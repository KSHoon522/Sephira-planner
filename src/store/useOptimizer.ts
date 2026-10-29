"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OptimizeDone, OptimizeProgress, OptimizeRequest } from "@/engine/optimize";
import type { BagApi, BagState } from "./useBag";

export interface OptState {
  running: boolean;
  bestScore: number | null;
  iter: number;
  elapsedMs: number;
  error: string | null;
}

export function useOptimizer(bag: BagApi) {
  const workerRef = useRef<Worker | null>(null);
  const [opt, setOpt] = useState<OptState>({ running: false, bestScore: null, iter: 0, elapsedMs: 0, error: null });
  const bagRef = useRef(bag);
  useEffect(() => { bagRef.current = bag; }, [bag]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  /** `from` lets a caller optimise a state it just dispatched, before the hook has re-rendered with it. */
  const run = useCallback((timeMs: number, restarts: number, live: boolean, from?: BagState) => {
    const s = from ?? bagRef.current.state;
    workerRef.current?.terminate();
    const w = new Worker(new URL("../engine/optimize.worker.ts", import.meta.url));
    workerRef.current = w;
    setOpt({ running: true, bestScore: null, iter: 0, elapsedMs: 0, error: null });
    w.onmessage = (ev: MessageEvent<OptimizeProgress | OptimizeDone | { type: "error"; message: string }>) => {
      const m = ev.data;
      if (m.type === "error") { setOpt((o) => ({ ...o, running: false, error: m.message })); return; }
      setOpt((o) => ({ ...o, bestScore: m.bestScore, iter: m.iter, elapsedMs: m.elapsedMs }));
      if (m.type === "done" || live) bagRef.current.dispatch({ type: "applyLayout", cells: m.layout.cells, items: m.items });
      if (m.type === "done") { setOpt((o) => ({ ...o, running: false })); w.terminate(); }
    };
    const req: OptimizeRequest = {
      layout: { cells: s.cells },
      items: Object.values(s.items),
      cfg: s.cfg,
      evalOpts: s.evalOpts,
      timeMs, restarts,
    };
    w.postMessage(req);
  }, []);

  const stop = useCallback(() => { workerRef.current?.terminate(); setOpt((o) => ({ ...o, running: false })); }, []);
  return { opt, run, stop };
}
