import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocs } from "../src/docs/discover.js";
import { resolveReadySet } from "../src/docs/dispatch.js";
import { requirementIdentity } from "../src/sessions/roleLineage.js";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import {
  CHAIN_KINDS, ChainPlanError, amendmentProblems, chainActionIds, chainLauncher, chainLibraryIds, chainNextAction, chainQueueKeys, chainQueueProblems, chainQueueRequestId,
  completionIdProblems, completionRequestId, decideFixtureStart, planChainQueueOrder, reconciliationProblems, renderChainPlan, validateChainParams,
  type ChainAmendmentObservation, type ChainQueueFacts, type ChainRunParams, type FixtureStartFacts
} from "../src/operatorActions/rehearsalChain.js";
import { chainDescriptor, chainDescriptorText } from "../src/operatorActions/rehearsalChainDescriptors.js";

/**
 * The pure parts of the rehearsal-chain operator script set: parameter
 * validation, the derived ids, the fixture Plan rendering for N=3 and N=9
 * (judged by Arcadia's real discovery, ready set and requirementIdentity),
 * completion-id freshness, the previous-head decision and the previous
 * terminal-Off reconciliation cross-check, plus the rendered library entries.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const paramsDir = path.join(library, "rehearsal-chain", "params");
const readParams = (runId: string) => JSON.parse(readFileSync(path.join(paramsDir, `${runId}.json`), "utf8")) as ChainRunParams;
const RUN6 = readParams("run6-2026-10-06");
const RUN7 = readParams("run7-2026-10-06");
const RUN8 = readParams("run8-2026-10-06");
/** Run 6 at N=3 (its first form), a test-only variant that keeps the three-Action rendering covered now that run 6 is the nine-Action chain. */
const RUN6_N3: ChainRunParams = { ...RUN6, actionCount: 3 };
const PLAN_FILE = "docs/plans/autonomous-three-action-rehearsal.md";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const source = (id: string) => readFileSync(path.join(library, `${id}.sh`), "utf8");
const constantOf = (id: string, name: string) => {
  const match = source(id).match(new RegExp(`^${name}=(?:'([^']*)'|"([^"$]*)")$`, "m"));
  if (!match) throw new Error(`${id} has no literal ${name}`);
  return match[1] ?? match[2];
};
// G1's original write-start-marker line and run 5's, as the merged resets carry them.
const ORIGINAL_LINE = constantOf("reset-three-action-rehearsal-fixture-2026-10-05", "OLD_NEXT_ACTION");
const RUN5_LINE = constantOf("reset-three-action-rehearsal-fixture-run5-2026-10-06", "NEW_NEXT_ACTION");

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

