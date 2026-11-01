import path from "node:path";
import { DELEGATION_DECISION, DELEGATION_SCOPE, validateDelegationBlock, type StartRunDelegation } from "./startRunDelegation.js";

/**
 * The pinned facts of one per-run START card (Decisions 0156 and 0157). The card is a thin launcher plus a
 * descriptor; this block is everything run-specific, so reviewing a new card is a mechanical diff of these
 * pins plus an independent critic check. The shared executor (`scripts/start-run.sh`) reads every value
 * from here with jq and hard-codes none of them.
 *
 * The installed-revision pin of the older START cards becomes `reviewedRevision`: the main sha the card
 * fast-forwards the clean checkout to (never beyond), installs with `go-broker ensure` and then checks with
 * `production runtime-check`.
 */
export interface StartRunPins {
  schema: "arcadia-start-run-v1";
  /** The reviewed main commit the card installs and starts from. Origin main must equal it at press time. */
  reviewedRevision: string;
  /** sha256 of scripts/start-run.sh at `reviewedRevision`; the card refuses any other executor. */
  executorSha256: string;
  /** Workspace directory name the configured default workspace must resolve to. */
  workspace: string;
  project: string;
  plan: string;
  /** The pinned Actions, in queue order. All must still be open. */
  actions: string[];
  provider: "claude-code-cli";
  /** Delegated mechanics; must include packet_approval. */
  transitions: string[];
  concurrency: 1;
  /** Packet-approval delegation and integration grant length, 1 to 24 hours from the press. */
  packetApprovalHours: number;
  intent: string;
  spendDecision: string;
  integrationDecision: string;
  /** Decisions that must be approved with a recorded answer at the reviewed revision. */
  requiredDecisions: string[];
  /** Repository-relative files that must exist at the reviewed revision. */
  requiredFiles: string[];
  /** Production must be Off at exactly this policy revision and epoch with zero live admissions. */
  production: { revision: number; epoch: number };
  /** The Action queue revision observed when the card was prepared (see the executor for the activation case). */
  queueRevision: number;
  /** The managed worker's launchd label: after `go-broker ensure` succeeds the card reinstalls it from the pinned compiled release (protected) and restarts it. */
  workerLabel: string;
  /** The operator-owned card that turns the capacity gate on. */
  gateCardId: string;
  /** The generic STOP entry named in handoffs. */
  offId: string;
  /** Who authorizes the press: the operator personally, from /actions, under Decisions 0156/0157 (no agent delegation). */
  grantedBy: string;
  /** Receipts whose bytes must be unchanged (consumed markers of earlier runs, authority evidence). */
  consumedHistory: Array<{ path: string; sha256: string }>;
  // Decision 0161 replaced the retained pre-press sign-in receipt (the former signInEvidence pin): the card itself renews
  // the sign-in once and has the bound worker check usage after its protected install (scripts/start-run.sh, P4).
  /** Decision 0163: present only on a successor card Rowan presses, delegated from the operator's originating press. */
  delegation?: StartRunDelegation;
}

export class StartRunPinsError extends Error {
  constructor(message: string) { super(message); }
}

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha1 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const decisionId = /^\d{4}$/;
const TRANSITIONS = ["validation", "acceptance", "pointer", "packet_approval"];
export const START_RUN_KEYS = [
  "actions", "concurrency", "consumedHistory", "executorSha256", "gateCardId", "grantedBy", "integrationDecision", "intent", "offId",
  "packetApprovalHours", "plan", "production", "project", "provider", "queueRevision", "requiredDecisions", "requiredFiles",
  "reviewedRevision", "schema", "spendDecision", "transitions", "workerLabel", "workspace"
];
/** The repository path of the shared executor; every card pins its hash. */
export const START_RUN_EXECUTOR_PATH = "scripts/start-run.sh";

const fail = (message: string): never => { throw new StartRunPinsError(message); };
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && ![...v].some((char) => char.charCodeAt(0) < 32);
const int = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const exactKeys = (value: unknown, keys: string[], label: string): void => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    fail(`${label} needs exactly the fields ${[...keys].sort().join(", ")}.`);
  }
};
const distinct = (list: unknown[]): boolean => new Set(list).size === list.length;
const repoRelative = (v: unknown): v is string =>
  text(v, 300) && !path.isAbsolute(v) && !v.split(/[\\/]/).some((part) => part === ".." || part === "" || part === ".") && !v.includes("\\");

