"use client";
import { ARTIFACTS, TABLETS, catalog } from "@/engine/catalog";
import type { Rarity } from "@/engine/types";
import bundledJson from "@/data/learned-templates.json";
import { packSprite, rotateSprite, scaleSprite, spriteDistance, spriteFromIcon, unpackSprite, type Sprite } from "./sprite";

export type TemplateSource = "icon" | "bundled" | "learned";

export interface Template {
  key: string; // "artifact:<id>" | "tablet:<id>"
  kind: "artifact" | "tablet";
  defId: string;
  spr: Sprite;
  source: TemplateSource;
  /** tablet only: the rotation (0-3, clockwise 90° steps) the sprite in `spr` was drawn at */
  rot: number;
}

/** On-disk / on-wire format (also used for export & import files). `s` = packed native sprite. */
export interface PackedTemplate { key: string; kind: "artifact" | "tablet"; defId: string; s: string; r?: number }
export interface TemplateFile { version: 2; templates: PackedTemplate[] }

const LEARNED_KEY = "sephiria-planner:learned-templates:v4";
/** v3 stored blurred 24×24 signatures that the native-pixel matcher cannot use */
const LEGACY_KEY = "sephiria-planner:learned-templates:v3";
const MAX_PER_KEY = 4;

const pack = (t: Template): PackedTemplate => ({ key: t.key, kind: t.kind, defId: t.defId, s: packSprite(t.spr), r: t.rot || 0 });
const unpack = (p: PackedTemplate, source: TemplateSource): Template => ({ key: p.key, kind: p.kind, defId: p.defId, spr: unpackSprite(p.s), source, rot: p.r ?? 0 });
const isCurrent = (p: unknown): p is PackedTemplate => !!p && typeof (p as PackedTemplate).key === "string" && typeof (p as PackedTemplate).s === "string";

/** Templates shipped with the app (src/data/learned-templates.json). */
export function loadBundledTemplates(): Template[] {
  const arr = bundledJson as unknown as PackedTemplate[] | TemplateFile;
  const list = Array.isArray(arr) ? arr : arr.templates ?? [];
  return list.filter(isCurrent).map((p) => unpack(p, "bundled"));
}

let iconTemplates: Template[] | null = null;
let iconLoading: Promise<Template[]> | null = null;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

/** Builds templates from /icons/<id>.png (transparent sprites), reduced to game pixels. */
export async function loadIconTemplates(onProgress?: (done: number, total: number) => void): Promise<Template[]> {
  if (iconTemplates) return iconTemplates;
  if (iconLoading) return iconLoading;
  iconLoading = (async () => {
    const defs = [
      ...TABLETS.map((t) => ({ kind: "tablet" as const, id: t.id })),
      ...ARTIFACTS.map((a) => ({ kind: "artifact" as const, id: a.id })),
    ];
    const out: Template[] = [];
    let done = 0;
    const queue = [...defs];
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const d = queue.shift()!;
        const img = await loadImage(`/icons/${d.id}.png`);
        if (img && img.naturalWidth > 0) {
          const w = img.naturalWidth, h = img.naturalHeight;
          cv.width = w; cv.height = h; ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0);
          const spr = spriteFromIcon({ w, h, data: ctx.getImageData(0, 0, w, h).data });
          if (spr) out.push({ key: `${d.kind}:${d.id}`, kind: d.kind, defId: d.id, spr, source: "icon", rot: 0 });
        }
        done++; onProgress?.(done, defs.length);
      }
    }));
    iconTemplates = out;
    return out;
  })();
  return iconLoading;
}

function readLearnedPacked(): PackedTemplate[] {
  try {
    const raw = localStorage.getItem(LEARNED_KEY);
    return raw ? (JSON.parse(raw) as unknown[]).filter(isCurrent) : [];
  } catch { return []; }
}
function writeLearnedPacked(list: PackedTemplate[]) {
  localStorage.setItem(LEARNED_KEY, JSON.stringify(list));
}

export function loadLearnedTemplates(): Template[] {
  return readLearnedPacked().map((p) => unpack(p, "learned"));
}

