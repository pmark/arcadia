import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { ArcadiaError } from "../src/cli/errors.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import { loadPhase3Registries } from "../src/intent/registries.js";
import { launchGuardedHostSession } from "../src/sessions/launch.js";
import { git, HOST_SEATBELT, LINE_A, LINE_B, Rehearsal, type RehearsalOptions } from "./helpers/rehearsalHarness.js";
import { expectIdentityBlock } from "./helpers/identityBlock.js";
import { resolveSessionAgentIdentity } from "../src/codingAgents/agentIdentity.js";
import type { AgentSession } from "../src/sessions/index.js";
import type { TierAgent } from "../src/codingAgents/modelTiers.js";

/**
 * The launched brief's Identity block names exactly the identity the launch
 * environment commits under: the tier the Session's own model resolves to.
 */
function expectLaunchIdentity(argv: string[], session: AgentSession, agent: TierAgent): void {
  const { tier, name } = resolveSessionAgentIdentity({ agent, model: session.model, effort: session.effort });
  expectIdentityBlock(String(argv.at(-1)), agent, tier);
  expect(argv).toContain(`GIT_AUTHOR_NAME=${name}`);
}

/**
 * The operator's two-Action rehearsal (`prove-two-action-unattended-production`),
 * replayed hermetically: the real worker tick, real Git, real preservation
 * validation under Seatbelt, real settlement — with only tmux, the coding
 * agent's keystrokes, and provider capacity/sign-in simulated. See
 * `tests/helpers/rehearsalHarness.ts` for exactly what is and is not real.
 *
 * Each `describe` block maps to one runbook step or one fixture decision the
 * operator's prepare script makes, so a red test names the step the live
 * rehearsal would have stopped at.
 *
 * With `ARCADIA_PRESERVATION_HOST_TEST=1` (macOS, from an unsandboxed shell,
 * because `sandbox-exec` will not nest) preservation runs the real Seatbelt
 * validator everywhere. Without it -- CI, Linux -- the tick uses the harness's
 * `unsandboxedValidator` (same bindings, same commands, no Seatbelt), and the
 * one scenario that goes through the agent-initiated `arcadia preserve` path,
 * which cannot take an injected validator, is skipped.
 */

const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const CRITERIA_B = [
  "MARKER.md contains both lines, action A's line before action B's line.",
  'tests/marker.test.mjs exists and "node --test" passes, asserting both lines appear in order.'
];
const MARKER_TEST = `import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
test("marker lines are in order", () => {
  assert.deepEqual(readFileSync("MARKER.md", "utf8"), ${JSON.stringify(`${LINE_A}\n${LINE_B}\n`)});
});
`;

/** Runbook Steps 1, 1b and 2: fixture, registration, A's packet approval (one operator intervention), activation. */
function activated(options: RehearsalOptions = {}) {
  const rehearsal = new Rehearsal(options);
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  const approvalA = rehearsal.registerProject();
  rehearsal.approve(approvalA);
  const activation = rehearsal.activate();
  return { rehearsal, approvalA, activation };
}

/** Runbook Step 3: the worker launches A with no operator command. */
function launchA(rehearsal: Rehearsal) {
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
  return rehearsal.lease()!;
}

/** A finished in one Session, then the worker integrates it and launches B. */
function runThroughBLaunch(rehearsal: Rehearsal) {
  const a = launchA(rehearsal);
  rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
  rehearsal.agentFinish(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionB, 4);
  return { a, b: rehearsal.lease()! };
}

describe("rehearsal Steps 1-2: preparation and activation", () => {
  it("imports, syncs and seeds the fixture so the pointer names A, dispatchable, with one open build-packet approval", () => {
    const rehearsal = new Rehearsal();
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    const approvalA = rehearsal.registerProject();

    expect(approvalA).toMatch(/^review_/);
    expect(rehearsal.pointer()).toBe("write-marker-a");
    const status = withDatabase(rehearsal.workspace, (db) =>
      (db.prepare("SELECT status FROM review_items WHERE id = ?").get(approvalA) as { status: string }).status
    );
    expect(status).toBe("open");
  });

  it("grants both Actions, the integration grant and packet approval in one activation, and refuses a replayed request id as a no-op", () => {
    const { rehearsal, activation } = activated();

    expect(activation.preview.scope.actions).toEqual([rehearsal.actionA, rehearsal.actionB]);
    expect(activation.preview.scope.integrationGrant?.decisionRef).toBe("0058");
    expect(activation.preview.scope.mechanicalTransitions).toEqual(expect.arrayContaining(["validation", "acceptance", "pointer", "packet_approval"]));
    expect(activation.result.policy.desiredState).toBe("active");
    expect(activation.result.replayed).toBe(false);

    const replay = rehearsal.activate();
    expect(replay.result.replayed).toBe(true);
    expect(replay.warnings.join(" ")).toMatch(/Replayed an existing activation receipt/);
  });
});

