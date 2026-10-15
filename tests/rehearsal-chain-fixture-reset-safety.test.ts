import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { discoverDocs } from "../src/docs/discover.js";
import { chainCoherenceProblems, readCoherenceFiles } from "../src/operatorActions/rehearsalChainCoherence.js";
import { chainActionIds, completionRequestId } from "../src/operatorActions/rehearsalChain.js";
import { RUN6, RUN7, REPO, PLAN_FILE, A1_BRANCH, A2_BRANCH, git, sandbox, afterRun5, unfilledRun7, writeParams, resetEnv, unchanged } from "./helpers/rehearsalChain.js";


describe("rehearsal-chain reset", () => {
  it("--dry-run prints the exact planned change against run 5's terminal state and writes nothing", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    const result = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("== DRY RUN: planned fixture change for run 6");
    expect(result.stdout).toContain(`Step 1: move ONLY the clone's local main from ${state.a1Tip} back to GitHub main ${state.base}`);
    expect(result.stdout).toContain(`${A1_BRANCH} (PR #5`);
    expect(result.stdout).toContain(`${A2_BRANCH} (PR #6`);
    expect(result.stdout).toContain(`one commit 'Reset the rehearsal fixture as a 3-Action serial chain for rehearsal run 6' on ${state.base}`);
    for (const id of chainActionIds(3)) expect(result.stdout).toContain(`${id}: completion ${completionRequestId(id, RUN6)}`);
    expect(result.stdout).toContain("+    next_action: Implement MARKER.md containing exactly the line");
    expect(result.stdout).toContain("DRY RUN: no refusal");
    unchanged(box, state.a1Tip);
    // Nothing in the library (its evidence went to a temporary directory), and no CLI production read.
    expect(box.runDirs().map((d) => path.basename(d)).sort()).toEqual(["20261004T165157Z-6269", "20261006T031820Z-74070", "20261006T033451Z-43195"]);
    expect(box.keys().filter((k) => k.startsWith("arcadia production"))).toEqual([]);
    const evidence = readdirSync(box.tmp).filter((d) => d.startsWith("rehearsal-chain-dry-run."));
    expect(evidence).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(box.tmp, evidence[0], "receipt.json"), "utf8"))).toMatchObject({ outcome: "dry_run_ready", mode: "--dry-run", resetState: "move_local_main" });
  });

  it.each([3, 9])("N=%i: moves only local main back, commits the validated chain once, pushes without force, syncs and records the receipt; a rerun refuses", { timeout: 300_000 }, (n) => {
    const runId = n === 3 ? RUN6 : RUN7;
    const box = sandbox(runId);
    const state = afterRun5(box, { actionCount: n, runId });
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const newHead = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    expect(git(box.fixture, ["rev-parse", "refs/heads/main^"])).toBe(state.base);
    // G1's three-Action PROJECT.md already states N=3, so only a longer chain changes it (its size statements, never its pointer or status fields).
    expect(git(box.fixture, ["diff", "--name-only", state.base, newHead])).toBe(n === 3 ? PLAN_FILE : `PROJECT.md\n${PLAN_FILE}`);
    const projectLines = (revision: string) => git(box.fixture, ["show", `${revision}:PROJECT.md`]).split("\n");
    const pointers = (lines: string[]) => lines.filter((line) => /^(slug|name|status|active_plan|current_action|type|arcadia): /.test(line));
    expect(pointers(projectLines(newHead))).toEqual(pointers(projectLines(state.base)));
    if (n === 9) {
      expect(projectLines(newHead).filter((line) => /^(goal|outcome|milestone): /.test(line)).join("\n")).toContain("nine serial Actions");
      expect(chainCoherenceProblems(readCoherenceFiles(box.fixture), 9)).toEqual([]);
      expect(git(box.fixture, ["show", `${newHead}:${PLAN_FILE}`])).toContain("# Autonomous nine-Action rehearsal chain");
    }
    expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
    // The earlier candidates are untouched; f68ec48's stand-in is still on its branch.
    expect(git(box.fixture, ["rev-parse", `refs/heads/${A1_BRANCH}`])).toBe(state.a1Tip);
    expect(git(box.fixture, ["rev-parse", `refs/heads/${A2_BRANCH}`])).toBe(state.a2Tip);
    expect(git(box.fixture, ["reflog", "-1", "--format=%gs", "refs/heads/main@{1}"])).toContain("move local main back to GitHub main");
    expect(box.pushes()).toEqual(["git -C " + box.fixture + " push -q origin refs/heads/main:refs/heads/main"]);
    const { json } = box.receipt(box.ids.reset);
    expect(json).toMatchObject({
      outcome: "succeeded", chainRunId: runId, actionCount: n, newHead, remoteMainAfter: newHead, previousMain: state.base, startingHead: state.a1Tip, localMainBefore: state.a1Tip,
      genesis: state.genesis, githubRepository: REPO, fixtureCommitted: true, localMainMoved: true, githubRepositoryChanged: true, agentAskSettled: false,
      actionIds: chainActionIds(n), completionIds: chainActionIds(n).map((id) => completionRequestId(id, runId)),
      localMainMove: { from: state.a1Tip, to: state.base }
    });
    expect(json.localMainPreservedOn.map((c: { pullRequest: number }) => c.pullRequest)).toEqual([5, 6]);
    expect(json.candidatesAfter).toEqual(json.candidatesBefore);
    expect(json).toMatchObject({ projectChanged: n === 9, amendedProjectBlob: git(box.fixture, ["rev-parse", `${newHead}:PROJECT.md`]), amendedPlanBlob: git(box.fixture, ["rev-parse", `${newHead}:${PLAN_FILE}`]) });
    if (n === 9) {
      // The Project amendment was applied by the real docs sync, not skipped as older than the record.
      const sync = JSON.parse(readFileSync(path.join(box.receipt(box.ids.reset).dir, "docs-sync.json"), "utf8"));
      expect(sync.data.projects[0].changes.filter((c: { entity: string }) => c.entity === "project").map((c: { action: string }) => c.action)).toEqual(["update"]);
      expect(json.liveSyncProjectPreview.map((c: { action: string }) => c.action)).toEqual(["update"]);
    }
    expect(json.actions).toHaveLength(n);
    expect(json.actions.slice(0, 3).every((a: { inputRevisionBefore: string; inputRevisionAfter: string }) => a.inputRevisionBefore && a.inputRevisionBefore !== a.inputRevisionAfter)).toBe(true);
    expect(json.actions.slice(3).every((a: { inputRevisionBefore: string | null }) => a.inputRevisionBefore === null)).toBe(true);
    expect(json.liveSyncPreview.map((c: { action: string }) => c.action)).toEqual([...Array(3).fill("update"), ...Array(n - 3).fill("create")]);
    const plan = discoverDocs(box.fixture).docs.find((doc) => doc.type === "plan");
    expect(plan?.type === "plan" && plan.actions.map((a) => a.id)).toEqual(chainActionIds(n));
    // Once is enough.
    const again = box.run(box.ids.reset, resetEnv);
    expect(again.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json.reason).toContain("already succeeded");
    expect(box.pushes()).toHaveLength(1);
  });

  it("refuses, moving nothing, when the integrated local main is not on any earlier candidate", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box, { extraLocalCommit: true });
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "fixture_state", localMainMoved: false, fixtureCommitted: false });
    expect(box.receipt(box.ids.reset).json.reason).toContain("could lose work");
    unchanged(box, state.localMain);
    const dry = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain("DRY RUN: a real run would REFUSE");
    expect(dry.stdout).toContain("could lose work");
    unchanged(box, state.localMain);
  });

  it("refuses when the clone's local main is not the one the previous terminal Off recorded", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    const params = JSON.parse(JSON.stringify(state.params));
    params.previousRun.bindings.localMain = state.a2Tip;
    writeParams(box, RUN6, params);
    expect(box.run(box.ids.reset, resetEnv).status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "prior_evidence" });
    unchanged(box, state.a1Tip);
  });

  it("refuses a pending fixture proposal without settling it, and the dry run names it", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    runAgentAskPreviewCommand({ workspace: box.workspace, request: JSON.stringify({
      agent_ask: "v1", request_id: "complete-transform-start-marker-stale", project: "three-action-rehearsal", intent: "complete", target_ref: "action/transform-start-marker",
      candidate_revision: state.a2Tip, evidence: [{ criterion: "x", status: "met" }], desired_result: "Mark transform-start-marker complete."
    }) });
    const dry = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain("complete-transform-start-marker-stale");
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "proposal_gate", agentAskSettled: false });
    unchanged(box, state.a1Tip);
  });

  it("the coherence guard refuses, in the dry run and the real run alike, a base fixture statement the renderer does not know that states another Action count, naming file, line and text, before anything moves", { timeout: 300_000 }, () => {
    const box = sandbox(RUN7);
    const state = afterRun5(box, { actionCount: 9, runId: RUN7, projectText: (text) => text.replace("Disposable fixture for the installed three-Action autonomous rehearsal.", "This is the three-Action rehearsal, installed on the host.") });
    const text = "PROJECT.md:17: states 3 Actions but this run's chain has 9 (\"three-Action\"): This is the three-Action rehearsal, installed on the host.";
    const dry = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(dry.status, dry.stdout + dry.stderr).not.toBe(0);
    const jsonText = JSON.stringify(text).slice(1, -1);
    expect(dry.stdout + dry.stderr).toContain(jsonText);
    expect(dry.stdout + dry.stderr).toContain("fixture coherence");
    unchanged(box, state.a1Tip);
    const real = box.run(box.ids.reset, resetEnv);
    expect(real.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "validate_amendment", fixtureCommitted: false, localMainMoved: false, githubRepositoryChanged: false });
    expect(box.receipt(box.ids.reset).json.reason).toContain(jsonText);
    unchanged(box, state.a1Tip);
  });

  it("refuses a parameter file that is not committed (rendered but unreviewed), before reading anything else", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    writeParams(box, RUN6, { ...state.params, actionCount: 12 }, false);
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "parameters" });
    expect(box.receipt(box.ids.reset).json.reason).toContain("is not tracked and unmodified at the checkout's HEAD");
    expect(box.run(box.ids.reset, resetEnv, ["--dry-run"]).status).not.toBe(0);
    unchanged(box, state.a1Tip);
  });

  it("refuses unfilled previous-run bindings (run 7's file before run 6's receipts) before reading anything else", { timeout: 120_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, unfilledRun7());
    box.setReplies({ "probe": { passthrough: "probe" } });
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    const { json } = box.receipt(box.ids.reset);
    expect(json).toMatchObject({ outcome: "refused", stage: "parameters" });
    expect(json.reason).toContain("UNFILLED previous-run bindings");
    expect(box.keys()).toEqual(["probe params"]);
  });
});
