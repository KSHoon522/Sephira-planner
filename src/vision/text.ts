/**
 * Reads the small level text in the top-left of a bag cell.
 *   artifact: "cur/max" (white or blue 3x5 pixel font)
 *   tablet:   "-N" / "+N" in yellow
 * Returns the parsed hint; every field is best-effort.
 */
export interface CellText {
  kind: "artifact" | "tablet" | "none";
  cur: number | null;
  max: number | null; // artifact max level (star count)
  raw: string;
}

const FONT: Record<string, string> = {
  "0": "###|#.#|#.#|#.#|###", "1": "##.|.#.|.#.|.#.|###", "2": "###|..#|###|#..|###", "3": "###|..#|###|..#|###",
  "4": "#.#|#.#|###|..#|..#", "5": "###|#..|###|..#|###", "6": "###|#..|###|#.#|###", "7": "###|..#|..#|..#|..#",
  "8": "###|#.#|###|#.#|###", "9": "###|#.#|###|..#|###", "/": "..#|..#|.#.|#..|#..",
};
const GLYPHS = Object.entries(FONT).map(([ch, s]) => ({ ch, bits: s.split("|").flatMap((row) => [...row].map((c) => (c === "#" ? 1 : 0))) }));

export function readCellText(cell: ImageData): CellText {
  const { width: w, height: h, data } = cell;
  const x0 = Math.floor(w * 0.04), x1 = Math.floor(w * 0.55), y0 = Math.floor(h * 0.06), y1 = Math.floor(h * 0.34);
  const rw = x1 - x0, rh = y1 - y0;
  const mask = new Uint8Array(rw * rh);
  const ymask = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = ((y0 + y) * w + x0 + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = (r + g + b) / 3;
    const white = lum > 150, blue = b > 140 && b - r > 50, yellow = r > 170 && g > 150 && b < 120;
    if (yellow) ymask[y * rw + x] = 1;
    if (white || blue || yellow) mask[y * rw + x] = 1;
  }
  // connected components (4-neigh)
  const label = new Int32Array(rw * rh).fill(-1);
  const comps: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < rw * rh; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = comps.length; const c = { x0: rw, x1: 0, y0: rh, y1: 0 };
    stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop()!; const px = p % rw, py = Math.floor(p / rw);
      if (px < c.x0) c.x0 = px; if (px + 1 > c.x1) c.x1 = px + 1; if (py < c.y0) c.y0 = py; if (py + 1 > c.y1) c.y1 = py + 1;
      const nb = [p - 1, p + 1, p - rw, p + rw];
      for (const q of nb) {
        if (q < 0 || q >= rw * rh) continue;
        if ((q === p - 1 && px === 0) || (q === p + 1 && px === rw - 1)) continue;
        if (mask[q] && label[q] < 0) { label[q] = id; stack.push(q); }
      }
    }
    comps.push(c);
  }
  const glyphs: { x: number; ch: string }[] = [];
  const classify = (bx0: number, bx1: number, by0: number, by1: number): string | null => {
    const gw = bx1 - bx0, gh = by1 - by0;
    if (gw <= 0 || gh <= 0) return null;
    const bits = new Array<number>(15).fill(0);
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
      const sx0 = bx0 + Math.floor((gx * gw) / 3), sx1 = bx0 + Math.max(1, Math.floor(((gx + 1) * gw) / 3));
      const sy0 = by0 + Math.floor((gy * gh) / 5), sy1 = by0 + Math.max(1, Math.floor(((gy + 1) * gh) / 5));
      let on = 0, n = 0;
      for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) { n++; if (mask[y * rw + x]) on++; }
      bits[gy * 3 + gx] = n && on / n > 0.45 ? 1 : 0;
    }
    let best = "", bd = 99;
    for (const g of GLYPHS) { let d = 0; for (let i = 0; i < 15; i++) d += g.bits[i] ^ bits[i]; if (d < bd) { bd = d; best = g.ch; } }
    return bd <= 4 ? best : null;
  };
  let minusSign = false;
  for (const c of comps) {
    const gw = c.x1 - c.x0, gh = c.y1 - c.y0;
    const digitH = gh >= 0.11 * h && gh <= 0.21 * h;
    if (gw >= 0.05 * w && gw <= 0.14 * w && gh <= 0.05 * h && c.x0 < 0.3 * rw) {
      let yc = 0, n = 0;
      for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) { n++; if (ymask[y * rw + x]) yc++; }
      if (n && yc / n > 0.4) minusSign = true;
      continue;
    }
    if (digitH && gw >= 0.04 * w && gw <= 0.13 * w) {
      const ch = classify(c.x0, c.x1, c.y0, c.y1); if (ch) glyphs.push({ x: c.x0, ch });
    } else if (digitH && gw > 0.13 * w && gw <= 0.3 * w) {
      // two glyphs merged: split in half
      const mid = Math.floor((c.x0 + c.x1) / 2);
      const a = classify(c.x0, mid, c.y0, c.y1), b = classify(mid, c.x1, c.y0, c.y1);
      if (a) glyphs.push({ x: c.x0, ch: a }); if (b) glyphs.push({ x: mid, ch: b });
    }
  }
  glyphs.sort((a, b) => a.x - b.x);
  const raw = glyphs.map((g) => g.ch).join("");
  const digits = glyphs.filter((g) => g.ch !== "/").map((g) => Number(g.ch));
  if (minusSign) return { kind: "tablet", cur: digits.length ? digits[0] : null, max: null, raw: "-" + raw };
  if (digits.length === 0) return { kind: "none", cur: null, max: null, raw };
  const hasSlash = glyphs.some((g) => g.ch === "/");
  if (digits.length >= 2) return { kind: "artifact", cur: digits[0], max: digits[digits.length - 1], raw };
  return { kind: "artifact", cur: digits[0], max: hasSlash ? null : null, raw };
}
