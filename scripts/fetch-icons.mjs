// Downloads item icons into public/icons/<id>.png for UI display and screenshot matching.
// Run once on your machine: node scripts/fetch-icons.mjs
// Icons are game assets mirrored by sephiria.tools; used here for a non-commercial fan tool.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const out = path.join(root, "public", "icons");
fs.mkdirSync(out, { recursive: true });

const tablets = JSON.parse(fs.readFileSync(path.join(root, "src/data/tablets.json"), "utf8"));
const artifacts = JSON.parse(fs.readFileSync(path.join(root, "src/data/artifacts.json"), "utf8"));
const ids = [...tablets.map((t) => t.id), ...artifacts.map((a) => a.id)];

let ok = 0, skip = 0, fail = 0;
const queue = [...ids];
async function worker() {
  while (queue.length) {
    const id = queue.shift();
    const file = path.join(out, `${id}.png`);
    if (fs.existsSync(file)) { skip++; continue; }
    try {
      const res = await fetch(`https://www.sephiria.tools/icons/items/${id}.png`);
      if (!res.ok) throw new Error(String(res.status));
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      ok++;
    } catch (e) {
      fail++;
      console.warn("fail", id, e.message);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`downloaded ${ok}, skipped ${skip}, failed ${fail} → ${out}`);
