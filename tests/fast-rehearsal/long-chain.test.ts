import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { AGENT_MINUTES, CHAIN, CHAIN_VALIDATION, chainFilesAfter, runChainStep, type ChainStep } from "./helpers/chain.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { PHASES, type ScenarioReport } from "./helpers/report.js";
import { FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * The overnight shape (one G7 press, nine Actions inside the Grant's 12-hour
 * window) run offline first: nine tiny dependent Actions in three batches of
 * three (helpers/chain.ts), each reading its predecessor's output, from one
 * activation through the real worker tick, preservation, stacked draft PRs,
 * readiness, both review steps and local fast-forward integration. Each
 * agent works half a simulated hour, so the chain spans more than five
 * simulated hours. The run happens once (beforeAll); each test reads what it
 * left. Blockers midway are in long-chain-verdict-failure.test.ts and
 * long-chain-grant-expiry.test.ts.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
let report: ScenarioReport;
let remoteMain = "";
let startedAt = 0;
const steps: ChainStep[] = [];
let final: ReturnType<FastRehearsal["productionStatus"]>;
let trailing: ReturnType<FastRehearsal["ticks"]>;

beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("long-chain-nine-actions", isolation, import.meta.filename, { longChain: true });
  world.start();
  remoteMain = world.github.headOf("main");
  startedAt = world.now.getTime();
  for (const index of CHAIN.keys()) {
    const wall = performance.now();
    steps.push(runChainStep(world, index));
    world.recorder.notes.push(`${CHAIN[index]}: ${Math.round(performance.now() - wall)} ms wall, integrated at ${world.now.toISOString()}`);
  }
  trailing = world.ticks(3);
  final = world.productionStatus();
  report = world.finish();
}, SCENARIO_TIMEOUT_MS * 2);

afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("fast rehearsal: a nine-Action chain in three batches over simulated hours", () => {
  it("spans more than five simulated hours and finishes inside the Grant's 12-hour window", () => {
    const grant = final.data.read.status === "ok" ? final.data.read.policy.scope?.integrationGrant : null;
    expect(grant).toBeTruthy();
    expect(world.now.getTime() - startedAt).toBeGreaterThan(5 * 3_600_000);
    expect(world.now.getTime()).toBeLessThan(Date.parse(grant!.expiresAt));
    expect(Date.parse(grant!.expiresAt) - startedAt).toBeLessThanOrEqual(12 * 3_600_000 + 60_000);
    // Each step was admitted after its predecessor's agent time had passed.
    for (const index of CHAIN.keys()) {
      if (index > 0) expect(Date.parse(steps[index].admittedAt) - Date.parse(steps[index - 1].admittedAt)).toBeGreaterThan(AGENT_MINUTES * 60_000);
    }
  });

  it("admits every Action exactly once and integrates all nine in order", () => {
    expect(world.sessions().map((s) => s.action_id)).toEqual([...CHAIN]);
    expect(world.tmux.launches).toHaveLength(CHAIN.length);
    const launched = report.tickLog.filter((tick) => tick.summary.includes("launch launched")).map((tick) => tick.actionId);
    expect(launched).toEqual([...CHAIN]);
    expect(report.tickLog.filter((tick) => tick.phase === "integration").map((tick) => tick.actionId)).toEqual([...CHAIN]);
    expect(report.actions.map((action) => [action.actionId, action.outcome])).toEqual(CHAIN.map((id) => [id, "integrated"]));
    for (const id of CHAIN) expect(world.planAction(world.repo, id)).toBe("done");
    for (const id of CHAIN) {
      const lineage = world.attempts(id);
      expect(lineage.filter((x) => x.role === "development").map((x) => x.status)).toEqual(["passed"]);
      expect(lineage.filter((x) => x.role === "code-review" || x.role === "qa").map((x) => [x.role, x.status])).toEqual([["code-review", "passed"], ["qa", "passed"]]);
    }
  });

  it("launches each step from its predecessor's integrated head, so each reads its predecessor's output", () => {
    expect(steps[0].launchBase).toBe(remoteMain);
    for (const index of CHAIN.keys()) {
      if (index > 0) expect(steps[index].launchBase).toBe(steps[index - 1].result.finalHead);
      expect(steps[index].baseAfter).toBe(steps[index].result.finalHead);
    }
    for (const [file, content] of Object.entries(chainFilesAfter(CHAIN.length))) {
      expect(readFileSync(path.join(world.repo, file), "utf8"), file).toBe(content);
    }
    execFileSync("/bin/sh", ["-c", CHAIN_VALIDATION], { cwd: world.repo });
  });

  it("stacks every PR on the previous candidate branch, each with a QA plan consistent with its GitHub diff", () => {
    const branches = world.gh.prs.map((pr) => pr.branch);
    expect(branches).toHaveLength(CHAIN.length);
    expect(world.github.prCreates).toEqual(branches.map((branch, index) => ({ branch, baseBranch: index === 0 ? "main" : branches[index - 1] })));
    expect(CHAIN.map((id) => world.preservationReceipt(id)?.prBase?.kind)).toEqual(["project", ...Array(CHAIN.length - 1).fill("stacked")]);
    for (const [index, step] of steps.entries()) {
      if (index > 0) expect(step.view).toMatchObject({ baseRefName: branches[index - 1], baseRefOid: steps[index - 1].result.finalHead });
      expect(step.consistency.mismatches, step.actionId).toEqual([]);
      expect(step.consistency.consistent).toBe(true);
      expect(step.published).toMatchObject({ baseBranch: step.view.baseRefName, baseRevision: step.view.baseRefOid, commit: step.view.headRefOid, fileCount: step.view.files.length });
      expect(step.published.files.map((file) => file.path).sort()).toEqual(step.view.files.map((file) => file.path).sort());
      // Only this step's chain file and settlement record are in its diff, never an earlier step's.
      const archived = step.view.files.filter((file) => file.path.startsWith(".arcadia/asks/archive/")).map((file) => file.path);
      expect(archived, step.actionId).toEqual([expect.stringContaining(`agent-ask-complete-${step.actionId}-`)]);
      expect(step.view.files.filter((file) => file.path.startsWith("chain/")).map((file) => file.path)).toEqual([`chain/batch-${Math.ceil((index + 1) / 3)}.md`]);
    }
  });

  it("loses no commit, never pushes or merges the remote base and never force pushes", () => {
    for (const step of steps) {
      git(world.repo, ["merge-base", "--is-ancestor", step.result.workCommit, "refs/heads/main"]);
      git(world.repo, ["merge-base", "--is-ancestor", step.result.finalHead, "refs/heads/main"]);
    }
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(steps.at(-1)!.result.finalHead);
    expect(world.github.headOf("main")).toBe(remoteMain);
    expect(world.github.pushes.map((push) => push.branch)).not.toContain("main");
    expect(world.github.ghCalls.some((call) => / merge\b/.test(call))).toBe(false);
    expect(world.github.readyCalls).toEqual(world.gh.prs.map((pr) => pr.url));
    for (const [index, pr] of world.gh.prs.entries()) expect(world.github.headOf(pr.branch)).toBe(steps[index].result.finalHead);
  });

  it("names the progress in production status: the Action building, the Action in review, and each integration as a base advance", () => {
    for (const [index, step] of steps.entries()) {
      const key = world.actionKey(step.actionId);
      expect(step.building.data.display.label).toBe("Active · Building (1 admitted)");
      expect(step.building.text).toMatch(new RegExp(`committed\\s+${key} via `));
      // Every earlier step's integration is a recorded base advance, newest first.
      expect(step.building.data.baseBranchAdvances.map((advance) => advance.newSha)).toEqual(steps.slice(0, index).map((s) => s.result.finalHead).reverse());
      expect(step.preserved.data.operatorEscalations.map((e) => [e.actionKey, e.kind])).toEqual([[key, "awaiting_independent_verdicts"]]);
      expect(step.preserved.text).toContain(`${key} [awaiting_independent_verdicts]`);
      expect(step.preserved.data.redAlerts).toEqual([]);
    }
    expect(final.data.baseBranchAdvances).toHaveLength(CHAIN.length);
  });

  it("ends with nothing admitted, every Action done and no silent stall", () => {
    expect(final.data.liveAdmissions).toBe(0);
    expect(final.data.display.label).toBe("Active · No admitted work");
    expect(final.data.operatorEscalations).toEqual([]);
    expect(final.data.redAlerts).toEqual([]);
    expect(final.data.launchBlockers).toEqual([]);
    for (const tick of trailing) {
      expect(tick.launch).toMatchObject({ outcome: "skipped", reason: expect.stringContaining("Every Action in this Project's active Plans is done") });
      expect(tick.handoff).toBeNull();
    }
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
    for (const action of report.actions) expect(Object.keys(action.phases)).toEqual([...PHASES]);
  });
});
