import tabletsJson from "@/data/tablets.json";
import artifactsJson from "@/data/artifacts.json";
import type { ArtifactDef, TabletDef } from "./types";
import type { Catalog } from "./grid";

export const TABLETS = tabletsJson as unknown as TabletDef[];
export const ARTIFACTS = artifactsJson as unknown as ArtifactDef[];

export const catalog: Catalog = {
  artifacts: new Map(ARTIFACTS.map((a) => [a.id, a])),
  tablets: new Map(TABLETS.map((t) => [t.id, t])),
};

export const RARITY_ORDER: Record<string, number> = { common: 0, advanced: 1, rare: 2, legendary: 3, eternal: 4, bond: 5 };
export const RARITY_KO: Record<string, string> = { common: "일반", advanced: "고급", rare: "희귀", legendary: "전설", eternal: "영원", bond: "결속" };

export const CATEGORY_KO: Record<string, string> = {
  Sturdy: "견고", Shadow: "그림자", Glacier: "빙하", Lake: "호수", "Wind Song": "바람노래", Mystic: "신비",
  Magitech: "마법공학", "Frost Relic": "얼음무구", Planet: "행성", Precision: "정밀", Companion: "동료",
  Ember: "잉걸불", "Storm Cloud": "먹구름", Elemental: "원소", Guardian: "수호", Negotiation: "교섭",
  Curse: "저주", Academy: "아카데미", "Solar Blade": "태양검", Alchemy: "연금술",
};

export const RESTRICTION_KO: Record<string, string> = {
  top: "최상단", bottom: "최하단", edge: "가장자리", inside: "안쪽", "both-sides-empty": "양옆 빈칸",
};

export const WEAPONS = ["Sword and shield", "Greatsword", "Dagger", "Crossbow", "Magic staff", "Katana", "Golem", "Staff"] as const;
export const WEAPON_KO: Record<string, string> = {
  "Sword and shield": "검과 방패", Greatsword: "대검", Dagger: "단검", Crossbow: "석궁", "Magic staff": "마법 지팡이",
  Katana: "도", Golem: "골렘", Staff: "봉",
};
