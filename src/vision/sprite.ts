/**
 * Native-pixel sprite matching.
 * The game draws pixel art at an integer scale, and screenshots are often resized on top of that. We first
 * recover the game's own pixel grid (one sample per game pixel) and then compare sprites pixel by pixel at
 * that resolution, instead of comparing blurred downscaled crops.
 *
 * Cell layout in game pixels, measured on public/samples/bag1.png: the bag pitch is 40, a cell is 34×34
 * including its frame, sprites live in [4, 30). The level text sits top-left and the rarity badge top-right;
 * both are treated as "unknown" so they never count for or against a match.
 * Pure functions on RGBA rasters (no DOM), so they can be tested outside the browser.
 */
import type { Rarity } from "@/engine/types";
import type { Rect } from "./grid";

export interface Raster { w: number; h: number; data: Uint8ClampedArray | Uint8Array }

export const NATIVE_PITCH = 40;
export const CELL = 34;
const IN0 = 4, IN1 = 30;
export const AREA = IN1 - IN0;
const TEXT = { x0: 3, x1: 16, y0: 3, y1: 10 }; // cell coords
const BADGE = { x0: 25, x1: 31, y0: 1, y1: 8 };
const FG_THRESHOLD = 45; // L1 RGB distance from the cell background
const COLOR_SCALE = 120; // L1 RGB distance counted as a full mismatch

/**
 * A sprite at game resolution. mask: 1 = sprite pixel. unk: 1 = hidden (text, badge), ignored when comparing.
 * x0..y1 / cx, cy: bounding box and its centre, used to line sprites up.
 */
export interface Sprite {
  w: number; h: number;
  rgb: Uint8Array; mask: Uint8Array; unk: Uint8Array;
  x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; n: number;
}

export interface PixelGrid { s: number; ox: number; oy: number; n: number; score: number }

/**
 * Finds the size and phase of the game-pixel grid inside a bag region. The bag pitch spans a whole number of
 * game pixels and sharp colour edges fall on game-pixel boundaries, so we try each pitch/N and keep the
 * size whose boundaries collect the most edge energy.
 */
export function estimatePixelGrid(img: Raster, region: Rect, pitch: number): PixelGrid {
  const x0 = Math.max(0, Math.floor(region.x)), y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(img.w - 1, Math.floor(region.x + region.w)), y1 = Math.min(img.h - 1, Math.floor(region.y + region.h));
  const colP = new Float64Array(x1 - x0), rowP = new Float64Array(y1 - y0);
  const d = img.data, W = img.w;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4, r = i + 4, b = i + W * 4;
    colP[x - x0] += Math.abs(d[r] - d[i]) + Math.abs(d[r + 1] - d[i + 1]) + Math.abs(d[r + 2] - d[i + 2]);
    rowP[y - y0] += Math.abs(d[b] - d[i]) + Math.abs(d[b + 1] - d[i + 1]) + Math.abs(d[b + 2] - d[i + 2]);
  }
  // pixel x is centred on x, so the edge between x and x+1 sits at x + 0.5
  const fit = (prof: Float64Array, off: number, s: number) => {
    let total = 0; for (const v of prof) total += v;
    let best = { score: -1, ph: 0 };
    for (let ph = 0; ph < s; ph += 0.05) {
      let on = 0;
      for (let i = 0; i < prof.length; i++) {
        let f = ((i + off + 0.5 - ph) / s) % 1; if (f < 0) f += 1;
        if (Math.min(f, 1 - f) < 0.12) on += prof[i];
      }
      if (on > best.score) best = { score: on, ph };
    }
    return { score: total ? best.score / total : 0, ph: best.ph };
  };
  let best: PixelGrid = { s: pitch / NATIVE_PITCH, ox: 0, oy: 0, n: NATIVE_PITCH, score: -1 };
  for (let n = 24; n <= 64; n++) {
    const s = pitch / n;
    if (s < 1) break;
    const fx = fit(colP, x0, s);
    if (fx.score > best.score) best = { s, ox: fx.ph, oy: 0, n, score: fx.score };
  }
  best.oy = fit(rowP, y0, best.s).ph;
  return best;
}

