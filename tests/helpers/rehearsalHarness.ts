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
import { launchGuardedHostSession } from "../../src/sessions/launch.js";
import { materializeCandidateTree, snapshotCandidate } from "../../src/sessions/candidateSnapshot.js";
import { bindCheckDefinitions } from "../../src/sessions/preservationCheckBinding.js";
import { processPreservationRequests } from "../../src/sessions/preservationTransport.js";
import { preservationAuthority, validatePreservationCandidate } from "../../src/sessions/preservationValidation.js";
import { validationError } from "../../src/cli/errors.js";
import { spawnSync } from "node:child_process";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";
import type { SessionRoleAttempt } from "../../src/sessions/enrollment.js";
import { beginIndependentVerdict, finishIndependentVerdict, independentVerdictGate, independentVerdictReadiness } from "../../src/sessions/roleLineage.js";
import type { SelectedCodingAgentConfiguration } from "../../src/codingAgents/providerAdapters.js";
import type { CandidatePreservationRemote } from "../../src/sessions/candidatePreservation.js";
import type { IndependentReviewDeps } from "../../src/production/independentReview.js";
import {
  CODE_REVIEW_PR_CRITERIA,
  QA_PR_REVIEW_CRITERIA,
  runQaPrReviewCommand,
  type PullRequestCheckRun,
  type QaPrModelVerdict,
  type QaPrReviewDependencies
} from "../../src/qa/prReview.js";

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
 * - **The independent reviewers.** Between ticks, {@link Rehearsal.review}
 *   records an exact-head code review and QA verdict for every terminal
 *   candidate that is deterministically ready, through the same
 *   `beginIndependentVerdict`/`finishIndependentVerdict` seam a real
 *   reviewer process uses, under reviewer identities distinct from the
 *   developer's. `independentReviewers: false` turns them off;
 *   `"host-commands"` instead runs the real host commands
 *   (`arcadia qa code-review`, `arcadia qa pr`) with only GitHub and the
 *   read-only reviewer model stubbed ({@link hostReviewHost}). `"tick"` runs
 *   no reviewer from the harness at all: the activation adds
 *   `--remote-preservation`, preservation pushes to a real bare `origin` and
 *   opens a draft PR on {@link FakeGitHub}, and the worker tick itself readies
 *   the PR, waits for its checks and runs both host review commands, with
 *   only the GitHub CLI and the reviewer model stubbed.
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

export function unsandboxedValidator(db: Parameters<typeof validatePreservationCandidate>[0], workspace: string, lease: AgentSession, terminalRecovery = false, operatorLaunch?: Parameters<typeof preservationAuthority>[4]): ReturnType<typeof validatePreservationCandidate> {
  // `terminalRecovery` is passed through exactly as validatePreservationCandidate
  // does: dropping it made every terminal-recovery retry (a preservation retried
  // after its first attempt failed) refuse "Preservation Session binding is
  // stale" here, a refusal the real validator never gives.
  const binding = preservationAuthority(db, workspace, lease, terminalRecovery, operatorLaunch);
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
/** Only the opt-in three-Action variant (`thirdAction`) has this line. */
export const LINE_C = "three-action rehearsal action C";

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
  /**
   * Append a third Action C (depending on B) to the same Plan. Off by
   * default, so the two-Action fixture stays byte-for-byte the prepare
   * script's shape.
   */
  thirdAction?: boolean;
  /**
   * Replace the fixture Plan's Actions with a custom list (the fast harness's
   * long chain): `actionsYaml` is the Plan's `actions:` entries, `firstAction`
   * the pointer's first Action, and `genesisFiles` extra files committed at
   * the fixture's genesis (a check script the declared validation runs).
   * Overrides `thirdAction`. Off by default.
   */
  fixturePlan?: { firstAction: string; actionsYaml: string; genesisFiles: Record<string, string> };
  /** Simulated out-of-band reviewers before each tick (default on), the real host commands, or the tick's own review step; see the class comment. */
  independentReviewers?: boolean | "host-commands" | "tick";
  /** `"tick"` mode only: overrides for the tick's review deadlines and budget. */
  review?: Pick<IndependentReviewDeps, "pollIntervalMs" | "checksDeadlineMs" | "maxFailures" | "rateLimitBackoffMs" | "rateLimitEscalateAfterMs">;
}