/** G1's genesis, rendered from G1's own heredocs. */
function renderG1Fixture(directory: string) {
  const script = source(G1);
  const constants = script.slice(0, script.indexOf('case "${1:-run}" in')).split("\n").filter((line) => /^[A-Z_]+=/.test(line) && !line.includes("$(")).join("\n");
  const end = "} # end render_fixture";
  const start = script.indexOf("render_fixture() {");
  const program = [constants, 'REPO="pmark/arcadia-three-action-rehearsal-t1"', "FIXTURE_DATE=2026-10-04", script.slice(start, script.indexOf(end) + end.length), `render_fixture ${JSON.stringify(directory)}`].join("\n");
  const run = spawnSync("bash", ["-c", program], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
}
let genesisRoot: string | null = null;
/** G1's genesis tree, and run 5's reset tree (7214de28 live): run 5's write-start-marker line and `updated: 2026-10-06`. */
function trees() {
  const genesis = temp("chain-genesis-");
  renderG1Fixture(genesis);
  genesisRoot = genesis;
  const run5 = temp("chain-run5-");
  cpSync(genesis, run5, { recursive: true });
  const plan = readFileSync(path.join(genesis, PLAN_FILE), "utf8");
  expect(plan.split("\n").filter((line) => line === ORIGINAL_LINE)).toHaveLength(1);
  writeFileSync(path.join(run5, PLAN_FILE), plan.replace(ORIGINAL_LINE, RUN5_LINE).replace(/^updated: \d{4}-\d{2}-\d{2}$/m, "updated: 2026-10-06"));
  return { genesis, run5 };
}
const withPlan = (base: string, plan: string) => {
  const root = temp("chain-amended-");
  cpSync(base, root, { recursive: true });
  writeFileSync(path.join(root, PLAN_FILE), plan);
  return root;
};
const planDoc = (root: string) => {
  const discovered = discoverDocs(root);
  const plan = discovered.docs.find((doc) => doc.type === "plan");
  if (plan?.type !== "plan") throw new Error("no Plan");
  return { discovered, plan };
};
const identities = (root: string) => Object.fromEntries(planDoc(root).plan.actions.map((action) => {
  const identity = requirementIdentity({ projectSlug: "three-action-rehearsal", planSlug: "autonomous-three-action-rehearsal", action });
  return [action.id, { requirementId: identity.requirementId, inputRevision: identity.inputRevision, criteriaFingerprint: identity.criteriaFingerprint }];
}));
/** The observation the reset's validation probe builds, from the same Arcadia functions (docs sync errors come from discovery here). */
function observe(genesis: string, before: string, after: string): ChainAmendmentObservation {
  const a = planDoc(after);
  const b = planDoc(before);
  const project = a.discovered.docs.find((doc) => doc.type === "project");
  const ready = resolveReadySet(after, "three-action-rehearsal");
  return {
    importSlug: "three-action-rehearsal",
    errors: a.discovered.errors.map((e) => e.message),
    rejected: [],
    readySetBlockers: ready.blockers.map((e) => e.message),
    project: project?.type === "project" ? { slug: project.slug, activePlan: project.activePlan, currentAction: project.currentAction } : null,
    actions: a.plan.actions.map((action) => ({ id: action.id, status: action.status, responsibility: action.responsibility, dependsOn: action.dependsOn })),
    ready: ready.ready.map((entry) => entry.actionId),
    candidates: ready.candidates.map((entry) => ({ id: entry.actionId, ready: entry.ready, gate: entry.gate, blockers: entry.blockers.map((blocker) => blocker.field) })),
    beforeErrors: b.discovered.errors.map((e) => e.message),
    beforeActions: b.plan.actions as unknown as Array<Record<string, unknown>>,
    afterActions: a.plan.actions as unknown as Array<Record<string, unknown>>,
    genesisIdentity: identities(genesis), beforeIdentity: identities(before), afterIdentity: identities(after)
  };
}
/** Run 7's reviewed parameter file (fully filled from run 6's receipts), as a throwaway copy. */
const filled7 = (): ChainRunParams => structuredClone(RUN7);

describe("rehearsal-chain parameter files", () => {
  it("run 6 (N=9, tonight's one press) is valid and fully filled: binds run 5's receipts and heads and requires the merged #987 and #997 fixes", () => {
    const { params, problems, unfilled } = validateChainParams(RUN6);
    expect(problems).toEqual([]);
    expect(params?.actionCount).toBe(9);
    expect(unfilled).toEqual([]);
    expect(RUN6.requiredCommits[4].commit).toBe("a4a7c18450c6fe38beb390d7ce4fd62570ca841f");
    expect(RUN6.requiredCommits[3].commit).toBe("26172c74ae9dcf795cc69cabd8a62616f7ed42c8");
    expect(RUN6.previousRun).toMatchObject({
      label: "run 5", resetId: "reset-three-action-rehearsal-fixture-run5-2026-10-06", terminalOffId: "restore-terminal-off-three-action-rehearsal-run5-2026-10-06",
      grantId: "grant-production-three-action-rehearsal-run5-2026-10-06",
      bindings: { resetRunId: "20261006T031820Z-74070", resetHead: "7214de28da2745c66f89d81e124e2ab2de05b2ca", terminalOffRunId: "20261006T033451Z-43195", localMain: "f68ec48ed4ff95772fee108258d401158c26a54d" }
    });
    expect(RUN6.previousRun.bindings.candidates.map((c) => c.pullRequest)).toEqual([1, 2, 3, 4, 5, 6]);
    // Run 5's integrated local main is exactly PR #5's tip; Action 2's work is PR #6.
    expect(RUN6.previousRun.bindings.candidates[4]).toEqual({ branch: "claude/write-start-marker-20261006T032202909Z", tip: "f68ec48ed4ff95772fee108258d401158c26a54d", pullRequest: 5 });
    expect(RUN6.previousRun.bindings.candidates[5]).toEqual({ branch: "claude/transform-start-marker-20261006T032821535Z", tip: "69eb7d6283447270a9a16e540f7d4f5f2e3427fc", pullRequest: 6 });
    // The run-5 G6 and G7 required commits, kept.
    expect(RUN6.requiredCommits.slice(0, 3).map((c) => c.commit)).toEqual(["9a9db5e8bfe7b35d0b312fc2f763cc80c2db25f1", "0b3686013f0a924c35d58dc7a09c979f1a994c7e", "bb83f70cbc0d6c08685735d0f192ef20fc0cf5d4"]);
  });

  it("run 7 (N=9) is valid and fully filled from run 6's receipts: reset runs/20261006T141854Z-41044, terminal Off runs/20261006T160825Z-24828, all eight candidates including stacked PR #8, and #1017 required", () => {
    const { params, problems, unfilled } = validateChainParams(RUN7);
    expect(problems).toEqual([]);
    expect(unfilled).toEqual([]);
    expect(params?.actionCount).toBe(9);
    expect(JSON.stringify(RUN7)).not.toContain("UNFILLED");
    expect(RUN7.previousRun).toMatchObject({
      label: "run 6", resetId: "reset-rehearsal-chain-fixture-run6-2026-10-06", terminalOffId: "restore-terminal-off-rehearsal-chain-run6-2026-10-06", grantId: "grant-production-rehearsal-chain-run6-2026-10-06",
      bindings: { resetRunId: "20261006T141854Z-41044", resetHead: "162f5b19dce5eac700c5edae0a0d640bad07daa0", terminalOffRunId: "20261006T160825Z-24828", localMain: "6fbae8d6c04f3014038ff51745ae27572a3524dc" }
    });
    // Run 5's six candidates stay pinned; run 6 adds PR #7 (Action 1, integrated locally) and PR #8 (Action 2, stacked on #7's branch).
    expect(RUN7.previousRun.bindings.candidates.slice(0, 6)).toEqual(RUN6.previousRun.bindings.candidates);
    expect(RUN7.previousRun.bindings.candidates.slice(6)).toEqual([
      { branch: "claude/write-start-marker-20261006T155142019Z", tip: "6fbae8d6c04f3014038ff51745ae27572a3524dc", pullRequest: 7 },
      { branch: "claude/transform-start-marker-20261006T155537486Z", tip: "2aa3e2489d151289eb47a8b3e52629f434897d07", pullRequest: 8 }
    ]);
    // Run 6's integrated local main is exactly PR #7's tip.
    expect(RUN7.previousRun.bindings.localMain).toBe(RUN7.previousRun.bindings.candidates[6].tip);
    // The required commits are run 6's plus #1017's merge commit.
    expect(RUN7.requiredCommits.slice(0, RUN6.requiredCommits.length)).toEqual(RUN6.requiredCommits);
    expect(RUN7.requiredCommits.slice(RUN6.requiredCommits.length)).toEqual([expect.objectContaining({ commit: "3c67b0a8996893210a8694960584dc9732f83d09", why: expect.stringContaining("#1017") })]);
    expect(RUN7.actionCount).toBe(RUN6.actionCount);
  });

  it("run 8 (N=9) is valid and fully filled from run 7's receipts: reset runs/20261006T173810Z-40687 (newHead f478438a), terminal Off runs/20261006T175308Z-12860, all nine candidates including run 7's PR #9, and #1019 and #1020 required", () => {
    const { params, problems, unfilled } = validateChainParams(RUN8);
    expect(problems).toEqual([]);
    expect(unfilled).toEqual([]);
    expect(params?.actionCount).toBe(9);
    expect(JSON.stringify(RUN8)).not.toContain("UNFILLED");
    expect(RUN8).toMatchObject({ runId: "run8-2026-10-06", runLabel: "run 8" });
    expect(RUN8.previousRun).toMatchObject({
      label: "run 7", resetId: "reset-rehearsal-chain-fixture-run7-2026-10-06", terminalOffId: "restore-terminal-off-rehearsal-chain-run7-2026-10-06", grantId: "grant-production-rehearsal-chain-run7-2026-10-06",
      bindings: { resetRunId: "20261006T173810Z-40687", resetHead: "f478438a00d98dae34434ca2b6ddebc3da0e9b73", terminalOffRunId: "20261006T175308Z-12860", localMain: "f478438a00d98dae34434ca2b6ddebc3da0e9b73" }
    });
    // Run 7 integrated nothing by local fast-forward: its terminal Off recorded the reset head, so the reset moves no local main.
    expect(RUN8.previousRun.bindings.localMain).toBe(RUN8.previousRun.bindings.resetHead);
    // Run 6's eight candidates stay pinned and run 7 adds PR #9 (its Action 1, preserved at 8e362475, from its work-reconciliation).
    expect(RUN8.previousRun.bindings.candidates.slice(0, 8)).toEqual(RUN7.previousRun.bindings.candidates);
    expect(RUN8.previousRun.bindings.candidates.slice(8)).toEqual([{ branch: "claude/write-start-marker-20261006T174204533Z", tip: "8e362475887c3c7c25d1dc594e48a5c8f586ce0f", pullRequest: 9 }]);
    expect(RUN8.previousRun.bindings.candidates.map((c) => c.pullRequest)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Run 7's required commits kept, plus #1019 (c26f3a9e) and #1020 (98b532a1).
    expect(RUN8.requiredCommits.slice(0, RUN7.requiredCommits.length)).toEqual(RUN7.requiredCommits);
    expect(RUN8.requiredCommits.slice(RUN7.requiredCommits.length)).toEqual([
      expect.objectContaining({ commit: "c26f3a9ebbdbf87315396a9dffc9fd178e02cf37", why: expect.stringContaining("#1019") }),
      expect.objectContaining({ commit: "98b532a183d31411da4437792d1e24bd1dd6eb8b", why: expect.stringContaining("#1020") })
    ]);
    expect(RUN8.actionCount).toBe(RUN7.actionCount);
  });

  it("a run-7 file with any binding left UNFILLED is still valid in shape and fail-closed: every script refuses it", () => {
    const params = structuredClone(RUN7);
    Object.assign(params.previousRun.bindings, { resetRunId: "UNFILLED: x", resetHead: "UNFILLED: x", terminalOffRunId: "UNFILLED: x", localMain: "UNFILLED: x" });
    params.previousRun.bindings.candidates[7] = { branch: "UNFILLED: x", tip: "UNFILLED", pullRequest: "UNFILLED" as unknown as number };
    params.requiredCommits[5].commit = "UNFILLED: the commit";
    const { problems, unfilled } = validateChainParams(params);
    expect(problems).toEqual([]);
    for (const binding of ["resetRunId", "resetHead", "terminalOffRunId", "localMain"]) expect(unfilled).toContain(`params.previousRun.bindings.${binding}`);
    expect(unfilled).toContain("params.previousRun.bindings.candidates[7].branch");
    expect(unfilled).toContain("params.requiredCommits[5].commit");
  });

  it.each([
    ["a wrong schema", (p: Record<string, any>) => { p.schema = "x"; }, "params.schema"],
    ["a run label naming another run", (p: Record<string, any>) => { p.runLabel = "run 8"; }, "different run numbers"],
    ["N below 3", (p: Record<string, any>) => { p.actionCount = 2; }, "actionCount"],
    ["N above 12", (p: Record<string, any>) => { p.actionCount = 13; }, "actionCount"],
    ["a fractional N", (p: Record<string, any>) => { p.actionCount = 3.5; }, "actionCount"],
    ["an unknown key", (p: Record<string, any>) => { p.extra = true; }, "params.extra is not a known parameter"],
    ["no required commits", (p: Record<string, any>) => { p.requiredCommits = []; }, "requiredCommits"],
    ["a malformed commit", (p: Record<string, any>) => { p.requiredCommits[0].commit = "abc"; }, "requiredCommits[0].commit"],
    ["a repeated commit", (p: Record<string, any>) => { p.requiredCommits[1].commit = p.requiredCommits[0].commit; }, "repeats"],
    ["a malformed reset head", (p: Record<string, any>) => { p.previousRun.bindings.resetHead = "7214de2"; }, "resetHead"],
    ["a repeated candidate branch", (p: Record<string, any>) => { p.previousRun.bindings.candidates[1].branch = p.previousRun.bindings.candidates[0].branch; }, "repeats"],
    ["a repeated pull request", (p: Record<string, any>) => { p.previousRun.bindings.candidates[1].pullRequest = 1; }, "repeats"],
    ["a branch with ..", (p: Record<string, any>) => { p.previousRun.bindings.candidates[0].branch = "claude/../main"; }, ".."],
    ["no candidates", (p: Record<string, any>) => { p.previousRun.bindings.candidates = []; }, "candidates"],
    ["this run's own Grant as the previous one", (p: Record<string, any>) => { p.previousRun.grantId = "grant-production-rehearsal-chain-run6-2026-10-06"; }, "own Grant"],
    ["a non-slug previous id", (p: Record<string, any>) => { p.previousRun.resetId = "Reset Run 5"; }, "resetId"],
    ["a required-commit list without the #922/#924/#983/#987/#997 floor", (p: Record<string, any>) => { p.requiredCommits = p.requiredCommits.slice(4); }, "the floor cannot be removed"]
  ])("refuses %s", (_label, mutate, expected) => {
    const params = structuredClone(RUN6) as unknown as Record<string, any>;
    mutate(params);
    const { params: valid, problems } = validateChainParams(params);
    expect(valid).toBeNull();
    expect(problems.join("; ")).toContain(expected);
  });

  it("derives the chain ids, the fresh completion ids and the per-run library ids", () => {
    expect(chainActionIds(3)).toEqual(["write-start-marker", "transform-start-marker", "verify-final-rehearsal"]);
    expect(chainActionIds(9).slice(3)).toEqual(["chain-step-04", "chain-step-05", "chain-step-06", "chain-step-07", "chain-step-08", "chain-step-09"]);
    expect(chainActionIds(12).at(-1)).toBe("chain-step-12");
    expect(() => chainActionIds(2)).toThrow();
    expect(() => chainActionIds(13)).toThrow();
    expect(completionRequestId("write-start-marker", "run6-2026-10-06")).toBe("complete-write-start-marker-run6-2026-10-06");
    expect(chainLibraryIds("run6-2026-10-06")).toEqual({
      reset: "reset-rehearsal-chain-fixture-run6-2026-10-06", preflight: "preflight-rehearsal-chain-run6-2026-10-06",
      grant: "grant-production-rehearsal-chain-run6-2026-10-06", terminalOff: "restore-terminal-off-rehearsal-chain-run6-2026-10-06"
    });
  });
});

describe("rehearsal-chain Plan rendering", () => {
  it("N=3 (run 6's first form, test-only) from run 5's reset head amends exactly the three next_action lines, the date and the budget, with fresh inputs and only Action 1 ready", () => {
    const { genesis, run5 } = trees();
    const base = readFileSync(path.join(run5, PLAN_FILE), "utf8");
    const rendered = renderChainPlan(base, RUN6_N3, "2026-10-06");
    expect(rendered.planUpdatedBefore).toBe("2026-10-06");
    const before = base.split("\n");
    const after = rendered.plan.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.map((line, i) => [before[i], line] as const).filter(([b, a]) => a !== b);
    // G1's three-Action wording already states N=3, so only the Plan title gains "chain"; for any other N the milestone and body paragraph change too (rehearsal-chain-coherence.test.ts).
    expect(changed.map(([, a]) => a.split(":")[0].trim())).toEqual(["token_budget", "next_action", "next_action", "next_action", "# Autonomous three-Action rehearsal chain"]);
    expect(rendered.actions.map((a) => [a.id, a.completionId, a.appended])).toEqual([
      ["write-start-marker", "complete-write-start-marker-run6-2026-10-06", false],
      ["transform-start-marker", "complete-transform-start-marker-run6-2026-10-06", false],
      ["verify-final-rehearsal", "complete-verify-final-rehearsal-run6-2026-10-06", false]
    ]);
    for (const action of rendered.actions) {
      expect(action.nextAction).toContain(`record completion under the unused Agent Ask request id ${action.completionId}`);
      expect(action.nextAction).toContain("leave `git status` clean after settling");
      expect(action.nextAction).toContain("rehearsal run 6, run id run6-2026-10-06");
    }
    // Action 1 keeps G1's original sentence, then the run note.
    expect(rendered.actions[0].nextAction.startsWith(ORIGINAL_LINE.replace("    next_action: ", "").slice(0, -1) + " (rehearsal run 6")).toBe(true);
    const amended = withPlan(run5, rendered.plan);
    const observation = observe(genesis, run5, amended);
    expect(amendmentProblems(observation, { project: "three-action-rehearsal", plan: "autonomous-three-action-rehearsal", actionIds: chainActionIds(3), nextActions: rendered.actions.map((a) => a.nextAction) })).toEqual([]);
    expect(observation.ready).toEqual(["write-start-marker"]);
    const [g, b, a] = [identities(genesis), identities(run5), identities(amended)];
    for (const id of chainActionIds(3)) {
      expect(a[id].inputRevision).not.toBe(b[id].inputRevision);
      expect(a[id].inputRevision).not.toBe(g[id].inputRevision);
      expect(a[id].criteriaFingerprint).toBe(g[id].criteriaFingerprint);
    }
    // Run 5's write-start-marker input (8703b0edac2d, live) and Action 2's passed input (6bf8f08dbb3e, live) are not reused.
    expect(b["write-start-marker"].inputRevision.startsWith("8703b0edac2d")).toBe(true);
    expect(b["transform-start-marker"].inputRevision.startsWith("6bf8f08dbb3e")).toBe(true);
  });

  it("N=9 (run 7) appends six genuinely dependent chain steps to a three-Action chain and from run 5's head alike", () => {
    const { genesis, run5 } = trees();
    const run6 = renderChainPlan(readFileSync(path.join(run5, PLAN_FILE), "utf8"), RUN6_N3, "2026-10-06");
    const run6Root = withPlan(run5, run6.plan);
    const params = filled7();
    const rendered = renderChainPlan(run6.plan, params, "2026-10-07");
    expect(rendered.actions.map((a) => a.id)).toEqual(chainActionIds(9));
    expect(rendered.actions.map((a) => a.appended)).toEqual([false, false, false, true, true, true, true, true, true]);
    const amended = withPlan(run6Root, rendered.plan);
    const { plan } = planDoc(amended);
    expect(plan.actions.map((a) => a.dependsOn)).toEqual([[], ["write-start-marker"], ["transform-start-marker"], ["verify-final-rehearsal"], ["chain-step-04"], ["chain-step-05"], ["chain-step-06"], ["chain-step-07"], ["chain-step-08"]]);
    expect(plan.actions[3].nextAction).toContain('reading the last line of MARKER.md, which verify-final-rehearsal wrote and which must be "three-action rehearsal verified"');
    expect(plan.actions[3].acceptanceCriteria[0]).toBe('CHAIN.md exists and contains exactly the line "chain step 04 follows three-action rehearsal verified" followed by a trailing newline, with no other content.');
    expect(plan.actions[8].nextAction).toContain('which chain-step-08 wrote and which must start with "chain step 08 follows"');
    expect(plan.actions[8].acceptanceCriteria[0]).toContain('its last line is exactly "chain step 09 follows chain step 08"');
    expect(plan.actions[8].nextAction).toContain("Action 9 of 9 in one serial chain");
    const observation = observe(genesis, run6Root, amended);
    expect(amendmentProblems(observation, { project: "three-action-rehearsal", plan: "autonomous-three-action-rehearsal", actionIds: chainActionIds(9), nextActions: rendered.actions.map((a) => a.nextAction) })).toEqual([]);
    expect(observation.ready).toEqual(["write-start-marker"]);
    // Every chain step is gated only by its predecessor.
    expect(observation.candidates.filter((c) => c.id !== "write-start-marker").every((c) => !c.ready && c.blockers.every((field) => field.endsWith(".depends_on")))).toBe(true);
    // The same nine from run 5's head directly.
    const direct = renderChainPlan(readFileSync(path.join(run5, PLAN_FILE), "utf8"), params, "2026-10-07");
    expect(direct.plan).toBe(rendered.plan);
    expect(discoverDocs(withPlan(run5, direct.plan)).errors).toEqual([]);
    // Each N renders: 12 is the ceiling.
    expect(renderChainPlan(run6.plan, { ...params, actionCount: 12 }, "2026-10-07").actions.at(-1)?.id).toBe("chain-step-12");
  });

  it.each([
    ["a reset date before the base Plan's date", (plan: string) => plan, "2026-10-05", "RESET_DATE_BEFORE_PLAN"],
    ["a base Action whose criteria changed", (plan: string) => plan.replace("      - The genesis check node scripts/check-rehearsal.mjs passes.", "      - The genesis check passes."), "2026-10-06", "BASE_ACTION_CHANGED"],
    ["a base Action whose title changed", (plan: string) => plan.replace("    title: Implement MARKER.md containing", "    title: Write MARKER.md containing"), "2026-10-06", "BASE_ACTION_CHANGED"],
    ["a base Action already done", (plan: string) => plan.replace("    status: open", "    status: done"), "2026-10-06", "BASE_ACTION_CHANGED"],
    ["a base Plan with a foreign Action id", (plan: string) => plan.replace("  - id: verify-final-rehearsal", "  - id: verify-final"), "2026-10-06", "BASE_ACTIONS"],
    ["a base Plan with two date lines", (plan: string) => plan.replace("updated: 2026-10-06", "updated: 2026-10-06\nupdated: 2026-10-06"), "2026-10-06", "DATE_LINE"]
  ])("refuses %s", (_label, mutate, date, reason) => {
    const { run5 } = trees();
    const base = mutate(readFileSync(path.join(run5, PLAN_FILE), "utf8"));
    for (const params of [RUN6, RUN6_N3]) expect(() => renderChainPlan(base, params, date)).toThrow(expect.objectContaining({ reason }));
  });

  it("run 6 (N=9) from run 5's reset head: the three G1 Actions amended, six chain steps appended, fresh inputs, only Action 1 ready; run 7 repeats it over run 6's chain", () => {
    const { genesis, run5 } = trees();
    const rendered = renderChainPlan(readFileSync(path.join(run5, PLAN_FILE), "utf8"), RUN6, "2026-10-06");
    expect(rendered.actions.map((a) => [a.id, a.completionId, a.appended])).toEqual(chainActionIds(9).map((id, i) => [id, completionRequestId(id, "run6-2026-10-06"), i >= 3]));
    for (const action of rendered.actions) expect(action.nextAction).toContain(`rehearsal run 6, run id run6-2026-10-06, Action ${chainActionIds(9).indexOf(action.id) + 1} of 9 in one serial chain`);
    const amended = withPlan(run5, rendered.plan);
    const expected = { project: "three-action-rehearsal", plan: "autonomous-three-action-rehearsal", actionIds: chainActionIds(9), nextActions: rendered.actions.map((a) => a.nextAction) };
    const observation = observe(genesis, run5, amended);
    expect(amendmentProblems(observation, expected)).toEqual([]);
    expect(observation.ready).toEqual(["write-start-marker"]);
    const [b, a] = [identities(run5), identities(amended)];
    for (const id of chainActionIds(3)) expect(a[id].inputRevision).not.toBe(b[id].inputRevision);
    // Run 7 over run 6's nine: every Action amended again (fresh inputs), none appended.
    const repeat = renderChainPlan(rendered.plan, filled7(), "2026-10-07");
    expect(repeat.actions.every((action) => !action.appended)).toBe(true);
    const repeated = withPlan(amended, repeat.plan);
    expect(amendmentProblems(observe(genesis, amended, repeated), { ...expected, nextActions: repeat.actions.map((x) => x.nextAction) })).toEqual([]);
    const [r] = [identities(repeated)];
    for (const id of chainActionIds(9)) expect(r[id].inputRevision).not.toBe(a[id].inputRevision);
  });

  it("refuses to render the same run twice, and a run of fewer Actions over a longer chain", () => {
    const { run5 } = trees();
    const run6 = renderChainPlan(readFileSync(path.join(run5, PLAN_FILE), "utf8"), RUN6_N3, "2026-10-06");
    expect(() => renderChainPlan(run6.plan, RUN6_N3, "2026-10-06")).toThrow(expect.objectContaining({ reason: "NEXT_ACTION_NOT_FRESH" }));
    const nine = renderChainPlan(readFileSync(path.join(run5, PLAN_FILE), "utf8"), RUN6, "2026-10-06");
    expect(() => renderChainPlan(nine.plan, RUN6, "2026-10-06")).toThrow(expect.objectContaining({ reason: "NEXT_ACTION_NOT_FRESH" }));
    expect(() => renderChainPlan(nine.plan, { ...RUN6_N3, runId: "run8-2026-10-07", runLabel: "run 8" }, "2026-10-07")).toThrow(ChainPlanError);
  });

  it("amendmentProblems names each way an amendment fails", () => {
    const { genesis, run5 } = trees();
    const rendered = renderChainPlan(readFileSync(path.join(run5, PLAN_FILE), "utf8"), RUN6_N3, "2026-10-06");
    const amended = withPlan(run5, rendered.plan);
    const expected = { project: "three-action-rehearsal", plan: "autonomous-three-action-rehearsal", actionIds: chainActionIds(3), nextActions: rendered.actions.map((a) => a.nextAction) };
    const base = observe(genesis, run5, amended);
    expect(amendmentProblems({ ...base, ready: ["write-start-marker", "transform-start-marker"] }, expected).join("; ")).toContain("not exactly [write-start-marker]");
    expect(amendmentProblems({ ...base, errors: ["bad yaml"] }, expected)).toContain("docs sync error: bad yaml");
    expect(amendmentProblems(base, { ...expected, nextActions: ["x", ...expected.nextActions.slice(1)] }).join("; ")).toContain("write-start-marker next_action is not this run's text");
    // An unamended base (same inputs) is not fresh.
    expect(amendmentProblems(observe(genesis, run5, run5), expected).join("; ")).toContain("fresh requirement input revision");
    expect(amendmentProblems({ ...base, project: null }, expected)).toContain("no PROJECT.md was discovered");
  });
});

describe("completion-id freshness", () => {
  const ids = chainActionIds(3).map((id) => completionRequestId(id, "run6-2026-10-06"));
  it("accepts fresh ids and refuses used, repeated or already-archived ones", () => {
    expect(completionIdProblems(ids, ["complete-write-start-marker-run5-2026-10-06", "complete-transform-start-marker-2026-10-05"], [".arcadia/asks/archive/agent-ask-complete-write-start-marker-run5-2026-10-06.yaml"])).toEqual([]);
    expect(completionIdProblems(ids, [ids[1]])).toEqual([`completion id ${ids[1]} is already used by an Agent Ask proposal in the workspace`]);
    expect(completionIdProblems([ids[0], ids[0]], [])).toEqual([`completion id ${ids[0]} is named twice`]);
    expect(completionIdProblems(ids, [], [`.arcadia/asks/agent-ask-${ids[2]}.yaml`])).toEqual([`completion id ${ids[2]} already has an Ask file in the fixture tree`]);
  });
});

describe("previous-head decision", () => {
  const RESET = "7214de28da2745c66f89d81e124e2ab2de05b2ca";
  const LOCAL = "f68ec48ed4ff95772fee108258d401158c26a54d";
  const candidates = RUN6.previousRun.bindings.candidates.map((c) => ({ ...c, containsExpectedLocalMain: c.pullRequest >= 5 }));
  const live: FixtureStartFacts = { remoteMain: RESET, localMain: LOCAL, resetHead: RESET, expectedLocalMain: LOCAL, resetHeadIsAncestorOfExpectedLocalMain: true, candidates, localMainIsResetCommit: false, remoteMainIsResetCommit: false };

  it("run 5's terminal state: local main f68ec48 preserved on PR #5 and #6, so only local main moves back to 7214de28", () => {
    expect(decideFixtureStart(live)).toEqual({ state: "move_local_main", refusals: [], preservedOn: [
      { branch: "claude/write-start-marker-20261006T032202909Z", tip: LOCAL, pullRequest: 5 },
      { branch: "claude/transform-start-marker-20261006T032821535Z", tip: "69eb7d6283447270a9a16e540f7d4f5f2e3427fc", pullRequest: 6 }
    ] });
  });
  it("resumes from GitHub main, an unpushed or a pushed reset commit", () => {
    expect(decideFixtureStart({ ...live, localMain: RESET }).state).toBe("at_base");
    expect(decideFixtureStart({ ...live, localMain: "c".repeat(40), localMainIsResetCommit: true }).state).toBe("committed_unpushed");
    expect(decideFixtureStart({ ...live, localMain: "c".repeat(40), remoteMain: "c".repeat(40), localMainIsResetCommit: true, remoteMainIsResetCommit: true }).state).toBe("pushed");
    // No local integration at all: nothing to preserve.
    expect(decideFixtureStart({ ...live, localMain: RESET, expectedLocalMain: RESET, candidates: candidates.map((c) => ({ ...c, containsExpectedLocalMain: false })) }).state).toBe("at_base");
  });
  it.each([
    ["a local main other than the pinned one", { localMain: "d".repeat(40) }, "not the previous run's reset head"],
    ["pinned work no candidate contains", { candidates: candidates.map((c) => ({ ...c, containsExpectedLocalMain: false })) }, "could lose work"],
    ["pinned work not descending from the reset head", { resetHeadIsAncestorOfExpectedLocalMain: false }, "does not descend"],
    ["a GitHub main that moved", { remoteMain: "e".repeat(40) }, "moved by another path"],
    ["already moved back but the pinned work is not preserved", { localMain: RESET, candidates: candidates.map((c) => ({ ...c, containsExpectedLocalMain: false })) }, "could lose work"]
  ])("refuses %s, moving nothing", (_label, patch, expected) => {
    const decision = decideFixtureStart({ ...live, ...patch });
    expect(decision.state).toBeNull();
    expect(decision.refusals.join("; ")).toContain(expected);
  });
});

describe("previous terminal-Off reconciliation cross-check", () => {
  // Run 5's G8 work reconciliation (runs/20261006T033451Z-43195), abridged to the fields read.
  const run5 = [
    ["claude/write-start-marker-20261004T170245861Z", "58bcd9155cf64836994045ca63a7707d8b9ebe75", 1, "preserved"],
    ["claude/write-start-marker-20261005T155147519Z", "7f1390376f4d49215cd29fd98145d40198475613", 2, "preserved"],
    ["claude/write-start-marker-20261005T184707757Z", "50d1eab84e385a5566119831c82f5a6d32e752fd", 3, "preserved"],
    ["claude/write-start-marker-20261005T220000438Z", "79c6bae937255964cf0453c163ece0c36bb1985a", 4, "preserved"],
    ["claude/write-start-marker-20261006T032202909Z", "f68ec48ed4ff95772fee108258d401158c26a54d", 5, "integrated"],
    ["claude/transform-start-marker-20261006T032821535Z", "69eb7d6283447270a9a16e540f7d4f5f2e3427fc", 6, "preserved"]
  ].map(([branch, tip, pr, state], i) => ({ session: `s${i}`, state, branch, tip, pullRequest: `https://github.com/pmark/arcadia-three-action-rehearsal-20261004/pull/${pr}` }));
  it("run 6's pinned candidates cover run 5's reconciliation exactly", () => {
    expect(reconciliationProblems(run5, RUN6.previousRun.bindings.candidates)).toEqual([]);
  });
  it("refuses a missing, moved or unreconciled candidate", () => {
    expect(reconciliationProblems(run5, RUN6.previousRun.bindings.candidates.slice(0, 5)).join("; ")).toContain("does not pin it");
    expect(reconciliationProblems(run5, RUN6.previousRun.bindings.candidates.map((c) => c.pullRequest === 6 ? { ...c, tip: "f".repeat(40) } : c)).join("; ")).toContain("pins claude/transform-start-marker");
    expect(reconciliationProblems([...run5, { session: "x", state: "committed_unreconciled", branch: "b", tip: "t" }], RUN6.previousRun.bindings.candidates).join("; ")).toContain("committed_unreconciled");
    expect(reconciliationProblems([{ session: "y", state: "no_committed_work", branch: "z", tip: "" }], [])).toEqual([]);
    expect(reconciliationProblems(run5.map((line, i) => i === 5 ? { ...line, pullRequest: "" } : line), RUN6.previousRun.bindings.candidates).join("; ")).toContain("recorded no pull request");
  });
});

describe("run 7's previous-head decision over run 6's stacked candidates", () => {
  const RESET = "162f5b19dce5eac700c5edae0a0d640bad07daa0";
  const LOCAL = "6fbae8d6c04f3014038ff51745ae27572a3524dc";
  // Run 6's integrated Action 1 is PR #7's tip; PR #8 is stacked on it, so both contain it and nothing earlier does.
  const candidates = RUN7.previousRun.bindings.candidates.map((c) => ({ ...c, containsExpectedLocalMain: c.pullRequest >= 7 }));
  const live: FixtureStartFacts = { remoteMain: RESET, localMain: LOCAL, resetHead: RESET, expectedLocalMain: LOCAL, resetHeadIsAncestorOfExpectedLocalMain: true, candidates, localMainIsResetCommit: false, remoteMainIsResetCommit: false };
  it("moves only local main from 6fbae8d6 back to GitHub main 162f5b19, preserved on PR #7 and its stacked PR #8", () => {
    expect(decideFixtureStart(live)).toMatchObject({ state: "move_local_main", refusals: [], preservedOn: [{ pullRequest: 7, tip: LOCAL }, { pullRequest: 8, tip: "2aa3e2489d151289eb47a8b3e52629f434897d07" }] });
  });
  it("still preserved by the stacked PR #8 alone if PR #7's own branch no longer contains it", () => {
    const only8 = candidates.map((c) => ({ ...c, containsExpectedLocalMain: c.pullRequest === 8 }));
    expect(decideFixtureStart({ ...live, candidates: only8 }).state).toBe("move_local_main");
  });
});

describe("previous terminal-Off reconciliation of run 6 (a locally integrated Action 1 and a stacked Action 2)", () => {
  // Run 6's G8 work reconciliation (runs/20261006T160825Z-24828), abridged to the fields read.
  const line = (branch: string, tip: string, pr: number, state: string) => ({ session: `s${pr}`, state, branch, tip, pullRequest: `https://github.com/pmark/arcadia-three-action-rehearsal-20261004/pull/${pr}` });
  const run6 = RUN7.previousRun.bindings.candidates.map((c) => line(c.branch, c.tip, c.pullRequest, c.pullRequest === 7 ? "integrated" : "preserved"));
  it("run 7's pinned candidates cover run 6's reconciliation exactly, and nothing is accepted that drops, moves or leaves live one of its lines", () => {
    expect(run6).toHaveLength(8);
    expect(reconciliationProblems(run6, RUN7.previousRun.bindings.candidates)).toEqual([]);
    expect(reconciliationProblems(run6, RUN7.previousRun.bindings.candidates.slice(0, 7)).join("; ")).toContain("does not pin it");
    expect(reconciliationProblems(run6, RUN7.previousRun.bindings.candidates.map((c) => c.pullRequest === 8 ? { ...c, pullRequest: 9 } : c)).join("; ")).toContain("pull request #9");
    expect(reconciliationProblems([...run6, { session: "x", state: "committed_unreconciled", branch: "b", tip: "t" }], RUN7.previousRun.bindings.candidates).join("; ")).toContain("committed_unreconciled");
  });
});

describe("run 8's previous-head decision and reconciliation over run 7's receipts (nothing integrated locally)", () => {
  const RESET = "f478438a00d98dae34434ca2b6ddebc3da0e9b73";
  // Run 7's G8 work reconciliation (runs/20261006T175308Z-12860/work-reconciliation.jsonl), abridged to the fields read: nine preserved lines, none integrated.
  const lines = [
    ["claude/write-start-marker-20261004T170245861Z", "58bcd9155cf64836994045ca63a7707d8b9ebe75", 1], ["claude/write-start-marker-20261005T155147519Z", "7f1390376f4d49215cd29fd98145d40198475613", 2],
    ["claude/write-start-marker-20261005T184707757Z", "50d1eab84e385a5566119831c82f5a6d32e752fd", 3], ["claude/write-start-marker-20261005T220000438Z", "79c6bae937255964cf0453c163ece0c36bb1985a", 4],
    ["claude/write-start-marker-20261006T032202909Z", "f68ec48ed4ff95772fee108258d401158c26a54d", 5], ["claude/transform-start-marker-20261006T032821535Z", "69eb7d6283447270a9a16e540f7d4f5f2e3427fc", 6],
    ["claude/write-start-marker-20261006T155142019Z", "6fbae8d6c04f3014038ff51745ae27572a3524dc", 7], ["claude/transform-start-marker-20261006T155537486Z", "2aa3e2489d151289eb47a8b3e52629f434897d07", 8],
    ["claude/write-start-marker-20261006T174204533Z", "8e362475887c3c7c25d1dc594e48a5c8f586ce0f", 9]
  ].map(([branch, tip, pr]) => ({ session: `s${pr}`, state: "preserved", branch, tip, pullRequest: `https://github.com/pmark/arcadia-three-action-rehearsal-20261004/pull/${pr}` }));
  it("run 8's pinned candidates cover run 7's reconciliation exactly (including PR #9), and drop, move or live lines are refused", () => {
    expect(reconciliationProblems(lines, RUN8.previousRun.bindings.candidates)).toEqual([]);
    expect(reconciliationProblems(lines, RUN7.previousRun.bindings.candidates).join("; ")).toContain("does not pin it");
    expect(reconciliationProblems(lines.map((l) => l.session === "s9" ? { ...l, tip: "f".repeat(40) } : l), RUN8.previousRun.bindings.candidates).join("; ")).toContain("pins claude/write-start-marker-20261006T174204533Z");
    expect(reconciliationProblems([...lines, { session: "x", state: "committed_unreconciled", branch: "b", tip: "t" }], RUN8.previousRun.bindings.candidates).join("; ")).toContain("committed_unreconciled");
  });
  it("starts at the base: local main, GitHub main and the pinned local main are all run 7's reset head, so no local main moves", () => {
    const candidates = RUN8.previousRun.bindings.candidates.map((c) => ({ ...c, containsExpectedLocalMain: false }));
    const facts: FixtureStartFacts = { remoteMain: RESET, localMain: RESET, resetHead: RESET, expectedLocalMain: RESET, resetHeadIsAncestorOfExpectedLocalMain: true, candidates, localMainIsResetCommit: false, remoteMainIsResetCommit: false };
    expect(decideFixtureStart(facts)).toMatchObject({ state: "at_base", refusals: [], preservedOn: [] });
    expect(decideFixtureStart({ ...facts, localMain: "a".repeat(40) }).state).toBeNull();
  });
});

describe("the operational queue after the chain reset (Issue #1015)", () => {
  const chain = chainQueueKeys(chainActionIds(9));
  const entry = (key: string, status = "explicit") => ({ key, status });
  const facts = (entries: Array<{ key: string; status: string }>, extra: Partial<ChainQueueFacts> = {}): ChainQueueFacts => {
    const unpositioned = entries.filter((e) => e.status === "unpositioned").length;
    return { revision: 234, orderValid: unpositioned === 0, unpositionedCount: unpositioned, entries, ...extra };
  };
  it("names the nine chain keys project/action in chain order", () => {
    expect(chain).toEqual(["three-action-rehearsal/write-start-marker", "three-action-rehearsal/transform-start-marker", "three-action-rehearsal/verify-final-rehearsal",
      ...["04", "05", "06", "07", "08", "09"].map((n) => `three-action-rehearsal/chain-step-${n}`)]);
    expect(chainQueueRequestId("run7-2026-10-06", 234)).toBe("arrange-rehearsal-chain-queue-run7-2026-10-06-r234");
  });
  it("run 6's live state: seven unpositioned chain Actions are placed after every other key, each other key keeping its relative order", () => {
    const others = ["arcadia/a1", "ppn/b2", "arcadia/a3"];
    const before = facts([...others.map((k) => entry(k)), entry(chain[1]), entry(chain[2]), entry(chain[0], "unpositioned"), ...chain.slice(3).map((k) => entry(k, "unpositioned"))]);
    expect(before).toMatchObject({ orderValid: false, unpositionedCount: 7 });
    const plan = planChainQueueOrder(before, chain);
    expect(plan).toEqual({ missing: [], order: [...others, ...chain], othersUnpositioned: [], satisfied: false });
    const after = facts(plan.order.map((k) => entry(k)));
    expect(chainQueueProblems(before, after, chain, plan)).toEqual([]);
  });
  it("a non-chain Action that is also unpositioned keeps its projected place and is reported", () => {
    const before = facts([entry("arcadia/a1"), entry("ppn/new", "unpositioned"), ...chain.map((k) => entry(k, "unpositioned"))]);
    const plan = planChainQueueOrder(before, chain);
    expect(plan.order).toEqual(["arcadia/a1", "ppn/new", ...chain]);
    expect(plan.othersUnpositioned).toEqual(["ppn/new"]);
  });
  it("an already valid queue with the chain in chain order needs no arrangement; a valid one with the chain out of order does", () => {
    const valid = facts([entry("arcadia/a1"), ...chain.map((k) => entry(k))]);
    expect(planChainQueueOrder(valid, chain).satisfied).toBe(true);
    const swapped = facts([entry("arcadia/a1"), ...[chain[1], chain[0], ...chain.slice(2)].map((k) => entry(k))]);
    expect(planChainQueueOrder(swapped, chain)).toMatchObject({ satisfied: false, order: ["arcadia/a1", ...chain] });
  });
  it("a chain Action the queue does not list is reported missing (the reset refuses)", () => {
    const plan = planChainQueueOrder(facts([entry("arcadia/a1"), ...chain.slice(0, 8).map((k) => entry(k))]), chain);
    expect(plan.missing).toEqual([chain[8]]);
    expect(plan.satisfied).toBe(false);
  });
  it("chainQueueProblems names an invalid or unpositioned queue, another order and a reordered non-chain Action", () => {
    const before = facts([entry("arcadia/a1"), entry("ppn/b2"), ...chain.map((k) => entry(k, "unpositioned"))]);
    const plan = planChainQueueOrder(before, chain);
    const good = facts(plan.order.map((k) => entry(k)));
    expect(chainQueueProblems(before, good, chain, plan)).toEqual([]);
    expect(chainQueueProblems(before, { ...good, orderValid: false, unpositionedCount: 2 }, chain, plan).join("; ")).toContain("not orderValid");
    expect(chainQueueProblems(before, { ...good, orderValid: false, unpositionedCount: 2 }, chain, plan).join("; ")).toContain("2 Action(s) are still unpositioned");
    expect(chainQueueProblems(before, facts(["ppn/b2", "arcadia/a1", ...chain].map((k) => entry(k))), chain, plan).join("; ")).toContain("relative order of a non-chain Action");
    expect(chainQueueProblems(before, facts([...plan.order.slice(0, 2), ...[...chain].reverse()].map((k) => entry(k))), chain, plan).join("; ")).toContain("not in chain order");
  });
});

describe("rendered library entries", () => {
  it.each([RUN6, RUN7, RUN8].flatMap((params) => CHAIN_KINDS.map((kind) => [params.runId, kind] as const)))("%s %s: launcher and descriptor match the renderer and the library contract", (runId, kind) => {
    const params = readParams(runId);
    const id = chainLibraryIds(runId)[kind];
    expect(readFileSync(path.join(library, `${id}.sh`), "utf8")).toBe(chainLauncher(kind, runId));
    expect(readFileSync(path.join(library, `${id}.json`), "utf8")).toBe(chainDescriptorText(kind, params));
    expect(() => validateOperatorScriptContract(JSON.parse(readFileSync(path.join(library, `${id}.json`), "utf8")), id, chainLauncher(kind, runId))).not.toThrow();
  });

  it("the G7 descriptor tells the operator plainly what one press authorises for N Actions, and that Decision 0058 sets no three-Action limit", () => {
    for (const params of [RUN6, RUN7, RUN8]) {
      const grant = chainDescriptor("grant", params);
      expect(grant.kind).toBe("grant");
      expect(grant.repeatable).toBe(false);
      expect(grant.problem).toContain(`ONE PRESS AUTHORISES ${params.actionCount} ACTIONS`);
      for (const id of chainActionIds(params.actionCount)) expect(grant.problem).toContain(id);
      expect(grant.problem).toContain("Neither limits the number of Actions");
      expect(grant.problem).toContain("never authorises a GitHub merge or a base-branch push");
      expect(grant.problem).toContain("12 hours");
      expect(grant.next_after).toMatchObject({ id: chainLibraryIds(params.runId).preflight, within_minutes: 30, when_production: "inactive" });
      expect(grant.next_after?.voided_by).toEqual(expect.arrayContaining([chainLibraryIds(params.runId).terminalOff, chainLibraryIds(params.runId).reset, params.previousRun.terminalOffId, "recover-arcadia-host-services", "reinstall-go-broker"]));
    }
    expect(chainDescriptor("reset", RUN6).desired_effect).toContain("The new line starts from run 5's reset head 7214de28da2745c66f89d81e124e2ab2de05b2ca on GitHub main.");
    expect(chainDescriptor("reset", RUN6).problem).toContain("moves ONLY the clone's local main back to 7214de28da2745c66f89d81e124e2ab2de05b2ca");
    expect(chainDescriptor("reset", RUN7).desired_effect).toContain("The new line starts from run 6's reset head 162f5b19dce5eac700c5edae0a0d640bad07daa0 on GitHub main.");
    expect(chainDescriptor("reset", RUN7).problem).toContain("moves ONLY the clone's local main back to 162f5b19dce5eac700c5edae0a0d640bad07daa0");
    // Run 8: run 7 integrated nothing locally (its terminal Off recorded the reset head), so no local-main move; the reset states the coherence guard.
    expect(chainDescriptor("reset", RUN8).desired_effect).toContain("The new line starts from run 7's reset head f478438a00d98dae34434ca2b6ddebc3da0e9b73 on GitHub main.");
    expect(chainDescriptor("reset", RUN8).problem).toContain("no local-main move is needed");
    expect(chainDescriptor("reset", RUN8).desired_effect).toContain("the fixture-coherence guard refuses any stated Action count other than 9, naming file, line and text");
    expect(JSON.stringify(chainDescriptor("reset", RUN8).authority.does)).toContain("chainCoherenceProblems");
    expect(JSON.stringify(chainDescriptor("preflight", RUN8).authority.does)).toContain("chainCoherenceProblems");
    expect(chainNextAction(0, RUN6)).toContain("Action 1 of 9");
    expect(chainNextAction(0, RUN6_N3)).toContain("Action 1 of 3");
    // Tonight's run-6 press authorises exactly nine named Actions.
    const grant6 = chainDescriptor("grant", RUN6);
    expect(grant6.problem).toContain("ONE PRESS AUTHORISES 9 ACTIONS");
    expect(grant6.problem).toContain("for each of the 9 disposable fixture Actions write-start-marker, transform-start-marker, verify-final-rehearsal, chain-step-04, chain-step-05, chain-step-06, chain-step-07, chain-step-08 and chain-step-09, in that order");
    expect(grant6.problem).not.toContain("chain-step-10");
    expect(genesisRoot === null || typeof genesisRoot === "string").toBe(true);
  });
});

describe("check:operator-scripts follows a launcher's exec target", () => {
  it("judges a rehearsal-chain launcher together with its shared implementation, so a settlement hidden there is refused", () => {
    const lib = temp("chain-checker-");
    mkdirSync(path.join(lib, "rehearsal-chain"));
    const id = chainLibraryIds("run6-2026-10-06").reset;
    for (const ext of ["sh", "json"]) copyFileSync(path.join(library, `${id}.${ext}`), path.join(lib, `${id}.${ext}`));
    chmodSync(path.join(lib, `${id}.sh`), 0o755);
    const check = () => spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "scripts", "check-operator-scripts.ts"), lib], { cwd: repoRoot, encoding: "utf8" });
    writeFileSync(path.join(lib, "rehearsal-chain", "reset.sh"), readFileSync(path.join(library, "rehearsal-chain", "reset.sh"), "utf8"));
    expect(check().status, check().stderr).toBe(0);
    writeFileSync(path.join(lib, "rehearsal-chain", "reset.sh"), readFileSync(path.join(library, "rehearsal-chain", "reset.sh"), "utf8") + "\narcadia agent-ask settle --proposal x --disposition rejected\n");
    const refused = check();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("UNDECLARED_OPERATOR_SETTLEMENT");
  });
});
