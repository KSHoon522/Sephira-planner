/**
 * Sprite signature for icon matching.
 * The game draws each item as a pixel-art sprite (nearest-neighbour upscaled) on a flat dark cell background.
 * We segment the sprite from the cell, fit it into a canonical S x S box (aspect preserved), and compare
 *   - colour (mean/std-normalised RGB, composited on the cell background)
 *   - silhouette (mask IoU)
 *   - aspect ratio
 */
export const S = 24;

export interface Signature {
  rgb: Float32Array; // S*S*3 normalised
  mask: Float32Array; // S*S in [0,1]
  aspect: number; // w/h of the sprite bbox
  pixels: number; // sprite pixel count in source (0 => empty)
}

export interface Segmented {
  x0: number; y0: number; x1: number; y1: number; // bbox in cell coords
  mask: Uint8Array; // cell-sized mask
  bg: [number, number, number];
  pixels: number;
}

/** Segment the sprite inside a cell (ImageData of the cell interior incl. frame). */
export function segmentCell(cell: ImageData): Segmented {
  const { width: w, height: h, data } = cell;
  // background = median of inner region
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let y = Math.floor(h * 0.06); y < h * 0.94; y += 2) for (let x = Math.floor(w * 0.06); x < w * 0.94; x += 2) {
    const i = (y * w + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  }
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const bg: [number, number, number] = [med(rs), med(gs), med(bs)];

  const mask = new Uint8Array(w * h);
  const mx = Math.floor(w * 0.08), my = Math.floor(h * 0.05);
  const textY = Math.floor(h * 0.21), textX = Math.floor(w * 0.40), tagX = Math.floor(w * 0.68);
  for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) {
    if (y < textY && (x < textX || x >= tagX)) continue; // level text / tag icons
    const i = (y * w + x) * 4;
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > 60) mask[y * w + x] = 1;
  }
  // connected components on a 1px-dilated mask
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) dil[yy * w + xx] = 1;
    }
  }
  const label = new Int32Array(w * h).fill(-1);
  const comps: { area: number; cy: number; idx: number[] }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!dil[s] || label[s] >= 0) continue;
    const id = comps.length; const comp = { area: 0, cy: 0, idx: [] as number[] };
    stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop()!; comp.idx.push(p); comp.area++; comp.cy += Math.floor(p / w);
      const px = p % w, py = Math.floor(p / w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = py + dy, xx = px + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        const q = yy * w + xx;
        if (dil[q] && label[q] < 0) { label[q] = id; stack.push(q); }
      }
    }
    comp.cy /= comp.area * h;
    comps.push(comp);
  }
  const body = comps.filter((c) => c.cy >= 0.18);
  const big = body.reduce((m, c) => Math.max(m, c.area), 0);
  const keep = new Uint8Array(w * h);
  let pixels = 0;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (const c of body) {
    if (c.area < big * 0.08) continue;
    for (const p of c.idx) {
      if (!mask[p]) continue;
      keep[p] = 1; pixels++;
      const px = p % w, py = Math.floor(p / w);
      if (px < x0) x0 = px; if (px + 1 > x1) x1 = px + 1; if (py < y0) y0 = py; if (py + 1 > y1) y1 = py + 1;
    }
  }
  if (pixels < 30) return { x0: 0, y0: 0, x1: 0, y1: 0, mask: keep, bg, pixels: 0 };
  return { x0, y0, x1, y1, mask: keep, bg, pixels };
}

