import { evaluate, type Catalog, type EvalOptions } from "./grid";
import type { BagConfig, ItemInstance, Layout } from "./types";
import { resolveTabletDef } from "./custom";

export interface OptimizeRequest {
  layout: Layout; // initial layout (locked items stay where they are)
  items: ItemInstance[];
  cfg: BagConfig;
  evalOpts?: EvalOptions;
  timeMs?: number; // total time budget
  restarts?: number;
  seed?: number;
}

export interface OptimizeProgress {
  type: "progress";
  bestScore: number;
  iter: number;
  restart: number;
  elapsedMs: number;
  layout: Layout;
  items: ItemInstance[];
}

export interface OptimizeDone {
  type: "done";
  bestScore: number;
  layout: Layout;
  items: ItemInstance[];
  iter: number;
  elapsedMs: number;
}

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function optimize(
  req: OptimizeRequest, catalog: Catalog, onProgress?: (p: OptimizeProgress) => void,
): OptimizeDone {
  const rand = mulberry32(req.seed ?? Date.now() & 0xffffffff);
  const N = req.cfg.cellCount;
  const timeMs = req.timeMs ?? 4000;
  const restarts = Math.max(1, req.restarts ?? 4);
  const items = new Map<string, ItemInstance>(req.items.map((it) => [it.uid, structuredClone(it)]));
  const lockedIdx = new Set<number>();
  const cells: (string | null)[] = new Array(N).fill(null);

  // Keep locked items in place; everything else gets randomly placed.
  const placedUids = new Set<string>();
  req.layout.cells.forEach((uid, i) => {
    if (i < N && uid && items.get(uid)?.locked) { cells[i] = uid; lockedIdx.add(i); placedUids.add(uid); }
  });
  const free = [...items.keys()].filter((u) => !placedUids.has(u));
  const freeIdx = () => cells.map((_, i) => i).filter((i) => !lockedIdx.has(i));
  if (free.length > freeIdx().length) throw new Error(`아이템(${items.size})이 가방 칸(${N})보다 많습니다.`);

  const rotatableUids = [...items.values()]
    .filter((it) => it.kind === "tablet" && resolveTabletDef(it, catalog)?.rotatable && !it.locked)
    .map((it) => it.uid);

  const score = () => evaluate({ cells }, items, req.cfg, catalog, req.evalOpts).score;

  const randomFill = () => {
    for (const i of freeIdx()) cells[i] = null;
    const idx = freeIdx();
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    free.forEach((u, k) => { cells[idx[k]] = u; });
    for (const u of rotatableUids) { const it = items.get(u)!; if (it.kind === "tablet") it.rotation = Math.floor(rand() * 4) as 0 | 1 | 2 | 3; }
  };

  let best: OptimizeDone = { type: "done", bestScore: -Infinity, layout: { cells: [...cells] }, items: [], iter: 0, elapsedMs: 0 };
  const snapshot = (s: number, iter: number, t0: number) => {
    best = { type: "done", bestScore: s, layout: { cells: [...cells] }, items: [...items.values()].map((it) => structuredClone(it)), iter, elapsedMs: performance.now() - t0 };
  };

  const t0 = performance.now();
  const perRestart = timeMs / restarts;
  let totalIter = 0;
  const movable = freeIdx();

  for (let r = 0; r < restarts; r++) {
    if (r === 0 && req.layout.cells.some((u, i) => i < N && u && !items.get(u)?.locked)) {
      // first restart: start from the user's current layout where possible
      for (const i of freeIdx()) cells[i] = null;
      const remaining = new Set(free);
      req.layout.cells.forEach((uid, i) => { if (i < N && uid && remaining.has(uid) && !lockedIdx.has(i)) { cells[i] = uid; remaining.delete(uid); } });
      const empties = freeIdx().filter((i) => cells[i] === null);
      [...remaining].forEach((u, k) => { cells[empties[k]] = u; });
    } else randomFill();

    let cur = score();
    if (cur > best.bestScore) snapshot(cur, totalIter, t0);
    const tStart = performance.now();
    const T0 = 3, T1 = 0.02;
    let lastReport = tStart;
    let iter = 0;
    while (true) {
      const frac = (performance.now() - tStart) / perRestart;
      if (frac >= 1) break;
      const T = T0 * Math.pow(T1 / T0, frac);
      // propose move
      const useRotate = rotatableUids.length > 0 && rand() < 0.25;
      let undo: () => void;
      if (useRotate) {
        const u = rotatableUids[Math.floor(rand() * rotatableUids.length)];
        const it = items.get(u)!;
        if (it.kind !== "tablet") continue;
        const old = it.rotation;
        it.rotation = ((old + 1 + Math.floor(rand() * 3)) % 4) as 0 | 1 | 2 | 3;
        undo = () => { it.rotation = old; };
      } else {
        const a = movable[Math.floor(rand() * movable.length)];
        const b = movable[Math.floor(rand() * movable.length)];
        if (a === b || (cells[a] === null && cells[b] === null)) continue;
        [cells[a], cells[b]] = [cells[b], cells[a]];
        undo = () => { [cells[a], cells[b]] = [cells[b], cells[a]]; };
      }
      const next = score();
      const d = next - cur;
      if (d >= 0 || rand() < Math.exp(d / T)) {
        cur = next;
        if (cur > best.bestScore) snapshot(cur, totalIter + iter, t0);
      } else undo();
      iter++;
      if (onProgress && performance.now() - lastReport > 150) {
        lastReport = performance.now();
        onProgress({ type: "progress", bestScore: best.bestScore, iter: totalIter + iter, restart: r, elapsedMs: lastReport - t0, layout: best.layout, items: best.items });
      }
    }
    totalIter += iter;
  }
  best.iter = totalIter;
  best.elapsedMs = performance.now() - t0;
  return best;
}
