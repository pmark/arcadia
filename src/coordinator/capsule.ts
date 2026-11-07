import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { ensureCoordinatorDirectories, type CoordinatorPaths } from "./paths.js";
import { JOURNAL_STALE_MS, type CoordinatorState } from "./state.js";

/**
 * The coordinator state capsule (docs/agent-guidance/coordinator-handoff-design.md,
 * section b). A derived projection: it grants no authority, every relay-owned
 * field points at its canonical source, and it carries no transcript, private
 * reasoning or credential. `gh` and ping fields carry ids, never tokens.
 */
export const CAPSULE_SCHEMA = "arcadia-coordinator-capsule-v1";
export const ADVISORY_HEADING = "advisory: model-written, not authority";

export interface CapsulePlan { activePlan: string | null; currentAction: string | null; mainSha: string | null }
export interface CapsuleProduction {
  status: string;
  revision: number | null;
  epoch: number | null;
  openEscalations: Array<{ actionKey: string; kind: string }>;
  redAlerts: Array<{ id: string; trigger: string }>;
}
export interface CapsulePr {
  number: number;
  headSha: string | null;
  /** The head named by the newest "Independent review, head <sha>" marker comment, or null. */
  verdictMarkerHead: string | null;
  checks: "pass" | "fail" | "pending" | "none" | "unknown";
  mergeState: string | null;
  /** The durable approval or gate that governs the merge, when one is recorded. */
  gate: string | null;
}
export interface CapsuleSession { id: string; owner: string; status: string; lastProgressAt: string | null }
export interface CapsuleDecisions { open: string[]; recentlyAnswered: string[]; pendingMerge: string[] }
export interface CapsulePings {
  pending: Array<{ id: string; kind: string; createdAt: string }>;
  recent: Array<{ id: string; kind: string; signature: string; createdAt: string }>;
}
export interface CapsuleBudget { occupancy: number | null; window: number | null; source: string; observedAt: string; state?: string }

/** The relay-owned sources, injectable so tests and replays read no host state. */
export interface CapsuleSources {
  plan(): CapsulePlan;
  production(): CapsuleProduction;
  prs(numbers: number[]): CapsulePr[];
  sessions(): CapsuleSession[];
  decisions(): CapsuleDecisions;
  pings(): CapsulePings;
  /** Change 1's measurement, when it has written one; null until then. */
  budget(): CapsuleBudget | null;
}

export interface CapsuleCustodian {
  provider: string;
  model: string;
  tier: string;
  identity: string;
  sessionId: string | null;
  transcriptPath: string | null;
  tmuxName: string | null;
  remoteControlName: string | null;
}

export interface CapsuleAssignment {
  briefPath: string | null;
  briefSha: string | null;
  /** Directives in force, by reference only: checked-in brief, Decisions or AGENTS.md. */
  directives: string[];
}

export interface Capsule {
  schema: typeof CAPSULE_SCHEMA;
  project: string;
  role: string;
  generation: number | null;
  observedAt: string;
  custodian: CapsuleCustodian | null;
  assignment: CapsuleAssignment;
  plan: CapsulePlan;
  production: CapsuleProduction;
  prs: CapsulePr[];
  sessions: CapsuleSession[];
  decisions: CapsuleDecisions;
  pings: CapsulePings;
  subscriptions: CoordinatorState["subscriptions"];
  approvals: { durable: string[]; chat_only: CoordinatorState["chatOnlyApprovals"] };
  journal: CoordinatorState["journal"];
  next_move: (CoordinatorState["nextMove"] & { derived?: false }) | { text: string; at: string; generation: null; derived: true } | null;
  budget: CapsuleBudget | null;
  sources: Record<string, string>;
}

/** Where each relay-owned field comes from; printed in the capsule so the successor can re-read it. */
export const FIELD_SOURCES: Record<string, string> = {
  custodian: "coordinator_generations (workspace database)",
  assignment: "launch brief recorded on the generation row",
  plan: "PROJECT.md active_plan and current_action on the repository checkout; git rev-parse origin/main",
  production: "arcadia production status (workspace database)",
  prs: "gh pr view / issue comments, cached 5 minutes",
  sessions: "agent_sessions prepared/running rows (workspace database)",
  decisions: "docs/decisions/*.md status on the repository checkout",
  pings: "operator_pings (workspace database)",
  budget: "arcadia coordinator budget (change 1), when present",
  durable_approvals: "answered Decisions on main",
  journal: "arcadia coordinator note (advisory)",
  next_move: "arcadia coordinator note --next-move (advisory); else derived from open escalations",
  subscriptions: "arcadia coordinator subscribe"
};

