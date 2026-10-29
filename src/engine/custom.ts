import type { ItemInstance, TabletCondition, TabletDef, TabletQuery } from "./types";
import { rotateQuery, type Catalog } from "./grid";
const RARITY_ORDER: Record<string, number> = { common: 0, advanced: 1, rare: 2, legendary: 3, eternal: 4, bond: 5 };

export interface TabletPart { defId: string; rotation: 0 | 1 | 2 | 3 }

export const CUSTOM_PREFIX = "custom:";

/** Serialises parts into a stable id: custom:<defId>@<rot>+<defId>@<rot> */
export function customId(parts: TabletPart[]): string {
  return CUSTOM_PREFIX + parts.map((p) => `${p.defId}@${p.rotation}`).join("+");
}

export function parseCustomId(id: string): TabletPart[] | null {
  if (!id.startsWith(CUSTOM_PREFIX)) return null;
  const parts = id.slice(CUSTOM_PREFIX.length).split("+").map((s) => {
    const [defId, r] = s.split("@");
    return { defId, rotation: (Number(r) % 4) as 0 | 1 | 2 | 3 };
  });
  return parts.every((p) => p.defId) ? parts : null;
}

const cache = new Map<string, TabletDef>();

/**
 * Builds the merged definition of a synthesised (합성) tablet.
 * Rules (namu wiki): the result inherits every effect of both parts — level areas, ignore areas,
 * placement conditions (all must hold). The result can be rotated (as a whole) only when every part is
 * rotatable. Each part is merged at its own rotation.
 */
export function buildCustomTablet(parts: TabletPart[], catalog: Catalog): TabletDef | undefined {
  const id = customId(parts);
  const hit = cache.get(id);
  if (hit) return hit;
  const defs = parts.map((p) => catalog.tablets.get(p.defId));
  if (defs.some((d) => !d) || defs.length === 0) return undefined;
  const queries: TabletQuery[] = [];
  const conditions: TabletCondition[] = [];
  const rotatable = defs.every((d) => d!.rotatable); // game rule: rotatable parts give a rotatable result
  let rarity = defs[0]!.rarity;
  defs.forEach((d, i) => {
    const def = d!;
    const rot = def.rotatable ? parts[i].rotation : 0;
    for (const q of def.queries) queries.push(rotateQuery(q, rot));
    if (def.condition && !conditions.includes(def.condition)) conditions.push(def.condition);
    if ((RARITY_ORDER[def.rarity] ?? 0) > (RARITY_ORDER[rarity] ?? 0)) rarity = def.rarity;
  });
  const def: TabletDef = {
    id,
    name: defs.map((d) => d!.name).join(" + "),
    nameKo: defs.map((d) => d!.nameKo).join("+"),
    rarity,
    rotatable,
    condition: conditions[0] ?? null,
    conditions,
    queries,
    parts,
  };
  cache.set(id, def);
  return def;
}

/** Resolve the effective TabletDef for a tablet item (built-in or custom). */
export function resolveTabletDef(it: ItemInstance, catalog: Catalog): TabletDef | undefined {
  if (it.kind !== "tablet") return undefined;
  if (it.parts && it.parts.length) return buildCustomTablet(it.parts, catalog);
  const parsed = parseCustomId(it.defId);
  if (parsed) return buildCustomTablet(parsed, catalog);
  return catalog.tablets.get(it.defId);
}

/** Resolve by id (built-in id or custom id). */
export function tabletDefById(id: string, catalog: Catalog): TabletDef | undefined {
  const parsed = parseCustomId(id);
  return parsed ? buildCustomTablet(parsed, catalog) : catalog.tablets.get(id);
}