describe("rehearsal Steps 3-5: two dependent Actions from one activation (criteria 2 and 3)", () => {
  it("splits A across two Sessions in one candidate, refuses a concurrent execution, integrates A, and launches B on a fresh base with no operator step", () => {
    const { rehearsal } = activated();

    // Step 3: A1 launches on the first tick.
    const a1 = launchA(rehearsal);
    expect(rehearsal.tmux.launches).toHaveLength(1);

    // Step 4a: a concurrent second execution against the live candidate is refused.
    const registries = loadPhase3Registries(rehearsal.workspace);
    let concurrent: unknown;
    try {
      concurrent = withDatabase(rehearsal.workspace, (db) =>
        launchGuardedHostSession({
          db, workspace: rehearsal.workspace, repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug,
          requestId: "concurrent-attempt", standingPolicy: true, profiles: registries.codingAgents.profiles,
          adapters: defaultAdapters as ProviderAdapterRegistry, now: rehearsal.now, tmux: rehearsal.tmux,
          providerSignIn: () => ({ signedIn: true, remedy: "" }), agentWorktreeRoot: rehearsal.worktrees
        })
      );
    } catch (error) {
      concurrent = error;
    }
    // Either refused outright, or handed back the one durable Session -- never a second execution.
    if (!(concurrent instanceof ArcadiaError)) {
      expect(concurrent).toMatchObject({ reused: true, session: { id: a1.id } });
    }
    expect(rehearsal.tmux.launches).toHaveLength(1);
    expect(rehearsal.sessions()).toHaveLength(1);
    const whileLive = rehearsal.tick();
    expect(whileLive.launch?.reason).toMatch(/Repository lease held by Session/);

    // Step 4b: A1 edits the candidate and is killed before committing.
    rehearsal.agentEdit(a1, "MARKER.md", `${LINE_A}\n`);
    rehearsal.tmux.exit(a1.tmux_session_name);
    const reconciled = rehearsal.tick();
    expect(reconciled.reconciled).toEqual([{ sessionId: a1.id, outcome: "incomplete_resumable" }]);
    expect(reconciled.handoff?.preservation.kind).toBe("preserved");
    expect(reconciled.handoff?.integration.kind).toBe("refused");

    // Step 4c: the worker itself resumes A in the same worktree and branch, and A2 sees A1's work.
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 2);
    const a2 = rehearsal.lease()!;
    expect(a2.id).not.toBe(a1.id);
    expect(a2.action_id).toBe("write-marker-a");
    expect(a2.worktree_path).toBe(a1.worktree_path);
    expect(a2.branch).toBe(a1.branch);
    expect(readFileSync(path.join(a2.worktree_path, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n`);

    // Step 5: A2 finishes by the brief's completion protocol and exits.
    rehearsal.agentFinish(a2, CRITERIA_A);
    rehearsal.tmux.exit(a2.tmux_session_name);
    // The exit tick preserves and accepts A but integrates only once current
    // independent code review and QA verdicts bind A's exact head.
    const { exited, integrated } = rehearsal.tickThroughReview();
    expect(exited.reconciled).toEqual([{ sessionId: a2.id, outcome: "accepted_completion" }]);
    expect(exited.handoff?.preservation.kind).toBe("preserved");
    expect(exited.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/current independent verdicts/) });
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-a")).toBe("done");
    expect(rehearsal.pointer()).toBe("write-marker-b");

    // B's packet is prepared and approved under the standing grant; B launches with no operator call.
    const launchTicks = [integrated];
    if (integrated.launch?.outcome !== "launched") {
      launchTicks.push(...rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3));
    }
    const b = rehearsal.lease()!;
    expect(b.action_id).toBe("write-marker-b");
    expect(b.worktree_path).not.toBe(a2.worktree_path);
    expect(b.base_revision).toBe(git(rehearsal.repo, ["rev-parse", "main"]).trim());
    expect(readFileSync(path.join(b.worktree_path, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n`);
    expect(rehearsal.log.join("\n")).toMatch(/Approved build packet Decision review_\w+ for two-action-rehearsal-v4\/write-marker-b under the standing policy's packet_approval delegation/);
    expect(rehearsal.status().operatorEscalations).toEqual([]);

    // B finishes; the Plan completes and nothing further launches.
    rehearsal.agentEdit(b, "MARKER.md", `${LINE_A}\n${LINE_B}\n`);
    rehearsal.agentEdit(b, "tests/marker.test.mjs", MARKER_TEST);
    rehearsal.agentFinish(b, CRITERIA_B);
    rehearsal.tmux.exit(b.tmux_session_name);
    const { exited: finishedExit, integrated: finished } = rehearsal.tickThroughReview();
    expect(finishedExit.reconciled).toEqual([{ sessionId: b.id, outcome: "accepted_completion" }]);
    expect(finished.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-b")).toBe("done");
    expect(readFileSync(path.join(rehearsal.repo, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n`);

    const after = [rehearsal.tick(), rehearsal.tick()];
    expect(after.every((r) => r.launch?.outcome !== "launched")).toBe(true);
    expect(rehearsal.tmux.launches).toHaveLength(3);
    expect(rehearsal.sessions().map((s) => [s.action_id, s.status])).toEqual([
      ["write-marker-a", expect.any(String)],
      ["write-marker-a", expect.any(String)],
      ["write-marker-b", expect.any(String)]
    ]);
    const status = rehearsal.status();
    expect(status.operatorEscalations).toEqual([]);
    expect(status.launchBlockers).toEqual([]);
    expect(status.liveAdmissions).toBe(0);
    expect(git(rehearsal.repo, ["status", "--porcelain"])).toBe("");
  });

  it.skipIf(!HOST_SEATBELT)("follows the brief's full completion protocol -- validate, preserve through the host, settle, exit -- and still integrates", () => {
    const { rehearsal } = activated();
    const a = launchA(rehearsal);
    // The launch hands the agent a brief naming the Action, its criteria and the protocol, in its own worktree.
    const launch = rehearsal.tmux.launches[0];
    expect(launch.cwd).toBe(a.worktree_path);
    expect(JSON.stringify(launch.args)).toMatch(/Arcadia managed-production Action brief/);
    expect(JSON.stringify(launch.args)).toContain("arcadia-preserve-broker-claude");

    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    const preserved = rehearsal.agentPreserve(a);
    expect(preserved).toBeTruthy();
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    const { exited: result, integrated } = rehearsal.tickThroughReview();
    expect(result.reconciled[0]?.outcome).toBe("accepted_completion");
    expect(result.handoff?.preservation.kind).toBe("preserved");
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.pointer()).toBe("write-marker-b");
  });

  it("keeps an integrated, unpushed base branch when the fixture has an origin the tick fetches from", () => {
    const { rehearsal } = activated({ withOrigin: true });
    runThroughBLaunch(rehearsal);
    const integratedHead = git(rehearsal.repo, ["rev-parse", "main"]).trim();
    expect(git(rehearsal.repo, ["rev-parse", "origin/main"]).trim()).not.toBe(integratedHead);
    rehearsal.tick();
    rehearsal.tick();
    expect(git(rehearsal.repo, ["rev-parse", "main"]).trim()).toBe(integratedHead);
    expect(rehearsal.pointer()).toBe("write-marker-b");
  });

  it("finishes A in one Session when nothing interrupts it", () => {
    const { rehearsal } = activated();
    const { a, b } = runThroughBLaunch(rehearsal);
    expect(b.action_id).toBe("write-marker-b");
    expect(b.worktree_path).not.toBe(a.worktree_path);
  });
});

describe("rehearsal provider: the launched process must be able to run and exit unattended", () => {
  it("runs the whole two-Action path on opencode-cli, launched headless with `opencode run`", () => {
    const { rehearsal } = activated({ provider: { id: "opencode-cli", profile: "opencode_build" } });
    const { a, b } = runThroughBLaunch(rehearsal);
    for (const [index, launch] of rehearsal.tmux.launches.entries()) {
      const argv = [launch.command, ...launch.args];
      expect(argv).toContain("opencode");
      expect(argv[argv.indexOf("opencode") + 1]).toBe("run");
      expectLaunchIdentity(argv, rehearsal.sessions()[index], "opencode");
    }
    expect([a.provider, b.provider]).toEqual(["opencode-cli", "opencode-cli"]);
  });

  // pmark/arcadia#727 / #698: a standing-policy Claude Session is launched with
  // `--print`, which skips the workspace trust dialog on a fresh candidate
  // worktree and exits after its turn, so the tick can reconcile it and launch B.
  it("launches a standing-policy Claude Session with `--print` and `acceptEdits`, never bypassing approvals", () => {
    const { rehearsal } = activated();
    const a = launchA(rehearsal);
    const launch = rehearsal.tmux.launches[0];
    const argv = [launch.command, ...launch.args];
    expectLaunchIdentity(argv, a, "claude");
    const claude = argv.indexOf("claude");
    expect(claude).toBeGreaterThanOrEqual(0);
    expect(argv[claude + 1]).toBe("--print");
    expect(argv.slice(claude)).toEqual(expect.arrayContaining(["--permission-mode", "acceptEdits"]));
    expect(argv.join(" ")).not.toMatch(/dangerously|bypass/i);
    expect(argv.at(-1)).toMatch(/Arcadia managed-production Action brief/);
  });
});

describe("rehearsal on codex-cli, with a realistically sandboxed agent", () => {
  const CODEX = { provider: { id: "codex-cli", profile: "codex_build" } };

  it("integrates A and launches B when the agent can only edit, draft its completion, and exit", () => {
    const { rehearsal } = activated(CODEX);
    const a = launchA(rehearsal);
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinishSandboxed(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);

    const { exited, integrated } = rehearsal.tickThroughReview();
    expect(exited.handoff?.preservation.kind).toBe("preserved");
    expect(exited.reconciled[0]?.outcome).toBe("accepted_completion");
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.pointer()).toBe("write-marker-b");
    if (integrated.launch?.outcome !== "launched") rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3);
    const b = rehearsal.lease()!;
    expect(b.action_id).toBe("write-marker-b");

    rehearsal.agentEdit(b, "MARKER.md", `${LINE_A}\n${LINE_B}\n`);
    rehearsal.agentEdit(b, "tests/marker.test.mjs", MARKER_TEST);
    rehearsal.agentFinishSandboxed(b, CRITERIA_B);
    rehearsal.tmux.exit(b.tmux_session_name);
    const { exited: finishedExit, integrated: finished } = rehearsal.tickThroughReview();
    expect(finishedExit.reconciled[0]?.outcome).toBe("accepted_completion");
    expect(finished.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-b")).toBe("done");
    expect(readFileSync(path.join(rehearsal.repo, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n`);
    expect(rehearsal.tmux.launches).toHaveLength(2);
  });

  it("launches a standing-policy Codex Session with `codex exec` in its worktree's workspace-write sandbox, never bypassing approvals", () => {
    const { rehearsal } = activated(CODEX);
    const a = launchA(rehearsal);
    const argv = [rehearsal.tmux.launches[0].command, ...rehearsal.tmux.launches[0].args];
    expectLaunchIdentity(argv, a, "codex");
    const codex = argv.indexOf("codex");
    expect(codex).toBeGreaterThanOrEqual(0);
    expect(argv[codex + 1]).toBe("exec");
    expect(argv.slice(codex)).toEqual(expect.arrayContaining(["--sandbox", "workspace-write", "--cd", a.worktree_path]));
    expect(argv.join(" ")).not.toMatch(/dangerously|bypass|danger-full-access/);
    expect(argv.at(-1)).toMatch(/Arcadia managed-production Action brief/);
  });
});

describe("rehearsal Step 6: Turn Off mid-work, then restart (criterion 4)", () => {
  it("never kills the live Session, never launches again, reconciles its exit visibly, and keeps its output after a worker restart", () => {
    const { rehearsal } = activated();
    const { b } = runThroughBLaunch(rehearsal);
    const launchesBeforeOff = rehearsal.tmux.launches.length;

    const off = rehearsal.deactivate();
    expect(off.policy.desiredState).toBe("inactive");
    expect(off.withinAcknowledgementDeadline).toBe(true);
    expect(rehearsal.tmux.hasSession(b.tmux_session_name)).toBe(true);

    const whileLive = rehearsal.tick();
    expect(whileLive.launch).toBeNull();
    expect(rehearsal.lease()?.id).toBe(b.id);

    // B finishes its work after Off, then exits.
    rehearsal.agentEdit(b, "MARKER.md", `${LINE_A}\n${LINE_B}\n`);
    rehearsal.agentEdit(b, "tests/marker.test.mjs", MARKER_TEST);
    rehearsal.agentFinish(b, CRITERIA_B);
    const branchHead = git(b.worktree_path, ["rev-parse", "HEAD"]).trim();
    rehearsal.tmux.exit(b.tmux_session_name);
    const exited = rehearsal.tick();
    expect(exited.reconciled).toHaveLength(1);
    expect(exited.reconciled[0].sessionId).toBe(b.id);
    expect(exited.handoff?.integration.kind).toBe("refused");
    expect(exited.launch).toBeNull();

    // "Restart the worker": later ticks load everything fresh. Nothing launches or reactivates.
    const restarted = [rehearsal.tick(), rehearsal.tick(), rehearsal.tick()];
    expect(restarted.every((r) => r.launch === null && r.reconciled.length === 0)).toBe(true);
    expect(rehearsal.tmux.launches).toHaveLength(launchesBeforeOff);
    expect(rehearsal.status().read).toMatchObject({ status: "ok", policy: { desiredState: "inactive" } });
    // Off preserved B's output: its branch still carries the finished work, unmerged.
    expect(git(b.worktree_path, ["rev-parse", "HEAD"]).trim()).toBe(branchHead);
    expect(readFileSync(path.join(b.worktree_path, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n`);
    expect(rehearsal.pointer()).toBe("write-marker-b");
  });
});

describe("rehearsal fixture decisions the prepare script must get right", () => {
  it("a validation command naming a file only Action B creates fails A's preservation, so B could never launch", () => {
    // The prepare script's original `--validation-command 'node --test tests/marker.test.mjs'`:
    // at A's candidate the file does not exist yet, so the check fails; at B's
    // candidate the check-binding refuses it because the candidate created the
    // file its own check runs.
    const { rehearsal } = activated({ validationCommand: "node --test tests/marker.test.mjs" });
    const a = launchA(rehearsal);
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    const result = rehearsal.tick();
    expect(result.handoff?.preservation).toMatchObject({ kind: "refused", reason: expect.stringMatching(/preservation validation failed/) });
    expect(result.handoff?.integration.kind).toBe("refused");
    expect(rehearsal.pointer()).toBe("write-marker-a");
  });

  it("without the Decision 0058 integration grant, A is preserved but never merged, and B never launches", () => {
    const { rehearsal } = activated({ withoutIntegrationGrant: true });
    const a = launchA(rehearsal);
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    const result = rehearsal.tick();
    expect(result.reconciled[0]?.outcome).toBe("accepted_completion");
    expect(result.handoff?.preservation.kind).toBe("preserved");
    expect(result.handoff?.integration).toMatchObject({ kind: "refused", operatorMergeCommand: expect.stringContaining("merge --ff-only") });
    const later = [rehearsal.tick(), rehearsal.tick()];
    expect(later.every((r) => r.launch?.outcome !== "launched")).toBe(true);
    expect(rehearsal.pointer()).toBe("write-marker-a");
  });

  it("without packet_approval, B waits on a named build-packet approval in production status, and launches the tick after the operator approves it", () => {
    const { rehearsal } = activated({ withoutPacketApproval: true });
    const a = launchA(rehearsal);
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    rehearsal.tick();
    rehearsal.tickUntil(() => rehearsal.status().operatorEscalations.some((e) => e.kind === "build_packet_approval_pending"), 4);
    const escalation = rehearsal.status().operatorEscalations.find((e) => e.actionKey === rehearsal.actionB)!;
    expect(escalation.kind).toBe("build_packet_approval_pending");
    const approvalB = /review_[a-z0-9]+/.exec(escalation.remedy ?? "")?.[0];
    expect(approvalB).toBeDefined();
    expect(rehearsal.tmux.launches).toHaveLength(1);

    const workItemsBefore = withDatabase(rehearsal.workspace, (db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM work_items").get() as { count: number }).count);
    const approved = runReviewApproveCommand({ workspace: rehearsal.workspace, id: approvalB!, execute: false });
    // The packet's sourceInput is a doc reference, not free text: approving it
    // never runs intent classification, so no Requires Review Action is filed
    // under whatever Project the path resembles (Issue #663). Only the
    // follow-up is created either: the Session is launched separately (#1189).
    expect(approved.data.approval).toBeNull();
    expect(approved.data.item.status).toBe("approved");
    withDatabase(rehearsal.workspace, (db) => {
      expect((db.prepare("SELECT COUNT(*) AS count FROM work_items").get() as { count: number }).count).toBe(workItemsBefore);
      const pending = db.prepare(`SELECT project_id FROM review_items
        WHERE resolved_intent = 'ReviewExecutionPending' AND json_extract(context_json, '$.originalReviewId') = ?`)
        .get(approvalB!) as { project_id: string } | undefined;
      expect(pending).toBeUndefined();
    });
    const launched = rehearsal.tick();
    expect(launched.launch).toMatchObject({ outcome: "launched", actionKey: rehearsal.actionB });
    expect(rehearsal.status().operatorEscalations).toEqual([]);
  });
});

describe("rehearsal guards: completion is recognized only when it really happened", () => {
  it("never accepts a candidate whose Plan was hand-edited to done without a settlement", () => {
    const { rehearsal } = activated();
    const a = launchA(rehearsal);
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    const planPath = path.join(a.worktree_path, "docs", "plans", "two-action-rehearsal-bootstrap.md");
    const plan = readFileSync(planPath, "utf8");
    rehearsal.agentEdit(a, "docs/plans/two-action-rehearsal-bootstrap.md", plan.replace("status: open", "status: done"));
    git(a.worktree_path, ["add", "-A"]);
    git(a.worktree_path, ["-c", "user.name=Agent", "-c", "user.email=agent@rehearsal.test", "commit", "-q", "-m", "hand-edit"]);
    rehearsal.tmux.exit(a.tmux_session_name);
    const result = rehearsal.tick();
    expect(result.reconciled[0]?.outcome).toBe("incomplete_resumable");
    expect(result.handoff?.integration.kind).toBe("refused");
    expect(rehearsal.pointer()).toBe("write-marker-a");
  });

  it("resumes an agent that committed its work but exited before settling, and integrates once the resumed Session settles", () => {
    const { rehearsal } = activated();
    const a1 = launchA(rehearsal);
    rehearsal.agentEdit(a1, "MARKER.md", `${LINE_A}\n`);
    git(a1.worktree_path, ["add", "-A"]);
    git(a1.worktree_path, ["-c", "user.name=Agent", "-c", "user.email=agent@rehearsal.test", "commit", "-q", "-m", "work, unsettled"]);
    rehearsal.tmux.exit(a1.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("incomplete_resumable");

    rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 2);
    const a2 = rehearsal.lease()!;
    expect(a2.worktree_path).toBe(a1.worktree_path);
    rehearsal.agentFinish(a2, CRITERIA_A);
    rehearsal.tmux.exit(a2.tmux_session_name);
    const { exited: result, integrated } = rehearsal.tickThroughReview();
    expect(result.reconciled[0]?.outcome).toBe("accepted_completion");
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.pointer()).toBe("write-marker-b");
  });

  it("relaunches A on a fresh candidate after a Session that died before changing anything", () => {
    const { rehearsal } = activated();
    const a1 = launchA(rehearsal);
    rehearsal.tmux.exit(a1.tmux_session_name);
    const result = rehearsal.tick();
    expect(result.reconciled[0]?.outcome).toMatch(/missing_evidence|failed_execution/);
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3);
    const a2 = rehearsal.lease()!;
    expect(a2.action_id).toBe("write-marker-a");
    expect(a2.id).not.toBe(a1.id);
    expect(existsSync(a2.worktree_path)).toBe(true);
  });
});
