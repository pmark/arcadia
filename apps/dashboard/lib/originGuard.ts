/**
 * This deployment has no auth/identity layer (docs/AGENT_ORIENTATION.md):
 * every dashboard API route is reachable by anything that can reach the host
 * over loopback or the operator's tailnet. "Unauthorized" here can only mean
 * "not a same-origin request from the dashboard's own UI" — a CSRF-style
 * guard, not an identity check. `Sec-Fetch-Site` (sent by every modern
 * browser) is authoritative when present; `Origin` is the fallback for older
 * clients. A request carrying neither header is not a cross-site browser
 * request — a curl/script call on this single-operator host, or a fetch that
 * omits the header outright — and is let through, matching this deployment's
 * "reachable, not attributable" security model.
 */
export function isSameOriginRequest(request: Request): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
