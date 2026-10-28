import type { DirectionView } from "../../../src/ask/directionTypes.js";

const states = ["submitted", "delivered", "acknowledged", "continued", "verified", "unknown", "held", "refused"];
export function isDirectionView(value: unknown): value is DirectionView {
  if (!value || typeof value !== "object") return false;
  const v = value as DirectionView;
  return typeof v.requestId === "string" && typeof v.content === "string" && states.includes(v.state) &&
    (v.disposition === "unknown" ? v.fingerprint === null : typeof v.fingerprint === "string" && /^[a-f0-9]{64}$/.test(v.fingerprint)) &&
    (v.lastSupportedState === null || states.includes(v.lastSupportedState)) &&
    ["accepted", "refused", "unknown"].includes(v.disposition) && (v.reason === null || typeof v.reason === "string") &&
    Array.isArray(v.evidence) && v.evidence.every(e => e && states.includes(e.state) && typeof e.artifact === "string" && e.artifact.length > 0 &&
      typeof e.source === "string" && e.source.length > 0 && typeof e.provenance === "string" &&
      typeof e.observedAt === "string" && Number.isFinite(new Date(e.observedAt).getTime())) &&
    (v.state !== "verified" || (v.lastSupportedState === "verified" && v.evidence.some(e => e.state === "verified" && e.current === true && e.result === "passed" && /^[a-f0-9]{40}$/.test(e.revision ?? ""))));
}