/** Samples one cell (CELL×CELL game pixels) starting at the game pixel that contains the cell's top-left corner. */
export function sampleNativeCell(img: Raster, cell: Rect, g: PixelGrid): Raster {
  const out = new Uint8ClampedArray(CELL * CELL * 4);
  const kx0 = Math.round((cell.x - g.ox) / g.s), ky0 = Math.round((cell.y - g.oy) / g.s);
  const rad = Math.max(0, Math.min(0.9, g.s * 0.25)); // average the middle of each game pixel only
  for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) {
    const cx = g.ox + (kx0 + i + 0.5) * g.s, cy = g.oy + (ky0 + j + 0.5) * g.s;
    const xa = Math.max(0, Math.round(cx - rad)), xb = Math.min(img.w - 1, Math.round(cx + rad));
    const ya = Math.max(0, Math.round(cy - rad)), yb = Math.min(img.h - 1, Math.round(cy + rad));
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const k = (y * img.w + x) * 4; r += img.data[k]; gg += img.data[k + 1]; b += img.data[k + 2]; n++;
    }
    const o = (j * CELL + i) * 4;
    out[o] = n ? r / n : 0; out[o + 1] = n ? gg / n : 0; out[o + 2] = n ? b / n : 0; out[o + 3] = 255;
  }
  return { w: CELL, h: CELL, data: out };
}

function median(a: number[]) { a.sort((p, q) => p - q); return a[a.length >> 1]; }

/** Cuts the sprite out of a native cell. Returns null for an empty cell. */
export function extractSprite(cell: Raster): Sprite | null {
  const d = cell.data, W = cell.w;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let y = IN0; y < IN1; y++) for (let x = IN0; x < IN1; x++) { const k = (y * W + x) * 4; rs.push(d[k]); gs.push(d[k + 1]); bs.push(d[k + 2]); }
  const bg = [median(rs), median(gs), median(bs)];
  const N = AREA;
  const rgb = new Uint8Array(N * N * 3), raw = new Uint8Array(N * N), unk = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const cx = x + IN0, cy = y + IN0, k = (cy * W + cx) * 4, p = y * N + x;
    rgb[p * 3] = d[k]; rgb[p * 3 + 1] = d[k + 1]; rgb[p * 3 + 2] = d[k + 2];
    const hidden = (cx >= TEXT.x0 && cx < TEXT.x1 && cy >= TEXT.y0 && cy < TEXT.y1) || (cx >= BADGE.x0 && cx < BADGE.x1 && cy >= BADGE.y0 && cy < BADGE.y1);
    if (hidden) { unk[p] = 1; continue; }
    if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > FG_THRESHOLD) raw[p] = 1;
  }
  // keep the main body: large components, and small details near the middle (drops UI marks at the edges)
  const label = new Int32Array(N * N).fill(-1);
  const comps: number[][] = [];
  for (let s = 0; s < N * N; s++) {
    if (!raw[s] || label[s] >= 0) continue;
    const pts: number[] = [], stack = [s]; label[s] = comps.length;
    while (stack.length) {
      const p = stack.pop()!; pts.push(p);
      const px = p % N, py = (p / N) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = px + dx, yy = py + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        const q = yy * N + xx;
        if (raw[q] && label[q] < 0) { label[q] = comps.length; stack.push(q); }
      }
    }
    comps.push(pts);
  }
  if (!comps.length) return null;
  const big = Math.max(...comps.map((c) => c.length));
  const mask = new Uint8Array(N * N);
  for (const c of comps) {
    let sx = 0, sy = 0; for (const p of c) { sx += p % N; sy += (p / N) | 0; }
    const cx = sx / c.length, cy = sy / c.length;
    const central = cx >= 3 && cx <= N - 4 && cy >= 3 && cy <= N - 4;
    if (c.length >= big * 0.4 || (central && c.length >= 3)) for (const p of c) mask[p] = 1;
  }
  const spr = finish({ w: N, h: N, rgb, mask, unk });
  return spr.n >= 12 ? spr : null;
}

/** Fills bbox/centre/count. */
function finish(s: Pick<Sprite, "w" | "h" | "rgb" | "mask" | "unk">): Sprite {
  let x0 = s.w, y0 = s.h, x1 = 0, y1 = 0, n = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.mask[y * s.w + x]) {
    n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
  }
  if (!n) { x0 = y0 = 0; }
  return { ...s, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, n };
}

