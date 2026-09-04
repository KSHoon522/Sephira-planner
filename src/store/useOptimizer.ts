"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OptimizeDone, OptimizeProgress, OptimizeRequest } from "@/engine/optimize";
import type { BagApi } from "./useBag";

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

  const run = useCallback((timeMs: number, restarts: number, live: boolean) => {
    const b = bagRef.current;
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
      layout: { cells: b.state.cells },
      items: Object.values(b.state.items),
      cfg: b.state.cfg,
      evalOpts: b.state.evalOpts,
      timeMs, restarts,
    };
    w.postMessage(req);
  }, []);

  const stop = useCallback(() => { workerRef.current?.terminate(); setOpt((o) => ({ ...o, running: false })); }, []);
  return { opt, run, stop };
}
