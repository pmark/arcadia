import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #719: the split settlement's cycle-safety check for rewiring an
 * existing dependent's `depends_on` was built from the Plan snapshot this
 * settlement's own initial read captured, not from the fresh content its own
 * compare-and-set write step re-reads immediately before writing. Between
 * those two reads, a concurrent settlement (a different process, racing
 * against this one) can change some other Action's `depends_on` such that a
 * fresh-only path closes a cycle the stale check never saw.
 *
 * This is exercised here by intercepting `node:fs`'s `readFileSync`: every
 * read of the Plan file that does NOT originate from
 * `writePointerPairWithCompareAndSet` (`src/dispatch/pointer.ts`) -- this
 * settlement's own preliminary `discoverDocs` passes and its direct
 * `planBefore` read, all of which run before any write -- returns the
 * ORIGINAL content, while the disk itself already carries a
 * concurrently-added edge. Only a read from inside that one function (the
 * compare-and-set write step, which re-reads the real file immediately
 * before writing) passes through to the real, already-edited disk file.
 * Routing on the call site rather than a fixed read count is deliberate: how
 * many times the Plan path is read before the write is an implementation
 * detail of `discoverDocs` and the settlement pipeline, not something this
 * test should have to keep in lockstep with. `vi.mock` intercepts every
 * import site in the module graph, which is what a genuine
 * concurrent-process race would look like from this settlement's point of
 * view: its own preview-time snapshot is stale, and only the write-time read
 * is fresh.
 */

const staleReadState = { path: null as string | null, staleContent: null as string | null, active: false };

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const [target] = args;
      // The instant any read happens from inside the compare-and-set write
      // step, staleness ends for good -- not just for this one read, but
      // for everything after it too, including this same settlement's own
      // post-write verification read. That mirrors reality: once the write
      // has (or is about to) happen, there is no more "before the write"
      // content to fake.
      if ((new Error().stack ?? "").includes("writePointerPairWithCompareAndSet")) {
        staleReadState.active = false;
      }
      if (
        staleReadState.active &&
        staleReadState.path !== null &&
        typeof target === "string" &&
        target === staleReadState.path
      ) {
        return staleReadState.staleContent as ReturnType<typeof actual.readFileSync>;
      }
      return actual.readFileSync(...args);
    }
  };
});

const { runAgentAskPreviewCommand, runAgentAskSettleCommand } = await import("../src/commands/agentAsk.js");
const { withDatabase } = await import("../src/db/connection.js");
const { discoverDocs } = await import("../src/docs/discover.js");
const { arrangeActionOrder } = await import("../src/dispatch/order.js");
const { upsertProject, upsertProjectMetadata } = await import("../src/db/repositories.js");
const { initWorkspace } = await import("../src/workspace/initWorkspace.js");
const fs = await import("node:fs");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  staleReadState.path = null;
  staleReadState.staleContent = null;
  staleReadState.active = false;
});

