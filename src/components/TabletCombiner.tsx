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
    <div className="flex flex-col gap-3 p-3 rounded-lg border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">석판 합성</h3>
        {onClose && <button onClick={onClose} className="text-xs px-2 py-1 rounded bg-[var(--panel-2)]">닫기</button>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {parts.map((p, i) => {
          const def = p.defId ? catalog.tablets.get(p.defId) : undefined;
          const nq = norm(q[i]);
          const list = nq ? sorted.filter((t) => norm(t.nameKo).includes(nq) || norm(t.name).includes(nq)).slice(0, 12) : [];
          return (
            <div key={i} className="flex flex-col gap-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">재료 {i + 1}</div>
              {def ? (
                <div className={`rarity-${def.rarity} flex items-center gap-2 p-1 rounded bg-[var(--panel-2)]`}>
                  <ItemIcon id={def.id} label={def.nameKo} rarity={def.rarity} kind="tablet" size={26} />
                  <span className="text-sm truncate" style={{ color: "var(--rc)" }}>{def.nameKo}</span>
                  <button onClick={() => setParts((ps) => ps.map((x, k) => (k === i ? { defId: "", rotation: 0 } : x)))} className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--bad)]">✕</button>
                </div>
              ) : (
                <input value={q[i]} onChange={(e) => setQ((qs) => qs.map((x, k) => (k === i ? e.target.value : x)))} placeholder="석판 검색…"
                  className="bg-[var(--panel-2)] border border-[var(--line)] rounded px-2 py-1 text-sm outline-none focus:border-[var(--accent)]" />
              )}
              {!def && list.map((t) => (
                <button key={t.id} onClick={() => setParts((ps) => ps.map((x, k) => (k === i ? { defId: t.id, rotation: 0 } : x)))}
                  className={`rarity-${t.rarity} flex items-center gap-2 text-left px-1 py-0.5 rounded hover:bg-[var(--panel-2)]`}>
                  <ItemIcon id={t.id} label={t.nameKo} rarity={t.rarity} kind="tablet" size={22} />
                  <span className="text-xs" style={{ color: "var(--rc)" }}>{RARITY_KO[t.rarity]} {t.nameKo}</span>
                  <span className="ml-auto"><TabletPattern def={t} cell={6} /></span>
                </button>
              ))}
              {def && (
                <div className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                  {def.rotatable ? (
                    <>
                      <span>회전</span>
                      {[0, 1, 2, 3].map((r) => (
                        <button key={r} onClick={() => setParts((ps) => ps.map((x, k) => (k === i ? { ...x, rotation: r as 0 | 1 | 2 | 3 } : x)))}
                          className={`px-1.5 rounded font-mono ${p.rotation === r ? "bg-[var(--accent)] text-black" : "bg-[var(--panel-2)]"}`}>{r * 90}</button>
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
        <div className="flex items-center gap-3 p-2 rounded bg-[var(--panel-2)]">
          <TabletPattern def={merged} cell={12} />
          <div className="text-xs text-[var(--muted)] flex-1">
            <div className="text-sm text-[var(--fg)]">{merged.nameKo}</div>
            <div>회전 불가{merged.conditions?.length ? ` · 조건: ${merged.conditions.map(condKo).join(" + ")}` : ""}</div>
            <div>레벨 합 {merged.queries.reduce((a, qq) => a + (qq.effect.kind === "level" && qq.type === "cell" ? qq.effect.value : 0), 0)} (단일 칸 기준)</div>
          </div>
          <button onClick={() => onCreate(parts)} className="px-3 py-1.5 rounded bg-[var(--accent)] text-black font-semibold text-sm">추가</button>
        </div>
      )}
      <p className="text-[10px] text-[var(--muted)]">합성 석판은 두 재료의 효과 영역·레벨·제약 무시·배치 조건을 모두 물려받고, 결과는 항상 회전 불가입니다. 재료 회전은 합성 시점의 방향입니다.</p>
    </div>
  );
}
