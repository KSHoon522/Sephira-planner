"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { BagConfig, ComboGoal, ItemInstance, Layout, RelationRule } from "@/engine/types";
import { catalog } from "@/engine/catalog";
import { MAX_CELLS, MIN_CELLS, evaluate, type EvalOptions } from "@/engine/grid";
import { customId, parseCustomId, resolveTabletDef, type TabletPart } from "@/engine/custom";

export interface BagState {
  cfg: BagConfig;
  items: Record<string, ItemInstance>;
  cells: (string | null)[]; // length = cfg.cellCount
  evalOpts: EvalOptions & { edgeCountsAsEmpty: boolean; inactivePenalty: number; needleValue: number; comboGoals: ComboGoal[]; relations: RelationRule[] };
  selected: string | null; // selected uid
}

export type Action =
  | { type: "addItem"; kind: "artifact" | "tablet"; defId: string; place?: boolean; parts?: TabletPart[] }
  | { type: "removeItem"; uid: string }
  | { type: "place"; uid: string; index: number } // moves/swaps
  | { type: "unplace"; uid: string }
  | { type: "rotate"; uid: string; delta?: number }
  | { type: "setWeight"; uid: string; weight: number }
  | { type: "setEnchant"; uid: string; enchant: number }
  | { type: "toggleLock"; uid: string }
  | { type: "setCellCount"; count: number }
  | { type: "setWeapon"; weapon: string | null }
  | { type: "setEvalOpt"; key: "edgeCountsAsEmpty" | "inactivePenalty" | "needleValue"; value: number | boolean }
  | { type: "setComboGoals"; goals: ComboGoal[] }
  | { type: "setRelations"; relations: RelationRule[] }
  | { type: "select"; uid: string | null }
  | { type: "applyLayout"; cells: (string | null)[]; items: ItemInstance[] }
  | { type: "clearBag" }
  | { type: "reset" }
  | { type: "hydrate"; state: BagState };

const STORAGE_KEY = "sephiria-planner:v1";

export const initialState: BagState = {
  cfg: { width: 6, cellCount: 24, weapon: null },
  items: {},
  cells: new Array(24).fill(null),
  evalOpts: { edgeCountsAsEmpty: true, inactivePenalty: 10, needleValue: 2, comboGoals: [], relations: [] },
  selected: null,
};

