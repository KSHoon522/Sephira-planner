"use client";
import type { BagApi } from "@/store/useBag";
import { catalog } from "@/engine/catalog";
import { ItemIcon } from "./ItemIcon";
import { TabletPattern } from "./TabletPattern";
import { reasonKo } from "@/engine/labels";
import { resolveTabletDef } from "@/engine/custom";

/** All items (placed + bench) with weights, lock, rotate, remove. */
export function Inventory({ bag }: { bag: BagApi }) {
  const { state, dispatch, result } = bag;
  const items = Object.values(state.items);
  const artifacts = items.filter((i) => i.kind === "artifact");
  const tablets = items.filter((i) => i.kind === "tablet");

  const row = (it: (typeof items)[number]) => {
    const idx = state.cells.indexOf(it.uid);
    const placed = idx >= 0;
    const c = placed ? result.cells[idx] : null;
    const def = it.kind === "tablet" ? resolveTabletDef(it, catalog) : catalog.artifacts.get(it.defId);
    if (!def) return null;
    const selected = state.selected === it.uid;
    return (
      <div key={it.uid}
        draggable
        onDragStart={(e) => { e.dataTransfer.setData("text/uid", it.uid); }}
        onClick={() => dispatch({ type: "select", uid: it.uid })}
        className={`rarity-${def.rarity} flex items-center gap-2 p-1 rounded border cursor-pointer ${selected ? "border-[var(--accent)] bg-[var(--panel-2)]" : "border-transparent hover:bg-[var(--panel-2)]"}`}>
        <ItemIcon id={def.id} label={def.nameKo} rarity={def.rarity} kind={it.kind} size={28} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm">
            <span className="truncate font-medium" style={{ color: "var(--rc)" }}>{"parts" in def && def.parts ? "합성: " : ""}{def.nameKo}</span>
            {!placed && <span className="text-[10px] text-[var(--warn)]">미배치</span>}
            {it.locked && <span className="text-[10px]">🔒</span>}
          </div>
          {it.kind === "artifact" ? (
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              {c ? (
                <span style={{ color: c.active ? "var(--good)" : "var(--bad)" }}>
                  Lv {c.effectiveLevel}/{c.maxLevel}{!c.active && ` ✕ ${c.reasons.map(reasonKo).join(",")}`}
                </span>
              ) : <span>★{"maxLevel" in def ? def.maxLevel : ""}</span>}
              <label className="flex items-center gap-1 ml-auto" onClick={(e) => e.stopPropagation()} title="인챈트로 올린 기본 레벨 (석판과 별개로 합산)">
                인챈트
                <input type="number" min={0} max={"maxLevel" in def ? def.maxLevel : 9} step={1} value={it.enchant ?? 0}
                  onChange={(e) => dispatch({ type: "setEnchant", uid: it.uid, enchant: Number(e.target.value) })}
                  className="w-11 bg-[var(--panel)] border border-[var(--line)] rounded px-1 text-right" />
              </label>
              <label className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                중요도
                <input type="number" min={0} max={20} step={1} value={it.weight}
                  onChange={(e) => dispatch({ type: "setWeight", uid: it.uid, weight: Number(e.target.value) })}
                  className="w-12 bg-[var(--panel)] border border-[var(--line)] rounded px-1 text-right" />
              </label>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              {"rotatable" in def && def.rotatable ? <span>회전 {it.rotation * 90}°</span> : <span>회전불가</span>}
              {c && !c.tabletActive && <span className="text-[var(--bad)]">조건 불충족</span>}
            </div>
          )}
        </div>
        {it.kind === "tablet" && "queries" in def && <TabletPattern def={def} rotation={it.rotation} cell={8} />}
        <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
          {it.kind === "tablet" && "rotatable" in def && def.rotatable && (
            <button className="text-[11px] px-1 rounded bg-[var(--panel)] hover:bg-[var(--line)]" onClick={() => dispatch({ type: "rotate", uid: it.uid })} title="회전 (R)">↻</button>
          )}
          <button className="text-[11px] px-1 rounded bg-[var(--panel)] hover:bg-[var(--line)]" onClick={() => dispatch({ type: "toggleLock", uid: it.uid })} title="위치 고정 (L)">{it.locked ? "🔓" : "🔒"}</button>
          <button className="text-[11px] px-1 rounded bg-[var(--panel)] hover:bg-[var(--bad)]" onClick={() => dispatch({ type: "removeItem", uid: it.uid })} title="삭제">✕</button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-[var(--muted)] flex justify-between">
        <span>석판 {tablets.length}</span>
      </div>
      {tablets.map(row)}
      <div className="text-xs text-[var(--muted)] flex justify-between mt-2">
        <span>아티팩트 {artifacts.length}</span>
      </div>
      {artifacts.map(row)}
      {items.length === 0 && <div className="text-xs text-[var(--muted)] p-2">왼쪽 목록에서 석판/아티팩트를 클릭해 추가하세요.</div>}
    </div>
  );
}

