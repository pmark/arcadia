/**
 * Read-only probe of the operator's Tailnet press path (Issue 2633, Decision 0173).
 *
 * It sends exactly one GET, with Origin set to the URL's own origin, to the dashboard's press-path route. That route
 * runs the unchanged `isOperatorBrowserPress` over the Origin and Host the server actually received, so a `tailscale
 * serve` that rewrote Host shows up as a refusal naming the host the server saw. It never sends a POST, never presses
 * anything and never throws.
 */
export type PressPathOutcome = "accept" | "refuse" | "unreachable";

export interface PressPathProbeResult {
  outcome: PressPathOutcome;
  /** The Host header the dashboard saw, when it answered. */
  host: string | null;
  /** Why it refused or could not be reached. */
  detail: string | null;
}

export type PressPathFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function probePressPath(options: { url: string; fetch?: PressPathFetch }): Promise<PressPathProbeResult> {
  const unreachable = (detail: string): PressPathProbeResult => ({ outcome: "unreachable", host: null, detail });
  let origin: string;
  try {
    const parsed = new URL(options.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return unreachable(`${options.url} is not an http(s) URL.`);
    origin = parsed.origin;
  } catch { return unreachable(`${options.url} is not a valid URL.`); }
  try {
    const response = await (options.fetch ?? globalThis.fetch)(options.url, { method: "GET", headers: { origin } });
    let body: { accepted?: unknown; host?: unknown; reason?: unknown };
    try { body = await response.json() as typeof body; } catch { return unreachable(`HTTP ${response.status} without a press-path answer.`); }
    if (!response.ok || typeof body.accepted !== "boolean") return unreachable(`HTTP ${response.status} without a press-path answer.`);
    const host = typeof body.host === "string" ? body.host : null;
    if (body.accepted) return { outcome: "accept", host, detail: null };
    return { outcome: "refuse", host, detail: typeof body.reason === "string" ? body.reason : null };
  } catch (error) {
    return unreachable(error instanceof Error ? error.message : String(error));
  }
}

/** One line for the operator; the exit code is non-zero on refuse or unreachable. */
export function formatPressPathResult(url: string, result: PressPathProbeResult): { line: string; exitCode: number } {
  if (result.outcome === "accept") return { line: `PRESS PATH ACCEPT ${url} (server saw Host ${result.host ?? "unknown"})`, exitCode: 0 };
  if (result.outcome === "refuse") return { line: `PRESS PATH REFUSE ${url} (server saw Host ${result.host ?? "none"}): ${result.detail ?? "refused"}`, exitCode: 1 };
  return { line: `PRESS PATH UNREACHABLE ${url}: ${result.detail ?? "no answer"}`, exitCode: 2 };
}

/** Entry for scripts/press-path-probe.sh. */
export async function runPressPathProbeCli(url: string | undefined): Promise<number> {
  if (!url) { console.log("PRESS PATH UNREACHABLE: pass the Tailnet press-path URL as the first argument."); return 2; }
  const { line, exitCode } = formatPressPathResult(url, await probePressPath({ url }));
  console.log(line);
  return exitCode;
}
