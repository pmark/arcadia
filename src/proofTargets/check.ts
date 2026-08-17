export interface ProofCheckResult {
  healthState: "healthy" | "unhealthy";
  httpStatus: number | null;
  latencyMs: number;
  errorMessage: string | null;
}

/**
 * A deterministic reachability probe: one GET, no LLM involved. `2xx`/`3xx`
 * (Response.ok, redirects already followed) counts healthy; anything else,
 * including a network failure or timeout, is unhealthy with the reason kept
 * so the hero never claims health it did not observe.
 */
export async function performProofCheck(url: string, timeoutMs = 8000): Promise<ProofCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    return {
      healthState: response.ok ? "healthy" : "unhealthy",
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      errorMessage: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      healthState: "unhealthy",
      httpStatus: null,
      latencyMs: Date.now() - started,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}
