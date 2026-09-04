"use client";
import { ARTIFACTS, TABLETS } from "@/engine/catalog";
import bundledJson from "@/data/learned-templates.json";
import { distance, packSignature, rotateSignature, signatureFromCrop, unpackSignature, type Signature } from "./signature";

export type TemplateSource = "icon" | "bundled" | "learned";

export interface Template {
  key: string; // "artifact:<id>" | "tablet:<id>"
  kind: "artifact" | "tablet";
  defId: string;
  sig: Signature;
  source: TemplateSource;
  /** tablet only: the rotation (0-3, clockwise 90° steps) the sprite in `sig` was drawn at */
  rot: number;
}

/** On-disk / on-wire format (also used for export & import files). */
export interface PackedTemplate { key: string; kind: "artifact" | "tablet"; defId: string; a: number; p: number; d: string; r?: number }
export interface TemplateFile { version: 1; templates: PackedTemplate[] }

const LEARNED_KEY = "sephiria-planner:learned-templates:v3";
const MAX_PER_KEY = 4;
const ICON_BG: [number, number, number] = [66, 67, 81];

const pack = (t: Template): PackedTemplate => ({ key: t.key, kind: t.kind, defId: t.defId, ...packSignature(t.sig), r: t.rot || 0 });
const unpack = (p: PackedTemplate, source: TemplateSource): Template => ({ key: p.key, kind: p.kind, defId: p.defId, sig: unpackSignature(p), source, rot: p.r ?? 0 });

/** Templates shipped with the app (src/data/learned-templates.json). */
export function loadBundledTemplates(): Template[] {
  const arr = (bundledJson as unknown as PackedTemplate[] | TemplateFile);
  const list = Array.isArray(arr) ? arr : arr.templates ?? [];
  return list.map((p) => unpack(p, "bundled"));
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

/** Builds templates from /icons/<id>.png (transparent sprites): alpha-bbox crop → canonical signature. */
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
          const px = ctx.getImageData(0, 0, w, h).data;
          let x0 = w, y0 = h, x1 = 0, y1 = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 25) { if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1; if (y < y0) y0 = y; if (y + 1 > y1) y1 = y + 1; }
          if (x1 > x0 && y1 > y0) {
            const cw = x1 - x0, ch = y1 - y0;
            const crop = ctx.getImageData(x0, y0, cw, ch).data;
            const sig = signatureFromCrop(crop, cw, ch, null, ICON_BG);
            out.push({ key: `${d.kind}:${d.id}`, kind: d.kind, defId: d.id, sig, source: "icon", rot: 0 });
          }
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
    return raw ? (JSON.parse(raw) as PackedTemplate[]) : [];
  } catch { return []; }
}
function writeLearnedPacked(list: PackedTemplate[]) {
  localStorage.setItem(LEARNED_KEY, JSON.stringify(list));
}

export function loadLearnedTemplates(): Template[] {
  return readLearnedPacked().map((p) => unpack(p, "learned"));
}

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
  for (const p of [...bundled, ...learned]) { if (seen.has(p.d)) continue; seen.add(p.d); merged.push(p); }
  return { version: 1, templates: capPerKey(merged) };
}

/** Import a file produced by exportTemplateFile into local learned storage (merges). */
export function importTemplateFile(text: string): number {
  const parsed = JSON.parse(text) as TemplateFile | PackedTemplate[];
  const list = Array.isArray(parsed) ? parsed : parsed.templates;
  if (!Array.isArray(list)) throw new Error("형식이 올바르지 않습니다.");
  const valid = list.filter((p) => p && typeof p.key === "string" && typeof p.d === "string");
  const all = readLearnedPacked();
  const seen = new Set(all.map((p) => p.d));
  let added = 0;
  for (const p of valid) if (!seen.has(p.d)) { all.push(p); seen.add(p.d); added++; }
  writeLearnedPacked(capPerKey(all));
  return added;
}

/** rotation = the item rotation (0-3) implied by the best-matching orientation (tablets only; 0 for artifacts). */
export interface Match { template: Template; dist: number; rotation: number; }

const SOURCE_WEIGHT: Record<TemplateSource, number> = { icon: 1, bundled: 0.7, learned: 0.7 };

/**
 * Compare the query with every template; rotatable tablets are tried in all 4 orientations
 * (the game draws a rotated tablet's sprite rotated), and the implied rotation is returned.
 */
export function matchSignature(sig: Signature, templates: Template[], topN = 6, isRotatable?: (defId: string) => boolean): Match[] {
  const scored: Match[] = [];
  for (const t of templates) {
    const tryRot = t.kind === "tablet" && (!isRotatable || isRotatable(t.defId));
    let best = distance(sig, t.sig), bestK = 0;
    if (tryRot) {
      for (let k = 1; k < 4; k++) {
        const d = distance(sig, rotateSignature(t.sig, k));
        if (d < best) { best = d; bestK = k; }
      }
    }
    scored.push({ template: t, dist: best * SOURCE_WEIGHT[t.source], rotation: tryRot ? (t.rot + bestK) % 4 : 0 });
  }
  scored.sort((a, b) => a.dist - b.dist);
  const seen = new Set<string>(); const out: Match[] = [];
  for (const m of scored) { if (seen.has(m.template.key)) continue; seen.add(m.template.key); out.push(m); if (out.length >= topN) break; }
  return out;
}
