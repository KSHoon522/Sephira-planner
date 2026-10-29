"use client";
import { useMemo, useState } from "react";
import { ARTIFACTS, TABLETS, RARITY_KO, RARITY_ORDER, CATEGORY_KO, RESTRICTION_KO } from "@/engine/catalog";
import type { BagApi } from "@/store/useBag";
import { ItemIcon } from "./ItemIcon";
import { TabletPattern } from "./TabletPattern";
import { condKo } from "@/engine/labels";
import { TabletCombiner } from "./TabletCombiner";

type Tab = "artifact" | "tablet";

export function Palette({ bag }: { bag: BagApi }) {
  const [tab, setTab] = useState<Tab>("tablet");
  const [q, setQ] = useState("");
  const [rarity, setRarity] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [combine, setCombine] = useState(false);

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const list = useMemo(() => {
    const nq = norm(q);
    if (tab === "tablet") {
      return TABLETS.filter((t) => t.id !== "custom" && (rarity === "all" || t.rarity === rarity) && (!nq || norm(t.nameKo).includes(nq) || norm(t.name).includes(nq)))
        .sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || a.nameKo.localeCompare(b.nameKo, "ko"));
    }
    return ARTIFACTS.filter((a) => (rarity === "all" || a.rarity === rarity) && (category === "all" || a.categories.includes(category)) && (!nq || norm(a.nameKo).includes(nq) || norm(a.name).includes(nq)))
      .sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || a.nameKo.localeCompare(b.nameKo, "ko"));
  }, [tab, q, rarity, category]);

  const categories = useMemo(() => Object.keys(CATEGORY_KO), []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 p-2 border-b-2 border-[var(--frame-dark)]">
        {(["tablet", "artifact"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-btn ${tab === t ? "px-btn-on" : "text-[var(--muted)]"}`}>
            {t === "tablet" ? `석판 (${TABLETS.length})` : `아티팩트 (${ARTIFACTS.length})`}
          </button>
        ))}
        {tab === "tablet" && (
          <button onClick={() => setCombine((v) => !v)} className={`ml-auto px-btn ${combine ? "px-btn-on" : "text-[var(--muted)]"}`}>합성</button>
        )}
      </div>
      {tab === "tablet" && combine && (
        <div className="p-1 border-b-2 border-[var(--frame-dark)]">
          <TabletCombiner onCreate={(parts) => { bag.dispatch({ type: "addItem", kind: "tablet", defId: "custom", parts }); setCombine(false); }} onClose={() => setCombine(false)} />
        </div>
      )}
      <div className="flex flex-wrap gap-1 p-2 border-b-2 border-[var(--frame-dark)]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 검색 (한/영)"
          className="flex-1 min-w-[120px] px-input" />
        <select value={rarity} onChange={(e) => setRarity(e.target.value)} className="px-input">
          <option value="all">등급 전체</option>
          {Object.entries(RARITY_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {tab === "artifact" && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-input">
            <option value="all">태그 전체</option>
            {categories.map((c) => <option key={c} value={c}>{CATEGORY_KO[c]}</option>)}
          </select>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-2 grid gap-1" style={{ gridTemplateColumns: "1fr" }}>
        {list.map((d) => (
          <button key={d.id}
            onClick={() => bag.dispatch({ type: "addItem", kind: tab, defId: d.id })}
            className={`rarity-${d.rarity} px-row group flex items-center gap-2 p-1.5 text-left`}
            title={"effect" in d ? d.effect : undefined}
          >
            <ItemIcon id={d.id} label={d.nameKo} rarity={d.rarity} kind={tab} size={32} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-tiny px-1" style={{ background: "color-mix(in oklab, var(--rc) 22%, transparent)", color: "var(--rc)", boxShadow: "0 0 0 1px color-mix(in oklab, var(--rc) 45%, transparent)" }}>{RARITY_KO[d.rarity]}</span>
                <span className="truncate font-bold px-shadow" style={{ color: "var(--rc)" }}>{d.nameKo}</span>
                <span className="truncate text-tiny text-[var(--muted)]">{d.name}</span>
              </div>
              {"maxLevel" in d ? (
                <div className="text-tiny text-[var(--muted)] flex gap-2 flex-wrap">
                  <span>★{d.maxLevel}</span>
                  {d.categories.map((c) => <span key={c}>#{CATEGORY_KO[c] ?? c}</span>)}
                  {d.restriction && <span className="text-[var(--warn)]">제약: {RESTRICTION_KO[d.restriction]}</span>}
                  {d.weapon && <span className="text-[var(--warn)]">{d.weapon} 전용</span>}
                </div>
              ) : (
                <div className="text-tiny text-[var(--muted)] flex gap-2">
                  {!d.rotatable && <span className="text-[var(--warn)]">회전불가</span>}
                  {d.condition && <span className="text-[var(--warn)]">조건: {condKo(d.condition)}</span>}
                </div>
              )}
            </div>
            {"queries" in d && <TabletPattern def={d} cell={9} />}
          </button>
        ))}
      </div>
    </div>
  );
}

