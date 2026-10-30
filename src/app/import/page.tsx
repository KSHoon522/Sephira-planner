"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ARTIFACTS, TABLETS, RARITY_KO, catalog } from "@/engine/catalog";
import { estimatePixelGrid, extractSprite, readBadge, sampleNativeCell, type Sprite } from "@/vision/sprite";
import { detectGrid, evenGrid, type Rect } from "@/vision/grid";
import { readCellText, type CellText } from "@/vision/text";
import { loadIconTemplates, loadLearnedTemplates, loadBundledTemplates, matchSprite, assignUnique, saveLearnedTemplate, clearLearnedTemplates, exportTemplateFile, importTemplateFile, legacyLearnedCount, clearLegacyLearned, type Template, type Match } from "@/vision/templates";
import { writeImportedLayout } from "@/store/useBag";
import { ItemIcon } from "@/components/ItemIcon";
import { TabletPattern } from "@/components/TabletPattern";
import { TabletCombiner } from "@/components/TabletCombiner";
import { customId, parseCustomId, tabletDefById } from "@/engine/custom";
import { evaluate } from "@/engine/grid";
import type { ItemInstance, Rarity } from "@/engine/types";

interface CellRec {
  index: number;
  rect: Rect;
  spr: Sprite | null; // null => empty
  badge: Rarity | null; // rarity read from the top-right badge (artifacts)
  matches: Match[];
  choice: string; // template key or "empty"
  rotation: number; // tablet rotation 0-3 (clockwise 90° steps)
  thumb: string;
  text: CellText;
}
const isRotatableId = (id: string) => !!tabletDefById(id, catalog)?.rotatable;
const isRotatableKey = (key: string) => key.startsWith("tablet:") && !!tabletDefById(key.slice(7), catalog)?.rotatable;