/** Build a signature from RGBA pixel data + boolean mask of a sprite bbox crop. */
export function signatureFromCrop(rgba: Uint8ClampedArray, w: number, h: number, mask: Uint8Array | null, bg: [number, number, number]): Signature {
  // composite on bg into a canvas, then box-downscale into S x S keeping aspect
  const src = document.createElement("canvas"); src.width = w; src.height = h;
  const sctx = src.getContext("2d")!;
  const img = sctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const on = mask ? mask[i] === 1 : rgba[i * 4 + 3] > 25;
    img.data[i * 4] = on ? rgba[i * 4] : bg[0];
    img.data[i * 4 + 1] = on ? rgba[i * 4 + 1] : bg[1];
    img.data[i * 4 + 2] = on ? rgba[i * 4 + 2] : bg[2];
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const scale = S / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
  const ox = Math.floor((S - nw) / 2), oy = Math.floor((S - nh) / 2);
  const dst = document.createElement("canvas"); dst.width = S; dst.height = S;
  const dctx = dst.getContext("2d", { willReadFrequently: true })!;
  dctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`; dctx.fillRect(0, 0, S, S);
  dctx.imageSmoothingEnabled = true; dctx.imageSmoothingQuality = "high";
  dctx.drawImage(src, 0, 0, w, h, ox, oy, nw, nh);
  const out = dctx.getImageData(0, 0, S, S).data;
  const rgb = new Float32Array(S * S * 3);
  let mean = 0;
  for (let i = 0; i < S * S; i++) { rgb[i * 3] = out[i * 4]; rgb[i * 3 + 1] = out[i * 4 + 1]; rgb[i * 3 + 2] = out[i * 4 + 2]; mean += out[i * 4] + out[i * 4 + 1] + out[i * 4 + 2]; }
  mean /= rgb.length;
  let sd = 0; for (let i = 0; i < rgb.length; i++) sd += (rgb[i] - mean) ** 2; sd = Math.sqrt(sd / rgb.length) || 1;
  for (let i = 0; i < rgb.length; i++) rgb[i] = (rgb[i] - mean) / sd;

  // mask downscale (area average)
  const m = new Float32Array(S * S);
  let pixels = 0;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const sx0 = Math.floor(x / scale), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / scale));
    const sy0 = Math.floor(y / scale), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / scale));
    let on = 0, n = 0;
    for (let yy = sy0; yy < Math.min(h, sy1); yy++) for (let xx = sx0; xx < Math.min(w, sx1); xx++) { n++; if (mask ? mask[yy * w + xx] : rgba[(yy * w + xx) * 4 + 3] > 25) on++; }
    m[(y + oy) * S + (x + ox)] = n ? on / n : 0;
  }
  for (let i = 0; i < w * h; i++) if (mask ? mask[i] : rgba[i * 4 + 3] > 25) pixels++;
  return { rgb, mask: m, aspect: w / h, pixels };
}

/** Rotate a signature 90° clockwise `k` times (image rotation; aspect flips on odd k). */
export function rotateSignature(s: Signature, k: number): Signature {
  k = ((k % 4) + 4) % 4;
  if (k === 0) return s;
  let rgb = s.rgb, mask = s.mask;
  for (let r = 0; r < k; r++) {
    const nrgb = new Float32Array(rgb.length), nmask = new Float32Array(mask.length);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // clockwise: (x, y) -> (S-1-y, x)
      const nx = S - 1 - y, ny = x;
      nmask[ny * S + nx] = mask[y * S + x];
      for (let c = 0; c < 3; c++) nrgb[(ny * S + nx) * 3 + c] = rgb[(y * S + x) * 3 + c];
    }
    rgb = nrgb; mask = nmask;
  }
  return { rgb, mask, aspect: k % 2 === 1 ? 1 / s.aspect : s.aspect, pixels: s.pixels };
}

export function distance(a: Signature, b: Signature): number {
  let d = 0;
  for (let i = 0; i < a.rgb.length; i++) { const x = a.rgb[i] - b.rgb[i]; d += x * x; }
  d = Math.sqrt(d / a.rgb.length);
  let inter = 0, union = 0;
  for (let i = 0; i < a.mask.length; i++) { inter += Math.min(a.mask[i], b.mask[i]); union += Math.max(a.mask[i], b.mask[i]); }
  const iou = union ? inter / union : 0;
  return d + 1.2 * (1 - iou) + 0.5 * Math.abs(Math.log(a.aspect / b.aspect));
}

/** Compact base64 packing (rgb quantised to bytes, mask to 0..255) for bundling in the repo. */
export function packSignature(s: Signature): { a: number; p: number; d: string } {
  const bytes = new Uint8Array(s.rgb.length + s.mask.length);
  for (let i = 0; i < s.rgb.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round((s.rgb[i] + 4) * 32)));
  for (let i = 0; i < s.mask.length; i++) bytes[s.rgb.length + i] = Math.round(s.mask[i] * 255);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { a: Math.round(s.aspect * 1000) / 1000, p: s.pixels, d: btoa(bin) };
}
export function unpackSignature(o: { a: number; p: number; d: string }): Signature {
  const bin = atob(o.d);
  const n = S * S * 3, m = S * S;
  const rgb = new Float32Array(n), mask = new Float32Array(m);
  for (let i = 0; i < n; i++) rgb[i] = bin.charCodeAt(i) / 32 - 4;
  for (let i = 0; i < m; i++) mask[i] = bin.charCodeAt(n + i) / 255;
  return { rgb, mask, aspect: o.a, pixels: o.p };
}

export function serialize(s: Signature): string {
  return JSON.stringify({ r: Array.from(s.rgb, (v) => Math.round(v * 1000) / 1000), m: Array.from(s.mask, (v) => Math.round(v * 100) / 100), a: s.aspect, p: s.pixels });
}
export function deserialize(str: string): Signature {
  const o = JSON.parse(str) as { r: number[]; m: number[]; a: number; p: number };
  return { rgb: Float32Array.from(o.r), mask: Float32Array.from(o.m), aspect: o.a, pixels: o.p };
}
