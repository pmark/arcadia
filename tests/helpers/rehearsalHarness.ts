import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../../src/codingAgents/capacity.js";
import { runAgentAskDraftCommand, runAgentAskSettleCommand } from "../../src/commands/agentAsk.js";
import { runDocsSyncCommand } from "../../src/commands/docs.js";
import {
  runProductionActivateCommand,
  runProductionDeactivateCommand,
  runProductionPreviewCommand,
  runProductionStatusCommand
} from "../../src/commands/production.js";
import { runPreserveCommand } from "../../src/commands/preserve.js";
import { runProjectImportCommand, runProjectMetadataCommand } from "../../src/commands/project.js";
import { runReviewApproveCommand } from "../../src/commands/review.js";
import { runWorkListCommand, runWorkPlanCommand } from "../../src/commands/work.js";
import { withDatabase, withReadOnlyDatabase } from "../../src/db/connection.js";
import { loadPhase3Registries } from "../../src/intent/registries.js";
import { runManagedProductionTick, type ManagedProductionTickProjectResult } from "../../src/production/tick.js";
import { getRepositoryLease, type AgentSession, type TmuxAdapter } from "../../src/sessions/index.js";
import { materializeCandidateTree, snapshotCandidate } from "../../src/sessions/candidateSnapshot.js";
import { bindCheckDefinitions } from "../../src/sessions/preservationCheckBinding.js";
import { processPreservationRequests } from "../../src/sessions/preservationTransport.js";
import { preservationAuthority, validatePreservationCandidate } from "../../src/sessions/preservationValidation.js";
import { validationError } from "../../src/cli/errors.js";
import { spawnSync } from "node:child_process";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";

/**
 * A hermetic replica of the operator's two-Action rehearsal
 * (`prepare-two-action-rehearsal-2026-09-26.sh` + its generated
 * `next-steps.md`, runbook `docs/reports/prove-two-action-unattended-production-runbook.md`).
 *
 * Every preparation step calls the exact command function the operator's
 * `pnpm arcadia ...` line calls — `project import`, `project metadata`,
 * `docs sync --apply`, `work plan --agent-profile`, `review approve
 * --no-execute`, `production preview`/`activate`/`deactivate` — against a
 * real workspace database and a real Git fixture repository. The worker tick
 * is the real `runManagedProductionTick`, with the workspace's own registries,
 * exactly as `arcadia worker` calls it.
 *
 * Three things are simulated, and only these three:
 *
 * - **tmux.** `FakeTmux` records each launch instead of spawning a pane;
 *   `exit()` is the pane dying.
 * - **The coding agent.** `agent*` helpers do in the candidate worktree what
 *   the Action brief's completion protocol tells a real agent to do (edit,
 *   commit, draft and settle a `complete` Agent Ask), through the same
 *   `agent-ask draft`/`settle` command functions the agent's shell would run.
 * - **Provider capacity and sign-in**, which need a real provider account.
 *
 * Nothing else is stubbed: preservation runs the real Seatbelt validator,
 * reconciliation and integration run real Git, and settlement writes real
 * managed documents. A green run here is therefore evidence about the
 * controller, and a red one is a rehearsal failure found without spending a
 * provider token.
 */

/**
 * Real Seatbelt preservation validation needs macOS and an unsandboxed shell
 * (`sandbox-exec` will not nest). Set `ARCADIA_PRESERVATION_HOST_TEST=1` -- the
 * same switch `manual-preservation.test.ts` uses -- to run it. Otherwise the
 * harness validates with {@link unsandboxedValidator}: the identical authority
 * binding and check-definition binding, and the identical declared commands
 * run against the identical materialized candidate tree, only without the
 * Seatbelt profile around them.
 */
export const HOST_SEATBELT = process.env.ARCADIA_PRESERVATION_HOST_TEST === "1";

