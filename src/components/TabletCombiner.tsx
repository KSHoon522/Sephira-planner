"use client";
import { useMemo, useState } from "react";
import { TABLETS, catalog, RARITY_KO, RARITY_ORDER } from "@/engine/catalog";
import { buildCustomTablet, type TabletPart } from "@/engine/custom";
import { condKo } from "@/engine/labels";
import { ItemIcon } from "./ItemIcon";
import { TabletPattern } from "./TabletPattern";

/** Picks two tablets (+ their rotations) and previews the synthesised result. */
export function TabletCombiner({ onCreate, onClose, initial }: { onCreate: (parts: TabletPart[]) => void; onClose?: () => void; initial?: TabletPart[] }) {
  const [parts, setParts] = useState<TabletPart[]>(initial?.length ? initial : [{ defId: "", rotation: 0 }, { defId: "", rotation: 0 }]);
  const [q, setQ] = useState(["", ""]);
  const sorted = useMemo(() => TABLETS.filter((t) => t.id !== "custom").sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || a.nameKo.localeCompare(b.nameKo, "ko")), []);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const ready = parts.every((p) => p.defId);
  const merged = ready ? buildCustomTablet(parts, catalog) : undefined;

  return (
    <div className="flex flex-col gap-3 p-3 px-panel">
      <div className="flex items-center justify-between">
        <h3 className="px-title flex-1">석판 합성</h3>
        {onClose && <button onClick={onClose} className="px-btn px-btn-sm ml-2">닫기</button>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {parts.map((p, i) => {
          const def = p.defId ? catalog.tablets.get(p.defId) : undefined;
          const nq = norm(q[i]);
          const list = nq ? sorted.filter((t) => norm(t.nameKo).includes(nq) || norm(t.name).includes(nq)).slice(0, 12) : [];
          return (
            <div key={i} className="flex flex-col gap-1 min-w-0">
              <div className="text-tiny text-[var(--muted)]">재료 {i + 1}</div>
              {def ? (
                <div className={`rarity-${def.rarity} flex items-center gap-2 p-1 bg-[var(--panel-2)]`}>
                  <ItemIcon id={def.id} label={def.nameKo} rarity={def.rarity} kind="tablet" size={26} />
                  <span className="truncate font-bold" style={{ color: "var(--rc)" }}>{def.nameKo}</span>
                  <button onClick={() => setParts((ps) => ps.map((x, k) => (k === i ? { defId: "", rotation: 0 } : x)))} className="ml-auto px-btn px-btn-ghost px-btn-sm text-[var(--muted)]">✕</button>
                </div>
              ) : (
                <input value={q[i]} onChange={(e) => setQ((qs) => qs.map((x, k) => (k === i ? e.target.value : x)))} placeholder="석판 검색…"
                  className="px-input" />
              )}
              {!def && list.map((t) => (
                <button key={t.id} onClick={() => setParts((ps) => ps.map((x, k) => (k === i ? { defId: t.id, rotation: 0 } : x)))}
                  className={`rarity-${t.rarity} px-row flex items-center gap-2 text-left px-1 py-0.5`}>
                  <ItemIcon id={t.id} label={t.nameKo} rarity={t.rarity} kind="tablet" size={22} />
                  <span style={{ color: "var(--rc)" }}>{RARITY_KO[t.rarity]} {t.nameKo}</span>
                  <span className="ml-auto"><TabletPattern def={t} cell={6} /></span>
                </button>
              ))}
              {def && (
                <div className="flex items-center gap-1 text-tiny text-[var(--muted)]">
                  {def.rotatable ? (
                    <>
                      <span>회전</span>
                      {[0, 1, 2, 3].map((r) => (
                        <button key={r} onClick={() => setParts((ps) => ps.map((x, k) => (k === i ? { ...x, rotation: r as 0 | 1 | 2 | 3 } : x)))}
                          className={`px-btn px-btn-sm ${p.rotation === r ? "px-btn-on" : ""}`}>{r * 90}</button>
                      ))}
                    </>
                  ) : <span className="text-[var(--warn)]">회전불가</span>}
                  {def.condition && <span className="text-[var(--warn)]">· {condKo(def.condition)}</span>}
                  <span className="ml-auto"><TabletPattern def={def} rotation={p.rotation} cell={7} /></span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {merged && (
        <div className="flex items-center gap-3 p-2 bg-[var(--panel-2)]">
          <TabletPattern def={merged} cell={12} />
          <div className="text-tiny text-[var(--muted)] flex-1">
            <div className="text-xs font-bold text-[var(--fg)]">{merged.nameKo}</div>
            <div>{merged.rotatable ? "회전 가능" : "회전 불가"}{merged.conditions?.length ? ` · 조건: ${merged.conditions.map(condKo).join(" + ")}` : ""}</div>
            <div>레벨 합 {merged.queries.reduce((a, qq) => a + (qq.effect.kind === "level" && qq.type === "cell" ? qq.effect.value : 0), 0)} (단일 칸 기준)</div>
          </div>
          <button onClick={() => onCreate(parts)} className="px-btn px-btn-gold">추가</button>
        </div>
      )}
      <p className="text-tiny text-[var(--muted)]">합성 석판은 두 재료의 효과 영역·레벨·제약 무시·배치 조건을 모두 물려받습니다. 두 재료가 모두 회전 가능하면 결과도 통째로 회전할 수 있고, 하나라도 회전 불가면 회전 불가입니다. 재료 회전은 합성 시점의 방향입니다.</p>
    </div>
  );
}
