import type { ObstacleClass } from "./schema.js";

/**
 * Deterministic obstacle classification by wording. Order matters: the first
 * matching class wins, so the narrower, more causal classes come first (a
 * "5h window reset" is capacity, not timing).
 */
const RULES: ReadonlyArray<readonly [ObstacleClass, RegExp]> = [
  ["capacity-credential", /\b401\b|credential|sign-?in|oauth|\btoken\b|usage window|\d+h window|rate.?limit|capacity|quota|usage limit/i],
  ["stale-judgement", /stale|earlier judgement|judgement revision|old checker|outdated verdict|superseded verdict/i],
  ["identity-attestation", /identity|attestation|signature|committer|unsigned/i],
  ["environment-wall", /tmux|sandbox|keychain|EPERM|permission denied|ENOENT|network|could not start|heartbeat/i],
  ["gate-misreads-bookkeeping", /bookkeeping|completion ask|settlement|governed record|mission log|patch check|not-applicable|\bdraft\b/i],
  ["timing", /midnight|timezone|clock|expired|timed? ?out|deadline|too early|too late/i]
];

export function classifyObstacle(text: string): ObstacleClass | null {
  for (const [obstacleClass, pattern] of RULES) {
    if (pattern.test(text)) return obstacleClass;
  }
  return null;
}
