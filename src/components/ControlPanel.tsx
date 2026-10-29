"use client";
import { useState } from "react";
import type { BagApi } from "@/store/useBag";
import { useOptimizer } from "@/store/useOptimizer";
import { CATEGORY_KO, WEAPONS, WEAPON_KO } from "@/engine/catalog";
import { MAX_CELLS, MIN_CELLS } from "@/engine/grid";
import { GoalsPanel } from "./GoalsPanel";
import { AiGoalsPanel } from "./AiGoalsPanel";

export function ControlPanel({ bag }: { bag: BagApi }) {
  const { state, dispatch, result } = bag;
  const { opt, run, stop } = useOptimizer(bag);
  const [timeSec, setTimeSec] = useState(4);
  const [restarts, setRestarts] = useState(4);
  const [live, setLive] = useState(true);
  const itemCount = Object.keys(state.items).length;

  return (
    <div className="flex flex-col gap-3">
      <AiGoalsPanel bag={bag} running={opt.running} onOptimize={(from) => run(timeSec * 1000, restarts, live, from)} />

      <section className="px-panel p-3 flex flex-col gap-2">
        <h3 className="px-title">가방 설정</h3>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>칸 수 <b className="font-mono">{state.cfg.cellCount}</b> <span className="text-[var(--muted)] text-tiny">({Math.ceil(state.cfg.cellCount / 6)}행)</span></span>
          <input type="range" min={MIN_CELLS} max={MAX_CELLS} value={state.cfg.cellCount} onChange={(e) => dispatch({ type: "setCellCount", count: Number(e.target.value) })} className="w-36" />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>무기</span>
          <select value={state.cfg.weapon ?? ""} onChange={(e) => dispatch({ type: "setWeapon", weapon: e.target.value || null })} className="px-input">
            <option value="">선택 안 함</option>
            {WEAPONS.map((w) => <option key={w} value={w}>{WEAPON_KO[w]}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm" title="차가운 자물쇠 등 '양옆 빈칸' 제약에서 가방 밖 칸을 빈칸으로 볼지">
          <span>가방 밖 = 빈칸 취급</span>
          <input type="checkbox" checked={state.evalOpts.edgeCountsAsEmpty} onChange={(e) => dispatch({ type: "setEvalOpt", key: "edgeCountsAsEmpty", value: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm" title="비활성 아티팩트 1개당 감점 (중요도 × 이 값)">
          <span>비활성 페널티</span>
          <input type="number" min={0} max={100} value={state.evalOpts.inactivePenalty} onChange={(e) => dispatch({ type: "setEvalOpt", key: "inactivePenalty", value: Number(e.target.value) })} className="w-16 px-input text-right" />
        </label>
        <div className="flex gap-2 pt-1">
          <button onClick={() => dispatch({ type: "clearBag" })} className="px-btn">가방 비우기</button>
          <button onClick={() => { if (confirm("모든 아이템을 삭제할까요?")) dispatch({ type: "reset" }); }} className="px-btn hover:!bg-[var(--bad)]">전체 초기화</button>
        </div>
      </section>

      <section className="px-panel p-3 flex flex-col gap-2">
        <h3 className="px-title">자동 최적화</h3>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>탐색 시간 <b className="font-mono">{timeSec}s</b></span>
          <input type="range" min={1} max={30} value={timeSec} onChange={(e) => setTimeSec(Number(e.target.value))} className="w-36" />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>재시작 횟수 <b className="font-mono">{restarts}</b></span>
          <input type="range" min={1} max={12} value={restarts} onChange={(e) => setRestarts(Number(e.target.value))} className="w-36" />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>진행 중 실시간 반영</span>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
        </label>
        {!opt.running ? (
          <button onClick={() => run(timeSec * 1000, restarts, live)} disabled={itemCount === 0 || itemCount > state.cfg.cellCount}
            className="mt-1 py-2 px-btn px-btn-gold">
            최적 배치 계산
          </button>
        ) : (
          <button onClick={stop} className="mt-1 py-2 px-btn px-btn-bad">중지</button>
        )}
        {itemCount > state.cfg.cellCount && <div className="text-xs text-[var(--bad)]">아이템({itemCount})이 칸 수({state.cfg.cellCount})보다 많습니다.</div>}
        {opt.error && <div className="text-xs text-[var(--bad)]">{opt.error}</div>}
        {(opt.running || opt.bestScore !== null) && (
          <div className="text-[var(--muted)]">
            {opt.running ? "탐색 중… " : "완료 · "}점수 {opt.bestScore?.toFixed(0) ?? "-"} · {opt.iter.toLocaleString()}회 · {(opt.elapsedMs / 1000).toFixed(1)}s
          </div>
        )}
        <p className="text-tiny text-[var(--muted)] leading-snug">
          점수 = Σ(중요도 × 유효 레벨) − 비활성 페널티 + 콤보 목표 + 관계 규칙 + 금빛 침. 🔒 고정한 아이템은 움직이지 않습니다. 회전 가능한 석판은 자동으로 회전됩니다.
        </p>
      </section>

      <section className="px-panel p-3 flex flex-col gap-1">
        <h3 className="px-title">현재 결과</h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="점수" value={result.score.toFixed(0)} accent />
          <Stat label="유효 레벨 합" value={String(result.totalEffective)} />
          <Stat label="활성 / 전체" value={`${result.activeCount} / ${result.artifactCount}`} bad={result.inactiveCount > 0} />
        </div>
        {(result.comboGoalScore || result.needleScore || result.relationScore) ? (
          <div className="text-tiny text-[var(--muted)]">콤보 목표 +{result.comboGoalScore} · 금빛 침 +{result.needleScore} · 관계 +{result.relationScore}</div>
        ) : null}
        {Object.keys(result.combos).length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {Object.entries(result.combos).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
              <span key={c} className="px-chip text-tiny">#{CATEGORY_KO[c] ?? c} <b className="text-[var(--accent)]">{n}</b></span>
            ))}
          </div>
        )}
      </section>

      <GoalsPanel bag={bag} />

      <section className="text-tiny text-[var(--muted)] leading-relaxed px-1">
        <b className="text-[var(--fg)]">조작</b> · 목록 클릭: 추가 · 드래그: 이동/교체 · 더블클릭 또는 R: 석판 회전 · 우클릭/Delete: 가방에서 빼기 · L: 위치 고정 · 석판 선택 시 영향 칸 표시
      </section>
    </div>
  );
}

function Stat({ label, value, accent, bad }: { label: string; value: string; accent?: boolean; bad?: boolean }) {
  return (
    <div className="bg-[#15131f] py-1.5 shadow-[inset_2px_2px_0_0_#0b0910]">
      <div className="text-tiny text-[var(--muted)]">{label}</div>
      <div className="font-bold text-lg px-shadow" style={{ color: bad ? "var(--bad)" : accent ? "var(--accent)" : "var(--fg)" }}>{value}</div>
    </div>
  );
}
