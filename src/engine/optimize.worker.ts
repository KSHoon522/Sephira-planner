import { optimize, type OptimizeRequest } from "./optimize";
import { catalog } from "./catalog";

self.onmessage = (ev: MessageEvent<OptimizeRequest>) => {
  try {
    const done = optimize(ev.data, catalog, (p) => self.postMessage(p));
    self.postMessage(done);
  } catch (e) {
    self.postMessage({ type: "error", message: (e as Error).message });
  }
};
