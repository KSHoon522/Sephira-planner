// Builds src/data/tablets.json and src/data/artifacts.json from the raw scraped files.
// Run: node scripts/build-data.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const dataDir = path.join(root, "src", "data");

const tabletsRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "tablets.raw.json"), "utf8"));
const artifactsRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "artifacts.raw.json"), "utf8"));
const artifactsKo = JSON.parse(fs.readFileSync(path.join(dataDir, "artifacts.ko.json"), "utf8"));

// ---------- Tablets ----------
const TABLET_KO = {
  advance: "전진", advent: "도래", approximation: "근사", "binary-star": "쌍성", brilliance: "광휘",
  cheers: "환호", chivalry: "기사도", cohesion: "응집", competition: "경쟁", compression: "압축",
  conviction: "확신", courage: "용기", curse: "저주", daydream: "백일몽", dedication: "헌정",
  "defensive-move": "방어수", desire: "열망", destiny: "운명", disconnection: "단절", distribution: "분배",
  dry: "건조", entrance: "입구", exit: "출구", exploitation: "착취", flag: "깃발", foundation: "기반",
  future: "미래", gaze: "시선", "good-will": "선의", handshake: "악수", harvest: "수확", heaven: "천국",
  hell: "지옥", honor: "명예", hope: "희망", hospitality: "환대", junction: "접합", justice: "정의",
  "last-stand": "배수진", link: "이음", miracle: "기적", nurture: "양육", oaths: "맹세", oppression: "압제",
  past: "과거", peace: "평화", power: "권능", preparation: "준비", progress: "발전", pulsation: "고동",
  rally: "집결", rebellion: "반항", requital: "보은", shade: "차양", simultaneity: "동시성", stack: "적재",
  surge: "고양", thorns: "가시", "three-headed": "삼두", transference: "전이", trick: "장난", unity: "화합",
  vigilance: "경계", wave: "파도", wedge: "쐐기", wisdom: "지혜", wit: "재치",
};
const SKIP_TABLETS = new Set(["miracle-athlete", "wisdom"]);

// Direction token -> [dx, dy] (dy < 0 = up)
function dirToOffset(tok) {
  const m = tok.match(/^(DIA)?(UP|DOWN|LEFT|RIGHT)+$/);
  if (tok.startsWith("KNIGHT")) {
    // KNIGHTUPLEFT etc. Ambiguous between (-1,-2) and (-2,-1); use (dx=-1, dy=-2) style: 2 in first named dir.
    const rest = tok.slice(6);
    const parts = rest.match(/UP|DOWN|LEFT|RIGHT/g);
    let dx = 0, dy = 0;
    parts.forEach((p, i) => {
      const mag = i === 0 ? 2 : 1;
      if (p === "UP") dy -= mag; if (p === "DOWN") dy += mag; if (p === "LEFT") dx -= mag; if (p === "RIGHT") dx += mag;
    });
    return [dx, dy];
  }
  if (!m) return null;
  let s = tok.startsWith("DIA") ? tok.slice(3) : tok;
  let dx = 0, dy = 0;
  for (const p of s.match(/UP|DOWN|LEFT|RIGHT/g)) {
    if (p === "UP") dy -= 1; if (p === "DOWN") dy += 1; if (p === "LEFT") dx -= 1; if (p === "RIGHT") dx += 1;
  }
  return [dx, dy];
}

function parseSummary(summary) {
  const queries = [];
  if (!summary) return queries;
  for (const partRaw of summary.split("·")) {
    const part = partRaw.trim();
    if (!part) continue;
    const [tok, valRaw] = part.split(/\s+/);
    const val = valRaw === undefined ? null : valRaw === "X" ? "X" : valRaw === "IGNORECRITERIA" ? "IGNORE" : parseInt(valRaw, 10);
    const effect = val === "X" ? { kind: "disable" } : val === "IGNORE" ? { kind: "ignore" } : { kind: "level", value: val };
    switch (tok) {
      case "HORIZONTAL": queries.push({ type: "row", effect }); break;
      case "VERTICAL": queries.push({ type: "column", effect }); break;
      case "TOP": queries.push({ type: "top-row", effect }); break;
      case "BOTTOM": queries.push({ type: "bottom-cells", effect }); break;
      case "RIGHT_RISING": case "LEFT_FALLING": queries.push({ type: "diagonal", dir: "slash", half: tok === "RIGHT_RISING" ? "up-right" : "down-left", effect }); break;
      case "LEFT_RISING": case "RIGHT_FALLING": queries.push({ type: "diagonal", dir: "backslash", half: tok === "LEFT_RISING" ? "up-left" : "down-right", effect }); break;
      case "CHECKERBOARD2": queries.push({ type: "checkerboard", parity: "odd", effect }); break;
      case "CHECKERBOARD": queries.push({ type: "checkerboard", parity: "even", effect }); break;
      default: {
        const off = dirToOffset(tok);
        if (!off) throw new Error(`Unknown token ${tok} in "${summary}"`);
        queries.push({ type: "cell", dx: off[0], dy: off[1], effect });
      }
    }
  }
  // merge the two halves of a diagonal into one query
  const merged = [];
  const seenDiag = new Set();
  for (const q of queries) {
    if (q.type === "diagonal") {
      const key = q.dir + JSON.stringify(q.effect);
      if (seenDiag.has(key)) continue;
      seenDiag.add(key);
      merged.push({ type: "diagonal", dir: q.dir, effect: q.effect });
    } else merged.push(q);
  }
  return merged;
}