export function buildCapsule(input: {
  project: string;
  role: string;
  generation: number | null;
  custodian: CapsuleCustodian | null;
  assignment: CapsuleAssignment;
  state: CoordinatorState;
  sources: CapsuleSources;
  now: Date;
}): Capsule {
  const { sources, state } = input;
  const production = sources.production();
  const decisions = sources.decisions();
  const derivedNext = production.openEscalations[0]
    ? { text: `arcadia production status --json (open escalation ${production.openEscalations[0].kind} on ${production.openEscalations[0].actionKey})`, at: input.now.toISOString(), generation: null, derived: true as const }
    : null;
  return {
    schema: CAPSULE_SCHEMA,
    project: input.project,
    role: input.role,
    generation: input.generation,
    observedAt: input.now.toISOString(),
    custodian: input.custodian,
    assignment: input.assignment,
    plan: sources.plan(),
    production,
    prs: sources.prs(state.prs),
    sessions: sources.sessions(),
    decisions,
    pings: sources.pings(),
    subscriptions: state.subscriptions,
    approvals: { durable: decisions.recentlyAnswered.map((id) => `decision:${id}`), chat_only: state.chatOnlyApprovals },
    journal: state.journal,
    next_move: state.nextMove ?? derivedNext,
    budget: sources.budget(),
    sources: FIELD_SOURCES
  };
}

function serialize(capsule: Capsule): string {
  return `${JSON.stringify(capsule, null, 2)}\n`;
}

export function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The live projection is rewritten on each refresh (temporary file, then rename). */
export function writeLiveCapsule(paths: CoordinatorPaths, capsule: Capsule): void {
  ensureCoordinatorDirectories(paths);
  const temporary = `${paths.live}.${process.pid}.tmp`;
  writeFileSync(temporary, serialize(capsule), { mode: 0o600 });
  renameSync(temporary, paths.live);
}

export function snapshotPath(paths: CoordinatorPaths, generation: number): string {
  return path.join(paths.snapshots, `${generation}.json`);
}

/**
 * Writes one generation's immutable snapshot: to a temporary file, synced, then
 * linked into place, which fails rather than replaces when the path exists. A
 * snapshot is written once and never changed afterwards; its sha is what the
 * launch prompt pins.
 */
export function writeImmutableSnapshot(paths: CoordinatorPaths, generation: number, capsule: Capsule): { path: string; sha: string } {
  ensureCoordinatorDirectories(paths);
  const target = snapshotPath(paths, generation);
  const bytes = serialize(capsule);
  const temporary = `${target}.${process.pid}.tmp`;
  // A crash can leave a read-only temporary from an earlier process with the same pid.
  try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const fd = openSync(temporary, "wx", 0o400);
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw validationError(`Snapshot ${target} already exists; a snapshot is never overwritten. Nothing was claimed.`, { reason: "snapshot_exists" });
    }
    throw error;
  } finally {
    unlinkSync(temporary);
  }
  return { path: target, sha: sha256(bytes) };
}

/** The snapshot's bytes hashed now, or null when it is missing or unreadable. */
export function hashSnapshotFile(file: string | null): string | null {
  if (!file || !existsSync(file)) return null;
  try {
    return sha256(readFileSync(file));
  } catch {
    return null;
  }
}

export interface CapsuleCheck { passed: boolean; problems: string[] }

/** `capsule --check`: the handoff skill's "Preserve the handoff" step as a deterministic check. */
export function checkCapsule(capsule: Capsule, now: Date): CapsuleCheck {
  const problems: string[] = [];
  const stale = capsule.journal.filter((entry) => now.getTime() - Date.parse(entry.at) > JOURNAL_STALE_MS);
  if (stale.length > 0) problems.push(`${stale.length} journal entr${stale.length === 1 ? "y is" : "ies are"} stale (older than 2 hours); bring the journal up to date with arcadia coordinator note.`);
  if (!capsule.next_move) problems.push("No next_move: record one exact command with arcadia coordinator note --next-move \"<command>\".");
  if (capsule.approvals.chat_only.length > 0) problems.push(`${capsule.approvals.chat_only.length} chat-only approval(s) will not carry across a handoff; exercise each or prepare its durable card.`);
  return { passed: problems.length === 0, problems };
}