/** Largest integer factor the image was upscaled by (constant f×f blocks), 1 if none. */
export function upscaleFactor(img: Raster): number {
  const d = img.data;
  for (let f = 8; f >= 2; f--) {
    if (img.w < f * 4 || img.h < f * 4) continue;
    let blocks = 0, bad = 0;
    for (let by = 0; by + f <= img.h; by += f) for (let bx = 0; bx + f <= img.w; bx += f) {
      const k0 = (by * img.w + bx) * 4;
      let same = true;
      for (let y = by; y < by + f && same; y++) for (let x = bx; x < bx + f; x++) {
        const k = (y * img.w + x) * 4;
        if (Math.abs(d[k] - d[k0]) > 8 || Math.abs(d[k + 1] - d[k0 + 1]) > 8 || Math.abs(d[k + 2] - d[k0 + 2]) > 8 || Math.abs(d[k + 3] - d[k0 + 3]) > 8) { same = false; break; }
      }
      blocks++; if (!same) bad++;
    }
    if (blocks && bad / blocks < 0.03) return f;
  }
  return 1;
}

/** Sprite from a transparent reference icon: undo any integer upscale, alpha = mask, cropped to the sprite. */
export function spriteFromIcon(img: Raster): Sprite | null {
  const f = upscaleFactor(img);
  const w = Math.floor(img.w / f), h = Math.floor(img.h / f);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  const at = (x: number, y: number) => ((y * f + (f >> 1)) * img.w + x * f + (f >> 1)) * 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (img.data[at(x, y) + 3] > 25) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const sw = x1 - x0, sh = y1 - y0;
  const rgb = new Uint8Array(sw * sh * 3), mask = new Uint8Array(sw * sh), unk = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const k = at(x + x0, y + y0), p = y * sw + x;
    rgb[p * 3] = img.data[k]; rgb[p * 3 + 1] = img.data[k + 1]; rgb[p * 3 + 2] = img.data[k + 2];
    mask[p] = img.data[k + 3] > 25 ? 1 : 0;
  }
  return finish({ w: sw, h: sh, rgb, mask, unk });
}

/** Rotates 90° clockwise k times (the game rotates a tablet's sprite with the tablet). */
export function rotateSprite(s: Sprite, k: number): Sprite {
  k = ((k % 4) + 4) % 4;
  let cur = s;
  for (let r = 0; r < k; r++) {
    const w = cur.h, h = cur.w;
    const rgb = new Uint8Array(w * h * 3), mask = new Uint8Array(w * h), unk = new Uint8Array(w * h);
    for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) {
      const p = y * cur.w + x, q = x * w + (w - 1 - y); // (x, y) -> (h-1-y, x)
      rgb[q * 3] = cur.rgb[p * 3]; rgb[q * 3 + 1] = cur.rgb[p * 3 + 1]; rgb[q * 3 + 2] = cur.rgb[p * 3 + 2];
      mask[q] = cur.mask[p]; unk[q] = cur.unk[p];
    }
    cur = finish({ w, h, rgb, mask, unk });
  }
  return cur;
}

/** Nearest-neighbour rescale (used only when a reference icon is drawn at a different size than the game). */
export function scaleSprite(s: Sprite, f: number): Sprite {
  const w = Math.max(1, Math.round(s.w * f)), h = Math.max(1, Math.round(s.h * f));
  const rgb = new Uint8Array(w * h * 3), mask = new Uint8Array(w * h), unk = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(s.w - 1, Math.floor(x / f)), sy = Math.min(s.h - 1, Math.floor(y / f));
    const p = sy * s.w + sx, q = y * w + x;
    rgb[q * 3] = s.rgb[p * 3]; rgb[q * 3 + 1] = s.rgb[p * 3 + 1]; rgb[q * 3 + 2] = s.rgb[p * 3 + 2];
    mask[q] = s.mask[p]; unk[q] = s.unk[p];
  }
  return finish({ w, h, rgb, mask, unk });
}

