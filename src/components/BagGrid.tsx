"use client";
import { useEffect, useMemo, useState } from "react";
import type { BagApi } from "@/store/useBag";
import { catalog } from "@/engine/catalog";
import { makeGeometry, rotateQuery, targetsOf, tabletConditionOk } from "@/engine/grid";
import { ItemIcon } from "./ItemIcon";
import { resolveTabletDef } from "@/engine/custom";

const CELL = 64;

export function BagGrid({ bag }: { bag: BagApi }) {
  const { state, dispatch, itemsMap, result } = bag;
  const g = useMemo(() => makeGeometry(state.cfg), [state.cfg]);
  const [dragUid, setDragUid] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // cells affected by the selected/hovered tablet
  const highlight = useMemo(() => {
    const map = new Map<number, string>();
    const uid = state.selected;
    if (!uid) return map;
    const it = itemsMap.get(uid);
    const idx = state.cells.indexOf(uid);
    if (!it || it.kind !== "tablet" || idx < 0) return map;
    const def = resolveTabletDef(it, catalog);
    if (!def) return map;
    const [tx, ty] = g.xy(idx);
    if (!tabletConditionOk(def, tx, ty, g)) return map;
    for (const q0 of def.queries) {
      const q = rotateQuery(q0, def.rotatable ? it.rotation : 0);
      for (const t of targetsOf(q, tx, ty, g)) {
        const prev = map.get(t) ?? "";
        const lbl = q.effect.kind === "level" ? (q.effect.value > 0 ? `+${q.effect.value}` : `${q.effect.value}`) : q.effect.kind === "ignore" ? "무시" : "×";
        map.set(t, prev ? `${prev} ${lbl}` : lbl);
      }
    }
    return map;
  }, [state.selected, state.cells, itemsMap, g]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state.selected) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "r" || e.key === "R") dispatch({ type: "rotate", uid: state.selected, delta: e.shiftKey ? -1 : 1 });
      if (e.key === "Delete" || e.key === "Backspace") dispatch({ type: "unplace", uid: state.selected });
      if (e.key === "l" || e.key === "L") dispatch({ type: "toggleLock", uid: state.selected });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.selected, dispatch]);

  const total = g.rows * g.width;
  return (
    <div className="inline-grid gap-1 p-2 rounded-lg bg-[var(--panel)] border border-[var(--line)]"
      style={{ gridTemplateColumns: `repeat(${g.width}, ${CELL}px)` }}>
      {Array.from({ length: total }, (_, i) => {
        if (i >= g.cellCount) return <div key={i} style={{ width: CELL, height: CELL }} className="rounded-md opacity-20 bg-[repeating-linear-gradient(45deg,transparent_0_6px,var(--line)_6px_8px)]" />;
        const c = result.cells[i];
        const uid = state.cells[i];
        const it = uid ? itemsMap.get(uid) : undefined;
        const def = it ? (it.kind === "tablet" ? resolveTabletDef(it, catalog) : catalog.artifacts.get(it.defId)) : undefined;
        const selected = uid && uid === state.selected;
        const hl = highlight.get(i);
        const isDropTarget = dragUid && hover === i;

        let border = "1px solid var(--line)";
        if (selected) border = "2px solid var(--accent)";
        else if (isDropTarget) border = "2px dashed var(--accent)";
        else if (hl) border = "2px solid color-mix(in oklab, var(--accent) 60%, transparent)";

        return (
          <div key={i}
            draggable={!!uid}
            onDragStart={(e) => { if (uid) { setDragUid(uid); e.dataTransfer.setData("text/uid", uid); e.dataTransfer.effectAllowed = "move"; } }}
            onDragEnd={() => { setDragUid(null); setHover(null); }}
            onDragOver={(e) => { e.preventDefault(); setHover(i); }}
            onDragLeave={() => setHover((h) => (h === i ? null : h))}
            onDrop={(e) => {
              e.preventDefault();
              const u = e.dataTransfer.getData("text/uid") || dragUid;
              if (u) dispatch({ type: "place", uid: u, index: i });
              setDragUid(null); setHover(null);
            }}
            onClick={() => {
              if (uid) dispatch({ type: "select", uid });
              else if (state.selected && !state.cells.includes(state.selected)) dispatch({ type: "place", uid: state.selected, index: i });
              else dispatch({ type: "select", uid: null });
            }}
            onDoubleClick={() => { if (uid) dispatch({ type: "rotate", uid }); }}
            onContextMenu={(e) => { e.preventDefault(); if (uid) dispatch({ type: "unplace", uid }); }}
            className="relative rounded-md flex items-center justify-center cursor-pointer select-none transition-colors"
            style={{ width: CELL, height: CELL, background: uid ? "var(--cell)" : "color-mix(in oklab, var(--cell) 60%, transparent)", border, opacity: it?.kind === "tablet" && !c.tabletActive ? 0.55 : 1 }}
            title={def ? `${def.nameKo} (${def.name})${it?.kind === "artifact" ? ` · Lv ${c.level} / ${c.maxLevel}${c.enchant ? ` (인챈트 ${c.enchant} + 석판 ${c.tabletLevel})` : ""}${c.active ? "" : " · 비활성: " + c.reasons.join(",")}` : ""}` : undefined}
          >
            {!uid && (
              <span className="font-mono text-xs" style={{ color: c.level > 0 ? "var(--good)" : c.level < 0 ? "var(--bad)" : "var(--line)" }}>
                {c.level > 0 ? `+${c.level}` : c.level < 0 ? c.level : "·"}
              </span>
            )}
            {it && def && (
              <ItemIcon id={def.id} label={def.nameKo} rarity={def.rarity} kind={it.kind} size={44} />
            )}
            {it?.kind === "artifact" && (
              <span className="absolute bottom-0.5 right-1 font-mono text-[11px] font-bold px-1 rounded"
                style={{ background: "rgba(0,0,0,.6)", color: !c.active ? "var(--bad)" : c.effectiveLevel >= c.maxLevel ? "var(--accent)" : "var(--good)" }}>
                {c.active ? `${c.effectiveLevel}/${c.maxLevel}` : `${c.level}✕`}
              </span>
            )}
            {it?.kind === "tablet" && def && "rotatable" in def && def.rotatable && (
              <span className="absolute top-0.5 right-1 text-[10px] text-[var(--muted)]" style={{ transform: `rotate(${it.rotation * 90}deg)`, display: "inline-block" }}>▲</span>
            )}
            {it?.kind === "tablet" && !c.tabletActive && (
              <span className="absolute bottom-0.5 left-1 text-[10px] text-[var(--bad)]">조건✕</span>
            )}
            {it?.locked && <span className="absolute top-0.5 left-1 text-[10px]">🔒</span>}
            {it?.kind === "artifact" && c.enchant > 0 && <span className="absolute top-0.5 right-1 text-[9px] font-bold text-[var(--accent)]">+{c.enchant}</span>}
            {c.needleHits > 0 && <span className="absolute bottom-0.5 left-1 text-[9px] font-bold text-[var(--good)]" title="북향의 금빛 침 효과">▲×{c.needleHits}</span>}
            {c.comboGrant.length > 0 && <span className="absolute top-0.5 left-1 text-[9px] font-bold text-[var(--accent)]" title={`콤보 +1: ${c.comboGrant.join(", ")}`}>#+</span>}
            {hl && (
              <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold px-1 rounded bg-[var(--accent)] text-black whitespace-nowrap">{hl}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