/** Strict validation: the exact field set, no defaults, no extras. Returns the same object when valid. */
export function validateStartRunPins(value: unknown): StartRunPins {
  const hasDelegation = !!value && typeof value === "object" && "delegation" in value;
  exactKeys(value, hasDelegation ? [...START_RUN_KEYS, "delegation"] : START_RUN_KEYS, "startRun");
  const p = value as StartRunPins;
  if (hasDelegation) {
    try { validateDelegationBlock(p.delegation); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    if (!Array.isArray(p.requiredDecisions) || !p.requiredDecisions.includes(DELEGATION_DECISION)) fail("startRun.requiredDecisions must include Decision 0163 on a delegated card.");
    // The delegated scope is fixed by Decision 0163.
    if (p.plan !== DELEGATION_SCOPE.plan || JSON.stringify(p.actions) !== JSON.stringify(DELEGATION_SCOPE.actions) || p.provider !== DELEGATION_SCOPE.provider
      || p.concurrency !== DELEGATION_SCOPE.concurrency || p.spendDecision !== DELEGATION_SCOPE.spendDecision) {
      fail("A delegated card keeps exactly the scope Decision 0163 delegates (Plan, Actions in order, provider, concurrency, spend Decision).");
    }
  }
  if (p.schema !== "arcadia-start-run-v1") fail("startRun.schema must be arcadia-start-run-v1.");
  if (typeof p.reviewedRevision !== "string" || !sha1.test(p.reviewedRevision)) fail("startRun.reviewedRevision must be a full 40-hex commit id.");
  if (typeof p.executorSha256 !== "string" || !sha256.test(p.executorSha256)) fail("startRun.executorSha256 must be 64 lowercase hex.");
  for (const [name, v] of [["workspace", p.workspace], ["project", p.project], ["plan", p.plan], ["gateCardId", p.gateCardId], ["offId", p.offId]] as const) {
    if (typeof v !== "string" || !slug.test(v)) fail(`startRun.${name} must be a lowercase slug.`);
  }
  if (!Array.isArray(p.actions) || p.actions.length < 1 || p.actions.length > 12 || !p.actions.every((a) => typeof a === "string" && slug.test(a)) || !distinct(p.actions)) {
    fail("startRun.actions needs 1 to 12 distinct Action slugs in queue order.");
  }
  if (p.provider !== "claude-code-cli") fail("startRun.provider must be claude-code-cli (the executor binds the Claude worker heartbeat).");
  if (!Array.isArray(p.transitions) || p.transitions.length < 1 || !p.transitions.every((t) => TRANSITIONS.includes(t)) || !distinct(p.transitions) || !p.transitions.includes("packet_approval")) {
    fail(`startRun.transitions needs distinct entries of ${TRANSITIONS.join(", ")} and must include packet_approval.`);
  }
  if (p.concurrency !== 1) fail("startRun.concurrency must be 1.");
  if (!int(p.packetApprovalHours, 1, 24)) fail("startRun.packetApprovalHours must be a whole number from 1 to 24.");
  if (!text(p.intent, 1000)) fail("startRun.intent needs 1 to 1000 characters of single-line text.");
  if (!text(p.grantedBy, 300)) fail("startRun.grantedBy needs 1 to 300 characters of single-line text.");
  for (const [name, v] of [["spendDecision", p.spendDecision], ["integrationDecision", p.integrationDecision]] as const) {
    if (typeof v !== "string" || !decisionId.test(v)) fail(`startRun.${name} must be a four-digit Decision id.`);
  }
  if (!Array.isArray(p.requiredDecisions) || !p.requiredDecisions.length || !p.requiredDecisions.every((d) => typeof d === "string" && decisionId.test(d)) || !distinct(p.requiredDecisions)) {
    fail("startRun.requiredDecisions needs distinct four-digit Decision ids.");
  }
  for (const needed of [p.spendDecision, p.integrationDecision, "0141", "0143", "0156", "0157", "0161"]) {
    if (!p.requiredDecisions.includes(needed)) fail(`startRun.requiredDecisions must include Decision ${needed}.`);
  }
  if (!Array.isArray(p.requiredFiles) || !p.requiredFiles.every(repoRelative) || !distinct(p.requiredFiles) || !p.requiredFiles.includes(START_RUN_EXECUTOR_PATH)) {
    fail(`startRun.requiredFiles needs distinct repository-relative paths including ${START_RUN_EXECUTOR_PATH}.`);
  }
  exactKeys(p.production, ["epoch", "revision"], "startRun.production");
  if (!int(p.production.revision, 0) || !int(p.production.epoch, 0)) fail("startRun.production needs whole-number revision and epoch.");
  if (!int(p.queueRevision, 0)) fail("startRun.queueRevision must be a whole number.");
  if (typeof p.workerLabel !== "string" || !/^com\.arcadia\.[A-Za-z0-9._-]+\.worker$/.test(p.workerLabel)) fail("startRun.workerLabel must be a com.arcadia.*.worker launchd label.");
  if (!Array.isArray(p.consumedHistory) || p.consumedHistory.length < 1 || p.consumedHistory.length > 200) fail("startRun.consumedHistory must list 1 to 200 receipts (an empty authority list is refused).");
  for (const entry of p.consumedHistory) {
    exactKeys(entry, ["path", "sha256"], "startRun.consumedHistory entry");
    if (!text(entry.path, 1000) || !path.isAbsolute(entry.path) || typeof entry.sha256 !== "string" || !sha256.test(entry.sha256)) fail("Each consumedHistory entry needs an absolute path and a 64-hex sha256.");
  }
  if (!distinct(p.consumedHistory.map((entry) => entry.path))) fail("startRun.consumedHistory paths must be distinct.");
  return p;
}

/**
 * The exact thin launcher: three lines, no logic. The executor receives the mode and this card's own
 * descriptor, which carries every pin.
 */
export function startRunLauncher(id: string): string {
  if (!slug.test(id)) throw new StartRunPinsError("Operator action id must be a lowercase slug.");
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `exec "$(cd "$(dirname "\${BASH_SOURCE[0]}")/../../.." && pwd -P)/${START_RUN_EXECUTOR_PATH}" "\${1:-run}" "$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd -P)/${id}.json"`,
    ""
  ].join("\n");
}
