import type {
  ArtifactDef, BagConfig, CellEffect, CellResult, ComboGoal, EvalResult, ItemInstance, Layout, RelationRule, TabletDef, TabletQuery,
} from "./types";
import { resolveTabletDef } from "./custom";

export const BAG_WIDTH = 6;
export const MIN_CELLS = 24;
export const MAX_CELLS = 42;

export interface Geometry {
  width: number;
  cellCount: number;
  rows: number;
  bottomOf: (x: number) => number;
  exists: (x: number, y: number) => boolean;
  index: (x: number, y: number) => number;
  xy: (i: number) => [number, number];
}

export function makeGeometry(cfg: BagConfig): Geometry {
  const width = cfg.width || BAG_WIDTH;
  const cellCount = cfg.cellCount;
  const rows = Math.ceil(cellCount / width);
  const rem = cellCount % width;
  const bottomOf = (x: number) => (rem === 0 || x < rem ? rows - 1 : rows - 2);
  const exists = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y * width + x < cellCount;
  return {
    width, cellCount, rows, bottomOf, exists,
    index: (x, y) => y * width + x,
    xy: (i) => [i % width, Math.floor(i / width)],
  };
}

export function rotateOffset(dx: number, dy: number, rotation: number): [number, number] {
  let x = dx, y = dy;
  for (let r = 0; r < ((rotation % 4) + 4) % 4; r++) {
    const nx = -y, ny = x; // 90° clockwise (screen coords, y down)
    x = nx; y = ny;
  }
  return [x, y];
}

export function rotateQuery(q: TabletQuery, rotation: number): TabletQuery {
  const r = ((rotation % 4) + 4) % 4;
  switch (q.type) {
    case "cell": {
      const [dx, dy] = rotateOffset(q.dx, q.dy, r);
      return { ...q, dx, dy };
    }
    case "row": return r % 2 === 1 ? { type: "column", effect: q.effect } : q;
    case "column": return r % 2 === 1 ? { type: "row", effect: q.effect } : q;
    case "diagonal": return r % 2 === 1 ? { ...q, dir: q.dir === "slash" ? "backslash" : "slash" } : q;
    default: return q;
  }
}

/** Indices of cells targeted by a query from a tablet at (tx, ty). Excludes the tablet's own cell. */
export function targetsOf(q: TabletQuery, tx: number, ty: number, g: Geometry): number[] {
  const out: number[] = [];
  const push = (x: number, y: number) => { if (g.exists(x, y) && !(x === tx && y === ty)) out.push(g.index(x, y)); };
  switch (q.type) {
    case "cell": push(tx + q.dx, ty + q.dy); break;
    case "row": for (let x = 0; x < g.width; x++) push(x, ty); break;
    case "column": for (let y = 0; y < g.rows; y++) push(tx, y); break;
    case "diagonal":
      for (let y = 0; y < g.rows; y++) {
        const d = y - ty;
        push(q.dir === "backslash" ? tx + d : tx - d, y);
      }
      break;
    case "top-row": for (let x = 0; x < g.width; x++) push(x, 0); break;
    case "bottom-cells": for (let x = 0; x < g.width; x++) push(x, g.bottomOf(x)); break;
    case "checkerboard":
      for (let i = 0; i < g.cellCount; i++) {
        const [x, y] = g.xy(i);
        const par = Math.abs((x - tx) + (y - ty)) % 2;
        if ((q.parity === "odd") === (par === 1)) push(x, y);
      }
      break;
  }
  return out;
}

export function tabletConditionOk(def: TabletDef, x: number, y: number, g: Geometry): boolean {
  const list = def.conditions && def.conditions.length ? def.conditions : [def.condition];
  return list.every((c) => singleConditionOk(c, x, y, g));
}

function singleConditionOk(condition: TabletDef["condition"], x: number, y: number, g: Geometry): boolean {
  switch (condition) {
    case null: return true;
    case "left-end": return x === 0;
    case "right-end": return x === g.width - 1;
    case "left-or-right-end": return x === 0 || x === g.width - 1;
    case "top": return y === 0;
    case "bottom": return y === g.bottomOf(x);
  }
}

export function isEdgeCell(x: number, y: number, g: Geometry): boolean {
  return !g.exists(x - 1, y) || !g.exists(x + 1, y) || !g.exists(x, y - 1) || !g.exists(x, y + 1);
}

export interface EvalOptions {
  /** out-of-bag neighbour counts as "empty" for both-sides-empty restriction */
  edgeCountsAsEmpty?: boolean;
  /** score penalty multiplier for an inactive artifact (times its weight) */
  inactivePenalty?: number;
  /** combo targets: score += weight when combos[category] >= count */
  comboGoals?: ComboGoal[];
  /** 북향의 금빛 침: each needle reaching an artifact adds needleValue × that artifact's weight */
  needleValue?: number;
  /** user-defined placement relations between two items */
  relations?: RelationRule[];
}