export const DEFAULT_VALIDATION_COMMAND = "node scripts/check-marker.mjs";

/** The genesis check: MARKER.md, when present, must be a prefix of the expected lines. */
const checkMarkerScript = (lines: string[]) => `import { existsSync, readFileSync } from "node:fs";
const expected = [${lines.map((line) => JSON.stringify(line)).join(", ")}];
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
  /** Test-only fault injection: a signed-out provider makes admission refuse on every tick. */
  providerSignedIn = true;
  /**
   * Test-only, one-shot: runs at the launch's sign-in preflight -- after the
   * tick re-read the policy and the launch preview, before issueAdmission.
   */
  beforeAdmission: (() => void) | null = null;
  now = new Date("2026-09-26T21:00:00.000Z");
  private tickCount = 0;
  /** `"tick"` mode: the stubbed GitHub (PRs, checks, readiness) and reviewer model. */
  readonly github: FakeGitHub;
  /** How many progress heartbeats the tick reported. */
  heartbeats = 0;

  constructor(readonly options: RehearsalOptions = {}) {
    this.root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-rehearsal-")));
    this.workspace = path.join(this.root, "workspace");
    this.repo = path.join(this.root, "fixture");
    this.worktrees = path.join(this.root, "worktrees");
    this.validationCommand = options.validationCommand ?? DEFAULT_VALIDATION_COMMAND;
    this.provider = options.provider?.id ?? PROVIDER;
    this.profile = options.provider?.profile ?? AGENT_PROFILE;
    this.github = new FakeGitHub(path.join(this.root, "origin.git"));
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

  get actionC() {
    return `${this.projectSlug}/write-marker-c`;
  }

  /** Runbook Step 1: the fixture repository, byte-for-byte the prepare script's shape. */
  createFixtureRepository(): void {
    mkdirSync(path.join(this.repo, "docs", "plans"), { recursive: true });
    mkdirSync(path.join(this.repo, "scripts"), { recursive: true });
    writeFileSync(path.join(this.repo, "AGENTS.md"), "# AGENTS\n\nDisposable rehearsal fixture.\n");
    writeFileSync(path.join(this.repo, "CONSTITUTION.md"), "# Constitution\n\n- Do not merge, deploy, or publish from a Session.\n");
    writeFileSync(path.join(this.repo, "scripts", "check-marker.mjs"),
      checkMarkerScript(this.options.thirdAction ? [LINE_A, LINE_B, LINE_C] : [LINE_A, LINE_B]));
    const custom = this.options.fixturePlan;
    for (const [file, content] of Object.entries(custom?.genesisFiles ?? {})) {
      mkdirSync(path.dirname(path.join(this.repo, file)), { recursive: true });
      writeFileSync(path.join(this.repo, file), content);
    }
    const firstAction = custom?.firstAction ?? "write-marker-a";
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
current_action: ${firstAction}
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
${custom ? custom.actionsYaml : `  - id: write-marker-a
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
${this.options.thirdAction ? `  - id: write-marker-c
    title: Implement appending the line "${LINE_C}" to MARKER.md after action B's line.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement appending the line "${LINE_C}" to MARKER.md after action B's line.
    expected_artifact: MARKER.md with all three lines
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md contains the A, B and C lines in that order.
    depends_on: [write-marker-b]
    decisions: []
` : ""}`}questions: []
decisions: []
recommended_model: claude-sonnet-5
recommended_reasoning_effort: medium
current_action: ${firstAction}
---

# Two Action Rehearsal V4 bootstrap

Disposable fixture plan.
`);
    git(this.repo, ["init", "-q", "-b", "main"]);
    // A real Session commits under the agent identity its launch injects
    // (GIT_AUTHOR_*/GIT_COMMITTER_*); settlement run from the simulated agent
    // needs one too, including on a CI runner with no global Git identity.
    git(this.repo, ["config", "user.name", "Rehearsal Agent"]);
    git(this.repo, ["config", "user.email", "agent@rehearsal.test"]);
    git(this.repo, ["add", "-A"]);
    commit(this.repo, "Bootstrap two-action-rehearsal-v4 fixture");
    if (this.options.withOrigin || this.options.independentReviewers === "tick") {
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
    const workItem = this.workItemFor(this.options.fixturePlan?.firstAction ?? "write-marker-a");
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
      ...(this.options.independentReviewers === "tick" ? { remotePreservation: true } : {}),
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
      expectedRevision: String(preview.data.preview.expectedRevision)
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
    const tickReviews = this.options.independentReviewers === "tick";
    if (this.options.independentReviewers !== false && !tickReviews) this.review();
    const preserve = {
      ...(HOST_SEATBELT ? {} : { validate: unsandboxedValidator }),
      ...(tickReviews ? { remote: this.github.remote, fixtureStandingTestRemote: this.github.remote } : {})
    };
    const result = withDatabase(this.workspace, (db) =>
      runManagedProductionTick(db, this.workspace, {
        profiles: registries.codingAgents.profiles,
        adapters: registries.providerAdapters,
        tmux: this.tmux,
        now: this.now,
        clock: () => this.now,
        heartbeat: () => { this.heartbeats += 1; },
        capacityObservation: capacity(this.provider),
        providerSignIn: () => {
          const hook = this.beforeAdmission;
          this.beforeAdmission = null;
          hook?.();
          return { signedIn: this.providerSignedIn, remedy: this.providerSignedIn ? "" : "Sign in to the provider (injected fault)." };
        },
        agentWorktreeRoot: this.worktrees,
        log: (message) => this.log.push(`[tick ${this.tickCount}] ${message}`),
        ...(Object.keys(preserve).length ? { handoff: { preserve } } : {}),
        ...(tickReviews ? { review: { runCommand: this.github.runCommand, selectReviewer: () => hostReviewer(), ...this.options.review } } : {})
      })
    );
    const project = result.projects.find((entry) => entry.projectSlug === this.projectSlug);
    if (!project) throw new Error("The fixture Project was not visited by the tick.");
    return project;
  }

  /**
   * A Session just exited with its completion settled: the exit tick
   * reconciles and preserves it, but integration waits for current
   * independent verdicts; the simulated reviewers judge the exact head before
   * the next tick, which integrates it (and may launch the next Action).
   */
  tickThroughReview(limit = 6): { exited: ManagedProductionTickProjectResult; integrated: ManagedProductionTickProjectResult } {
    const exited = this.tick();
    if (exited.handoff?.integration.kind === "integrated" || this.options.independentReviewers === false) return { exited, integrated: exited };
    if (this.options.independentReviewers !== "tick") return { exited, integrated: this.tick() };
    // The tick readies the PR, then runs one reviewer per tick, then integrates.
    const results = this.tickUntil((r) => r.handoff?.integration.kind === "integrated", limit);
    return { exited, integrated: results.at(-1)! };
  }

  /** The guarded standing-policy launcher called directly, with the same registries, capacity and paths as `tick()`. */
  launchDirect(requestId: string, testHooks?: Parameters<typeof launchGuardedHostSession>[0]["testHooks"]) {
    const registries = loadPhase3Registries(this.workspace);
    return withDatabase(this.workspace, (db) => launchGuardedHostSession({
      db, workspace: this.workspace, repoRoot: this.repo, projectSlug: this.projectSlug, requestId, standingPolicy: true,
      profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters, tmux: this.tmux, now: this.now,
      capacityObservation: capacity(this.provider), agentWorktreeRoot: this.worktrees,
      providerSignIn: () => ({ signedIn: true, remedy: "" }), ...(testHooks ? { testHooks } : {})
    }));
  }

  /**
   * A worker host crash in the middle of a standing-policy launch: the
   * Session is prepared and its admission issued, then the process dies
   * before the admission commits (and so before any development attempt is
   * allocated).
   */
  crashLaunchAfterPrepare(requestId = "worker-tick-crashed-after-prepare"): void {
    try {
      this.launchDirect(requestId, { afterSessionPreparedBeforeCommit: () => { throw new Error("worker host crashed"); } });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "worker host crashed") throw error;
      return;
    }
    throw new Error("The injected crash did not happen.");
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

  /**
   * Simulated independent reviewers: for each tick-reconciled accepted
   * candidate that is deterministically ready and still lacks a current
   * verdict, record code review and QA as `verdict` (passed by default).
   * Returns the request ids recorded.
   */
  review(verdict: "passed" | "failed" = "passed", roles: Array<"code-review" | "qa"> = ["code-review", "qa"]): string[] {
    if (this.options.independentReviewers === "host-commands") return this.reviewThroughHostCommands(verdict, roles);
    const recorded: string[] = [];
    withDatabase(this.workspace, (db) => {
      const sessions = db.prepare(`SELECT s.* FROM agent_sessions s JOIN session_exit_receipts r ON r.session_id = s.id
        WHERE s.project_slug = ? AND r.outcome = 'accepted_completion' ORDER BY s.created_at, s.rowid`).all(this.projectSlug) as AgentSession[];
      for (const session of sessions) {
        const readiness = independentVerdictReadiness(db, { session, repoRoot: this.repo });
        if (!readiness.ready || independentVerdictGate(db, { session, repoRoot: this.repo }).satisfied) continue;
        for (const role of roles) {
          const requestId = `${role}-${session.id}-${readiness.binding.targetHead.slice(0, 12)}`.replaceAll("_", "-");
          const actorId = `${role}-reviewer:rehearsal`;
          const begun = beginIndependentVerdict(db, { role, session, repoRoot: this.repo, requestId, actorId, executionCwd: this.root, now: this.now });
          if (begun.attempt.status === "passed" || begun.attempt.status === "failed") continue;
          finishIndependentVerdict(db, { requestId, actorId, session, repoRoot: this.repo, verdict, receipt: { reviewer: actorId }, now: this.now });
          recorded.push(requestId);
        }
      }
    });
    return recorded;
  }

  /**
   * The real host review path: for each accepted candidate that is ready and
   * still waits on verdicts, run `arcadia qa code-review` and `arcadia qa pr`
   * against its PR (stubbed GitHub, stubbed reviewer model). The commands
   * themselves enforce readiness, exact head, independence and Off.
   */
  reviewThroughHostCommands(verdict: "passed" | "failed", roles: Array<"code-review" | "qa">): string[] {
    const waiting = withDatabase(this.workspace, (db) => {
      const sessions = db.prepare(`SELECT s.* FROM agent_sessions s JOIN session_exit_receipts r ON r.session_id = s.id
        WHERE s.project_slug = ? AND r.outcome = 'accepted_completion' ORDER BY s.created_at, s.rowid`).all(this.projectSlug) as AgentSession[];
      return sessions.flatMap((session) => {
        const readiness = independentVerdictReadiness(db, { session, repoRoot: this.repo });
        return readiness.ready && !independentVerdictGate(db, { session, repoRoot: this.repo }).satisfied
          ? [{ session, head: readiness.binding.targetHead }] : [];
      });
    });
    const recorded: string[] = [];
    for (const { session, head } of waiting) {
      const { dependencies } = hostReviewHost(session, head, { verdict: verdict === "passed" ? "pass" : "fail" });
      for (const role of roles) {
        try {
          const result = runQaPrReviewCommand({ workspace: this.workspace, pullRequest: HOST_REVIEW_PR_URL, role }, dependencies);
          recorded.push(`${role}:${session.action_id}:${result.data.verdict}`);
        } catch (error) {
          // Off fences the reviewer; every other refusal is a rehearsal failure.
          if ((error as { details?: { code?: string } }).details?.code !== "managed_production_off") throw error;
          this.log.push(`[review] ${role} for ${session.action_id} withheld: managed production is Off`);
        }
      }
    }
    return recorded;
  }

  /** Every attempt the role lineage recorded for one Action of this fixture. */
  attempts(actionId: string) {
    return withReadOnlyDatabase(this.workspace, (db) =>
      db.prepare("SELECT * FROM session_role_attempts WHERE requirement_id = ? ORDER BY created_at, rowid")
        .all(`${this.projectSlug}/${this.planSlug}/${actionId}`) as SessionRoleAttempt[]);
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
   * Simulated agent finishing from inside a real provider sandbox (Codex
   * `workspace-write`, Claude Code's sandbox): writes are confined to the
   * worktree, so it cannot commit (a linked worktree's commits write the main
   * repository's Git common directory) and cannot settle (settlement writes
   * the workspace database). What it can do is draft its `complete` Ask as a
   * file and exit. This fixture passes a deliberately missing workspace and
   * expects `not_available`; a real resolved-but-read-only workspace instead
   * reports `preview_blocked`. Everything after that is the host's job.
   */
  agentFinishSandboxed(session: AgentSession, criteria: string[]): string {
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
    const drafted = runAgentAskDraftCommand({
      workspace: path.join(this.root, "unreachable-from-the-sandbox"), request: ask, dir: session.worktree_path
    });
    if (drafted.data.workspaceStatus !== "not_available") throw new Error("The sandboxed draft unexpectedly reached a workspace.");
    return drafted.data.path;
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

/** The simulated provider capacity observation every harness tick passes (exported for tests/fast-rehearsal). */
export function capacity(provider: string): ProviderCapacityObservation {
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

export const HOST_REVIEW_PR_URL = "https://github.com/pmark/rehearsal/pull/7";
export const HOST_REVIEWER_BINDING = "host-reviewer-binding";

/**
 * Stubbed GitHub and read-only reviewer model for the real
 * `arcadia qa code-review` / `arcadia qa pr` executor: the PR is the
 * candidate's branch at `head` (`calls.prHead` may move it), every check is
 * green, and `model.verdict` decides each reviewer invocation's verdict.
 */
export function hostReviewHost(session: AgentSession, head: string, model: { verdict: "pass" | "fail" } = { verdict: "pass" }) {
  const calls = { reviewer: 0, prompts: [] as string[], prHead: head };
  const dependencies: QaPrReviewDependencies = {
    now: () => new Date("2026-10-03T22:00:00.000Z"),
    selectReviewer: () => hostReviewer(),
    runCommand: ({ command, args, stdin }) => {
      if (command === "git") return ok("https://github.com/pmark/rehearsal.git\n");
      if (command === "gh" && args[1] === "view") return ok(`${JSON.stringify(hostPullRequest(session.branch, calls.prHead))}\n`);
      if (command === "gh" && args[0] === "api") return ok(`diff --git a/MARKER.md b/MARKER.md\n+${session.action_id}\n`);
      if (command === "/bin/zsh") return ok("host-home-readable\nhost-repository-readable\nhost-network-reachable\n");
      if (command === "codex" && args[0] === "sandbox") return ok("sandbox-evidence-readable\nsandbox-home-denied\nsandbox-repository-denied\nsandbox-network-denied\n");
      if (command === "codex") {
        calls.reviewer += 1;
        calls.prompts.push(stdin ?? "");
        const criteria = (stdin ?? "").includes("Exact-Head Code Review") ? CODE_REVIEW_PR_CRITERIA : QA_PR_REVIEW_CRITERIA;
        writeFileSync(args[args.indexOf("--output-last-message") + 1], `${JSON.stringify(hostModelVerdict(model.verdict, criteria))}\n`, "utf8");
        return ok('{"type":"task.completed"}\n');
      }
      return { status: 1, stdout: "", stderr: `Unexpected command: ${command} ${args.join(" ")}`, error: null };
    }
  };
  return { calls, dependencies };
}

/** The stubbed read-only reviewer selection (exported for tests/fast-rehearsal). */
export function hostReviewer(): SelectedCodingAgentConfiguration {
  return {
    mappingId: "host-reviewer-mapping",
    bindingId: HOST_REVIEWER_BINDING,
    profile: { name: "host_reviewer", provider: "codex-cli", package: "fake", command: "codex", purpose: "planning", sandbox: "read-only", args: [] },
    provider: "codex-cli",
    model: "gpt-test",
    capability: "c2_integrated",
    effort: "e2_standard",
    args: ["--model", "gpt-test"],
    costRank: 1
  };
}

function hostPullRequest(branch: string, head: string) {
  return {
    number: 7,
    title: `Candidate ${branch}`,
    url: HOST_REVIEW_PR_URL,
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    headRefName: branch,
    headRefOid: head,
    baseRefName: "main",
    baseRefOid: "5e41cf757912474496705060abf5421aeda3236f",
    body: "## QA plan\nRead MARKER.md.",
    files: [{ path: "MARKER.md", additions: 1, deletions: 0, changeType: "MODIFIED" }],
    statusCheckRollup: [{ name: "fast", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/fast", workflowName: "CI" }]
  };
}

/**
 * `not-applicable` simulates a code reviewer that judges correctness and
 * reports every other criterion not-applicable to a marker-only candidate,
 * naming the files the patch touches (the honest answer for such a patch).
 * `variance` simulates run 6's zero-defect non-pass (Issue #1018): needs-follow-up
 * with no finding, every criterion pass except the last, which is not-checked.
 */
export type HostModelVerdict = "pass" | "fail" | "not-applicable" | "variance";

function hostModelVerdict(verdict: HostModelVerdict, criteria: ReadonlyArray<{ id: string; name: string }>, findingTitle = "Defect"): QaPrModelVerdict {
  return {
    verdict: verdict === "fail" ? "fail" : verdict === "variance" ? "needs-follow-up" : "pass",
    summary: verdict === "fail" ? "A defect blocks this head." : verdict === "variance" ? "No defect found, but one criterion is not established." : "No defects in the exact head.",
    findings: verdict === "fail" ? [{ severity: "blocker", title: findingTitle, evidence: "MARKER.md", recommendation: "Fix it." }] : [],
    checks: criteria.map((criterion, index) => ({
      criterion: criterion.id as QaPrModelVerdict["checks"][number]["criterion"],
      name: criterion.name,
      status: verdict === "fail" ? "fail" : verdict === "variance" && index === criteria.length - 1 ? "not-checked"
        : verdict === "not-applicable" && criterion.id !== "correctness" ? "not-applicable" : "pass",
      evidence: verdict === "not-applicable" && criterion.id !== "correctness"
        ? `The patch touches only MARKER.md and Arcadia's governed settlement records, none of which can affect ${criterion.name.toLowerCase()}.`
        : `${criterion.name} judged against the patch.`
    })),
    residualRisks: []
  };
}

function ok(stdout: string) {
  return { status: 0, stdout, stderr: "", error: null };
}

const GREEN_CHECKS: PullRequestCheckRun[] = [{ name: "fast", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/fast", workflowName: "CI" }];

export interface FakePullRequest {
  number: number;
  url: string;
  branch: string;
  /** The PR's base branch: the Project base, or (stacked, Issue #987) another branch such as the previous candidate's. */
  baseBranch: string;
  isDraft: boolean;
  /** GitHub's PR state; a scenario may close or merge a PR (default OPEN). */
  state?: "OPEN" | "CLOSED" | "MERGED";
}

/**
 * The GitHub CLI and the read-only reviewer model, stubbed for `"tick"` mode
 * and nothing else: pushes are real `git push`es to the fixture's bare
 * `origin`, a PR's head is whatever `origin` holds for its branch, and `gh pr
 * ready` flips the draft flag. Checks, the reviewer's verdict and its exit
 * status are test-controlled; one-shot hooks inject Off, an epoch change or
 * a crash at an exact step.
 */
export class FakeGitHub {
  prs: FakePullRequest[] = [];
  readyCalls: string[] = [];
  /** Every `gh` invocation, in order, as `gh <args>`. */
  ghCalls: string[] = [];
  /** Every reviewer-model invocation, with the PR head it judged. */
  reviewerCalls: Array<{ role: "code-review" | "qa"; url: string; head: string }> = [];
  checks: (pr: FakePullRequest) => PullRequestCheckRun[] = () => GREEN_CHECKS;
  /** GitHub's mergeStateStatus; branch protection reports BLOCKED while required checks run. */
  mergeState: (pr: FakePullRequest) => string = () => "CLEAN";
  /** Every push, with the exact commit it named (null: the local tip). */
  pushes: Array<{ branch: string; commitSha: string | null }> = [];
  /** Every `gh pr create`, with the `--base` it named. */
  prCreates: Array<{ branch: string; baseBranch: string }> = [];
  /** Each entry fails one `gh pr view` with that stderr, in order. */
  viewFailures: string[] = [];
  /** Every reviewer-model invocation's process timeout. */
  reviewerTimeouts: Array<number | undefined> = [];
  /** Simulates the reviewer process being killed at its timeout. */
  reviewerTimesOut: (role: "code-review" | "qa") => boolean = () => false;
  verdict: (role: "code-review" | "qa", pr: FakePullRequest | undefined) => HostModelVerdict = () => "pass";
  /** The title of the model's finding on a failed verdict (a model may write any title). */
  findingTitle = "Defect";
  /** A non-zero exit simulates reviewer capacity or sandbox trouble. */
  reviewerExit: (role: "code-review" | "qa") => number = () => 0;
  /** One-shot: runs when `gh pr ready` is called, before it takes effect. */
  beforeReady: (() => void) | null = null;
  /** One-shot: runs after `gh pr ready` took effect (throw to crash mid-step). */
  afterReady: (() => void) | null = null;
  /** One-shot: runs inside the reviewer-model call (throw to crash mid-review). */
  duringReview: ((role: "code-review" | "qa") => void) | null = null;

  constructor(readonly origin: string) {}

  headOf(branch: string): string {
    return git(this.origin, ["rev-parse", `refs/heads/${branch}`]).trim();
  }

  readonly remote: CandidatePreservationRemote = {
    hasRemote: (repositoryPath) => git(repositoryPath, ["remote"]).split("\n").includes("origin"),
    push: ({ repositoryPath, branch, commitSha }) => {
      this.pushes.push({ branch, commitSha: commitSha ?? null });
      git(repositoryPath, ["push", "-q", this.origin, `${commitSha ?? `refs/heads/${branch}`}:refs/heads/${branch}`]);
      return { remote: "origin" };
    },
    // `git ls-remote --heads origin`, as the system adapter runs it.
    listBranchTips: ({ repositoryPath }) => git(repositoryPath, ["ls-remote", "--heads", this.origin]).split("\n").flatMap((line) => {
      const match = /^([0-9a-f]{40})\trefs\/heads\/(.+)$/.exec(line.trim());
      return match ? [{ branch: match[2], sha: match[1] }] : [];
    }),
    // `gh pr view <branch>`: the branch's most recent PR, open or not, with its state.
    findPullRequest: ({ branch }) => {
      const pr = this.prs.filter((entry) => entry.branch === branch).at(-1);
      return pr ? { number: pr.number, url: pr.url, baseRefName: pr.baseBranch, state: pr.state ?? "OPEN" } : null;
    },
    upsertDraftPullRequest: ({ branch, baseBranch, existing }) => {
      if (existing) return existing;
      // `gh pr create --base <branch>`: GitHub refuses a base branch it does not have.
      if (spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${baseBranch}`], { cwd: this.origin }).status !== 0) {
        throw new Error(`pull request create failed: GraphQL: Base ref must be a branch (createPullRequest); no branch ${baseBranch} on the remote`);
      }
      this.prCreates.push({ branch, baseBranch });
      const number = 7 + this.prs.length;
      const pr = { number, url: `https://github.com/pmark/rehearsal/pull/${number}`, branch, baseBranch, isDraft: true };
      this.prs.push(pr);
      return { number, url: pr.url };
    }
  };

  private view(pr: FakePullRequest) {
    return {
      number: pr.number,
      title: `Candidate ${pr.branch}`,
      url: pr.url,
      state: pr.state ?? "OPEN",
      isDraft: pr.isDraft,
      mergeStateStatus: this.mergeState(pr),
      headRefName: pr.branch,
      headRefOid: this.headOf(pr.branch),
      baseRefName: pr.baseBranch,
      baseRefOid: this.headOf(pr.baseBranch),
      body: "## QA plan\nRead MARKER.md.",
      files: [{ path: "MARKER.md", additions: 1, deletions: 0, changeType: "MODIFIED" }],
      statusCheckRollup: this.checks(pr)
    };
  }

  /**
   * GitHub's compare patch (`repos/<repo>/compare/<base>...<head>` with the
   * patch media type) for the exact revisions asked for: the real
   * `git format-patch` series of the fixture's origin, so a reviewer and the
   * deterministic patch check see the candidate's real commits and files.
   */
  private comparePatch(args: string[]): string {
    const range = /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(args.find((arg) => arg.includes("/compare/")) ?? "");
    if (!range) throw new Error(`Unexpected gh api call: ${args.join(" ")}`);
    // Pinned so the host's Git configuration cannot change the patch's headers.
    return git(this.origin, [
      "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "core.quotepath=true", "-c", "diff.renames=true",
      "-c", "diff.relative=false", "-c", "format.signature=", "-c", "format.numbered=auto", "-c", "color.ui=false",
      "format-patch", "--stdout", "--no-signature", "--no-color", "--no-ext-diff", `${range[1]}..${range[2]}`
    ]);
  }

  private find(reference: string): FakePullRequest | undefined {
    return this.prs.find((pr) => pr.url === reference || String(pr.number) === reference);
  }

  readonly runCommand: NonNullable<QaPrReviewDependencies["runCommand"]> = ({ command, args, stdin, timeoutMs }) => {
    if (command === "git") return ok("https://github.com/pmark/rehearsal.git\n");
    if (command === "gh") this.ghCalls.push(`gh ${args.join(" ")}`);
    if (command === "gh" && args[0] === "pr" && args[1] === "view" && this.viewFailures.length > 0) {
      return { status: 1, stdout: "", stderr: this.viewFailures.shift()!, error: null };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      const pr = this.find(args[2]);
      if (!pr) return { status: 1, stdout: "", stderr: `no pull request ${args[2]}`, error: null };
      if (args[args.indexOf("--json") + 1] === "commits") {
        // GitHub's PR commit list, merges included (the compare patch omits them).
        const oids = git(this.origin, ["rev-list", "--reverse", `${this.headOf(pr.baseBranch)}..${this.headOf(pr.branch)}`]).split("\n").filter(Boolean);
        return ok(`${JSON.stringify({ commits: oids.map((oid) => ({ oid })) })}\n`);
      }
      return ok(`${JSON.stringify(this.view(pr))}\n`);
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "ready") {
      const pr = this.find(args[2]);
      if (!pr) return { status: 1, stdout: "", stderr: `no pull request ${args[2]}`, error: null };
      const before = this.beforeReady; this.beforeReady = null; before?.();
      pr.isDraft = false;
      this.readyCalls.push(pr.url);
      const after = this.afterReady; this.afterReady = null; after?.();
      return ok("");
    }
    if (command === "gh" && args[0] === "api") return ok(this.comparePatch(args));
    if (command === "/bin/zsh") return ok("host-home-readable\nhost-repository-readable\nhost-network-reachable\n");
    if (command === "codex" && args[0] === "sandbox") return ok("sandbox-evidence-readable\nsandbox-home-denied\nsandbox-repository-denied\nsandbox-network-denied\n");
    if (command === "codex") {
      const prompt = stdin ?? "";
      const role = prompt.includes("Exact-Head Code Review") ? "code-review" as const : "qa" as const;
      const pr = this.prs.find((entry) => prompt.includes(entry.url));
      this.reviewerCalls.push({ role, url: pr?.url ?? "unknown", head: pr ? this.headOf(pr.branch) : "unknown" });
      this.reviewerTimeouts.push(timeoutMs);
      const during = this.duringReview; this.duringReview = null; during?.(role);
      if (this.reviewerTimesOut(role)) return { status: null, stdout: "", stderr: "", error: `spawnSync codex ETIMEDOUT after ${String(timeoutMs)}ms` };
      const exit = this.reviewerExit(role);
      if (exit !== 0) return { status: exit, stdout: "", stderr: "reviewer capacity exhausted (simulated)", error: null };
      const criteria = role === "code-review" ? CODE_REVIEW_PR_CRITERIA : QA_PR_REVIEW_CRITERIA;
      writeFileSync(args[args.indexOf("--output-last-message") + 1], `${JSON.stringify(hostModelVerdict(this.verdict(role, pr), criteria, this.findingTitle))}\n`, "utf8");
      return ok('{"type":"task.completed"}\n');
    }
    return { status: 1, stdout: "", stderr: `Unexpected command: ${command} ${args.join(" ")}`, error: null };
  };
}