export function unsandboxedValidator(db: Parameters<typeof validatePreservationCandidate>[0], workspace: string, lease: AgentSession): ReturnType<typeof validatePreservationCandidate> {
  const binding = preservationAuthority(db, workspace, lease);
  const tree = snapshotCandidate(lease.worktree_path);
  const checkDefinition = bindCheckDefinitions(lease.repository_path, lease.base_revision, tree, binding.commands);
  const evidenceDirectory = path.join(workspace, "artifacts", "preservation", lease.id);
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidenceRef = path.join(evidenceDirectory, `unsandboxed-${Date.now()}.json`);
  const source = mkdtempSync(path.join(tmpdir(), "arcadia-rehearsal-check-"));
  try {
    materializeCandidateTree(lease.worktree_path, tree, source);
    const results = binding.commands.map((command) => {
      const run = spawnSync("/bin/sh", ["-c", command], { cwd: source, encoding: "utf8", timeout: 120_000 });
      return { command, exitStatus: run.status, stderr: run.stderr };
    });
    writeFileSync(evidenceRef, JSON.stringify({ producer: "rehearsal-harness-unsandboxed", tree, checkDefinition, results }, null, 2));
    const checks = results.filter((r) => r.exitStatus !== 0).map((r) => ({ command: r.command, status: "failed" as const, exitStatus: r.exitStatus }));
    if (checks.length) throw validationError("Declared preservation validation failed or was skipped.", { evidenceRef, checks });
    return { passed: true, evidenceRef, candidateFingerprint: tree, checkDefinition, binding };
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
}

export const PROVIDER = "claude-code-cli";
export const AGENT_PROFILE = "claude_build";
export const LINE_A = "two-action rehearsal action A";
export const LINE_B = "two-action rehearsal action B";

export class FakeTmux implements TmuxAdapter {
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() {
    return true;
  }
  hasSession(name: string) {
    return this.live.has(name);
  }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    this.launches.push(input);
    this.live.add(input.name);
  }
  capturePane(name: string) {
    return this.live.has(name) ? `working ${name}` : null;
  }
  exit(name: string) {
    this.live.delete(name);
  }
}

export interface RehearsalOptions {
  /**
   * The Project's declared validation command. The default is a
   * self-contained check committed at the fixture's genesis, so it exists at
   * every Session's base revision and no candidate can rewrite it.
   */
  validationCommand?: string;
  /** Omit the integration grant (Decision 0058) from the activation. */
  withoutIntegrationGrant?: boolean;
  /** Omit the packet_approval delegation (Decision 0072) from the activation. */
  withoutPacketApproval?: boolean;
  /** Give the fixture a bare `origin` remote, as a pushed fixture would have. */
  withOrigin?: boolean;
  /** The coding-agent provider and its build profile; defaults to Claude Code. */
  provider?: { id: string; profile: string };
}

export const DEFAULT_VALIDATION_COMMAND = "node scripts/check-marker.mjs";

/** The genesis check: MARKER.md, when present, must be a prefix of the two expected lines. */
const CHECK_MARKER_SCRIPT = `import { existsSync, readFileSync } from "node:fs";
const expected = [${JSON.stringify(LINE_A)}, ${JSON.stringify(LINE_B)}];
if (!existsSync("MARKER.md")) process.exit(0);
const lines = readFileSync("MARKER.md", "utf8").split("\\n");
if (lines.at(-1) !== "") { console.error("MARKER.md must end with a newline"); process.exit(1); }
lines.pop();
if (lines.length > expected.length || lines.some((line, index) => line !== expected[index])) {
  console.error("MARKER.md is not a prefix of the expected lines: " + JSON.stringify(lines));
  process.exit(1);
}
`;

export class Rehearsal {
  readonly root: string;
  readonly workspace: string;
  readonly repo: string;
  readonly worktrees: string;
  readonly projectSlug = "two-action-rehearsal-v4";
  readonly planSlug = "two-action-rehearsal-v4-bootstrap";
  readonly tmux = new FakeTmux();
  readonly log: string[] = [];
  readonly validationCommand: string;
  readonly provider: string;
  readonly profile: string;
  projectId = "";
  now = new Date("2026-09-26T21:00:00.000Z");
  private tickCount = 0;

