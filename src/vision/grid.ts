/**
 * Detects the bag grid inside a region of a screenshot.
 * Cells are drawn with a light-grey frame; we take the column/row profile of "light grey" pixels and fit
 * pitch p, cell width w and offset o so that frame lines land on o + k*p and o + k*p + w.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface GridFit { cells: Rect[]; pitchX: number; pitchY: number; cellW: number; cellH: number; score: number }

function fitAxis(profile: Float32Array, n: number): { p: number; w: number; o: number; score: number } | null {
  const L = profile.length;
  let max = 0; for (const v of profile) max = Math.max(max, v);
  if (max === 0) return null;
  // peak groups
  const peaks: number[] = [];
  let start = -1;
  for (let i = 0; i <= L; i++) {
    const on = i < L && profile[i] > max * 0.35;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { peaks.push((start + i - 1) / 2); start = -1; }
  }
  if (peaks.length < 2) return null;
  const at = (i: number) => { const a = Math.max(0, i - 1), b = Math.min(L - 1, i + 1); return Math.max(profile[a], profile[i], profile[b]); };
  let best: { p: number; w: number; o: number; score: number } | null = null;
  const pMin = (L / n) * 0.8, pMax = (L / n) * 1.05;
  for (let p = pMin; p <= pMax; p += 0.5) {
    for (let w = p * 0.6; w <= p * 0.98; w += 1) {
      for (const o of peaks) {
        if (o >= p) break;
        let s = 0, ok = true;
        for (let k = 0; k < n; k++) {
          const a = Math.round(o + k * p), b = Math.round(o + k * p + w);
          if (b >= L) { ok = false; break; }
          s += at(a) + at(b);
        }
        if (ok && (!best || s > best.score)) best = { p, w, o, score: s };
      }
    }
  }
  return best;
}

export function detectGrid(img: ImageData, region: Rect, cols: number, rows: number): GridFit | null {
  const { width: W, data } = img;
  const rx = Math.max(0, Math.floor(region.x)), ry = Math.max(0, Math.floor(region.y));
  const rw = Math.min(W - rx, Math.floor(region.w)), rh = Math.min(img.height - ry, Math.floor(region.h));
  if (rw < cols * 4 || rh < rows * 4) return null;
  const colP = new Float32Array(rw), rowP = new Float32Array(rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = ((ry + y) * W + rx + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = (r + g + b) / 3, sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum > 110 && sat < 40) { colP[x]++; rowP[y]++; }
  }
  const fx = fitAxis(colP, cols), fy = fitAxis(rowP, rows);
  if (!fx || !fy) return null;
  const cells: Rect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    cells.push({ x: rx + fx.o + c * fx.p, y: ry + fy.o + r * fy.p, w: fx.w, h: fy.w });
  }
  return { cells, pitchX: fx.p, pitchY: fy.p, cellW: fx.w, cellH: fy.w, score: fx.score + fy.score };
}

/** Fallback: even split of the region. */
export function evenGrid(region: Rect, cols: number, rows: number): Rect[] {
  const cw = region.w / cols, ch = region.h / rows;
  const cells: Rect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: region.x + c * cw, y: region.y + r * ch, w: cw, h: ch });
  return cells;
}
