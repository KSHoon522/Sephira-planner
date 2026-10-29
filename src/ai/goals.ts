import type { ComboGoal, Relation, RelationRule } from "@/engine/types";
import { CATEGORY_KO } from "@/engine/catalog";
import type { TabletPart } from "@/engine/custom";

export type AiProvider = "claude" | "gemini";

export const AI_PROVIDERS: Record<AiProvider, { label: string; short: string; defaultModel: string; keyHint: string; keyUrl: string }> = {
  claude: { label: "Claude (Anthropic)", short: "Claude", defaultModel: "claude-opus-5-5", keyHint: "sk-ant-…", keyUrl: "https://console.anthropic.com/settings/keys" },
  gemini: { label: "Gemini (Google AI Studio)", short: "Gemini", defaultModel: "gemini-2.5-flash", keyHint: "AIza…", keyUrl: "https://aistudio.google.com/apikey" },
};

export const RELATIONS: Relation[] = ["above", "below", "left", "right", "adjacent", "same-row", "same-col"];
export const COMBO_CATEGORIES = Object.keys(CATEGORY_KO);

export const LIMITS = {
  prompt: 1000,
  items: 60,
  weight: [0, 20],
  comboCount: [1, 12],
  goalWeight: [0, 100],
  needle: [0, 50],
  penalty: [0, 100],
} as const;

/** One bag item as sent to the server: uids are replaced by short refs (A1, T1…). */
export interface AiItemRef {
  ref: string;
  kind: "artifact" | "tablet";
  defId: string;
  parts?: TabletPart[];
  rotation: number;
  enchant: number;
  weight: number;
  locked: boolean;
  placed: boolean;
}

export interface AiGoalRequest {
  provider: AiProvider;
  model?: string;
  prompt: string;
  bag: {
    cellCount: number;
    weapon: string | null;
    inactivePenalty: number;
    needleValue: number;
    comboGoals: ComboGoal[];
    relations: { a: string; b: string; rel: Relation; weight: number }[];
    items: AiItemRef[];
  };
}

/** What the model returns (refs, numbers not yet clamped). */
export interface AiProposal {
  summary: string;
  weights: { ref: string; weight: number; reason: string }[];
  comboGoals: { category: string; count: number; weight: number; reason: string }[];
  relations: { a: string; b: string; rel: Relation; weight: number; reason: string }[];
  needleValue: number | null;
  inactivePenalty: number | null;
  notes: string[];
}

export interface AiGoalResponse { proposal: AiProposal; model: string }
export interface AiStatusResponse { serverKeys: Record<AiProvider, boolean> }

/** JSON schema for the model's output. Refs are enums so the model can only name items that exist. */
export function proposalSchema(artifactRefs: string[], allRefs: string[]) {
  const obj = (properties: Record<string, unknown>) => ({
    type: "object", additionalProperties: false, required: Object.keys(properties), properties,
  });
  const reason = { type: "string", description: "한국어 한 줄 근거" };
  return obj({
    summary: { type: "string", description: "한국어 1~2문장 요약" },
    weights: {
      type: "array",
      items: obj({ ref: { type: "string", enum: artifactRefs }, weight: { type: "integer" }, reason }),
    },
    comboGoals: {
      type: "array",
      items: obj({ category: { type: "string", enum: COMBO_CATEGORIES }, count: { type: "integer" }, weight: { type: "integer" }, reason }),
    },
    relations: {
      type: "array",
      items: obj({ a: { type: "string", enum: allRefs }, b: { type: "string", enum: allRefs }, rel: { type: "string", enum: RELATIONS }, weight: { type: "integer" }, reason }),
    },
    needleValue: { anyOf: [{ type: "number" }, { type: "null" }] },
    inactivePenalty: { anyOf: [{ type: "integer" }, { type: "null" }] },
    notes: { type: "array", items: { type: "string" } },
  });
}

// ---------------------------------------------------------------------------
// Client side: turn a proposal into bag settings

export interface NormalizedProposal {
  summary: string;
  weights: { uid: string; weight: number; reason: string }[];
  comboGoals: (ComboGoal & { reason: string })[];
  relations: (RelationRule & { reason: string })[];
  needleValue: number | null;
  inactivePenalty: number | null;
  notes: string[];
  /** entries the model returned that could not be used */
  dropped: string[];
}

const clamp = (v: unknown, [lo, hi]: readonly [number, number], step = 1) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n / step) * step));
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

/** Validates and clamps a model proposal, mapping refs back to bag uids. Never throws on bad input. */
export function normalizeProposal(raw: unknown, refToUid: Map<string, string>, artifactUids: Set<string>): NormalizedProposal {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dropped: string[] = [];

  const weights = new Map<string, { uid: string; weight: number; reason: string }>();
  for (const w of arr(p.weights)) {
    const uid = refToUid.get(str(w.ref));
    const weight = clamp(w.weight, LIMITS.weight);
    if (!uid || !artifactUids.has(uid) || weight === null) { dropped.push(`중요도 ${str(w.ref) || "?"}`); continue; }
    weights.set(uid, { uid, weight, reason: str(w.reason) });
  }

  const goals = new Map<string, ComboGoal & { reason: string }>();
  for (const g of arr(p.comboGoals)) {
    const category = str(g.category);
    const count = clamp(g.count, LIMITS.comboCount);
    const weight = clamp(g.weight, LIMITS.goalWeight);
    if (!COMBO_CATEGORIES.includes(category) || count === null || weight === null) { dropped.push(`콤보 ${category || "?"}`); continue; }
    if (!goals.has(category)) goals.set(category, { category, count, weight, reason: str(g.reason) });
  }

  const relations: (RelationRule & { reason: string })[] = [];
  for (const r of arr(p.relations)) {
    const a = refToUid.get(str(r.a)), b = refToUid.get(str(r.b));
    const rel = str(r.rel) as Relation;
    const weight = clamp(r.weight, LIMITS.goalWeight);
    if (!a || !b || a === b || !RELATIONS.includes(rel) || weight === null) { dropped.push(`관계 ${str(r.a)}→${str(r.b)}`); continue; }
    if (relations.some((x) => x.a === a && x.b === b && x.rel === rel)) continue;
    relations.push({ a, b, rel, weight, reason: str(r.reason) });
  }

  return {
    summary: str(p.summary),
    weights: [...weights.values()],
    comboGoals: [...goals.values()],
    relations,
    needleValue: p.needleValue === null || p.needleValue === undefined ? null : clamp(p.needleValue, LIMITS.needle, 0.5),
    inactivePenalty: p.inactivePenalty === null || p.inactivePenalty === undefined ? null : clamp(p.inactivePenalty, LIMITS.penalty),
    notes: (Array.isArray(p.notes) ? p.notes : []).map(str).filter(Boolean),
    dropped,
  };
}
