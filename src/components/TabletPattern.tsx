"use client";
import { makeGeometry, rotateQuery, targetsOf } from "@/engine/grid";
import type { TabletDef } from "@/engine/types";

/** Renders a tablet's effect pattern on a 7x7 mini grid (tablet at center). Whole-row/column patterns are shown across the mini grid. */
export function TabletPattern({ def, rotation = 0, cell = 14 }: { def: TabletDef; rotation?: number; cell?: number }) {
  const W = 7;
  const g = makeGeometry({ width: W, cellCount: W * W, weapon: null });
  const cx = 3, cy = 3;
  const level = new Array<number>(W * W).fill(0);
  const ignore = new Array<boolean>(W * W).fill(false);
  const disable = new Array<boolean>(W * W).fill(false);
  const rot = def.rotatable ? rotation : 0;
  for (const q0 of def.queries) {
    const q = rotateQuery(q0, rot);
    for (const t of targetsOf(q, cx, cy, g)) {
      if (q.effect.kind === "level") level[t] += q.effect.value;
      else if (q.effect.kind === "ignore") ignore[t] = true;
      else disable[t] = true;
    }
  }
  // crop to bounding box of affected cells (min 3x3)
  let minX = cx - 1, maxX = cx + 1, minY = cy - 1, maxY = cy + 1;
  for (let i = 0; i < W * W; i++) {
    if (level[i] || ignore[i] || disable[i]) {
      const [x, y] = g.xy(i);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const cols = maxX - minX + 1, rows = maxY - minY + 1;
  return (
    <div className="inline-grid gap-px" style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}>
      {Array.from({ length: rows * cols }, (_, k) => {
        const x = minX + (k % cols), y = minY + Math.floor(k / cols);
        const i = g.index(x, y);
        const isT = x === cx && y === cy;
        const v = level[i];
        let bg = "var(--cell)", color = "var(--muted)", text = "";
        if (isT) { bg = "var(--accent)"; color = "#000"; text = "■"; }
        else if (disable[i]) { bg = "#3a1f1f"; color = "var(--bad)"; text = "×"; }
        else if (v > 0) { bg = `color-mix(in oklab, var(--good) ${Math.min(90, 25 + v * 15)}%, var(--cell))`; color = "#0b1f12"; text = `+${v}`; }
        else if (v < 0) { bg = `color-mix(in oklab, var(--bad) ${Math.min(90, 25 + -v * 15)}%, var(--cell))`; color = "#2a0b0b"; text = `${v}`; }
        else if (ignore[i]) { bg = "#2a2f4a"; color = "#b8c2ff"; text = "무"; }
        return (
          <div key={k} className="flex items-center justify-center rounded-[2px] font-mono font-semibold"
            style={{ width: cell, height: cell, background: bg, color, fontSize: Math.max(8, cell * 0.55) }}>
            {text}
          </div>
        );
      })}
    </div>
  );
}