/** Samples saved by the previous (blurred signature) recogniser; they can't be converted, only re-learned. */
export function legacyLearnedCount(): number {
  try { return (JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]") as unknown[]).length; } catch { return 0; }
}
export function clearLegacyLearned() { localStorage.removeItem(LEGACY_KEY); }

/** Keep at most MAX_PER_KEY samples per key; newest wins. */
function capPerKey(list: PackedTemplate[]): PackedTemplate[] {
  const byKey = new Map<string, PackedTemplate[]>();
  for (const x of list) { const arr = byKey.get(x.key) ?? []; arr.push(x); byKey.set(x.key, arr.slice(-MAX_PER_KEY)); }
  return [...byKey.values()].flat();
}

export function saveLearnedTemplate(t: Omit<Template, "source">) {
  const all = readLearnedPacked();
  all.push(pack({ ...t, source: "learned" }));
  writeLearnedPacked(capPerKey(all));
}

export function clearLearnedTemplates() { localStorage.removeItem(LEARNED_KEY); }

/** Everything non-icon (bundled + learned), de-duplicated, as an export file. */
export function exportTemplateFile(): TemplateFile {
  const bundled = loadBundledTemplates().map(pack);
  const learned = readLearnedPacked();
  const seen = new Set<string>();
  const merged: PackedTemplate[] = [];
  for (const p of [...bundled, ...learned]) { if (seen.has(p.s)) continue; seen.add(p.s); merged.push(p); }
  return { version: 2, templates: capPerKey(merged) };
}

/** Import a file produced by exportTemplateFile into local learned storage (merges). */
export function importTemplateFile(text: string): number {
  const parsed = JSON.parse(text) as TemplateFile | PackedTemplate[];
  const list = Array.isArray(parsed) ? parsed : parsed.templates;
  if (!Array.isArray(list)) throw new Error("형식이 올바르지 않습니다.");
  const valid = list.filter(isCurrent);
  if (list.length && !valid.length) throw new Error("이전 인식 방식의 학습 파일이라 쓸 수 없습니다. 다시 학습해서 내보내 주세요.");
  const all = readLearnedPacked();
  const seen = new Set(all.map((p) => p.s));
  let added = 0;
  for (const p of valid) if (!seen.has(p.s)) { all.push(p); seen.add(p.s); added++; }
  writeLearnedPacked(capPerKey(all));
  return added;
}

/** rotation = the item rotation (0-3) implied by the best-matching orientation (tablets only; 0 for artifacts). */
export interface Match { template: Template; dist: number; rotation: number; }

/** captures of the real game beat reference icons when both look alike */
const SOURCE_WEIGHT: Record<TemplateSource, number> = { icon: 1, bundled: 0.9, learned: 0.9 };
/** added when the cell's rarity badge disagrees with the item's rarity (soft: the badge reading can be wrong) */
const RARITY_PENALTY = 0.15;

const rotCache = new WeakMap<Sprite, Sprite[]>();
function rotated(s: Sprite, k: number): Sprite {
  if (k === 0) return s;
  let arr = rotCache.get(s);
  if (!arr) { arr = []; rotCache.set(s, arr); }
  return (arr[k] ??= rotateSprite(s, k));
}

/** Icons can be drawn at another size than the game; bring them to the query's size when clearly off. */
function sized(q: Sprite, t: Template): Sprite {
  if (t.source !== "icon") return t.spr;
  const ratio = Math.max(q.x1 - q.x0, q.y1 - q.y0) / Math.max(1, t.spr.x1 - t.spr.x0, t.spr.y1 - t.spr.y0);
  return ratio < 0.8 || ratio > 1.25 ? scaleSprite(t.spr, Math.round(ratio * 20) / 20) : t.spr;
}

/**
 * Compare the query sprite with every template; rotatable tablets are tried in all 4 orientations
 * (the game draws a rotated tablet's sprite rotated), and the implied rotation is returned.
 * Grimoires share one book sprite, so for them the centre (the emblem) counts as much as the whole.
 */
export function matchSprite(q: Sprite, templates: Template[], opts: { topN?: number; isRotatable?: (defId: string) => boolean; badge?: Rarity | null } = {}): Match[] {
  const { topN = 6, isRotatable, badge } = opts;
  const scored: Match[] = [];
  for (const t of templates) {
    const tryRot = t.kind === "tablet" && (!isRotatable || isRotatable(t.defId));
    const art = t.kind === "artifact" ? catalog.artifacts.get(t.defId) : undefined;
    const base = sized(q, t);
    let best = Infinity, bestK = 0;
    for (let k = 0; k < (tryRot ? 4 : 1); k++) {
      const ts = rotated(base, k);
      let d = spriteDistance(q, ts);
      if (art?.grimoire) d = (d + spriteDistance(q, ts, 3, 0.5)) / 2;
      if (d < best) { best = d; bestK = k; }
    }
    let dist = best * SOURCE_WEIGHT[t.source];
    if (art && badge && art.rarity !== badge) dist += RARITY_PENALTY;
    scored.push({ template: t, dist, rotation: tryRot ? (t.rot + bestK) % 4 : 0 });
  }
  scored.sort((a, b) => a.dist - b.dist);
  const seen = new Set<string>(); const out: Match[] = [];
  for (const m of scored) { if (seen.has(m.template.key)) continue; seen.add(m.template.key); out.push(m); if (out.length >= topN) break; }
  return out;
}

/**
 * Picks one match per cell so that a unique artifact is used at most once: the most confident cells choose
 * first, later cells fall back to their next candidate. Returns the chosen match index per cell (-1 = none).
 */
export function assignUnique(cells: Match[][]): number[] {
  const order = cells.map((m, i) => i).filter((i) => cells[i].length).sort((a, b) => cells[a][0].dist - cells[b][0].dist);
  const taken = new Set<string>();
  const pick = cells.map(() => -1);
  for (const i of order) {
    const k = cells[i].findIndex((m) => !(m.template.kind === "artifact" && taken.has(m.template.defId)));
    pick[i] = k >= 0 ? k : 0;
    const m = cells[i][pick[i]];
    if (m.template.kind === "artifact" && catalog.artifacts.get(m.template.defId)?.unique) taken.add(m.template.defId);
  }
  return pick;
}