/**
 * 0 = identical, 1 = nothing in common. Over the pixels that either sprite covers (and neither hides),
 * a pixel both cover costs its colour difference and a pixel only one covers costs 1.
 * The template is centred on the query's sprite and nudged up to `r` pixels each way.
 * `focus` < 1 only looks at that central fraction of the query's bounding box (e.g. a grimoire's emblem).
 */
export function spriteDistance(q: Sprite, t: Sprite, r = 3, focus = 1): number {
  let best = 1;
  const bx = Math.round(q.cx - t.cx), by = Math.round(q.cy - t.cy);
  const fx = ((q.x1 - q.x0) * focus) / 2, fy = ((q.y1 - q.y0) * focus) / 2;
  const fx0 = Math.floor(q.cx - fx), fx1 = Math.ceil(q.cx + fx), fy0 = Math.floor(q.cy - fy), fy1 = Math.ceil(q.cy + fy);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const ox = bx + dx, oy = by + dy;
    let xa = Math.max(0, Math.min(q.x0, t.x0 + ox)), xb = Math.min(q.w, Math.max(q.x1, t.x1 + ox));
    let ya = Math.max(0, Math.min(q.y0, t.y0 + oy)), yb = Math.min(q.h, Math.max(q.y1, t.y1 + oy));
    if (focus < 1) { xa = Math.max(xa, fx0); xb = Math.min(xb, fx1); ya = Math.max(ya, fy0); yb = Math.min(yb, fy1); }
    let cost = 0, n = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const p = y * q.w + x;
      if (q.unk[p]) continue;
      const tx = x - ox, ty = y - oy;
      const inT = tx >= 0 && ty >= 0 && tx < t.w && ty < t.h;
      const tp = inT ? ty * t.w + tx : -1;
      if (inT && t.unk[tp]) continue;
      const qm = q.mask[p] === 1, tm = inT && t.mask[tp] === 1;
      if (!qm && !tm) continue;
      n++;
      if (qm && tm) {
        const c = Math.abs(q.rgb[p * 3] - t.rgb[tp * 3]) + Math.abs(q.rgb[p * 3 + 1] - t.rgb[tp * 3 + 1]) + Math.abs(q.rgb[p * 3 + 2] - t.rgb[tp * 3 + 2]);
        cost += Math.min(1, c / COLOR_SCALE);
      } else cost += 1;
    }
    if (n && cost / n < best) best = cost / n;
  }
  return best;
}

/** Rarity shown by the coloured badge in the cell's top-right corner; null when unsure. */
export function readBadge(cell: Raster): Rarity | null {
  const hues: number[] = [];
  for (let y = 2; y < 7; y++) for (let x = 26; x < 30; x++) {
    const k = (y * cell.w + x) * 4, r = cell.data[k], g = cell.data[k + 1], b = cell.data[k + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn <= 28 || mx <= 100) continue;
    let h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
    h *= 60; if (h < 0) h += 360;
    hues.push(h);
  }
  if (hues.length < 3) return "common"; // no badge
  const h = median(hues);
  if (h > 330 || h < 15) return "legendary";
  if (h < 60) return "rare";
  if (h > 190 && h < 250) return "advanced";
  return null;
}

// ---- storage: [w, h] + rgb + one byte per pixel (0 empty, 1 sprite, 2 hidden), base64

export function packSprite(s: Sprite): string {
  const bytes = new Uint8Array(2 + s.w * s.h * 4);
  bytes[0] = s.w; bytes[1] = s.h;
  bytes.set(s.rgb, 2);
  const o = 2 + s.w * s.h * 3;
  for (let i = 0; i < s.w * s.h; i++) bytes[o + i] = s.unk[i] ? 2 : s.mask[i];
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function unpackSprite(str: string): Sprite {
  const bin = atob(str);
  const w = bin.charCodeAt(0), h = bin.charCodeAt(1);
  const rgb = new Uint8Array(w * h * 3), mask = new Uint8Array(w * h), unk = new Uint8Array(w * h);
  for (let i = 0; i < rgb.length; i++) rgb[i] = bin.charCodeAt(2 + i);
  const o = 2 + rgb.length;
  for (let i = 0; i < w * h; i++) { const v = bin.charCodeAt(o + i); mask[i] = v === 1 ? 1 : 0; unk[i] = v === 2 ? 1 : 0; }
  return finish({ w, h, rgb, mask, unk });
}