/** Relay-owned fields compared between the snapshot and now (verify item 2). Differences are information, not failure. */
export function capsuleDrift(snapshot: Capsule, now: Capsule): Array<{ field: string; snapshot: unknown; now: unknown }> {
  const drift: Array<{ field: string; snapshot: unknown; now: unknown }> = [];
  const compare = (field: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) drift.push({ field, snapshot: left, now: right });
  };
  compare("plan.activePlan", snapshot.plan.activePlan, now.plan.activePlan);
  compare("plan.currentAction", snapshot.plan.currentAction, now.plan.currentAction);
  compare("plan.mainSha", snapshot.plan.mainSha, now.plan.mainSha);
  compare("production.status", snapshot.production.status, now.production.status);
  compare("production.revision", snapshot.production.revision, now.production.revision);
  compare("production.epoch", snapshot.production.epoch, now.production.epoch);
  compare("production.openEscalations", snapshot.production.openEscalations, now.production.openEscalations);
  compare("production.redAlerts", snapshot.production.redAlerts, now.production.redAlerts);
  const heads = (capsule: Capsule) => Object.fromEntries(capsule.prs.map((pr) => [pr.number, pr.headSha]));
  compare("prs.heads", heads(snapshot), heads(now));
  compare("decisions", snapshot.decisions, now.decisions);
  compare("pings.pending", snapshot.pings.pending.map((ping) => ping.id), now.pings.pending.map((ping) => ping.id));
  compare("sessions", snapshot.sessions.map((session) => session.id), now.sessions.map((session) => session.id));
  return drift;
}

function age(at: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60_000));
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

/** `capsule --markdown`: the arcadia-handoff template and release-manager checkpoint, rendered. */
export function renderCapsuleMarkdown(capsule: Capsule, now: Date): string {
  const lines: string[] = [];
  lines.push(`# ${capsule.role} capsule, ${capsule.project}, generation ${capsule.generation ?? "none"}`);
  lines.push("", `Schema ${capsule.schema}, observed ${capsule.observedAt}. A derived projection: it grants no authority.`);
  const custodian = capsule.custodian;
  lines.push("", "## Custodian", custodian
    ? `${custodian.provider} ${custodian.model} (${custodian.tier}) as ${custodian.identity}; session ${custodian.sessionId ?? "unknown"}; tmux ${custodian.tmuxName ?? "none"}; Remote Control ${custodian.remoteControlName ?? "none"}`
    : "No custodian generation is recorded.");
  lines.push("", "## Plan", `active_plan ${capsule.plan.activePlan ?? "unknown"}; current_action ${capsule.plan.currentAction ?? "unknown"}; main ${capsule.plan.mainSha ?? "unknown"}`);
  lines.push("", "## Production", `${capsule.production.status} (revision ${capsule.production.revision ?? "?"}, epoch ${capsule.production.epoch ?? "?"}); ${capsule.production.openEscalations.length} open escalation(s); ${capsule.production.redAlerts.length} red alert(s)`);
  lines.push("", "## Pull requests");
  if (capsule.prs.length === 0) lines.push("None tracked.");
  for (const pr of capsule.prs) lines.push(`- #${pr.number} head ${pr.headSha ?? "?"}; verdict marker ${pr.verdictMarkerHead ?? "none"}; checks ${pr.checks}; merge ${pr.mergeState ?? "?"}; gate ${pr.gate ?? "none recorded"}`);
  lines.push("", "## Decisions", `open ${capsule.decisions.open.join(", ") || "none"}; recently answered ${capsule.decisions.recentlyAnswered.join(", ") || "none"}`);
  lines.push("", "## Approvals", `durable: ${capsule.approvals.durable.join(", ") || "none"}`);
  for (const approval of capsule.approvals.chat_only) lines.push(`- chat only, will not carry: ${approval.text} (${age(approval.at, now)} ago)`);
  lines.push("", "## Subscriptions");
  if (capsule.subscriptions.length === 0) lines.push("None.");
  for (const subscription of capsule.subscriptions) lines.push(`- \`${subscription.command}\` cursor ${subscription.cursor} (armed by generation ${subscription.armedByGeneration ?? "none"})`);
  lines.push("", `## Journal and next move (${ADVISORY_HEADING})`);
  for (const entry of capsule.journal) lines.push(`- ${age(entry.at, now)} ago${now.getTime() - Date.parse(entry.at) > JOURNAL_STALE_MS ? " (stale)" : ""}: ${entry.text}`);
  lines.push(`Next move: ${capsule.next_move ? capsule.next_move.text : "none recorded"}`);
  lines.push("", "## Budget", capsule.budget ? `${capsule.budget.state ?? ""} occupancy ${capsule.budget.occupancy ?? "unmeasured"} of ${capsule.budget.window ?? "?"} (${capsule.budget.source})`.trim() : "Not measured (change 1 not present).");
  return `${lines.join("\n")}\n`;
}

export function readCapsuleFile(file: string): Capsule {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Capsule;
  if (parsed.schema !== CAPSULE_SCHEMA) throw validationError(`${file} is not an arcadia-coordinator-capsule-v1 capsule.`, { reason: "capsule_schema" });
  return parsed;
}
