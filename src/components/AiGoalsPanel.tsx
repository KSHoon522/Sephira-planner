"use client";
import { useEffect, useRef, useState } from "react";
import { reducer, type BagApi, type BagState, type GoalSettings } from "@/store/useBag";
import { CATEGORY_KO, catalog } from "@/engine/catalog";
import { REL_KO } from "@/engine/labels";
import { resolveTabletDef } from "@/engine/custom";
import {
  AI_PROVIDERS, LIMITS, normalizeProposal,
  type AiGoalRequest, type AiGoalResponse, type AiProvider, type AiStatusResponse, type NormalizedProposal,
} from "@/ai/goals";

const SETTINGS_KEY = "sephiria-planner:ai";

interface AiSettings {
  provider: AiProvider;
  models: Partial<Record<AiProvider, string>>;
  keys: Partial<Record<AiProvider, string>>;
}
const DEFAULT_SETTINGS: AiSettings = { provider: "claude", models: {}, keys: {} };

const EXAMPLES = [
  "정밀 콤보를 최대한 맞추고, ★가 높은 아티팩트 레벨을 우선해줘",
  "피해량이 제일 큰 아티팩트를 골라 금빛 침을 그 아래에 세로로 쌓아줘",
  "비활성 아티팩트가 하나도 없게 해줘",
];

function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return DEFAULT_SETTINGS;
}

