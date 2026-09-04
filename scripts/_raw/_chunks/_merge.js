const fs=require("fs");
const listing=fs.readFileSync("_listing_slugs.txt","utf8").trim().split("\n");
const planner=Object.fromEntries(JSON.parse(fs.readFileSync("_planner_extra.json","utf8")).map(x=>[x.slug,x]));
let pages=[];for(let i=1;i<=11;i++) pages.push(...JSON.parse(fs.readFileSync(`_p${i}.json`,"utf8")));
const pageBy=Object.fromEntries(pages.map(p=>[p.slug,p]));
const WEAPON={0:"Sword and shield",1:"Greatsword",2:"Dagger",3:"Crossbow",4:"Magic staff",5:"Katana",6:"Golem",7:"Staff"};
const CRIT={TopInInventory:"Triggers when placed in the top row",BottomInInventory:"Triggers when in the lowest slot",Outlined:"Triggers when in an outermost slot",Inside:"Triggers when in the inner slots",BothSidesAreEmpty:"Triggers when both adjacent slots are empty"};
const RCRIT=Object.fromEntries(Object.entries(CRIT).map(([k,v])=>[v,k]));
const WREQ={"sword and shield weapon":0,"greatsword":1,"dagger":2,"crossbow":3,"magic staff":4,"katana":5,"golem":6,"staff":7};
const missing=listing.slice(listing.indexOf("red-mushroom")+1);
const out=[];
for(const slug of missing){
  const p=pageBy[slug]; if(!p) throw new Error("no page "+slug);
  const pl=planner[slug]||null;
  // maxLevel: from scaling table "(max)" col -> we recorded scaling arrays but not max index; use planner maxLevel, else stars-1
  let maxLevel = pl? pl.maxLevel : (p.stars-1);
  if(pl && pl.maxLevel!==p.stars-1) console.error("WARN maxLevel/stars mismatch",slug,pl.maxLevel,p.stars);
  let weapon = pl? pl.weapon : (p.weapon!==undefined? p.weapon : null);
  if(weapon===null && p.weaponRequirement){ const m=p.weaponRequirement.match(/Only works while an? (.+?) is equipped/); if(m && WREQ[m[1]]!==undefined) weapon=WREQ[m[1]]; }
  if(pl && p.weaponRequirement){ const m=p.weaponRequirement.match(/Only works while an? (.+?) is equipped/); if(m && WREQ[m[1]]!==pl.weapon) console.error("WARN weapon mismatch",slug,pl.weapon,m[1]); }
  let restriction = p.restriction||null;
  let placementCriteria = pl? pl.criteria : (restriction? RCRIT[restriction]||null : null);
  if(pl && pl.criteria && CRIT[pl.criteria]!==restriction) console.error("WARN criteria mismatch",slug,pl.criteria,restriction);
  if(!restriction && placementCriteria) restriction=CRIT[placementCriteria];
  const grimoire = pl? pl.grimoire!==undefined? pl.grimoire : (p.grimoire||false) : (p.grimoire||false);
  const effects=p.effects||[];
  const effectTemplates= pl? pl.effects : [];
  const effectSummary = effects.length? effects.join("; ") : effectTemplates.join("; ");
  const rec={slug, name:p.name, rarity:p.rarity, cost:p.cost, grimoire, maxLevel, stars:p.stars, categories:p.categories, restriction, placementCriteria, weapon, weaponName: weapon===null?null:WEAPON[weapon], unique: pl? pl.unique : null, inBagPlanner: !!pl, effects, effectTemplates, effectSummary};
  if(p.weaponRequirement) rec.weaponRequirement=p.weaponRequirement;
  const flags=(p.flags||[]).filter(f=>f!=="Dual item"); if(flags.length) rec.flags=flags;
  if(p.howToGet) rec.howToGet=p.howToGet;
  if(p.behaviour) rec.behaviour=p.behaviour;
  if(p.comboEffects) rec.comboEffects=p.comboEffects;
  if(p.scaling) rec.scaling=p.scaling;
  if(p.arrangementBonus) rec.arrangementBonus=p.arrangementBonus;
  // sanity: planner categories count vs page
  if(pl && pl.categories.length!==p.categories.length) console.error("WARN cat count",slug,pl.categories,p.categories);
  out.push(rec);
}
console.log("new records",out.length);
fs.writeFileSync("c4.json",JSON.stringify(out.slice(0,60)));
fs.writeFileSync("c5.json",JSON.stringify(out.slice(60)));
let all=[];for(const f of ["c0.json","c1.json","c2.json","c3.json","c4.json","c5.json"]) all.push(...JSON.parse(fs.readFileSync(f,"utf8")));
console.log("total",all.length, "order ok", all.every((a,i)=>a.slug===listing[i]));
fs.writeFileSync("../artifacts.raw.json",JSON.stringify(all,null,2)+"\n");
console.log("inBagPlanner", all.filter(a=>a.inBagPlanner).length);
console.log("restrictions", [...new Set(all.map(a=>a.restriction).filter(Boolean))]);
console.log("categories", [...new Set(all.flatMap(a=>a.categories))].sort());
console.log("unique counts", {t:all.filter(a=>a.unique===true).length,f:all.filter(a=>a.unique===false).length,n:all.filter(a=>a.unique===null).length});
console.log("grimoire", all.filter(a=>a.grimoire).length);