function parseCondition(c) {
  if (!c) return null;
  const s = c.toUpperCase();
  const left = s.includes("LEFTEND"), right = s.includes("RIGHTEND");
  if (left && right) return "left-or-right-end";
  if (left) return "left-end";
  if (right) return "right-end";
  if (s.includes("TOP")) return "top";
  if (s.includes("BOTTOM")) return "bottom";
  throw new Error("Unknown condition " + c);
}

const tablets = tabletsRaw
  .filter((t) => !SKIP_TABLETS.has(t.slug))
  .map((t) => t.slug === "custom" ? { id: "custom", name: "Custom", nameKo: "합성 석판", rarity: "legendary", rotatable: false, condition: null, queries: [], placeholder: true } : ({
    id: t.slug,
    name: t.name,
    nameKo: TABLET_KO[t.slug] ?? t.name,
    rarity: t.rarity.toLowerCase(),
    rotatable: !!t.rotatable,
    condition: parseCondition(t.condition),
    queries: parseSummary(t.summary),
  }));

// ---------- Artifacts ----------
const RESTRICTION_MAP = {
  TopInInventory: "top", BottomInInventory: "bottom", Outlined: "edge", Inside: "inside", BothSidesAreEmpty: "both-sides-empty",
};
function restrictionOf(a) {
  if (a.placementCriteria && RESTRICTION_MAP[a.placementCriteria]) return RESTRICTION_MAP[a.placementCriteria];
  const r = (a.restriction || "").toLowerCase();
  if (!r) return null;
  if (r.includes("top row")) return "top";
  if (r.includes("lowest") || r.includes("bottom")) return "bottom";
  if (r.includes("outermost") || r.includes("border") || r.includes("edge")) return "edge";
  if (r.includes("inner")) return "inside";
  if (r.includes("both adjacent")) return "both-sides-empty";
  return null;
}
const WEAPONS = ["Sword and shield", "Greatsword", "Dagger", "Crossbow", "Magic staff", "Katana", "Golem", "Staff"];
const koMap = { ...(artifactsKo.map || {}), ...(artifactsKo._uncertain || {}) };

const artifacts = artifactsRaw
  .filter((a) => a.inBagPlanner)
  .map((a) => ({
    id: a.slug,
    name: a.name,
    nameKo: koMap[a.slug] ?? a.name,
    rarity: (a.rarity || "common").toLowerCase(),
    maxLevel: a.maxLevel ?? Math.max(0, (a.stars ?? 1) - 1),
    categories: a.categories || [],
    restriction: restrictionOf(a),
    weapon: typeof a.weapon === "number" ? WEAPONS[a.weapon] ?? null : a.weaponName ?? null,
    unique: !!a.unique,
    grimoire: !!a.grimoire,
    effect: a.effectSummary || (a.effects || []).filter(Boolean).join(", "),
  }));

fs.writeFileSync(path.join(dataDir, "tablets.json"), JSON.stringify(tablets, null, 1));
fs.writeFileSync(path.join(dataDir, "artifacts.json"), JSON.stringify(artifacts, null, 1));
console.log(`tablets: ${tablets.length}, artifacts: ${artifacts.length}`);
console.log("restrictions:", [...new Set(artifacts.map((a) => a.restriction).filter(Boolean))]);
console.log("categories:", [...new Set(artifacts.flatMap((a) => a.categories))].sort());
