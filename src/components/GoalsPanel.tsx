"use client";
import { useState } from "react";
import type { BagApi } from "@/store/useBag";
import { CATEGORY_KO, catalog } from "@/engine/catalog";
import type { Relation } from "@/engine/types";
import { resolveTabletDef } from "@/engine/custom";

const REL_KO: Record<Relation, string> = {
  above: "바로 위에", below: "바로 아래에", left: "바로 왼쪽에", right: "바로 오른쪽에", adjacent: "상하좌우 인접", "same-row": "같은 가로줄", "same-col": "같은 세로줄",
};

/** Combo goals + relation rules (position-dependent objectives for the optimizer). */
export function GoalsPanel({ bag }: { bag: BagApi }) {
  const { state, dispatch, result } = bag;
  const goals = state.evalOpts.comboGoals ?? [];
  const relations = state.evalOpts.relations ?? [];
  const [gCat, setGCat] = useState("Sturdy");
  const [gCount, setGCount] = useState(3);
  const [gWeight, setGWeight] = useState(5);
  const items = Object.values(state.items);
  const label = (uid: string) => {
    const it = state.items[uid]; if (!it) return uid;
    const def = it.kind === "tablet" ? resolveTabletDef(it, catalog) : catalog.artifacts.get(it.defId);
    return def?.nameKo ?? it.defId;
  };
  const [rA, setRA] = useState(""); const [rB, setRB] = useState(""); const [rRel, setRRel] = useState<Relation>("above"); const [rW, setRW] = useState(5);

  return (
    <>
      <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 flex flex-col gap-2">
        <h3 className="text-xs uppercase tracking-wider text-[var(--muted)]">콤보 목표</h3>
        {goals.map((gl, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className={result.goalsMet[i] ? "text-[var(--good)]" : "text-[var(--bad)]"}>{result.goalsMet[i] ? "✓" : "✕"}</span>
            <span className="flex-1">#{CATEGORY_KO[gl.category] ?? gl.category} ≥ {gl.count} <span className="text-[var(--muted)] text-xs">(현재 {result.combos[gl.category] ?? 0})</span></span>
            <span className="text-xs text-[var(--muted)]">+{gl.weight}</span>
            <button onClick={() => dispatch({ type: "setComboGoals", goals: goals.filter((_, k) => k !== i) })} className="text-xs px-1 rounded hover:bg-[var(--bad)]">✕</button>
          </div>
        ))}
        <div className="flex items-center gap-1 text-xs">
          <select value={gCat} onChange={(e) => setGCat(e.target.value)} className="bg-[var(--panel-2)] border border-[var(--line)] rounded px-1 py-0.5 flex-1">
            {Object.entries(CATEGORY_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span>≥</span>
          <input type="number" min={1} max={8} value={gCount} onChange={(e) => setGCount(Number(e.target.value))} className="w-10 bg-[var(--panel-2)] border border-[var(--line)] rounded px-1 text-right" />
          <span>가중치</span>
          <input type="number" min={0} max={100} value={gWeight} onChange={(e) => setGWeight(Number(e.target.value))} className="w-12 bg-[var(--panel-2)] border border-[var(--line)] rounded px-1 text-right" />
          <button onClick={() => dispatch({ type: "setComboGoals", goals: [...goals, { category: gCat, count: gCount, weight: gWeight }] })} className="px-2 py-0.5 rounded bg-[var(--accent)] text-black font-semibold">추가</button>
        </div>
        <p className="text-[10px] text-[var(--muted)]">달성 시 점수 +가중치. 하얀 종이(양옆 같은 태그 → +1)·캘세더니 열쇠(1행 견고·2행 잉걸불·3행 빙하·4행 마법공학, 반복)는 배치에 따라 콤보에 반영됩니다.</p>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 flex flex-col gap-2">
        <h3 className="text-xs uppercase tracking-wider text-[var(--muted)]">관계 규칙</h3>
        {relations.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className={result.relationsMet[i] ? "text-[var(--good)]" : "text-[var(--bad)]"}>{result.relationsMet[i] ? "✓" : "✕"}</span>
            <span className="flex-1 truncate"><b>{label(r.a)}</b>이(가) <b>{label(r.b)}</b>의 {REL_KO[r.rel]}</span>
            <span className="text-[var(--muted)]">+{r.weight}</span>
            <button onClick={() => dispatch({ type: "setRelations", relations: relations.filter((_, k) => k !== i) })} className="px-1 rounded hover:bg-[var(--bad)]">✕</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-1 text-xs">
          <select value={rA} onChange={(e) => setRA(e.target.value)} className="bg-[var(--panel-2)] border border-[var(--line)] rounded px-1 py-0.5">
            <option value="">아이템 A</option>
            {items.map((it) => <option key={it.uid} value={it.uid}>{label(it.uid)}</option>)}
          </select>
          <select value={rRel} onChange={(e) => setRRel(e.target.value as Relation)} className="bg-[var(--panel-2)] border border-[var(--line)] rounded px-1 py-0.5">
            {(Object.keys(REL_KO) as Relation[]).map((k) => <option key={k} value={k}>{REL_KO[k]}</option>)}
          </select>
          <select value={rB} onChange={(e) => setRB(e.target.value)} className="bg-[var(--panel-2)] border border-[var(--line)] rounded px-1 py-0.5">
            <option value="">아이템 B</option>
            {items.map((it) => <option key={it.uid} value={it.uid}>{label(it.uid)}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <span>가중치</span>
            <input type="number" min={0} max={100} value={rW} onChange={(e) => setRW(Number(e.target.value))} className="w-12 bg-[var(--panel-2)] border border-[var(--line)] rounded px-1 text-right" />
            <button disabled={!rA || !rB || rA === rB} onClick={() => dispatch({ type: "setRelations", relations: [...relations, { a: rA, b: rB, rel: rRel, weight: rW }] })} className="ml-auto px-2 py-0.5 rounded bg-[var(--accent)] text-black font-semibold disabled:opacity-40">추가</button>
          </div>
        </div>
        <label className="flex items-center justify-between gap-2 text-xs pt-1" title="북향의 금빛 침 1개가 위 아티팩트에 닿을 때마다 (이 값 × 그 아티팩트 중요도) 가산. 세로로 겹치면 맨 위 아티팩트에 누적.">
          <span>북향의 금빛 침 가치</span>
          <input type="number" min={0} max={50} step={0.5} value={state.evalOpts.needleValue ?? 2} onChange={(e) => dispatch({ type: "setEvalOpt", key: "needleValue", value: Number(e.target.value) })} className="w-14 bg-[var(--panel-2)] border border-[var(--line)] rounded px-1 text-right" />
        </label>
        <p className="text-[10px] text-[var(--muted)]">&quot;A가 B의 바로 위에&quot; 등 위치 관계를 만족하면 점수 +가중치. 레이에 별조각(왼쪽 칸 마법서), 헌신의 휘장(같은 가로줄 동료) 등에 사용. 금빛 침은 자동: 직접 피해 아티팩트의 중요도를 높게 두면 그 아래에 세로로 쌓입니다.</p>
      </section>
    </>
  );
}
