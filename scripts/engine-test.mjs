// Quick engine sanity test. Run: node scripts/engine-test.mjs  (uses tsx-free approach: compiles via esbuild-less TS strip)
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const tablets = JSON.parse(readFileSync(path.join(root, "src/data/tablets.json"), "utf8"));
const artifacts = JSON.parse(readFileSync(path.join(root, "src/data/artifacts.json"), "utf8"));
const catalog = { artifacts: new Map(artifacts.map((a) => [a.id, a])), tablets: new Map(tablets.map((t) => [t.id, t])) };

const { evaluate } = await import(pathToFileURL(path.join(root, ".tmp/grid.js")).href);
const { optimize } = await import(pathToFileURL(path.join(root, ".tmp/optimize.js")).href);

const cfg = { width: 6, cellCount: 24, weapon: null };
const items = new Map();
const add = (it) => items.set(it.uid, it);

// Test 1: Disconnection (단절) at (1,1): up +3, down +3, left -1, right -1, fixed
add({ uid: "t1", kind: "tablet", defId: "disconnection", rotation: 0 });
add({ uid: "a1", kind: "artifact", defId: "cold-lock", weight: 1 }); // max 4, both-sides-empty
add({ uid: "a2", kind: "artifact", defId: "charm-of-strength", weight: 1 }); // max 3
const cells = new Array(24).fill(null);
cells[7] = "t1"; // (1,1)
cells[1] = "a1"; // (1,0) above -> +3
cells[13] = "a2"; // (1,2) below -> +3
let r = evaluate({ cells }, items, cfg, catalog);
console.log("T1 cold-lock lvl", r.cells[1].level, "eff", r.cells[1].effectiveLevel, "active", r.cells[1].active, r.cells[1].reasons);
console.log("T1 strength lvl", r.cells[13].level, "eff", r.cells[13].effectiveLevel, "active", r.cells[13].active);
console.log("T1 left cell lvl", r.cells[6].level, "right", r.cells[8].level);

// Test 2: Shade (차양) requires top row; bottoms of columns with 27 cells
const cfg27 = { width: 6, cellCount: 27, weapon: null };
const it2 = new Map();
it2.set("s", { uid: "s", kind: "tablet", defId: "shade", rotation: 0 });
const c2 = new Array(27).fill(null); c2[0] = "s";
r = evaluate({ cells: c2 }, it2, cfg27, catalog);
console.log("T2 shade bottoms:", r.cells.map((c) => c.level).map((l, i) => (l ? i : null)).filter((x) => x !== null), "expect 24,25,26,21,22,23");
c2[0] = null; c2[6] = "s";
r = evaluate({ cells: c2 }, it2, cfg27, catalog);
console.log("T2 shade not top -> active?", r.cells[6].tabletActive, "(expect false)");

// Test 3: rotation of Conviction (UP 5) rotated 1 -> RIGHT 5
const it3 = new Map();
it3.set("c", { uid: "c", kind: "tablet", defId: "conviction", rotation: 1 });
const c3 = new Array(24).fill(null); c3[7] = "c";
r = evaluate({ cells: c3 }, it3, cfg, catalog);
console.log("T3 conviction rot1 -> cell 8 lvl", r.cells[8].level, "(expect 5)");

// Test 4: optimizer
const opt = new Map();
const oi = [
  { uid: "o1", kind: "tablet", defId: "disconnection", rotation: 0 },
  { uid: "o2", kind: "tablet", defId: "harvest", rotation: 0 },
  { uid: "o3", kind: "tablet", defId: "foundation", rotation: 0 },
  { uid: "o4", kind: "tablet", defId: "justice", rotation: 0 },
  { uid: "o5", kind: "tablet", defId: "cohesion", rotation: 0 },
  { uid: "a1", kind: "artifact", defId: "cold-lock", weight: 3 },
  { uid: "a2", kind: "artifact", defId: "charm-of-strength", weight: 1 },
  { uid: "a3", kind: "artifact", defId: "warrior-seal", weight: 2 },
  { uid: "a4", kind: "artifact", defId: "silver-plate", weight: 1 },
  { uid: "a5", kind: "artifact", defId: "magic-carrot", weight: 1 },
  { uid: "a6", kind: "artifact", defId: "keel-fragment", weight: 1 },
  { uid: "a7", kind: "artifact", defId: "thorn-bush", weight: 1 },
  { uid: "a8", kind: "artifact", defId: "white-paper", weight: 1 },
];
const t0 = performance.now();
const done = optimize({ layout: { cells: new Array(24).fill(null) }, items: oi, cfg, timeMs: 3000, restarts: 3, seed: 42 }, catalog);
console.log("T4 optimize score", done.bestScore, "iters", done.iter, "ms", Math.round(performance.now() - t0));
const itemsMap = new Map(done.items.map((i) => [i.uid, i]));
const res = evaluate(done.layout, itemsMap, cfg, catalog);
for (let y = 0; y < 4; y++) {
  console.log(done.layout.cells.slice(y * 6, y * 6 + 6).map((u, k) => {
    const i = y * 6 + k; const c = res.cells[i];
    if (!u) return `  .(${c.level >= 0 ? "+" : ""}${c.level})`.padEnd(14);
    const it = itemsMap.get(u);
    const d = it.kind === "tablet" ? catalog.tablets.get(it.defId).nameKo + "r" + it.rotation : catalog.artifacts.get(it.defId).nameKo.slice(0, 4) + `${c.effectiveLevel}/${c.maxLevel}${c.active ? "" : "X"}`;
    return d.padEnd(14);
  }).join(""));
}
console.log("active", res.activeCount, "/", res.artifactCount, "total eff", res.totalEffective);