export const WHITE_PAPER = "white-paper";
export const CHALCEDONY_KEY = "chalcedony-key";
export const GOLDEN_NEEDLE = "golden-needle-of-the-north";
/** 캘세더니 열쇠: row 1 견고, 2 잉걸불, 3 빙하, 4 마법공학, then repeats */
export const CHALCEDONY_ROWS = ["Sturdy", "Ember", "Glacier", "Magitech"];

export interface Catalog {
  artifacts: Map<string, ArtifactDef>;
  tablets: Map<string, TabletDef>;
}

export function evaluate(
  layout: Layout, items: Map<string, ItemInstance>, cfg: BagConfig, catalog: Catalog, opts: EvalOptions = {},
): EvalResult {
  const g = makeGeometry(cfg);
  const N = g.cellCount;
  const edgeEmpty = opts.edgeCountsAsEmpty ?? true;
  const penalty = opts.inactivePenalty ?? 10;

  const level = new Array<number>(N).fill(0);
  const ignored = new Array<boolean>(N).fill(false);
  const disabled = new Array<boolean>(N).fill(false);
  const tabletActive = new Array<boolean>(N).fill(false);

  // Pass 1: apply tablets
  for (let i = 0; i < N; i++) {
    const uid = layout.cells[i];
    if (!uid) continue;
    const it = items.get(uid);
    if (!it || it.kind !== "tablet") continue;
    const def = resolveTabletDef(it, catalog);
    if (!def) continue;
    const [tx, ty] = g.xy(i);
    if (!tabletConditionOk(def, tx, ty, g)) continue;
    tabletActive[i] = true;
    const rot = def.rotatable ? it.rotation : 0;
    for (const q0 of def.queries) {
      const q = rotateQuery(q0, rot);
      for (const t of targetsOf(q, tx, ty, g)) applyEffect(q.effect, t);
    }
  }
  function applyEffect(e: CellEffect, t: number) {
    if (e.kind === "level") level[t] += e.value;
    else if (e.kind === "ignore") ignored[t] = true;
    else disabled[t] = true;
  }

  // Pass 2: artifacts
  const cells: CellResult[] = [];
  const combos: Record<string, number> = {};
  let score = 0, totalEffective = 0, activeCount = 0, artifactCount = 0;
  for (let i = 0; i < N; i++) {
    const uid = layout.cells[i];
    const it = uid ? items.get(uid) : undefined;
    const [x, y] = g.xy(i);
    const base: CellResult = {
      index: i, uid: uid ?? null, kind: "empty", level: level[i], tabletLevel: level[i], enchant: 0, effectiveLevel: 0, maxLevel: 0,
      ignored: ignored[i], disabled: disabled[i], restrictionOk: true, weaponOk: true,
      tabletActive: tabletActive[i], active: false, reasons: [], needleHits: 0, comboGrant: [],
    };
    if (!it) { cells.push(base); continue; }
    if (it.kind === "tablet") {
      base.kind = "tablet";
      base.active = tabletActive[i];
      if (!tabletActive[i]) base.reasons.push("condition");
      cells.push(base); continue;
    }
    const def = catalog.artifacts.get(it.defId);
    if (!def) { cells.push(base); continue; }
    artifactCount++;
    for (const c of def.categories) combos[c] = (combos[c] ?? 0) + 1;
    base.kind = "artifact";
    base.enchant = Math.max(0, it.enchant ?? 0);
    base.level = level[i] + base.enchant;
    base.maxLevel = def.maxLevel;
    base.restrictionOk = restrictionOk(def.restriction, x, y, g, layout, edgeEmpty);
    base.weaponOk = !def.weapon || !cfg.weapon || def.weapon === cfg.weapon;
    const reasons: string[] = [];
    if (disabled[i]) reasons.push("disabled");
    if (base.level < 0) reasons.push("negative");
    if (!base.restrictionOk && !ignored[i]) reasons.push("restriction");
    if (!base.weaponOk) reasons.push("weapon");
    base.reasons = reasons;
    base.active = reasons.length === 0;
    base.effectiveLevel = base.active ? Math.min(Math.max(base.level, 0), def.maxLevel) : 0;
    if (base.active) {
      activeCount++;
      totalEffective += base.effectiveLevel;
      score += it.weight * base.effectiveLevel;
    } else {
      score -= penalty * it.weight;
    }
    cells.push(base);
  }
  // ---- Position-dependent combo grants ----
  const artAt = (x: number, y: number): { def: ArtifactDef; cell: CellResult } | null => {
    if (!g.exists(x, y)) return null;
    const idx = g.index(x, y); const u = layout.cells[idx]; const it = u ? items.get(u) : undefined;
    if (!it || it.kind !== "artifact") return null;
    const def = catalog.artifacts.get(it.defId); return def ? { def, cell: cells[idx] } : null;
  };
  for (let i = 0; i < N; i++) {
    const uid = layout.cells[i]; const it = uid ? items.get(uid) : undefined;
    if (!it || it.kind !== "artifact" || !cells[i].active) continue;
    const [x, y] = g.xy(i);
    if (it.defId === WHITE_PAPER) {
      const l = artAt(x - 1, y), r = artAt(x + 1, y);
      if (l && r) for (const c of l.def.categories) if (r.def.categories.includes(c)) { combos[c] = (combos[c] ?? 0) + 1; cells[i].comboGrant.push(c); }
    } else if (it.defId === CHALCEDONY_KEY) {
      const c = CHALCEDONY_ROWS[y % CHALCEDONY_ROWS.length];
      combos[c] = (combos[c] ?? 0) + 1; cells[i].comboGrant.push(c);
    }
  }
  // ---- Combo goals ----
  let comboGoalScore = 0;
  const goalsMet = (opts.comboGoals ?? []).map((gl) => {
    const met = (combos[gl.category] ?? 0) >= gl.count;
    if (met) comboGoalScore += gl.weight;
    return met;
  });
  // ---- 북향의 금빛 침: boosts the first non-needle artifact above (chains through stacked needles) ----
  let needleScore = 0;
  const needleValue = opts.needleValue ?? 2;
  for (let i = 0; i < N; i++) {
    const uid = layout.cells[i]; const it = uid ? items.get(uid) : undefined;
    if (!it || it.kind !== "artifact" || it.defId !== GOLDEN_NEEDLE || !cells[i].active) continue;
    const [x, y0] = g.xy(i);
    let y = y0 - 1;
    while (g.exists(x, y)) {
      const u = layout.cells[g.index(x, y)]; const t = u ? items.get(u) : undefined;
      if (!t || t.kind !== "artifact") break;
      if (t.defId === GOLDEN_NEEDLE) { y--; continue; }
      const tc = cells[g.index(x, y)];
      if (tc.active) { tc.needleHits++; needleScore += needleValue * t.weight; }
      break;
    }
  }
  // ---- Relation rules ----
  let relationScore = 0;
  const pos = new Map<string, [number, number]>();
  layout.cells.forEach((u, i) => { if (u) pos.set(u, g.xy(i)); });
  const relationsMet = (opts.relations ?? []).map((r) => {
    const pa = pos.get(r.a), pb = pos.get(r.b);
    if (!pa || !pb) return false;
    const dx = pa[0] - pb[0], dy = pa[1] - pb[1];
    let ok = false;
    switch (r.rel) {
      case "above": ok = dx === 0 && dy === -1; break;
      case "below": ok = dx === 0 && dy === 1; break;
      case "left": ok = dy === 0 && dx === -1; break;
      case "right": ok = dy === 0 && dx === 1; break;
      case "adjacent": ok = Math.abs(dx) + Math.abs(dy) === 1; break;
      case "same-row": ok = dy === 0; break;
      case "same-col": ok = dx === 0; break;
    }
    if (ok) relationScore += r.weight;
    return ok;
  });
  score += comboGoalScore + needleScore + relationScore;
  return { cells, score, totalEffective, activeCount, artifactCount, inactiveCount: artifactCount - activeCount, combos, comboGoalScore, needleScore, relationScore, goalsMet, relationsMet };
}

function restrictionOk(
  r: ArtifactDef["restriction"], x: number, y: number, g: Geometry, layout: Layout, edgeEmpty: boolean,
): boolean {
  switch (r) {
    case null: return true;
    case "top": return y === 0;
    case "bottom": return y === g.bottomOf(x);
    case "edge": return isEdgeCell(x, y, g);
    case "inside": return !isEdgeCell(x, y, g);
    case "both-sides-empty": {
      const side = (nx: number) => (g.exists(nx, y) ? layout.cells[g.index(nx, y)] === null : edgeEmpty);
      return side(x - 1) && side(x + 1);
    }
  }
}

/** Per-cell level preview (what an artifact placed there would get). */
export function levelField(layout: Layout, items: Map<string, ItemInstance>, cfg: BagConfig, catalog: Catalog): number[] {
  return evaluate(layout, items, cfg, catalog).cells.map((c) => c.level);
}