let uidCounter = 0;
function newUid(prefix: string) {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

function firstEmpty(cells: (string | null)[]): number {
  return cells.findIndex((c) => c === null);
}

export function reducer(s: BagState, a: Action): BagState {
  switch (a.type) {
    case "hydrate": return a.state;
    case "addItem": {
      const uid = newUid(a.kind === "tablet" ? "t" : "a");
      const it: ItemInstance = a.kind === "tablet"
        ? (a.parts && a.parts.length ? { uid, kind: "tablet", defId: customId(a.parts), rotation: 0, parts: a.parts } : { uid, kind: "tablet", defId: a.defId, rotation: 0 })
        : { uid, kind: "artifact", defId: a.defId, weight: 1 };
      const cells = [...s.cells];
      if (a.place !== false) {
        const i = firstEmpty(cells);
        if (i >= 0) cells[i] = uid;
      }
      return { ...s, items: { ...s.items, [uid]: it }, cells, selected: uid };
    }
    case "removeItem": {
      const items = { ...s.items }; delete items[a.uid];
      const relations = (s.evalOpts.relations ?? []).filter((r) => r.a !== a.uid && r.b !== a.uid);
      return { ...s, items, cells: s.cells.map((c) => (c === a.uid ? null : c)), selected: s.selected === a.uid ? null : s.selected, evalOpts: { ...s.evalOpts, relations } };
    }
    case "place": {
      if (a.index < 0 || a.index >= s.cells.length) return s;
      const cells = [...s.cells];
      const from = cells.indexOf(a.uid);
      const other = cells[a.index];
      if (other === a.uid) return s;
      if (from >= 0) cells[from] = other; // swap (or null)
      else if (other) return s; // bench -> occupied cell: refuse
      cells[a.index] = a.uid;
      return { ...s, cells };
    }
    case "unplace": return { ...s, cells: s.cells.map((c) => (c === a.uid ? null : c)) };
    case "rotate": {
      const it = s.items[a.uid];
      if (!it || it.kind !== "tablet") return s;
      const def = resolveTabletDef(it, catalog);
      if (!def?.rotatable) return s;
      const rotation = (((it.rotation + (a.delta ?? 1)) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
      return { ...s, items: { ...s.items, [a.uid]: { ...it, rotation } } };
    }
    case "setWeight": {
      const it = s.items[a.uid];
      if (!it || it.kind !== "artifact") return s;
      return { ...s, items: { ...s.items, [a.uid]: { ...it, weight: Math.max(0, a.weight) } } };
    }
    case "setEnchant": {
      const it = s.items[a.uid];
      if (!it || it.kind !== "artifact") return s;
      return { ...s, items: { ...s.items, [a.uid]: { ...it, enchant: Math.max(0, Math.floor(a.enchant)) } } };
    }
    case "toggleLock": {
      const it = s.items[a.uid];
      if (!it) return s;
      return { ...s, items: { ...s.items, [a.uid]: { ...it, locked: !it.locked } } };
    }
    case "setCellCount": {
      const count = Math.min(MAX_CELLS, Math.max(MIN_CELLS, a.count));
      const cells = s.cells.slice(0, count);
      while (cells.length < count) cells.push(null);
      return { ...s, cfg: { ...s.cfg, cellCount: count }, cells };
    }
    case "setWeapon": return { ...s, cfg: { ...s.cfg, weapon: a.weapon } };
    case "setEvalOpt": return { ...s, evalOpts: { ...s.evalOpts, [a.key]: a.value } };
    case "setComboGoals": return { ...s, evalOpts: { ...s.evalOpts, comboGoals: a.goals } };
    case "setRelations": return { ...s, evalOpts: { ...s.evalOpts, relations: a.relations } };
    case "select": return { ...s, selected: a.uid };
    case "applyLayout": {
      const items = { ...s.items };
      for (const it of a.items) items[it.uid] = it;
      const cells = a.cells.slice(0, s.cfg.cellCount);
      while (cells.length < s.cfg.cellCount) cells.push(null);
      return { ...s, items, cells };
    }
    case "clearBag": return { ...s, cells: s.cells.map(() => null) };
    case "reset": return { ...initialState, cells: new Array(initialState.cfg.cellCount).fill(null) };
  }
}

export function useBag() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const hydrated = useRef(false);

  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BagState;
        if (parsed?.cfg && parsed.cells) { dispatch({ type: "hydrate", state: { ...initialState, ...parsed, evalOpts: { ...initialState.evalOpts, ...(parsed.evalOpts ?? {}) }, selected: null } }); restored = true; }
      }
    } catch { /* ignore */ }
    // when restoring, persisting is enabled only after the hydrated state has rendered (see below)
    if (!restored) hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) {
      if (state !== initialState) hydrated.current = true; // hydrate landed; nothing to write yet
      return;
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, selected: null })); } catch { /* ignore */ }
  }, [state]);

  const itemsMap = useMemo(() => new Map(Object.values(state.items).map((it) => [it.uid, it])), [state.items]);
  const layout: Layout = useMemo(() => ({ cells: state.cells }), [state.cells]);
  const result = useMemo(() => evaluate(layout, itemsMap, state.cfg, catalog, state.evalOpts), [layout, itemsMap, state.cfg, state.evalOpts]);
  const bench = useMemo(() => Object.values(state.items).filter((it) => !state.cells.includes(it.uid)), [state.items, state.cells]);

  const act = useCallback((a: Action) => dispatch(a), []);
  return { state, dispatch: act, itemsMap, result, bench };
}

export type BagApi = ReturnType<typeof useBag>;

/** Used by the screenshot importer: replaces the stored bag with recognised contents. */
export function writeImportedLayout(cellCount: number, entries: { index: number; kind: "artifact" | "tablet"; defId: string; rotation?: number; parts?: TabletPart[]; enchant?: number }[], merge = false) {
  let base: BagState = { ...initialState, cfg: { ...initialState.cfg, cellCount }, cells: new Array(cellCount).fill(null) };
  if (merge) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const p = JSON.parse(raw) as BagState; base = { ...base, cfg: { ...p.cfg, cellCount }, evalOpts: { ...base.evalOpts, ...(p.evalOpts ?? {}), relations: [] }, items: {} }; }
    } catch { /* ignore */ }
  }
  const items: Record<string, ItemInstance> = {};
  const cells = new Array<string | null>(cellCount).fill(null);
  for (const e of entries) {
    if (e.index < 0 || e.index >= cellCount) continue;
    const uid = newUid(e.kind === "tablet" ? "t" : "a");
    const rotation = (((e.rotation ?? 0) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
    const parts = e.parts ?? parseCustomId(e.defId) ?? undefined;
    items[uid] = e.kind === "tablet"
      ? (parts ? { uid, kind: "tablet", defId: customId(parts), rotation, parts } : { uid, kind: "tablet", defId: e.defId, rotation })
      : { uid, kind: "artifact", defId: e.defId, weight: 1, enchant: e.enchant && e.enchant > 0 ? e.enchant : undefined };
    cells[e.index] = uid;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, items, cells, selected: null }));
}