/** Natural-language goal → optimizer settings via an LLM. The optimizer still does the placement. */
export function AiGoalsPanel({ bag, running, onOptimize }: { bag: BagApi; running: boolean; onOptimize: (from: BagState) => void }) {
  const { state, dispatch } = bag;
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [serverKeys, setServerKeys] = useState<AiStatusResponse["serverKeys"] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ proposal: NormalizedProposal; model: string } | null>(null);
  const [undo, setUndo] = useState<GoalSettings | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const s = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setSettings(s);
    fetch("/api/ai/goals").then((r) => r.json() as Promise<AiStatusResponse>).then((d) => {
      setServerKeys(d.serverKeys);
      if (!s.keys[s.provider] && !d.serverKeys[s.provider]) setShowSettings(true);
    }).catch(() => setShowSettings(!s.keys[s.provider]));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  const updateSettings = (patch: Partial<AiSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const provider = settings.provider;
  const userKey = settings.keys[provider] ?? "";
  const hasKey = !!userKey || !!serverKeys?.[provider];
  const items = Object.values(state.items);
  const artifacts = items.filter((it) => it.kind === "artifact");

  const label = (uid: string) => {
    const it = state.items[uid];
    if (!it) return "(삭제됨)";
    const def = it.kind === "tablet" ? resolveTabletDef(it, catalog) : catalog.artifacts.get(it.defId);
    return def?.nameKo ?? it.defId;
  };

  const snapshot = (s: BagState): GoalSettings => ({
    weights: Object.fromEntries(Object.values(s.items).flatMap((it) => (it.kind === "artifact" ? [[it.uid, it.weight]] : []))),
    comboGoals: s.evalOpts.comboGoals,
    relations: s.evalOpts.relations,
    needleValue: s.evalOpts.needleValue,
    inactivePenalty: s.evalOpts.inactivePenalty,
  });

  async function ask() {
    // short refs keep uids out of the prompt and let the schema restrict answers to real items
    const uidOf = new Map<string, string>(), refOf = new Map<string, string>();
    let na = 0, nt = 0;
    for (const it of items) {
      const ref = it.kind === "artifact" ? `A${++na}` : `T${++nt}`;
      uidOf.set(ref, it.uid); refOf.set(it.uid, ref);
    }
    const req: AiGoalRequest = {
      provider,
      model: settings.models[provider]?.trim() || undefined,
      prompt: prompt.trim(),
      bag: {
        cellCount: state.cfg.cellCount,
        weapon: state.cfg.weapon,
        inactivePenalty: state.evalOpts.inactivePenalty,
        needleValue: state.evalOpts.needleValue,
        comboGoals: state.evalOpts.comboGoals,
        relations: state.evalOpts.relations.filter((r) => refOf.has(r.a) && refOf.has(r.b))
          .map((r) => ({ a: refOf.get(r.a)!, b: refOf.get(r.b)!, rel: r.rel, weight: r.weight })),
        items: items.map((it) => ({
          ref: refOf.get(it.uid)!,
          kind: it.kind,
          defId: it.defId,
          parts: it.kind === "tablet" ? it.parts : undefined,
          rotation: it.kind === "tablet" ? it.rotation : 0,
          enchant: it.kind === "artifact" ? it.enchant ?? 0 : 0,
          weight: it.kind === "artifact" ? it.weight : 0,
          locked: !!it.locked,
          placed: state.cells.includes(it.uid),
        })),
      },
    };
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true); setElapsed(0); setError(null); setResult(null); setUndo(null);
    try {
      const res = await fetch("/api/ai/goals", {
        method: "POST",
        headers: { "content-type": "application/json", ...(userKey ? { "x-ai-key": userKey } : {}) },
        body: JSON.stringify(req),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({ error: `서버 응답 오류 (${res.status})` }));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `오류 (${res.status})`);
      const { proposal, model } = data as AiGoalResponse;
      setResult({ proposal: normalizeProposal(proposal, uidOf, new Set(artifacts.map((a) => a.uid))), model });
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ac) { setBusy(false); abortRef.current = null; }
    }
  }

  function apply(optimize: boolean) {
    if (!result) return;
    const p = result.proposal;
    const goals: GoalSettings = {
      weights: Object.fromEntries(p.weights.map((w) => [w.uid, w.weight])),
      comboGoals: p.comboGoals.map(({ category, count, weight }) => ({ category, count, weight })),
      relations: p.relations.map(({ a, b, rel, weight }) => ({ a, b, rel, weight })),
      needleValue: p.needleValue ?? undefined,
      inactivePenalty: p.inactivePenalty ?? undefined,
    };
    const action = { type: "applyGoals", goals } as const;
    setUndo(snapshot(state));
    dispatch(action);
    setResult(null);
    if (optimize) onOptimize(reducer(state, action));
  }

  const p = result?.proposal;
  const weightChanges = p ? p.weights.filter((w) => state.items[w.uid]?.kind === "artifact" && (state.items[w.uid] as { weight: number }).weight !== w.weight) : [];
  const needleChange = p && p.needleValue !== null && p.needleValue !== state.evalOpts.needleValue;
  const penaltyChange = p && p.inactivePenalty !== null && p.inactivePenalty !== state.evalOpts.inactivePenalty;

  return (
    <section className="px-panel p-3 flex flex-col gap-2">
      <div className="flex items-center">
        <h3 className="px-title flex-1">AI 목표 설정</h3>
        <button onClick={() => setShowSettings((v) => !v)} className={`px-btn px-btn-sm ml-2 ${showSettings ? "px-btn-on" : ""}`} title="AI 제공자·모델·API 키">설정</button>
      </div>

      {showSettings && (
        <div className="flex flex-col gap-1.5 p-2 bg-[#15131f] shadow-[inset_2px_2px_0_0_#0b0910]">
          <div className="flex gap-1">
            {(Object.keys(AI_PROVIDERS) as AiProvider[]).map((k) => (
              <button key={k} onClick={() => updateSettings({ provider: k })} className={`px-btn px-btn-sm flex-1 ${provider === k ? "px-btn-on" : ""}`} title={AI_PROVIDERS[k].label}>{AI_PROVIDERS[k].short}</button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-[var(--muted)]">모델</span>
            <input value={settings.models[provider] ?? ""} placeholder={AI_PROVIDERS[provider].defaultModel}
              onChange={(e) => updateSettings({ models: { ...settings.models, [provider]: e.target.value } })}
              className="px-input flex-1 min-w-0" />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-[var(--muted)]">API 키</span>
            <input type={showKey ? "text" : "password"} value={userKey} placeholder={serverKeys?.[provider] ? "서버 키 사용 중 (비워도 됨)" : AI_PROVIDERS[provider].keyHint}
              autoComplete="off" spellCheck={false}
              onChange={(e) => updateSettings({ keys: { ...settings.keys, [provider]: e.target.value.trim() } })}
              className="px-input flex-1 min-w-0" />
            <button onClick={() => setShowKey((v) => !v)} className="px-btn px-btn-sm px-btn-ghost text-tiny">{showKey ? "숨김" : "보기"}</button>
          </label>
          <p className="text-tiny text-[var(--muted)]">
            키는 이 브라우저에만 저장되고, 요청할 때 이 툴의 서버를 거쳐 {AI_PROVIDERS[provider].short}로 전달됩니다.{" "}
            <a href={AI_PROVIDERS[provider].keyUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">키 발급</a>
          </p>
        </div>
      )}

      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, LIMITS.prompt))} rows={3}
        placeholder="어떤 빌드를 원하는지 적어주세요. 예: 샤프 아이 중심 정밀 빌드, 정밀 4콤보는 꼭"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy && prompt.trim() && hasKey && artifacts.length) ask(); }}
        className="px-input w-auto leading-[18px]" />
      {!prompt && (
        <div className="flex flex-col gap-0.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setPrompt(ex)} className="px-row text-left text-tiny text-[var(--muted)] px-1">› {ex}</button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        {busy ? (
          <button onClick={() => abortRef.current?.abort()} className="px-btn px-btn-bad flex-1">생각 중… {elapsed}s · 취소</button>
        ) : (
          <button onClick={ask} disabled={!prompt.trim() || !hasKey || artifacts.length === 0} className="px-btn px-btn-gold flex-1">목표 제안 받기</button>
        )}
      </div>
      {!hasKey && serverKeys && <div className="text-tiny text-[var(--warn)]">설정에서 {AI_PROVIDERS[provider].label} API 키를 입력하세요.</div>}
      {artifacts.length === 0 && <div className="text-tiny text-[var(--muted)]">가방에 아티팩트를 먼저 추가하세요.</div>}
      {error && <div className="text-[var(--bad)] break-words">{error}</div>}

      {p && (
        <div className="flex flex-col gap-2 p-2 bg-[#15131f] shadow-[inset_2px_2px_0_0_#0b0910]">
          {p.summary && <p className="text-[var(--fg)]">{p.summary}</p>}

          <Group title={`중요도 변경 ${weightChanges.length}개`} hint={artifacts.length - weightChanges.length > 0 ? `나머지 ${artifacts.length - weightChanges.length}개 그대로` : undefined}>
            {weightChanges.map((w) => (
              <Line key={w.uid} main={<>{label(w.uid)} <span className="text-[var(--muted)]">{(state.items[w.uid] as { weight: number }).weight} →</span> <b className="text-[var(--accent)]">{w.weight}</b></>} reason={w.reason} />
            ))}
          </Group>

          <Group title={`콤보 목표 ${p.comboGoals.length}개`} hint={state.evalOpts.comboGoals.length ? `기존 ${state.evalOpts.comboGoals.length}개를 교체` : undefined}>
            {p.comboGoals.map((g) => (
              <Line key={g.category} main={<>#{CATEGORY_KO[g.category] ?? g.category} ≥ {g.count} <span className="text-[var(--accent)]">+{g.weight}</span></>} reason={g.reason} />
            ))}
          </Group>

          <Group title={`관계 규칙 ${p.relations.length}개`} hint={state.evalOpts.relations.length ? `기존 ${state.evalOpts.relations.length}개를 교체` : undefined}>
            {p.relations.map((r, i) => (
              <Line key={i} main={<><b>{label(r.a)}</b>이(가) <b>{label(r.b)}</b>의 {REL_KO[r.rel]} <span className="text-[var(--accent)]">+{r.weight}</span></>} reason={r.reason} />
            ))}
          </Group>

          {(needleChange || penaltyChange) && (
            <div className="flex flex-col">
              {needleChange && <span>금빛 침 가치 <span className="text-[var(--muted)]">{state.evalOpts.needleValue} →</span> <b className="text-[var(--accent)]">{p.needleValue}</b></span>}
              {penaltyChange && <span>비활성 페널티 <span className="text-[var(--muted)]">{state.evalOpts.inactivePenalty} →</span> <b className="text-[var(--accent)]">{p.inactivePenalty}</b></span>}
            </div>
          )}

          {p.notes.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-[var(--warn)]">
              {p.notes.map((n, i) => <li key={i} className="text-tiny">! {n}</li>)}
            </ul>
          )}
          {p.dropped.length > 0 && <div className="text-tiny text-[var(--muted)]">쓸 수 없는 항목 {p.dropped.length}개는 뺐습니다: {p.dropped.join(", ")}</div>}

          <div className="flex flex-wrap gap-1 pt-1">
            <button onClick={() => apply(false)} className="px-btn px-btn-gold">적용</button>
            <button onClick={() => apply(true)} disabled={running} className="px-btn px-btn-good">적용하고 최적화</button>
            <button onClick={() => setResult(null)} className="px-btn px-btn-ghost ml-auto">버리기</button>
          </div>
          <div className="text-tiny text-[var(--muted)]">{result.model}</div>
        </div>
      )}

      {undo && !p && (
        <div className="flex items-center gap-2 text-[var(--good)]">
          <span className="flex-1">AI 제안을 적용했습니다.</span>
          <button onClick={() => { dispatch({ type: "applyGoals", goals: undo }); setUndo(null); }} className="px-btn px-btn-sm">되돌리기</button>
        </div>
      )}
    </section>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-[var(--accent)]">{title}</span>
        {hint && <span className="text-tiny text-[var(--muted)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Line({ main, reason }: { main: React.ReactNode; reason: string }) {
  return (
    <div className="pl-2 border-l-2 border-[var(--line)]">
      <div>{main}</div>
      {reason && <div className="text-tiny text-[var(--muted)]">{reason}</div>}
    </div>
  );
}