  constructor(readonly options: RehearsalOptions = {}) {
    this.root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-rehearsal-")));
    this.workspace = path.join(this.root, "workspace");
    this.repo = path.join(this.root, "fixture");
    this.worktrees = path.join(this.root, "worktrees");
    this.validationCommand = options.validationCommand ?? DEFAULT_VALIDATION_COMMAND;
    this.provider = options.provider?.id ?? PROVIDER;
    this.profile = options.provider?.profile ?? AGENT_PROFILE;
    initWorkspace(this.workspace);
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  get actionA() {
    return `${this.projectSlug}/write-marker-a`;
  }

  get actionB() {
    return `${this.projectSlug}/write-marker-b`;
  }

  /** Runbook Step 1: the fixture repository, byte-for-byte the prepare script's shape. */
  createFixtureRepository(): void {
    mkdirSync(path.join(this.repo, "docs", "plans"), { recursive: true });
    mkdirSync(path.join(this.repo, "scripts"), { recursive: true });
    writeFileSync(path.join(this.repo, "AGENTS.md"), "# AGENTS\n\nDisposable rehearsal fixture.\n");
    writeFileSync(path.join(this.repo, "CONSTITUTION.md"), "# Constitution\n\n- Do not merge, deploy, or publish from a Session.\n");
    writeFileSync(path.join(this.repo, "scripts", "check-marker.mjs"), CHECK_MARKER_SCRIPT);
    writeFileSync(path.join(this.repo, "PROJECT.md"), `---
arcadia: v1
type: project
slug: ${this.projectSlug}
name: Two Action Rehearsal V4
status: active
goal: Disposable fixture proving two dependent Actions run unattended from one production activation.
outcome: Disposable fixture for prove-two-action-unattended-production; delete after the rehearsal settles.
milestone: Plan the first usable build
active_plan: ${this.planSlug}
current_action: write-marker-a
updated: 2026-09-26
---

# Two Action Rehearsal V4

Disposable fixture.
`);
    writeFileSync(path.join(this.repo, "docs", "plans", "two-action-rehearsal-bootstrap.md"), `---
arcadia: v1
type: plan
slug: ${this.planSlug}
project: ${this.projectSlug}
status: active
milestone: Plan the first usable build
token_impact: small
token_budget: Two trivial file-edit Actions; no model calls beyond the coding-agent sessions themselves.
updated: 2026-09-26
actions:
  - id: write-marker-a
    title: Implement MARKER.md containing exactly the line "${LINE_A}" plus a trailing newline.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement MARKER.md containing exactly the line "${LINE_A}" plus a trailing newline.
    expected_artifact: MARKER.md with action A's line
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.
    depends_on: []
    decisions: []
  - id: write-marker-b
    title: Implement appending the line "${LINE_B}" to MARKER.md, and add tests/marker.test.mjs asserting node --test sees both lines in order.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement appending the line "${LINE_B}" to MARKER.md, and add tests/marker.test.mjs asserting node --test sees both lines in order.
    expected_artifact: MARKER.md with both lines, plus a passing tests/marker.test.mjs
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md contains both lines, action A's line before action B's line.
      - tests/marker.test.mjs exists and "node --test" passes, asserting both lines appear in order.
    depends_on: [write-marker-a]
    decisions: []
questions: []
decisions: []
recommended_model: claude-sonnet-5
recommended_reasoning_effort: medium
current_action: write-marker-a
---

# Two Action Rehearsal V4 bootstrap

Disposable fixture plan.
`);
    git(this.repo, ["init", "-q", "-b", "main"]);
    git(this.repo, ["add", "-A"]);
    commit(this.repo, "Bootstrap two-action-rehearsal-v4 fixture");
    if (this.options.withOrigin) {
      const origin = path.join(this.root, "origin.git");
      git(this.root, ["init", "-q", "--bare", "-b", "main", origin]);
      git(this.repo, ["remote", "add", "origin", origin]);
      git(this.repo, ["push", "-q", "-u", "origin", "main"]);
    }
  }

  /** Runbook Step 1 (continued): import, point at the repo, sync, seed A's packet. Returns A's approval id. */
  registerProject(): string {
    const imported = runProjectImportCommand({
      workspace: this.workspace,
      name: "Two Action Rehearsal V4",
      mission: "Disposable fixture for prove-two-action-unattended-production.",
      status: "active",
      milestone: "Plan the first usable build",
      nextAction: "placeholder -- superseded by docs sync",
      classification: "agent"
    });
    this.projectId = imported.data.project.id;
    runProjectMetadataCommand({
      workspace: this.workspace,
      projectId: this.projectId,
      repoPath: this.repo,
      validationCommands: [this.validationCommand]
    });
    const sync = runDocsSyncCommand({ workspace: this.workspace, project: this.projectSlug, apply: true });
    const errors = (sync.data as unknown as { errorCount?: number }).errorCount ?? 0;
    if (errors !== 0) throw new Error(`docs sync reported ${errors} error(s): ${JSON.stringify(sync.data)}`);
    const workItem = this.workItemFor("write-marker-a");
    const plan = runWorkPlanCommand({ workspace: this.workspace, workId: workItem, agentProfile: this.profile });
    const approval = (plan.data as unknown as { buildApproval?: { id: string } | null }).buildApproval;
    if (!approval?.id) throw new Error(`work plan returned no buildApproval: ${JSON.stringify(plan.data)}`);
    return approval.id;
  }

  workItemFor(actionId: string): string {
    const list = runWorkListCommand({ workspace: this.workspace });
    const items = (list.data as unknown as { workItems: Array<{ id: string; doc_ref: string | null }> }).workItems;
    const match = items.find((item) => item.doc_ref === `plan/${this.planSlug}#${actionId}`);
    if (!match) throw new Error(`No work item for ${actionId}`);
    return match.id;
  }

  /** Runbook Step 1b. */
  approve(reviewId: string): void {
    runReviewApproveCommand({ workspace: this.workspace, id: reviewId, execute: false });
  }

  /** Runbook Step 2: preview, then activate against the previewed revision. */
  activate(requestId = "prove-two-action-unattended-production-20260926T210000Z") {
    const grantExpiresAt = new Date(this.now.getTime() + 12 * 3_600_000).toISOString();
    const transitions = this.options.withoutPacketApproval
      ? "validation,acceptance,pointer"
      : "validation,acceptance,pointer,packet_approval";
    const base = {
      workspace: this.workspace,
      project: [this.projectSlug],
      plan: [`${this.projectSlug}/${this.planSlug}`],
      provider: [this.provider],
      concurrency: "1",
      transitions,
      intent: "Prove two-Action unattended production with a deliberate split-session continuation.",
      ...(this.options.withoutIntegrationGrant
        ? {}
        : { integrationGrantDecision: "0058", integrationGrantExpiresAt: grantExpiresAt }),
      ...(this.options.withoutPacketApproval ? {} : { packetApprovalExpiresAt: grantExpiresAt })
    };
    const preview = runProductionPreviewCommand(base);
    const activated = runProductionActivateCommand({
      ...base,
      requestId,
      grantedBy: "rehearsal-harness",
      expectRevision: String(preview.data.preview.expectedRevision)
    });
    return { preview: preview.data.preview, result: activated.data.result, warnings: activated.warnings };
  }

  /** Runbook Step 6. */
  deactivate(requestId = "turn-off-prove-two-action-20260926T230000Z") {
    return runProductionDeactivateCommand({ workspace: this.workspace, requestId, reason: "Mid-work Off exercise." }).data.result;
  }

  status() {
    return runProductionStatusCommand({ workspace: this.workspace }).data;
  }

  /** One worker tick, one simulated minute later, exactly as `arcadia worker` calls it. */
  tick(): ManagedProductionTickProjectResult {
    this.tickCount += 1;
    this.now = new Date(this.now.getTime() + 60_000);
    const registries = loadPhase3Registries(this.workspace);
    // `arcadia worker` services agent preservation requests immediately before each tick.
    withDatabase(this.workspace, (db) => processPreservationRequests(db, this.workspace));
    const result = withDatabase(this.workspace, (db) =>
      runManagedProductionTick(db, this.workspace, {
        profiles: registries.codingAgents.profiles,
        adapters: registries.providerAdapters,
        tmux: this.tmux,
        now: this.now,
        capacityObservation: capacity(this.provider),
        providerSignIn: () => ({ signedIn: true, remedy: "" }),
        agentWorktreeRoot: this.worktrees,
        log: (message) => this.log.push(`[tick ${this.tickCount}] ${message}`),
        ...(HOST_SEATBELT ? {} : { handoff: { preserve: { validate: unsandboxedValidator } } })
      })
    );
    const project = result.projects.find((entry) => entry.projectSlug === this.projectSlug);
    if (!project) throw new Error("The fixture Project was not visited by the tick.");
    return project;
  }

  /** Tick until `done` holds or `limit` ticks pass; returns every tick's result. */
  tickUntil(done: (result: ManagedProductionTickProjectResult) => boolean, limit = 6): ManagedProductionTickProjectResult[] {
    const results: ManagedProductionTickProjectResult[] = [];
    for (let i = 0; i < limit; i += 1) {
      const result = this.tick();
      results.push(result);
      if (done(result)) return results;
    }
    throw new Error(
      `Condition not reached within ${limit} ticks.\nTick results:\n${results.map((r) => JSON.stringify(r.launch) + " reconciled=" + JSON.stringify(r.reconciled) + " handoff=" + JSON.stringify(r.handoff)).join("\n")}\nWorker log:\n${this.log.join("\n")}`
    );
  }

  lease(): AgentSession | null {
    return withReadOnlyDatabase(this.workspace, (db) => getRepositoryLease(db, this.repo));
  }

  sessions(): AgentSession[] {
    return withReadOnlyDatabase(this.workspace, (db) =>
      db.prepare("SELECT * FROM agent_sessions WHERE project_slug = ? ORDER BY created_at, rowid").all(this.projectSlug) as AgentSession[]
    );
  }

  /** Simulated agent: an uncommitted edit in the candidate (Session A1 before it is killed). */
  agentEdit(session: AgentSession, file: string, content: string): void {
    mkdirSync(path.dirname(path.join(session.worktree_path, file)), { recursive: true });
    writeFileSync(path.join(session.worktree_path, file), content);
  }

  /**
   * Simulated agent finishing its Action by the brief's completion protocol:
   * commit the work, then draft and settle a `complete` Agent Ask whose
   * `candidate_revision` is the worktree's HEAD, from inside the worktree.
   */
  agentFinish(session: AgentSession, criteria: string[]): void {
    git(session.worktree_path, ["add", "-A"]);
    if (git(session.worktree_path, ["status", "--porcelain"]).trim()) commit(session.worktree_path, `Implement ${session.action_id}`);
    const head = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
    const requestId = `complete-${session.action_id}-${session.id.replaceAll("_", "-")}`;
    const ask = JSON.stringify({
      agent_ask: "v1",
      request_id: requestId,
      project: this.projectSlug,
      intent: "complete",
      target_ref: `action/${session.action_id}`,
      desired_result: `Record ${session.action_id} complete.`,
      candidate_revision: head,
      evidence: criteria.map((criterion) => ({ criterion, status: "met", note: "Verified in the candidate worktree." })),
      requested_authority: "apply_if_approved"
    });
    runAgentAskDraftCommand({ workspace: this.workspace, request: ask, dir: session.worktree_path });
    const preview = runAgentAskSettleCommand({
      workspace: this.workspace, proposal: requestId, requestId, disposition: "accepted", cwd: session.worktree_path
    });
    runAgentAskSettleCommand({
      workspace: this.workspace, proposal: requestId, requestId, disposition: "accepted", cwd: session.worktree_path,
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
  }

  /**
   * Simulated agent step 2 of the completion protocol: `arcadia-preserve-broker-<agent>`
   * asks the host worker to preserve the candidate, and the worker runs
   * `runPreserveCommand` for it. This calls that host command directly
   * (the file transport around it is covered by the transport tests).
   */
  agentPreserve(session: AgentSession) {
    git(session.worktree_path, ["add", "-A"]);
    if (git(session.worktree_path, ["status", "--porcelain"]).trim()) commit(session.worktree_path, `Implement ${session.action_id}`);
    return runPreserveCommand({ source: session.worktree_path, workspace: this.workspace, now: this.now }).data;
  }

  planAction(root: string, actionId: string): string {
    const plan = git(root, ["show", "HEAD:docs/plans/two-action-rehearsal-bootstrap.md"]);
    const block = plan.split("  - id: ").find((entry) => entry.startsWith(`${actionId}\n`)) ?? "";
    return /\n\s+status: (\S+)/.exec(block)?.[1] ?? "missing";
  }

  pointer(root = this.repo): string {
    return /^current_action: (\S+)$/m.exec(git(root, ["show", "HEAD:PROJECT.md"]))?.[1] ?? "missing";
  }
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commit(cwd: string, message: string): void {
  git(cwd, ["-c", "user.name=Rehearsal Agent", "-c", "user.email=agent@rehearsal.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message]);
}

function capacity(provider: string): ProviderCapacityObservation {
  const decision: CapacityAdmissionDecision = {
    providerId: provider,
    admitted: true,
    code: null,
    reason: `${provider} fixture allowance (simulated).`,
    unattendedProof: true,
    retryAfter: null,
    refreshRequired: false,
    receipt: {
      version: 1,
      providerId: provider,
      providerLabel: provider,
      profiles: [],
      accountScope: "rehearsal-harness",
      source: "codex_app_server",
      evidence: "simulated",
      unattended: true,
      observedAt: "2026-09-26T21:00:00.000Z",
      observedAgeMs: 0,
      expiresAt: null,
      confidence: "observed",
      freshness: "fresh",
      usagePolicy: "included",
      usagePolicyReason: "rehearsal harness fixture",
      windows: [],
      nextResetAt: null,
      unsupported: [],
      availability: "available",
      telemetry: "rehearsal harness fixture"
    }
  } as CapacityAdmissionDecision;
  return { generatedAt: "2026-09-26T21:00:00.000Z", providers: [decision] };
}