describe("Agent Ask split settlement under a concurrent dependency edit (Issue #719)", () => {
  it("uses the fresh Plan graph, not the stale preview-time snapshot, when deciding whether a remainder is safe to add to a dependent's depends_on", () => {
    const { workspace, repo, planPath } = fixture();

    // "third" depends on "first" (the Action being split) from the start.
    // The remainder this split creates will declare a direct dependency on
    // "second". Right now "second" has no dependencies at all, so nothing
    // about adding "third -> first-remainder" looks unsafe from either graph.
    const originalPlanContent = fs.readFileSync(planPath, "utf8");
    expect(originalPlanContent).not.toContain("depends_on: [third]");

    // Simulate a *different* settlement landing, between this settlement's
    // own preview-time reads and its write-time retry read, an edge that
    // only a fresh read would see: "second" now depends on "third". Combined
    // with the remainder's own declared dependency on "second", and "third"
    // gaining a dependency on the remainder (the ordinary split rewrite),
    // this closes third -> first-remainder -> second -> third.
    const concurrentlyEditedPlanContent = originalPlanContent.replace(
      '    depends_on: []\n    decisions: []\n    references: []\n  - id: third',
      '    depends_on: [third]\n    decisions: []\n    references: []\n  - id: third'
    );
    expect(concurrentlyEditedPlanContent).not.toBe(originalPlanContent);
    expect(concurrentlyEditedPlanContent).toContain("depends_on: [third]");
    fs.writeFileSync(planPath, concurrentlyEditedPlanContent, "utf8");
    // A real concurrent settlement commits its change (Working-Copy Safety);
    // an uncommitted edit would just make this settlement refuse outright on
    // its own clean-repository check, before ever reaching the code under test.
    execFileSync("git", ["add", "docs/plans/demo-plan.md"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Simulate a concurrent settlement's dependency edit"], { cwd: repo });
    // The split Ask's own candidate_revision is checked against the repo's
    // actual current HEAD at settlement time, so it must be the HEAD left by
    // the simulated concurrent commit above, not the fixture's original one.
    const headAfterConcurrentEdit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    // Getting from an accepted proposal to a written Plan takes two settle
    // calls -- an unapplied "preview" call (which computes the fingerprint
    // this test's later apply call must match) and the applying call itself.
    // Every read of the Plan path from either call, up to and including the
    // applying call's own `discoverDocs` pass and direct `planBefore` read,
    // stays diverted to the pre-edit content, so both calls' fingerprint
    // computations agree exactly as they would with no race at all. Only
    // the applying call's compare-and-set write step -- which re-reads the
    // Plan immediately before it writes -- sees the real, already-edited
    // disk file, standing in for the instant the concurrent settlement's
    // write actually lands.
    staleReadState.path = planPath;
    staleReadState.staleContent = originalPlanContent;
    staleReadState.active = true;

    const request = splitAsk("split-concurrent-cycle", headAfterConcurrentEdit)
      .replace('    acceptance:\n      - "Second slice done."', '    acceptance:\n      - "Second slice done."\n    dependencies:\n      - second');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-concurrent-cycle", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-concurrent-cycle", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);

    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    // The fresh graph (which sees "second -> third", added concurrently)
    // shows the remainder already reaches "third" through "second" -- so
    // adding "third -> first-remainder" would close a cycle. A fix that
    // used the stale preview-time graph instead would have added it anyway,
    // since the preview-time graph never saw "second -> third".
    expect(plan).toMatchObject({
      actions: expect.arrayContaining([
        expect.objectContaining({ id: "third", dependsOn: ["first"] })
      ])
    });
    // The written Plan must still parse with no dependency cycle.
    expect(() => discoverDocs(repo)).not.toThrow();
  });

  it("chooses the next_action pointer from the fresh Plan the retry read, not the stale preview-time snapshot (Issue #722)", () => {
    const { workspace, repo, planPath } = fixture();
    const originalPlanContent = fs.readFileSync(planPath, "utf8");
    // The remainder depends on "second". At preview time "second" is open, so
    // the remainder is blocked and the pointer lands on "second". A concurrent
    // settlement then finishes "second"; the fresh read must move the pointer
    // onto the now-unblocked remainder instead.
    const concurrentlyEditedPlanContent = originalPlanContent.replace(
      "  - id: second\n    title: Second Action\n    status: open",
      "  - id: second\n    title: Second Action\n    status: done"
    );
    expect(concurrentlyEditedPlanContent).not.toBe(originalPlanContent);
    fs.writeFileSync(planPath, concurrentlyEditedPlanContent, "utf8");
    execFileSync("git", ["add", "docs/plans/demo-plan.md"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Simulate a concurrent settlement finishing second"], { cwd: repo });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    staleReadState.path = planPath;
    staleReadState.staleContent = originalPlanContent;
    staleReadState.active = true;

    const request = splitAsk("split-concurrent-pointer", head)
      .replace('    acceptance:\n      - "Second slice done."', '    acceptance:\n      - "Second slice done."\n    dependencies:\n      - second');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-concurrent-pointer", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-concurrent-pointer", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);

    const project = fs.readFileSync(path.join(repo, "PROJECT.md"), "utf8");
    const plan = fs.readFileSync(planPath, "utf8");
    expect(project).toMatch(/^current_action: first-remainder$/m);
    expect(plan).toMatch(/^current_action: first-remainder$/m);
  });
});

function fixture(): { workspace: string; repo: string; head: string; planPath: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-split-concurrency-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
  writeFileSync(path.join(repo, ".arcadia/asks/archive/.gitkeep"), "", "utf8");
  writeFileSync(path.join(repo, "PROJECT.md"), [
    "---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "mission: Test Agent Ask split.", "goal: Split work safely.", "active_plan: demo-plan",
    "current_action: first", "updated: 2026-09-01", "---", "", "# Demo", ""
  ].join("\n"), "utf8");
  const planPath = path.join(repo, "docs/plans/demo-plan.md");
  writeFileSync(planPath, [
    "---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Split work", "current_action: first", "token_impact: medium",
    "token_budget: Deterministic split with one accepted evidence pass.",
    "recommended_model: gpt-5.6-sol", "updated: 2026-09-01", "actions:",
    "  - id: first", "    title: First Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the first Action.",
    "    expected_artifact: First proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - First slice done.", "      - Second slice done.",
    "    depends_on: []", "    decisions: []", "    references: []",
    "  - id: second", "    title: Second Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the second Action.",
    "    expected_artifact: Second proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Second proof exists.",
    "    depends_on: []",
    "    decisions: []", "    references: []",
    "  - id: third", "    title: Third Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the third Action.",
    "    expected_artifact: Third proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Third proof exists.", "    depends_on: [first]", "    decisions: []", "    references: []",
    "questions: []", "---", "", "# Demo plan", ""
  ].join("\n"), "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "ask-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Ask Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add Ask fixture"], { cwd: repo });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Test Agent Ask split.", goal: "Split work safely.",
      status: "active", currentMilestone: "Split work", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: ["demo/first", "demo/second", "demo/third"],
      order: ["demo/first", "demo/second", "demo/third"],
      requestId: "fixture-order",
      apply: true
    });
  });
  return { workspace, repo, head, planPath };
}

function splitAsk(requestId: string, candidateRevision: string): string {
  return [
    "agent_ask: v1", `request_id: ${requestId}`, "project: demo", "intent: split",
    "target_ref: action/first", "desired_result: Finish the first slice of the first Action",
    "rationale: The session could only finish half of the declared criteria.",
    `candidate_revision: ${candidateRevision}`,
    "acceptance:", '  - "First slice done."',
    "evidence:", '  - criterion: "First slice done."', "    status: met",
    "actions:",
    "  - id: first-remainder",
    '    desired_result: "Finish the second slice of the first Action"',
    "    acceptance:",
    '      - "Second slice done."'
  ].join("\n");
}
