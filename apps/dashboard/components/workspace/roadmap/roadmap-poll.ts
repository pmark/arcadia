/** Data is at most about this old on a visible page (plus the server cache's own 2 s check). */
export const REFRESH_SECONDS = 30;

/** The slice of `document` the poll needs, so it can be driven without a browser. */
export interface VisibilitySource {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Wrap a read so a second call while one is running is ignored (a slow response never stacks requests). */
export function singleFlight(read: (fresh: boolean) => Promise<void>): (fresh: boolean) => Promise<void> {
  let inFlight = false;
  return async (fresh) => {
    if (inFlight) return;
    inFlight = true;
    try {
      await read(fresh);
    } finally {
      inFlight = false;
    }
  };
}

/**
 * Read every `seconds` while the page is visible, stop while it is hidden, and read at once when it is shown again.
 * Returns the function that stops it and removes its listener.
 */
export function startPolling(read: (fresh: boolean) => Promise<void> | void, source: VisibilitySource, seconds = REFRESH_SECONDS): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = () => { if (!timer) timer = setInterval(() => { void read(false); }, seconds * 1000); };
  const stop = () => { if (timer) { clearInterval(timer); timer = undefined; } };
  const onVisibility = () => {
    if (source.visibilityState === "hidden") stop();
    else { void read(false); start(); }
  };
  if (source.visibilityState !== "hidden") start();
  source.addEventListener("visibilitychange", onVisibility);
  return () => { stop(); source.removeEventListener("visibilitychange", onVisibility); };
}