export default function ImportPage() {
  const router = useRouter();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [rows, setRows] = useState(4);
  const [lastRow, setLastRow] = useState(6);
  const [gridCells, setGridCells] = useState<Rect[] | null>(null);
  const [gridPitch, setGridPitch] = useState<number | null>(null);
  const [legacyCount, setLegacyCount] = useState(0);
  const [gridInfo, setGridInfo] = useState<string>("");
  const [cells, setCells] = useState<CellRec[]>([]);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState(true);
  const [picker, setPicker] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgDataRef = useRef<ImageData | null>(null);
  const drag = useRef<{ start: [number, number]; mode: "draw" | "move" | "resize"; orig?: Rect } | null>(null);
  const [scale, setScale] = useState(1);
  const cellCount = (rows - 1) * 6 + lastRow;

  useEffect(() => {
    loadIconTemplates((d, t) => setProgress([d, t])).then((icons) => {
      setTemplates([...icons, ...loadBundledTemplates(), ...loadLearnedTemplates()]);
      setLegacyCount(legacyLearnedCount());
    });
  }, []);

  const loadFile = useCallback((file: File | Blob) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      setImg(im); setCells([]); setGridCells(null);
      setRect({ x: 0, y: 0, w: im.naturalWidth, h: im.naturalHeight });
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(im, 0, 0);
      imgDataRef.current = ctx.getImageData(0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
    };
    im.src = url;
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (f) loadFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  // auto-detect grid whenever rect/rows change
  useEffect(() => {
    const id = imgDataRef.current;
    if (!id || !rect || rect.w < 30 || rect.h < 30) { setGridCells(null); return; }
    const fit = detectGrid(id, rect, 6, rows);
    setGridPitch(fit ? fit.pitchX : null);
    if (fit) { setGridCells(fit.cells); setGridInfo(`격자 감지됨 · 칸 ${fit.cellW.toFixed(0)}×${fit.cellH.toFixed(0)}px · 간격 ${fit.pitchX.toFixed(0)}px`); }
    else { setGridCells(evenGrid(rect, 6, rows)); setGridInfo("격자 자동 감지 실패 → 균등 분할 사용 (영역을 칸 테두리에 맞춰 조정하세요)"); }
  }, [rect, rows, img]);

  // draw
  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !img) return;
    const maxW = cv.parentElement?.clientWidth ?? 900;
    const s = Math.min(1, maxW / img.naturalWidth, 720 / img.naturalHeight);
    setScale(s);
    cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    if (rect) {
      ctx.strokeStyle = "rgba(240,179,90,.9)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.strokeRect(rect.x * s, rect.y * s, rect.w * s, rect.h * s);
      ctx.setLineDash([]);
    }
    if (gridCells) {
      gridCells.forEach((c, i) => {
        const dead = i >= cellCount;
        ctx.strokeStyle = dead ? "rgba(255,255,255,.25)" : "rgba(106,212,138,.9)"; ctx.lineWidth = 2;
        ctx.strokeRect(c.x * s, c.y * s, c.w * s, c.h * s);
        if (dead) { ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(c.x * s, c.y * s, c.w * s, c.h * s); }
      });
      ctx.font = "bold 12px sans-serif"; ctx.textBaseline = "top";
      for (const c of cells) {
        const label = labelOf(c.choice);
        const px = c.rect.x * s + 3, py = (c.rect.y + c.rect.h) * s - 17;
        const tw = ctx.measureText(label).width + 6;
        ctx.fillStyle = "rgba(0,0,0,.75)"; ctx.fillRect(px, py, tw, 15);
        ctx.fillStyle = c.choice === "empty" ? "#8a94a6" : "#f0b35a"; ctx.fillText(label, px + 3, py + 1);
      }
    }
  }, [img, rect, gridCells, cells, cellCount]);

  const toImg = (e: React.MouseEvent) => {
    const cv = canvasRef.current!; const b = cv.getBoundingClientRect();
    return [(e.clientX - b.left) / scale, (e.clientY - b.top) / scale] as [number, number];
  };
  const onDown = (e: React.MouseEvent) => {
    if (!img) return;
    const p = toImg(e);
    // click on a recognised cell => open picker
    if (cells.length && !e.shiftKey) {
      const hit = cells.find((c) => p[0] >= c.rect.x && p[0] <= c.rect.x + c.rect.w && p[1] >= c.rect.y && p[1] <= c.rect.y + c.rect.h);
      if (hit) { setPicker(hit.index); return; }
    }
    if (rect) {
      const inside = p[0] >= rect.x && p[0] <= rect.x + rect.w && p[1] >= rect.y && p[1] <= rect.y + rect.h;
      const nearCorner = Math.abs(p[0] - (rect.x + rect.w)) < 14 / scale && Math.abs(p[1] - (rect.y + rect.h)) < 14 / scale;
      if (nearCorner) { drag.current = { start: p, mode: "resize", orig: rect }; return; }
      if (inside && !e.shiftKey && cells.length === 0) { drag.current = { start: p, mode: "move", orig: rect }; return; }
    }
    drag.current = { start: p, mode: "draw" };
    setRect({ x: p[0], y: p[1], w: 0, h: 0 }); setCells([]);
  };
  const onMove = (e: React.MouseEvent) => {
    const d = drag.current; if (!d || !img) return;
    const p = toImg(e);
    if (d.mode === "draw") setRect({ x: Math.min(d.start[0], p[0]), y: Math.min(d.start[1], p[1]), w: Math.abs(p[0] - d.start[0]), h: Math.abs(p[1] - d.start[1]) });
    else if (d.mode === "move" && d.orig) setRect({ ...d.orig, x: d.orig.x + p[0] - d.start[0], y: d.orig.y + p[1] - d.start[1] });
    else if (d.mode === "resize" && d.orig) setRect({ ...d.orig, w: Math.max(30, d.orig.w + p[0] - d.start[0]), h: Math.max(30, d.orig.h + p[1] - d.start[1]) });
  };
  const onUp = () => { drag.current = null; };

  const recognise = async () => {
    const id = imgDataRef.current;
    if (!img || !gridCells || !templates || !id) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 10));
    const raster = { w: id.width, h: id.height, data: id.data };
    // recover the game's own pixel grid once for the whole bag, then read every cell at that resolution
    const first = gridCells[0], last = gridCells[cellCount - 1];
    const region = { x: first.x, y: first.y, w: last.x + last.w - first.x, h: last.y + last.h - first.y };
    const pg = estimatePixelGrid(raster, region, gridPitch ?? (gridCells[1] ? gridCells[1].x - first.x : first.w));
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    const out: CellRec[] = [];
    for (let i = 0; i < cellCount; i++) {
      const r = gridCells[i];
      const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
      cv.width = w; cv.height = h;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const text = readCellText(ctx.getImageData(0, 0, w, h));
      const tc = document.createElement("canvas"); tc.width = 44; tc.height = 44;
      tc.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, 44, 44);
      const native = sampleNativeCell(raster, r, pg);
      const spr = extractSprite(native);
      if (!spr) { out.push({ index: i, rect: r, spr: null, badge: null, matches: [], choice: "empty", rotation: 0, thumb: tc.toDataURL(), text }); continue; }
      const badge = text.kind === "tablet" ? null : readBadge(native);
      // narrow candidates using the level text: tablets vs artifacts with the same max level
      let pool = templates;
      if (text.kind === "tablet") pool = templates.filter((t) => t.kind === "tablet");
      else if (text.kind === "artifact") {
        const arts = templates.filter((t) => t.kind === "artifact");
        const byMax = text.max !== null ? arts.filter((t) => catalog.artifacts.get(t.defId)?.maxLevel === text.max) : arts.filter((t) => (catalog.artifacts.get(t.defId)?.maxLevel ?? 0) >= (text.cur ?? 0));
        pool = byMax.length ? byMax : arts;
      } else {
        // no level text: usually a level-0 artifact (e.g. 마음의 짐, 황금 단풍잎)
        const lv0 = templates.filter((t) => t.kind === "artifact" && catalog.artifacts.get(t.defId)?.maxLevel === 0);
        pool = lv0.length ? lv0 : templates;
      }
      const matches = matchSprite(spr, pool, { topN: 10, isRotatable: isRotatableId, badge });
      out.push({ index: i, rect: r, spr, badge, matches, choice: "empty", rotation: 0, thumb: tc.toDataURL(), text });
      if (i % 6 === 5) await new Promise((res) => setTimeout(res, 0)); // let the busy state paint
    }
    // one pass over the whole bag so a unique artifact is not given to two cells
    const picks = assignUnique(out.map((c) => c.matches));
    for (const [i, c] of out.entries()) {
      const m = c.matches[picks[i]];
      if (m) { c.choice = m.template.key; c.rotation = m.rotation; }
    }
    setCells(out);
    setBusy(false);
  };

  const setChoice = (index: number, choice: string, rotation?: number) => setCells((cs) => cs.map((x) => {
    if (x.index !== index) return x;
    const m = x.matches.find((mm) => mm.template.key === choice);
    return { ...x, choice, rotation: rotation ?? (choice === x.choice ? x.rotation : m?.rotation ?? 0) };
  }));
  const setRotation = (index: number, rotation: number) => setCells((cs) => cs.map((x) => (x.index === index ? { ...x, rotation: ((rotation % 4) + 4) % 4 } : x)));

  const learn = (c: CellRec) => {
    if (!c.spr || c.choice === "empty") return;
    const ci = c.choice.indexOf(":");
    const kind = c.choice.slice(0, ci) as "artifact" | "tablet", defId0 = c.choice.slice(ci + 1);
    // synthesised tablets all share one sprite → learn them under the generic "custom" key
    const defId = defId0.startsWith("custom:") ? "custom" : defId0;
    saveLearnedTemplate({ key: `${kind}:${defId}`, kind, defId, spr: c.spr, rot: kind === "tablet" ? c.rotation : 0 });
  };
  const refreshLearned = () => setTemplates((t) => (t ? [...t.filter((x) => x.source === "icon"), ...loadBundledTemplates(), ...loadLearnedTemplates()] : t));
  const [ioMsg, setIoMsg] = useState("");
  const exportTemplates = () => {
    const file = exportTemplateFile();
    const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "learned-templates.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setIoMsg(`${file.templates.length}개 템플릿 내보냄 → src/data/learned-templates.json 으로 덮어쓰면 배포에 포함됩니다.`);
  };
  const importTemplates = async (f: File) => {
    try { const n = importTemplateFile(await f.text()); refreshLearned(); setIoMsg(`${n}개 템플릿 가져옴`); }
    catch (e) { setIoMsg(`가져오기 실패: ${(e as Error).message}`); }
  };
  const learnAll = () => { cells.forEach(learn); refreshLearned(); };

  const unspecifiedCustom = cells.filter((c) => c.choice === "tablet:custom").length;
  const apply = () => {
    if (unspecifiedCustom > 0 && !confirm(`재료가 지정되지 않은 합성 석판 ${unspecifiedCustom}개는 빈 칸으로 적용됩니다. 계속할까요?`)) return;
    const entries = cells.filter((c) => c.choice !== "empty" && c.choice !== "tablet:custom").map((c) => {
      const ci = c.choice.indexOf(":");
      const kind = c.choice.slice(0, ci) as "artifact" | "tablet", defId = c.choice.slice(ci + 1);
      return { index: c.index, kind, defId, rotation: kind === "tablet" ? c.rotation : 0, parts: parseCustomId(defId) ?? undefined, enchant: 0, cur: c.text.kind === "artifact" ? c.text.cur : null };
    });
    // Infer enchant levels: the level shown in-game = enchant + tablet effects. Simulate the recognised
    // layout once and attribute any surplus to enchant.
    const sim = new Map<string, ItemInstance>();
    const simCells = new Array<string | null>(cellCount).fill(null);
    entries.forEach((e, k) => {
      const uid = `s${k}`;
      sim.set(uid, e.kind === "tablet"
        ? { uid, kind: "tablet", defId: e.parts ? customId(e.parts) : e.defId, rotation: e.rotation as 0 | 1 | 2 | 3, parts: e.parts }
        : { uid, kind: "artifact", defId: e.defId, weight: 1 });
      simCells[e.index] = uid;
    });
    const res = evaluate({ cells: simCells }, sim, { width: 6, cellCount, weapon: null }, catalog);
    for (const e of entries) {
      if (e.kind !== "artifact" || e.cur === null) continue;
      const tabletLv = res.cells[e.index].tabletLevel;
      e.enchant = Math.max(0, e.cur - Math.max(0, tabletLv));
    }
    writeImportedLayout(cellCount, entries, merge);
    router.push("/");
  };

  const iconsAvailable = templates ? templates.filter((t) => t.source === "icon").length : 0;
  const learnedCount = templates ? templates.filter((t) => t.source === "learned").length : 0;
  const bundledCount = templates ? templates.filter((t) => t.source === "bundled").length : 0;
  const pickerCell = picker !== null ? cells.find((c) => c.index === picker) ?? null : null;

  return (
    <div className="p-3 grid gap-3 lg:h-[calc(100vh-50px)] min-h-0 grid-cols-1 lg:grid-cols-[1fr_420px]">
      <section className="min-h-0 overflow-auto scroll-thin flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="px-btn px-btn-gold">
            스크린샷 열기
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </label>
          <span className="text-[var(--muted)]">또는 붙여넣기(Ctrl/⌘+V) · 드롭</span>
          <button onClick={async () => { const b = await fetch("/samples/bag1.png").then((r) => r.blob()); loadFile(b); setRows(6); }} className="px-btn">샘플 불러오기</button>
          <span className="ml-auto text-tiny text-[var(--muted)]">
            아이콘 {templates ? `${iconsAvailable}` : `${progress[0]}/${progress[1]}`} · 내장 학습 {bundledCount} · 내 학습 {learnedCount}
          </span>
        </div>
        {templates && iconsAvailable === 0 && (
          <div className="px-panel text-[var(--warn)] p-2">
            public/icons 에 아이콘이 없습니다. <code>node scripts/fetch-icons.mjs</code> 실행 후 새로고침하세요.
          </div>
        )}
        <div className="relative px-panel px-window min-h-[300px] flex items-center justify-center overflow-hidden"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f); }}>
          {!img ? (
            <div className="text-[var(--muted)] text-center p-8 leading-relaxed">
              게임 가방 화면 캡쳐를 드롭하거나 붙여넣으세요.<br />
              가방 격자(칸 테두리)가 잘 보이게 캡쳐할수록 자동 감지가 정확합니다.
            </div>
          ) : (
            <canvas ref={canvasRef} className="cursor-crosshair max-w-full" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} />
          )}
        </div>
        {img && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">행 수
              <input type="number" min={4} max={7} value={rows} onChange={(e) => setRows(Math.min(7, Math.max(4, Number(e.target.value))))} className="w-14 px-input" />
            </label>
            <label className="flex items-center gap-2">마지막 행 칸 수
              <input type="number" min={1} max={6} value={lastRow} onChange={(e) => setLastRow(Math.min(6, Math.max(1, Number(e.target.value))))} className="w-14 px-input" />
            </label>
            <span className="text-[var(--muted)]">= {cellCount}칸</span>
            <button onClick={() => { setRect({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }); setCells([]); }} className="px-btn">영역 = 전체</button>
            <span style={{ color: gridCells && gridInfo.startsWith("격자 감지") ? "var(--good)" : "var(--warn)" }}>{gridInfo}</span>
            <button disabled={!gridCells || !templates || busy} onClick={recognise} className="ml-auto px-btn px-btn-gold">
              {busy ? "인식 중…" : cells.length ? "다시 인식" : "인식"}
            </button>
          </div>
        )}
        {img && <p className="text-tiny text-[var(--muted)]">가방 전체가 화면에 있으면 &quot;영역 = 전체&quot;로 충분합니다. 다른 UI가 섞여 있으면 가방 주변을 드래그해 영역을 지정하세요 (Shift+드래그: 새로 그리기, 우하단 모서리: 크기). 인식 후 칸을 클릭하면 직접 지정할 수 있습니다.</p>}
      </section>

      <aside className="min-h-0 overflow-y-auto scroll-thin px-panel p-3 flex flex-col gap-2">
        {pickerCell ? (
          <Picker cell={pickerCell} onPick={(key, rot) => { setChoice(pickerCell.index, key, rot); setPicker(null); }} onRotate={(r) => setRotation(pickerCell.index, r)} onClose={() => setPicker(null)} />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="px-title flex-1">인식 결과 ({cells.length})</h3>
              {cells.length > 0 && <button onClick={learnAll} className="px-btn ml-2" title="현재 선택된 값들을 모두 학습 템플릿으로 저장 — 다음부터 같은 아이템은 정확히 인식됩니다">전체 학습</button>}
            </div>
            {cells.length === 0 && <p className="text-[var(--muted)] leading-relaxed">인식 결과가 여기에 표시됩니다. 처음엔 참조 아이콘과 게임 스프라이트 차이로 오인식이 있을 수 있어요. 칸을 클릭해 올바른 아이템을 고른 뒤 &quot;전체 학습&quot;을 누르면 이후 정확도가 크게 올라갑니다.</p>}
            {cells.map((c) => {
              const best = c.matches.find((m) => m.template.key === c.choice);
              // native-pixel distance: the same item scores ~0.2-0.3, look-alikes (other grimoires) ~0.45, others 0.6+
              const conf = best ? Math.max(0, Math.min(1, 1 - (best.dist - 0.15) / 0.45)) : 0;
              return (
                <div key={c.index} className="px-row flex items-center gap-2 p-1 bg-[var(--panel-2)] cursor-pointer" onClick={() => setPicker(c.index)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.thumb} alt="" width={36} height={36} className="shadow-[0_0_0_2px_var(--frame-dark)]" style={{ imageRendering: "pixelated" }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 text-tiny text-[var(--muted)]">
                      <span>#{c.index + 1}</span>
                      <span>({c.index % 6 + 1},{Math.floor(c.index / 6) + 1})</span>
                      {c.text.kind !== "none" && <span className="text-[var(--accent)]">{c.text.kind === "tablet" ? "석판" : `Lv ${c.text.cur ?? "?"}/${c.text.max ?? "?"}`}</span>}
                      {c.badge && <span className={`rarity-${c.badge}`} style={{ color: "var(--rc)" }} title="칸 오른쪽 위 표시로 읽은 등급">{RARITY_KO[c.badge]}</span>}
                      {c.spr && best && <span style={{ color: conf > 0.6 ? "var(--good)" : conf > 0.35 ? "var(--warn)" : "var(--bad)" }}>신뢰도 {(conf * 100).toFixed(0)}%</span>}
                    </div>
                    <div className="truncate flex items-center gap-1" style={{ color: c.choice === "empty" ? "var(--muted)" : "var(--fg)" }}>
                      {labelOf(c.choice)}
                      {c.choice === "tablet:custom" && <span className="text-tiny px-1 bg-[var(--bad)] text-[#2b0709]">재료 지정 필요</span>}
                      {isRotatableKey(c.choice) && (
                        <button onClick={(e) => { e.stopPropagation(); setRotation(c.index, c.rotation + 1); }} className="px-btn px-btn-sm text-tiny" title="회전 (클릭: +90°)">
                          ↻{c.rotation * 90}°
                        </button>
                      )}
                    </div>
                  </div>
                  <ChoiceIcon choice={c.choice} />
                </div>
              );
            })}
            {cells.length > 0 && (
              <div className="sticky bottom-0 bg-[var(--panel)] pt-2 flex flex-col gap-2 border-t-2 border-[var(--frame-dark)]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} /> 기존 설정(무기 등) 유지하고 아이템만 교체</label>
                <button onClick={apply} className="py-2 px-btn px-btn-good">가방에 적용 → 배치 화면으로</button>
              </div>
            )}
            <div className="mt-auto pt-2 flex flex-col gap-1 text-[var(--muted)] border-t-2 border-[var(--frame-dark)]">
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={exportTemplates} className="px-btn" title="내장+내 학습 템플릿을 JSON으로 저장. src/data/learned-templates.json 에 넣고 배포하면 모든 사용자에게 적용">학습 내보내기</button>
                <label className="px-btn">학습 가져오기
                  <input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importTemplates(f); e.target.value = ""; }} />
                </label>
                <button onClick={() => { if (confirm("내 학습 템플릿을 모두 삭제할까요? (내장 템플릿은 유지)")) { clearLearnedTemplates(); refreshLearned(); } }} className="px-btn px-btn-ghost">내 학습 초기화</button>
              </div>
              {ioMsg && <div className="text-[var(--accent)]">{ioMsg}</div>}
              {legacyCount > 0 && (
                <div className="text-[var(--warn)]">
                  이전 인식 방식으로 저장된 학습 {legacyCount}개는 새 방식과 맞지 않아 쓰지 않습니다. 캡쳐를 다시 인식해서 학습해 주세요.{" "}
                  <button onClick={() => { clearLegacyLearned(); setLegacyCount(0); }} className="px-btn px-btn-sm px-btn-ghost">이전 학습 지우기</button>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Picker({ cell, onPick, onRotate, onClose }: { cell: CellRec; onPick: (key: string, rot?: number) => void; onRotate: (r: number) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [combine, setCombine] = useState(cell.choice === "tablet:custom" || cell.choice.startsWith("tablet:custom:"));
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const list = useMemo(() => {
    const nq = norm(q);
    const all = [
      ...TABLETS.map((t) => ({ key: `tablet:${t.id}`, ko: t.nameKo, en: t.name, rarity: t.rarity, kind: "tablet" as const, id: t.id })),
      ...ARTIFACTS.map((a) => ({ key: `artifact:${a.id}`, ko: a.nameKo, en: a.name, rarity: a.rarity, kind: "artifact" as const, id: a.id })),
    ];
    return nq ? all.filter((x) => norm(x.ko).includes(nq) || norm(x.en).includes(nq)).slice(0, 60) : [];
  }, [q]);
  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cell.thumb} alt="" width={44} height={44} className="shadow-[0_0_0_2px_var(--frame-dark)]" style={{ imageRendering: "pixelated" }} />
        <div className="px-title flex-1">칸 #{cell.index + 1} 지정</div>
        <button onClick={onClose} className="px-btn px-btn-sm">닫기</button>
      </div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 검색 (한/영)…"
        className="px-input" />
      {isRotatableKey(cell.choice) && (
        <div className="flex items-center gap-1 text-[var(--muted)]">
          <span>회전</span>
          {[0, 1, 2, 3].map((r) => (
            <button key={r} onClick={() => onRotate(r)} className={`px-btn px-btn-sm ${cell.rotation === r ? "px-btn-on" : ""}`}>{r * 90}°</button>
          ))}
          <TabletMini id={cell.choice.slice(7)} rotation={cell.rotation} />
        </div>
      )}
      <button onClick={() => onPick("empty")} className="px-row text-left px-2 py-1 text-[var(--muted)]">(빈 칸)</button>
      <button onClick={() => setCombine((v) => !v)} className="px-row text-left px-2 py-1 text-[var(--accent)]">{combine ? "합성 닫기" : "합성 석판으로 지정…"}</button>
      {combine && (
        <>
          <button onClick={() => onPick("tablet:custom", 0)} className="px-row text-left px-2 py-1 text-[var(--muted)]">합성 석판 (재료 나중에 지정)</button>
          <TabletCombiner initial={parseCustomId(cell.choice.startsWith("tablet:") ? cell.choice.slice(7) : "") ?? undefined} onCreate={(parts) => onPick(`tablet:${customId(parts)}`, 0)} />
        </>
      )}
      {cell.matches.length > 0 && !q && (
        <>
          <div className="text-tiny text-[var(--muted)]">추천</div>
          {cell.matches.map((m) => <PickRow key={m.template.key} k={m.template.key} onPick={(k) => onPick(k, m.rotation)} extra={`${m.dist.toFixed(2)}${m.template.kind === "tablet" && isRotatableId(m.template.defId) ? ` · ${m.rotation * 90}°` : ""}`} />)}
        </>
      )}
      {list.map((x) => <PickRow key={x.key} k={x.key} onPick={onPick} />)}
    </div>
  );
}

function PickRow({ k, onPick, extra }: { k: string; onPick: (key: string) => void; extra?: string }) {
  const idx = k.indexOf(":");
  const kind = k.slice(0, idx) as "artifact" | "tablet", id = k.slice(idx + 1);
  const d = kind === "tablet" ? tabletDefById(id, catalog) : catalog.artifacts.get(id);
  if (!d) return null;
  return (
    <button onClick={() => onPick(k)} className={`rarity-${d.rarity} px-row flex items-center gap-2 text-left px-1 py-1`}>
      <ItemIcon id={d.id} label={d.nameKo} rarity={d.rarity} kind={kind} size={26} />
      <span className="font-bold" style={{ color: "var(--rc)" }}>{kind === "tablet" ? "석판 · " : ""}{d.nameKo}</span>
      <span className="text-tiny text-[var(--muted)] truncate">{d.name}</span>
      {extra && <span className="ml-auto text-tiny text-[var(--muted)]">{extra}</span>}
    </button>
  );
}

function TabletMini({ id, rotation }: { id: string; rotation: number }) {
  const def = tabletDefById(id, catalog);
  if (!def) return null;
  return <span className="ml-1"><TabletPattern def={def} rotation={rotation} cell={7} /></span>;
}

function labelOf(key: string) {
  if (key === "empty") return "빈 칸";
  const idx = key.indexOf(":");
  const kind = key.slice(0, idx), id = key.slice(idx + 1);
  const d = kind === "tablet" ? tabletDefById(id, catalog) : catalog.artifacts.get(id);
  if (d && kind === "tablet" && "parts" in d && d.parts) return `합성 ${d.nameKo}`;
  return d ? (kind === "tablet" ? `석판 ${d.nameKo}` : d.nameKo) : key;
}

function ChoiceIcon({ choice }: { choice: string }) {
  if (choice === "empty") return <div className="w-7 h-7 border-2 border-dashed border-[var(--line)]" />;
  const idx = choice.indexOf(":");
  const kind = choice.slice(0, idx) as "artifact" | "tablet", id = choice.slice(idx + 1);
  const d = kind === "tablet" ? tabletDefById(id, catalog) : catalog.artifacts.get(id);
  if (!d) return null;
  if (kind === "tablet" && "parts" in d && d.parts) return <TabletPattern def={d} cell={6} />;
  return <ItemIcon id={d.id} label={d.nameKo} rarity={d.rarity} kind={kind} size={28} />;
}
