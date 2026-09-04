export type Rarity = "common" | "advanced" | "rare" | "legendary" | "eternal" | "bond";

export type CellEffect =
  | { kind: "level"; value: number }
  | { kind: "ignore" }
  | { kind: "disable" };

export type TabletQuery =
  | { type: "cell"; dx: number; dy: number; effect: CellEffect }
  | { type: "row"; effect: CellEffect }
  | { type: "column"; effect: CellEffect }
  | { type: "diagonal"; dir: "slash" | "backslash"; effect: CellEffect }
  | { type: "top-row"; effect: CellEffect }
  | { type: "bottom-cells"; effect: CellEffect }
  | { type: "checkerboard"; parity: "odd" | "even"; effect: CellEffect };

export type TabletCondition = "left-end" | "right-end" | "left-or-right-end" | "top" | "bottom" | null;

export interface TabletDef {
  id: string;
  name: string;
  nameKo: string;
  rarity: Rarity;
  rotatable: boolean;
  condition: TabletCondition;
  /** all placement conditions (custom tablets can carry several; all must hold) */
  conditions?: TabletCondition[];
  queries: TabletQuery[];
  /** set for synthesised (합성) tablets */
  parts?: { defId: string; rotation: 0 | 1 | 2 | 3 }[];
}

export type Restriction = "top" | "bottom" | "edge" | "inside" | "both-sides-empty" | null;

export interface ArtifactDef {
  id: string;
  name: string;
  nameKo: string;
  rarity: Rarity;
  maxLevel: number;
  categories: string[];
  restriction: Restriction;
  weapon: string | null;
  unique: boolean;
  grimoire: boolean;
  effect: string;
}

/** An item instance placed (or to be placed) in the bag. */
export type ItemInstance =
  | { uid: string; kind: "artifact"; defId: string; weight: number; locked?: boolean; enchant?: number }
  | { uid: string; kind: "tablet"; defId: string; rotation: 0 | 1 | 2 | 3; locked?: boolean; parts?: { defId: string; rotation: 0 | 1 | 2 | 3 }[] };

export interface BagConfig {
  width: number; // always 6 in game
  cellCount: number; // 24..42
  weapon: string | null;
}

/** cells[i] = uid of item at index i, or null */
export interface Layout {
  cells: (string | null)[];
}

export interface CellResult {
  index: number;
  uid: string | null;
  kind: "artifact" | "tablet" | "empty";
  level: number; // raw level (before cap) = tablet sum + enchant
  tabletLevel: number; // tablet contribution only
  enchant: number;
  effectiveLevel: number; // min(level, max)
  maxLevel: number;
  ignored: boolean; // restriction ignored by tablet
  disabled: boolean; // disabled by tablet
  restrictionOk: boolean;
  weaponOk: boolean;
  tabletActive: boolean; // for tablets: condition satisfied
  active: boolean; // for artifacts: effect actually applies
  reasons: string[];
  needleHits: number; // 북향의 금빛 침 boosts reaching this artifact
  comboGrant: string[]; // combo categories this cell adds via position (하얀 종이 / 캘세더니 열쇠)
}

export interface EvalResult {
  cells: CellResult[];
  score: number;
  totalEffective: number;
  activeCount: number;
  artifactCount: number;
  inactiveCount: number;
  combos: Record<string, number>;
  comboGoalScore: number;
  needleScore: number;
  relationScore: number;
  goalsMet: boolean[];
  relationsMet: boolean[];
}

export interface ComboGoal { category: string; count: number; weight: number }
export type Relation = "above" | "below" | "left" | "right" | "adjacent" | "same-row" | "same-col";
export interface RelationRule { a: string; b: string; rel: Relation; weight: number } // a is <rel> of b
