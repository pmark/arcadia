import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderAgentAskSettleSuccess, runAgentAskContractCommand, runAgentAskDraftCommand, runAgentAskNotificationsCommand,
  runAgentAskPreviewCommand, runAgentAskSettleCommand
} from "../src/commands/agentAsk.js";
import { agentAskSettlementMessage } from "../apps/discord-bot/src/notifications/poller.js";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import type { PlanDoc } from "../src/docs/types.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import {
  canonicalPath,
  getActiveActionClaim,
  getActiveWorktreeReservation,
  reserveAgentWorktree
} from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Agent Ask complete", () => {
  it("lists complete in the published contract", () => {
    expect(runAgentAskContractCommand().data.intents).toContain("complete");
  });

  it("marks an Action done, advances the pointer to the next eligible Action, and appends a Log entry", () => {
    const { workspace, repo, head } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-first", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-first", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-first", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).toContain("Marked Action demo/first done");
    expect(applied.data.receipt.effects.join(" ")).toContain("Pointer: demo/second.");

    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({
      currentAction: "second",
      actions: [
        // The completed Action's own next_action no longer reads as a live
        // instruction; it names the Agent Ask that settled the completion
        // (the Ask's own request_id, "complete-first" — not the settlement's
        // separate --request-id "settle-complete-first").
        expect.objectContaining({ id: "first", status: "done", nextAction: "Completed via Agent Ask complete-first; no further action." }),
        // The still-open pending Action keeps its own instruction untouched.
        expect.objectContaining({ id: "second", status: "open", nextAction: "Finish the second Action." })
      ]
    });
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ currentAction: "second" });
    const log = readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8");
    expect(log).toContain("Completed demo/first");
    expect(log).toContain(head);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");

    const replay = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-first", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(replay.data.receipt).toEqual(applied.data.receipt);
    // The replay is a no-op read of the already-settled receipt, not a second
    // rewrite: the done Action's next_action is still the single unambiguous
    // completed form, not doubled or re-dated.
    const replayedPlan = discoverDocs(repo).docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.slug === "demo-plan")!;
    expect(replayedPlan.actions.find((action) => action.id === "first")).toMatchObject({
      nextAction: "Completed via Agent Ask complete-first; no further action."
    });
  });

  it("rewrites a block-scalar next_action cleanly, without leaving orphaned continuation lines behind (parse.ts accepts | and > forms)", () => {
    const { workspace, repo } = fixture();
    const planPath = path.join(repo, "docs/plans/demo-plan.md");
    // Replace the plain single-line next_action with a YAML literal block
    // scalar spanning several deeper-indented lines, the same shape a real
    // multi-line instruction could take.
    const blockScalarPlan = readFileSync(planPath, "utf8").replace(
      "    next_action: Finish the first Action.",
      "    next_action: |\n      Finish the first Action.\n      Bring supporting evidence."
    );
    writeFileSync(planPath, blockScalarPlan, "utf8");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Rewrite first Action's next_action as a block scalar"], { cwd: repo });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-block-scalar", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-block-scalar", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-block-scalar", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);

    const rewritten = readFileSync(planPath, "utf8");
    // The field is a single clean plain-scalar line; none of the old block
    // scalar's continuation lines survive to fold into it or dangle after it.
    expect(rewritten).toContain("    next_action: Completed via Agent Ask complete-block-scalar; no further action.\n");
    expect(rewritten).not.toContain("Bring supporting evidence");
    expect(rewritten).not.toContain("next_action: |");

    const plan = discoverDocs(repo).docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.slug === "demo-plan")!;
    expect(plan.actions.find((action) => action.id === "first")).toMatchObject({
      status: "done", nextAction: "Completed via Agent Ask complete-block-scalar; no further action."
    });
    // Every other field and Action in the document survives untouched.
    expect(plan.actions.find((action) => action.id === "second")).toMatchObject({ status: "open", nextAction: "Finish the second Action." });
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
  });

  it("names the completion request id literally even when it contains String.replace metacharacters ($&)", () => {
    // request_id is normalized by `requiredText` only (agentAsk.ts): any
    // non-empty trimmed string is legal, including `$&`/`$1`/etc. A string
    // passed as the second argument to String.replace expands those as
    // match-reference patterns; only a replacer callback keeps it literal.
    const { workspace, repo, head } = fixture();
    const requestId = "complete-first-$&-end";
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk(requestId, "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-dollar-amp", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-dollar-amp", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);

    const plan = discoverDocs(repo).docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.slug === "demo-plan")!;
    expect(plan.actions.find((action) => action.id === "first")).toMatchObject({
      status: "done",
      nextAction: "Completed via Agent Ask complete-first-$&-end; no further action."
    });
    // The pending Action's own instruction is untouched by the literal rewrite.
    expect(plan.actions.find((action) => action.id === "second")).toMatchObject({ status: "open", nextAction: "Finish the second Action." });
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
  });

  it("settles a completion notification naming a short summary and the next scheduled Actions", () => {
    const { workspace, head } = fixture({ withThird: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-notify", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-notify", disposition: "accepted"
    });
    runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-notify", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });

    const notifications = runAgentAskNotificationsCommand({ workspace }).data.notifications;
    expect(notifications).toHaveLength(1);
    // Completing "first" leaves "second" (the new pointer) and "third" ready.
    expect(notifications[0].nextActions).toEqual([
      { key: "demo/second", title: "Second Action" },
      { key: "demo/third", title: "Third Action" }
    ]);

    const message = agentAskSettlementMessage(notifications[0]);
    expect(message).toContain("Action complete — demo");
    expect(message).toContain("Marked Action demo/first done with accepted evidence for all 1 criteria.");
    expect(message).toContain("Next up (2):");
    expect(message).toContain("1. demo/second — Second Action");
    expect(message).toContain("2. demo/third — Third Action");
    // The generic effects dump and single-Next line are gone from this format.
    expect(message).not.toContain("Agent Ask settled:");
    expect(message).not.toContain("Queue: no executable Action created");

    // An absent `nextActions` (an older CLI response that predates the field)
    // must read as "unknown", never as a false "nothing is ready".
    const { nextActions: _omitted, ...withoutNextActions } = notifications[0];
    expect(agentAskSettlementMessage(withoutNextActions)).toContain("Next up: queue preview unavailable.");
  });

  it("follows the explicit queue order, not document order, when advancing the pointer", () => {
    const { workspace, repo, head } = fixture({ withThird: true, queueOrder: ["demo/first", "demo/third", "demo/second"] });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-queue-order", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-queue-order", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-queue-order", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.effects.join(" ")).toContain("explicit queue order");
    expect(applied.data.receipt.effects.join(" ")).toContain("Pointer: demo/third.");
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ currentAction: "third" });
  });

  it("skips an Action an approved Decision deferred, even before its Plan record says so (Issue #310)", () => {
    const { workspace, repo, head } = fixture({ withThird: true, secondDeferredByDecision: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-skip-deferred", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-skip-deferred", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-skip-deferred", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.effects.join(" ")).toContain("Pointer: demo/third.");
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    // The deferred Action is untouched — the Decision is what parks it.
    expect(plan).toMatchObject({
      currentAction: "third",
      actions: [
        expect.objectContaining({ id: "first", status: "done" }),
        expect.objectContaining({ id: "second", status: "open" }),
        expect.objectContaining({ id: "third", status: "open" })
      ]
    });
  });

  it("marks the Plan complete when the finished Action was the last one open", () => {
    const { workspace, repo, head } = fixture({ secondDone: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-last", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-last", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-last", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.effects.join(" ")).toContain("Plan demo-plan is complete");
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({ status: "complete", currentAction: null });
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ currentAction: null });
  });

  it("activates the Plan whose earliest eligible Action is highest in the explicit queue when the active Plan completes", () => {
    const { workspace, repo, head } = fixture({ secondDone: true, withActiveSidePlan: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-cross-plan", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-cross-plan", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-cross-plan", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.effects.join(" ")).toContain("activated Plan side-plan");
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ activePlan: "side-plan", currentAction: "side-one" });
    const sidePlan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "side-plan");
    expect(sidePlan).toMatchObject({ status: "active", currentAction: "side-one" });
    const demoPlan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(demoPlan).toMatchObject({ status: "complete", currentAction: null });
  });

  it("settles deterministic completion evidence without an operator flag", () => {
    const { workspace, repo, head } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-no-operator", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-no-operator", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-no-operator", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.authority.kind).toBe("deterministic_proof");
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("status: done");
  });

  it("refuses completion evidence that does not mark every criterion met", () => {
    const { workspace, head } = fixture();
    const request = completeAsk("complete-unmet", "first", head).replace("status: met", "status: failed");
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-unmet", disposition: "accepted"
    })).toThrow(/not every acceptance criterion is met/);
  });

  it("refuses evidence that skips a declared criterion", () => {
    const { workspace, head } = fixture();
    const request = completeAsk("complete-skip", "first", head).replace("status: met", "status: skipped");
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-skip", disposition: "accepted"
    })).toThrow(/not every acceptance criterion is met/);
  });

  it("refuses evidence that does not cover every declared criterion verbatim", () => {
    const { workspace, head } = fixture();
    const request = completeAsk("complete-partial", "first", head).replace('criterion: "First proof exists."', 'criterion: "Some other claim."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-partial", disposition: "accepted"
    })).toThrow(/must cover every declared acceptance criterion/);
  });

  it("refuses completion while a required review Decision is unresolved", () => {
    const { workspace, repo, head } = fixture({ withOpenDecision: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-review", "first", head) });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-review", disposition: "accepted"
    })).toThrow(/unresolved required review Decisions/);
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("status: open");
  });

  it("refuses a stale Candidate revision", () => {
    const { workspace, head } = fixture();
    const request = completeAsk("complete-stale", "first", head).replace(head, "abadc0de".repeat(5));
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-stale", disposition: "accepted"
    })).toThrow(new RegExp(`does not match .*HEAD ${head}`));
  });

  it("refuses completion when the declared expected Artifact was not produced", () => {
    const { workspace, repo, head } = fixture({ expectedArtifactPath: "docs/contract.md", writeExpectedArtifact: false });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-missing-artifact", "first", head) });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-missing-artifact", disposition: "accepted"
    })).toThrow(/declared expected Artifact was not produced/);
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("status: open");
  });

  it("accepts completion when the declared expected Artifact (a real path) exists", () => {
    const { workspace, repo, head } = fixture({ expectedArtifactPath: "docs/contract.md", writeExpectedArtifact: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-present-artifact", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-present-artifact", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-present-artifact", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
    expect(applied.data.receipt.applied).toBe(true);
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("status: done");
  });

  it("does not refuse completion when the declared expected Artifact is prose, not a path", () => {
    // The default fixture's `expected_artifact: First proof` has a space, so it
    // never resolves to a filesystem path and is never checked for existence.
    const { workspace, head } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-prose-artifact", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-prose-artifact", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-prose-artifact", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
    expect(applied.data.receipt.applied).toBe(true);
  });

  it("settles a complete Ask from its own drafted file inside a candidate worktree, with no manual relocation and no commit rewrite", () => {
    const { workspace, repo, head } = fixture();
    const candidate = path.join(path.dirname(repo), "candidate-complete");
    execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-complete", candidate], { cwd: repo });

    // Mirrors the real flow: `arcadia agent-ask draft` writes the Ask file
    // straight into the candidate worktree's own `.arcadia/asks/`, untracked.
    const draft = runAgentAskDraftCommand({
      workspace, dir: candidate, request: completeAsk("complete-from-candidate", "first", head)
    });
    expect(draft.data.written).toBe("created");
    expect(draft.data.path).toBe(path.join(candidate, ".arcadia", "asks", "agent-ask-complete-from-candidate.yaml"));
    expect(draft.data.preview).not.toBeNull();
    // The drafted file itself is the only untracked change; settling it later
    // must not require moving it out of the repo or committing it first.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: candidate, encoding: "utf8" }).trim())
      .toBe("?? .arcadia/asks/agent-ask-complete-from-candidate.yaml");

    // A second draft is legitimate pending intake, not unrelated working-tree
    // dirt. The current settlement must archive only its own source and leave
    // this future Ask available.
    const pendingAsk = path.join(candidate, ".arcadia", "asks", "agent-ask-pending-follow-up.yaml");
    writeFileSync(pendingAsk, JSON.stringify({
      agent_ask: "v1", request_id: "pending-follow-up", project: "demo", intent: "log",
      desired_result: "Record a later follow-up."
    }), "utf8");

    const preview = runAgentAskSettleCommand({
      workspace, proposal: draft.data.preview!.proposal.id, requestId: "settle-complete-from-candidate",
      disposition: "accepted", cwd: candidate
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: draft.data.preview!.proposal.id, requestId: "settle-complete-from-candidate",
      disposition: "accepted", preview: preview.data.receipt.previewFingerprint, apply: true, operator: true, cwd: candidate
    });

    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).toContain("Marked Action demo/first done");
    expect(applied.data.receipt.effects.join(" ")).toContain("Archived the settled Ask file");

    // The candidate branch carries exactly one new commit; the base checkout
    // this settlement never touched is untouched and still at the original head.
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim()).toBe(head);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: candidate, encoding: "utf8" }).trim())
      .toBe("?? .arcadia/asks/agent-ask-pending-follow-up.yaml");
    expect(execFileSync("git", ["rev-list", "--count", `${head}..HEAD`], { cwd: candidate, encoding: "utf8" }).trim()).toBe("1");
    expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: candidate, encoding: "utf8" }))
      .toContain("settle complete-from-candidate");
    expect(existsSync(draft.data.path)).toBe(false);
    expect(existsSync(path.join(candidate, ".arcadia/asks/archive/agent-ask-complete-from-candidate.yaml"))).toBe(true);
  });

  it("finds the candidate worktree from the invoking directory when no cwd is passed, as the real CLI runs", () => {
    // The launcher cds into Arcadia's checkout, so process.cwd() never names the
    // candidate. Passing `cwd` (as the test above does) hid that: the CLI never
    // does. Settlement then compared the Ask against the base checkout's HEAD.
    const { workspace, repo, head } = fixture();
    const candidate = path.join(path.dirname(repo), "candidate-invoked-from");
    execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-invoked-from", candidate], { cwd: repo });
    const draft = runAgentAskDraftCommand({ workspace, dir: candidate, request: completeAsk("complete-invoked-from", "first", head) });
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "candidate work"], { cwd: candidate });
    const candidateHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: candidate, encoding: "utf8" }).trim();
    const moved = runAgentAskDraftCommand({
      workspace, dir: candidate, request: completeAsk("complete-invoked-from-2", "first", candidateHead)
    });
    const previousInvokedFrom = process.env.ARCADIA_INVOKED_FROM;
    process.env.ARCADIA_INVOKED_FROM = candidate;
    try {
      const preview = runAgentAskSettleCommand({
        workspace, proposal: moved.data.preview!.proposal.id, requestId: "settle-invoked-from", disposition: "accepted"
      });
      const applied = runAgentAskSettleCommand({
        workspace, proposal: moved.data.preview!.proposal.id, requestId: "settle-invoked-from", disposition: "accepted",
        preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
      });
      expect(applied.data.receipt.applied).toBe(true);
    } finally {
      if (previousInvokedFrom === undefined) delete process.env.ARCADIA_INVOKED_FROM;
      else process.env.ARCADIA_INVOKED_FROM = previousInvokedFrom;
    }
    expect(draft.data.written).toBe("created");
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim()).toBe(head);
    expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: candidate, encoding: "utf8" })).toContain("settle complete-invoked-from-2");
  });

  it("still refuses a stale Candidate revision when the drafted Ask file sits in the candidate worktree", () => {
    const { workspace, repo, head } = fixture();
    const candidate = path.join(path.dirname(repo), "candidate-complete-stale");
    execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-complete-stale", candidate], { cwd: repo });
    // Drafted while it was still applicable; the candidate moves on afterwards.
    const draft = runAgentAskDraftCommand({
      workspace, dir: candidate, request: completeAsk("complete-from-candidate-stale", "first", head)
    });
    writeFileSync(path.join(candidate, "README.md"), "advance the candidate past the recorded revision\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: candidate });
    execFileSync("git", ["commit", "-qm", "Advance candidate"], { cwd: candidate });
    const advancedCandidateHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: candidate, encoding: "utf8" }).trim();

    expect(() => runAgentAskSettleCommand({
      workspace, proposal: draft.data.preview!.proposal.id, requestId: "settle-complete-from-candidate-stale",
      disposition: "accepted", cwd: candidate
    })).toThrow(new RegExp(`Candidate revision ${head} does not match .*current HEAD ${advancedCandidateHead}`));
    // Refused before any write: the drafted file is still exactly where draft left it.
    expect(existsSync(draft.data.path)).toBe(true);
  });

  it("refuses to draft a complete Ask whose candidate_revision is not the checkout's HEAD, writing nothing (Issue #304)", () => {
    const { workspace, repo, head } = fixture();
    const candidate = path.join(path.dirname(repo), "candidate-draft-guard");
    execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-draft-guard", candidate], { cwd: repo });
    writeFileSync(path.join(candidate, "README.md"), "candidate work\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: candidate });
    execFileSync("git", ["commit", "-qm", "Candidate work"], { cwd: candidate });
    const candidateHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: candidate, encoding: "utf8" }).trim();

    // A revision the checkout has already moved past can never be applied.
    expect(() => runAgentAskDraftCommand({
      workspace, dir: candidate, request: completeAsk("complete-draft-stale", "first", head)
    })).toThrow(new RegExp(`candidate_revision ${head}.*HEAD ${candidateHead}; settlement could never apply it`));
    expect(existsSync(path.join(candidate, ".arcadia", "asks", "agent-ask-complete-draft-stale.yaml"))).toBe(false);

    // The trap the Issue names: drafting correctly, then committing the draft,
    // moves HEAD past the recorded revision. Re-drafting it now refuses rather
    // than handing over an Ask that fails only at apply time.
    const drafted = runAgentAskDraftCommand({
      workspace: path.join(path.dirname(repo), "no-workspace-here"), dir: candidate,
      request: completeAsk("complete-draft-committed", "first", candidateHead)
    });
    execFileSync("git", ["add", drafted.data.path], { cwd: candidate });
    execFileSync("git", ["commit", "-qm", "Commit the drafted Ask"], { cwd: candidate });
    expect(() => runAgentAskDraftCommand({
      workspace, dir: candidate, request: completeAsk("complete-draft-committed", "first", candidateHead)
    })).toThrow(/settlement could never apply it/);

    // An abbreviated sha of HEAD is exactly as applicable as the full one.
    const abbreviated = runAgentAskDraftCommand({
      workspace: path.join(path.dirname(repo), "no-workspace-here"), dir: repo,
      request: completeAsk("complete-draft-abbreviated", "first", JSON.stringify(head.slice(0, 12)))
    });
    expect(abbreviated.data.written).toBe("created");
  });

  it("archives a complete Ask with the Candidate revision the Mission Log records, not the draft's spelling or the settle commit (Issue #321)", () => {
    const { workspace, repo, head } = fixture();
    const candidate = path.join(path.dirname(repo), "candidate-archive-revision");
    execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-archive-revision", candidate], { cwd: repo });
    const draft = runAgentAskDraftCommand({
      workspace, dir: candidate, request: completeAsk("complete-archive-revision", "first", JSON.stringify(head.slice(0, 10)))
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: draft.data.preview!.proposal.id, requestId: "settle-archive-revision", disposition: "accepted", cwd: candidate
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: draft.data.preview!.proposal.id, requestId: "settle-archive-revision", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, cwd: candidate
    });
    const settleCommit = applied.data.receipt.documentsCommit;
    expect(settleCommit).toBeTruthy();
    expect(settleCommit).not.toBe(head);

    const archived = readFileSync(path.join(candidate, ".arcadia/asks/archive/agent-ask-complete-archive-revision.yaml"), "utf8");
    expect(archived).toMatch(new RegExp(`^candidate_revision: ${head}$`, "m"));
    expect(archived).not.toContain(settleCommit!);
    const log = readFileSync(path.join(candidate, "MISSION_LOG.md"), "utf8");
    expect(log).toContain(`(Candidate ${head})`);
    // The archive is part of the settlement commit, so what a reader finds on
    // the branch agrees with the Log.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: candidate, encoding: "utf8" })).toBe("");
  });

  describe("canonical draft fallback when no sourcePath was recorded (Issue #981)", () => {
    function settleInCandidate(workspace: string, candidate: string, proposalId: string, requestId: string) {
      const preview = runAgentAskSettleCommand({ workspace, proposal: proposalId, requestId, disposition: "accepted", cwd: candidate });
      const applied = runAgentAskSettleCommand({
        workspace, proposal: proposalId, requestId, disposition: "accepted",
        preview: preview.data.receipt.previewFingerprint, apply: true, cwd: candidate
      });
      return { preview, applied };
    }

    it("archives the untracked canonical draft into the settlement commit and leaves git status clean (the run-4 shape)", () => {
      const { workspace, repo, head } = fixture();
      const candidate = path.join(path.dirname(repo), "candidate-run4-shape");
      execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-run4-shape", candidate], { cwd: repo });
      // Previewed from inline text, so the proposal records no sourcePath...
      const ask = completeAsk("complete-run4-shape", "first", head);
      const proposal = runAgentAskPreviewCommand({ workspace, request: ask });
      expect(proposal.data.proposal.sourcePath).toBeNull();
      // ...while the same Ask also sits, untracked, at its canonical draft path
      // in the candidate worktree, exactly as `agent-ask draft` writes it.
      const canonical = path.join(candidate, ".arcadia", "asks", "agent-ask-complete-run4-shape.yaml");
      mkdirSync(path.dirname(canonical), { recursive: true });
      writeFileSync(canonical, `${ask.trim()}\n`, "utf8");

      const { preview, applied } = settleInCandidate(workspace, candidate, proposal.data.proposal.id, "settle-complete-run4-shape");
      expect(preview.data.receipt.effects).toContain("Archived the settled Ask file to .arcadia/asks/archive/agent-ask-complete-run4-shape.yaml.");
      expect(applied.data.receipt.applied).toBe(true);
      expect(applied.data.receipt.warnings).toBeUndefined();
      expect(existsSync(canonical)).toBe(false);
      const archived = readFileSync(path.join(candidate, ".arcadia/asks/archive/agent-ask-complete-run4-shape.yaml"), "utf8");
      expect(archived).toMatch(new RegExp(`^candidate_revision: ${head}$`, "m"));
      // The archive is in the settlement commit itself: HEAD is that commit and nothing is left over.
      expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: candidate, encoding: "utf8" }).trim()).toBe(applied.data.receipt.documentsCommit);
      expect(execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: candidate, encoding: "utf8" }))
        .toContain(".arcadia/asks/archive/agent-ask-complete-run4-shape.yaml");
      expect(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: candidate, encoding: "utf8" })).toBe("");
    });

    it("matches a drafted file whose bytes differ from the inline preview only by surrounding whitespace", () => {
      const { workspace, repo, head } = fixture();
      const candidate = path.join(path.dirname(repo), "candidate-run4-json");
      execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-run4-json", candidate], { cwd: repo });
      const ask = JSON.stringify({
        agent_ask: "v1", request_id: "complete-run4-json", project: "demo", intent: "complete", target_ref: "action/first",
        desired_result: "Accept the completion evidence for the first Action", candidate_revision: head,
        evidence: [{ criterion: "First proof exists.", status: "met", note: "Verified." }], requested_authority: "apply_if_approved"
      });
      const proposal = runAgentAskPreviewCommand({ workspace, request: ask });
      const canonical = path.join(candidate, ".arcadia", "asks", "agent-ask-complete-run4-json.yaml");
      mkdirSync(path.dirname(canonical), { recursive: true });
      writeFileSync(canonical, `${ask}\n`, "utf8");
      const { applied } = settleInCandidate(workspace, candidate, proposal.data.proposal.id, "settle-complete-run4-json");
      expect(existsSync(canonical)).toBe(false);
      expect(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: candidate, encoding: "utf8" })).toBe("");
      expect(applied.data.receipt.effects.join(" ")).toContain("Archived the settled Ask file");
    });

    it("never archives a canonical file whose content is not this Ask, and reports it as a warning", () => {
      const { workspace, repo, head } = fixture();
      const candidate = path.join(path.dirname(repo), "candidate-run4-mismatch");
      execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-run4-mismatch", candidate], { cwd: repo });
      const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-run4-mismatch", "first", head) });
      const canonical = path.join(candidate, ".arcadia", "asks", "agent-ask-complete-run4-mismatch.yaml");
      mkdirSync(path.dirname(canonical), { recursive: true });
      // Same request id, different content: a different Ask under the same name.
      const different = completeAsk("complete-run4-mismatch", "first", head).replace("Verified by the operator.", "Edited after preview.");
      writeFileSync(canonical, different, "utf8");

      const { preview, applied } = settleInCandidate(workspace, candidate, proposal.data.proposal.id, "settle-complete-run4-mismatch");
      expect(applied.data.receipt.applied).toBe(true);
      expect(applied.data.receipt.effects.some((effect) => effect.includes("Archived"))).toBe(false);
      expect(applied.data.receipt.warnings).toEqual([expect.stringContaining(
        "Left .arcadia/asks/agent-ask-complete-run4-mismatch.yaml in place: its content does not match settled proposal complete-run4-mismatch")]);
      const rendered = renderAgentAskSettleSuccess(preview);
      expect(rendered.join("\n")).toContain("Warning: Left .arcadia/asks/agent-ask-complete-run4-mismatch.yaml in place");
      expect(rendered.some((line) => line.startsWith("Queue: "))).toBe(true);
      expect(readFileSync(canonical, "utf8")).toBe(different);
      expect(existsSync(path.join(candidate, ".arcadia/asks/archive/agent-ask-complete-run4-mismatch.yaml"))).toBe(false);
    });

    it("never archives a symlink at the canonical path, even when it points at a matching Ask", () => {
      const { workspace, repo, head } = fixture();
      const candidate = path.join(path.dirname(repo), "candidate-run4-symlink");
      execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-run4-symlink", candidate], { cwd: repo });
      const ask = completeAsk("complete-run4-symlink", "first", head);
      const proposal = runAgentAskPreviewCommand({ workspace, request: ask });
      const outside = path.join(path.dirname(repo), "outside-run4-symlink.yaml");
      writeFileSync(outside, ask, "utf8");
      const canonical = path.join(candidate, ".arcadia", "asks", "agent-ask-complete-run4-symlink.yaml");
      mkdirSync(path.dirname(canonical), { recursive: true });
      symlinkSync(outside, canonical);

      // The preview decides the archive and proposes none; apply then refuses
      // the tree as dirty (a symlink is not an exempt draft) before writing.
      const preview = runAgentAskSettleCommand({
        workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-run4-symlink", disposition: "accepted", cwd: candidate
      });
      expect(preview.data.receipt.effects.some((effect) => effect.includes("Archived"))).toBe(false);
      expect(preview.data.receipt.review?.documents.some((document) => document.path.includes(".arcadia/asks"))).toBe(false);
      expect(preview.data.receipt.warnings).toEqual([expect.stringContaining("is not a regular file")]);
      expect(() => runAgentAskSettleCommand({
        workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-run4-symlink", disposition: "accepted",
        preview: preview.data.receipt.previewFingerprint, apply: true, cwd: candidate
      })).toThrow(/not clean/);
      expect(lstatSync(canonical).isSymbolicLink()).toBe(true);
      expect(readFileSync(outside, "utf8")).toBe(ask);
    });

    it("never follows a symlinked .arcadia/asks directory out of the settling repository", () => {
      const { workspace, repo, head } = fixture();
      const candidate = path.join(path.dirname(repo), "candidate-run4-dir-symlink");
      execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-run4-dir-symlink", candidate], { cwd: repo });
      const ask = completeAsk("complete-run4-dir-symlink", "first", head);
      const proposal = runAgentAskPreviewCommand({ workspace, request: ask });
      const elsewhere = path.join(path.dirname(repo), "elsewhere-asks");
      mkdirSync(elsewhere, { recursive: true });
      writeFileSync(path.join(elsewhere, "agent-ask-complete-run4-dir-symlink.yaml"), ask, "utf8");
      rmSync(path.join(candidate, ".arcadia", "asks"), { recursive: true, force: true });
      symlinkSync(elsewhere, path.join(candidate, ".arcadia", "asks"));

      // The settlement preview is where the archive is decided: it must not
      // propose moving a file reached through a symlinked directory. (Apply
      // would also refuse this tree as dirty before writing anything.)
      const preview = runAgentAskSettleCommand({
        workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-run4-dir-symlink", disposition: "accepted", cwd: candidate
      });
      expect(preview.data.receipt.effects.some((effect) => effect.includes("Archived"))).toBe(false);
      expect(preview.data.receipt.review?.documents.some((document) => document.path.includes(".arcadia/asks"))).toBe(false);
      expect(preview.data.receipt.warnings).toEqual([expect.stringContaining("resolves outside this repository's own .arcadia/asks/")]);
      expect(() => runAgentAskSettleCommand({
        workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-run4-dir-symlink", disposition: "accepted",
        preview: preview.data.receipt.previewFingerprint, apply: true, cwd: candidate
      })).toThrow(/not clean/);
      expect(readFileSync(path.join(elsewhere, "agent-ask-complete-run4-dir-symlink.yaml"), "utf8")).toBe(ask);
      expect(existsSync(path.join(elsewhere, "archive"))).toBe(false);
    });

    it("also archives an identical canonical copy when the recorded sourcePath was a differently named file", () => {
      const { workspace, repo, head } = fixture();
      const candidate = path.join(path.dirname(repo), "candidate-run4-two-copies");
      execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-run4-two-copies", candidate], { cwd: repo });
      const ask = `${completeAsk("complete-run4-two-copies", "first", head).trim()}\n`;
      const asksDir = path.join(candidate, ".arcadia", "asks");
      mkdirSync(asksDir, { recursive: true });
      const custom = path.join(asksDir, "agent-ask-custom-name.yaml");
      writeFileSync(custom, ask, "utf8");
      const proposal = runAgentAskPreviewCommand({ workspace, file: custom, dir: candidate });
      expect(proposal.data.proposal.sourcePath).toBe(custom);
      const canonical = path.join(asksDir, "agent-ask-complete-run4-two-copies.yaml");
      writeFileSync(canonical, ask, "utf8");
      settleInCandidate(workspace, candidate, proposal.data.proposal.id, "settle-complete-run4-two-copies");
      expect(existsSync(custom)).toBe(false);
      expect(existsSync(canonical)).toBe(false);
      expect(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: candidate, encoding: "utf8" })).toBe("");
    });

    it("behaves exactly as before when neither a sourcePath nor a canonical file exists", () => {
      const { workspace, repo, head } = fixture();
      const candidate = path.join(path.dirname(repo), "candidate-run4-nofile");
      execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-run4-nofile", candidate], { cwd: repo });
      const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-run4-nofile", "first", head) });
      const { preview, applied } = settleInCandidate(workspace, candidate, proposal.data.proposal.id, "settle-complete-run4-nofile");
      expect(applied.data.receipt.effects.some((effect) => effect.includes("Archived"))).toBe(false);
      expect(applied.data.receipt.warnings).toBeUndefined();
      expect(preview.data.receipt.review?.documents.map((document) => document.path).sort()).toEqual(["MISSION_LOG.md", "PROJECT.md", "docs/plans/demo-plan.md"]);
      expect(existsSync(path.join(candidate, ".arcadia/asks/archive/agent-ask-complete-run4-nofile.yaml"))).toBe(false);
      expect(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: candidate, encoding: "utf8" })).toBe("");
    });
  });

  it("carries the Action's completion in its own PR branch, so merging it alone advances the pointer with no further command", () => {
    // The end-to-end shape merge-completes-the-action exists to prove: a
    // session finishing an Action's acceptance criteria settles the complete
    // Ask into its own candidate worktree, same as any other governance
    // write (AGENTS.md "Settling commits locally and never pushes"). The
    // operator's merge — a plain fast-forward here, standing in for GitHub's
    // squash-merge of a PR branch with one commit — is then the only
    // remaining touch; nothing reads PROJECT.md's advanced pointer from
    // anywhere but the merged commit itself.
    const { workspace, repo, head } = fixture();
    const candidate = path.join(path.dirname(repo), "candidate-merge-completes");
    execFileSync("git", ["worktree", "add", "-q", "-b", "claude/candidate-merge-completes", candidate], { cwd: repo });

    const draft = runAgentAskDraftCommand({
      workspace, dir: candidate, request: completeAsk("complete-merge-completes", "first", head)
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: draft.data.preview!.proposal.id, requestId: "settle-merge-completes",
      disposition: "accepted", cwd: candidate
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: draft.data.preview!.proposal.id, requestId: "settle-merge-completes",
      disposition: "accepted", preview: preview.data.receipt.previewFingerprint, apply: true, operator: true, cwd: candidate
    });
    expect(applied.data.receipt.applied).toBe(true);
    // The receipt names the pointer this settlement wrote on the candidate
    // branch, not the base checkout's queue front, which still names the
    // Action just completed until the merge (Issue #507).
    expect(applied.data.receipt.nextActionKey).toBe("demo/second");

    // Before merge: the base checkout still shows the Action open and the
    // old pointer — the candidate's completion has not reached it yet.
    const beforePlan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan") as { currentAction: string; actions: { id: string; status: string }[] };
    expect(beforePlan.currentAction).toBe("first");
    expect(beforePlan.actions.find((action) => action.id === "first")?.status).toBe("open");

    // The only "command" from here on is the merge itself.
    execFileSync("git", ["merge", "--ff-only", "claude/candidate-merge-completes"], { cwd: repo });

    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({
      currentAction: "second",
      actions: [
        expect.objectContaining({ id: "first", status: "done" }),
        expect.objectContaining({ id: "second", status: "open" })
      ]
    });
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ currentAction: "second" });
    expect(readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8")).toContain("Completed demo/first");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
  });

  it("re-reads and re-applies the pointer pair when a concurrent settlement lands between resolution and write", () => {
    const { workspace, repo, head } = fixture({ withThird: true });
    // Settlement A completes `third` (outside pointer order) and resolves the
    // next pointer to `first`.
    const askA = completeAsk("concurrent-a", "third", head)
      .replace('criterion: "First proof exists."', 'criterion: "Third proof exists."');
    const proposalA = runAgentAskPreviewCommand({ workspace, request: askA });
    const previewA = runAgentAskSettleCommand({
      workspace, proposal: proposalA.data.proposal.id, requestId: "settle-concurrent-a", disposition: "accepted"
    });
    // Settlement B completes `first` and resolves the next pointer to `second`.
    const proposalB = runAgentAskPreviewCommand({ workspace, request: completeAsk("concurrent-b", "first", head) });
    const previewB = runAgentAskSettleCommand({
      workspace, proposal: proposalB.data.proposal.id, requestId: "settle-concurrent-b", disposition: "accepted"
    });
    // Apply B, landing A's already-applied change in the exact window between
    // B's resolution read and B's document write — the window a plain
    // readFileSync-then-write would silently overwrite.
    const appliedB = runAgentAskSettleCommand({
      workspace, proposal: proposalB.data.proposal.id, requestId: "settle-concurrent-b", disposition: "accepted",
      preview: previewB.data.receipt.previewFingerprint, apply: true, operator: true,
      hooks: {
        beforeDocumentWrite: () => {
          runAgentAskSettleCommand({
            workspace, proposal: proposalA.data.proposal.id, requestId: "settle-concurrent-a", disposition: "accepted",
            preview: previewA.data.receipt.previewFingerprint, apply: true, operator: true
          });
        }
      }
    });
    expect(appliedB.data.receipt.applied).toBe(true);
    expect(appliedB.data.receipt.effects.join(" ")).toContain("Marked Action demo/first done");

    // Neither settlement's completion was discarded: A's `third` stays done, and
    // B's own `first` completion and pointer move both land on top of it.
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({
      currentAction: "second",
      actions: [
        expect.objectContaining({ id: "first", status: "done" }),
        expect.objectContaining({ id: "second", status: "open" }),
        expect.objectContaining({ id: "third", status: "done" })
      ]
    });
    expect(discoverDocs(repo).docs.find((doc) => doc.type === "project")).toMatchObject({ currentAction: "second" });
    // The compare-and-set detected A's change and re-applied B's pinned change
    // on top of it, rather than writing a stale resolution-time result.
    expect(appliedB.data.receipt.effects.join(" ")).toContain("Re-read PROJECT.md and the Plan");
    // The receipt's next Action is the pointer the retried write actually left.
    expect(appliedB.data.receipt.nextActionKey).toBe("demo/second");
    // The shared completion log kept A's entry as well as B's: neither
    // settlement's record was silently discarded.
    const log = readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8");
    expect(log).toContain("Completed demo/first");
    expect(log).toContain("Completed demo/third");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
  });

  it("completes an Action in a non-active Plan and leaves the active Plan, its pointer, and the queue untouched", () => {
    const { workspace, repo, head } = fixture({ withInactivePlan: true });
    const request = completeAsk("complete-inactive", "first", head)
      .replace("target_ref: action/first", "target_ref: plan/side-plan#side-one")
      .replace('criterion: "First proof exists."', 'criterion: "Side proof exists."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-inactive", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-inactive", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).toContain("Marked Action demo/side-one done");
    expect(applied.data.receipt.effects.join(" ")).toContain("is not the active Plan");
    expect(applied.data.receipt.effects.join(" ")).toContain("Next ready Action in this inactive Plan: demo/side-two.");
    expect(applied.data.receipt.effects.join(" ")).not.toContain("Pointer:");
    expect(readFileSync(path.join(repo, "docs/plans/side-plan.md"), "utf8")).not.toContain("current_action");
    expect(execFileSync("git", ["log", "-1", "--format=%B"], { cwd: repo, encoding: "utf8" })).not.toContain("Pointer:");

    const docs = discoverDocs(repo).docs;
    // The non-active Plan records its own progress.
    // Only the active Plan carries a pointer (Issue #1061): none is written here.
    expect(docs.find((doc) => doc.type === "plan" && doc.slug === "side-plan")).toMatchObject({
      status: "draft",
      currentAction: null,
      actions: [
        // A non-active Plan's completed Action is rewritten the same way an
        // active Plan's is: the canonical rewrite does not depend on
        // `active_plan`.
        expect.objectContaining({ id: "side-one", status: "done", nextAction: "Completed via Agent Ask complete-inactive; no further action." }),
        expect.objectContaining({ id: "side-two", status: "open", nextAction: "Finish the second side Action." })
      ]
    });
    // The active Plan and the Project pointer are byte-for-byte untouched.
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toBe(planDoc({}));
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toBe(projectDoc());
    expect(docs.find((doc) => doc.type === "project")).toMatchObject({ activePlan: "demo-plan", currentAction: "first" });
    // The queue never moved: complete arranges no order, in either Plan.
    expect(applied.data.receipt.queueActionKeys).toEqual([]);
    expect(readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8")).toContain("Completed demo/side-one");
  });

  it("leaves an inactive Plan's existing current_action exactly as it was when completing an Action there (Issue #1061)", () => {
    const { workspace, repo } = fixture({ withInactivePlan: true });
    const sidePath = path.join(repo, "docs/plans/side-plan.md");
    writeFileSync(sidePath, readFileSync(sidePath, "utf8").replace("milestone: Parallel work", "milestone: Parallel work\ncurrent_action: side-two"), "utf8");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Give the inactive Plan a pointer"], { cwd: repo });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const request = completeAsk("complete-inactive-keeps-pointer", "first", head)
      .replace("target_ref: action/first", "target_ref: plan/side-plan#side-one")
      .replace('criterion: "First proof exists."', 'criterion: "Side proof exists."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-inactive-keeps-pointer", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-inactive-keeps-pointer", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).not.toContain("Pointer:");
    expect(readFileSync(sidePath, "utf8")).toContain("current_action: side-two");
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toBe(projectDoc());
    expect(execFileSync("git", ["log", "-1", "--format=%B"], { cwd: repo, encoding: "utf8" })).not.toContain("Pointer:");
  });

  it("completes a legacy Action that declares neither clarification nor next_action, leaving both absent", () => {
    // src/docs/parse.ts makes `clarification`/`next_action` optional unless
    // `clarification: clarified` (requires next_action) or the Action is the
    // current pointer (requires clarification itself). A non-active Plan's
    // Action can be neither and still parse validly; `complete` must keep
    // accepting it rather than refusing for a field it never had.
    const { workspace, repo } = fixture({ withInactivePlan: true });
    const planPath = path.join(repo, "docs/plans/side-plan.md");
    const legacyPlan = readFileSync(planPath, "utf8").replace(
      "    next_action: Finish the first side Action.\n    expected_artifact: Side proof\n    clarification: clarified\n    confidence: high\n",
      "    expected_artifact: Side proof\n"
    );
    writeFileSync(planPath, legacyPlan, "utf8");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Strip clarification/next_action from side-one (legacy shape)"], { cwd: repo });
    const legacyHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    const request = completeAsk("complete-legacy", "first", legacyHead)
      .replace("target_ref: action/first", "target_ref: plan/side-plan#side-one")
      .replace('criterion: "First proof exists."', 'criterion: "Side proof exists."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-legacy", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-legacy", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).toContain("Marked Action demo/side-one done");

    const plan = discoverDocs(repo).docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.slug === "side-plan")!;
    expect(plan.actions.find((action) => action.id === "side-one")).toMatchObject({
      status: "done", nextAction: null, clarification: null
    });
    // Every other field on the same Action, and the sibling Action, survive untouched.
    const rewritten = readFileSync(planPath, "utf8");
    const sideOneBlock = rewritten.split("  - id: side-two")[0];
    expect(sideOneBlock).toContain("    expected_artifact: Side proof");
    expect(sideOneBlock).not.toContain("next_action");
    expect(plan.actions.find((action) => action.id === "side-two")).toMatchObject({ status: "open", nextAction: "Finish the second side Action." });
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
  });

  it("refuses a Plan-scoped completion whose Plan does not exist", () => {
    const { workspace, head } = fixture({ withInactivePlan: true });
    const request = completeAsk("complete-missing-plan", "first", head)
      .replace("target_ref: action/first", "target_ref: plan/no-such-plan#side-one");
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-missing-plan", disposition: "accepted"
    })).toThrow(/names a Plan that was not found/);
  });

  it("refuses a Plan-scoped completion whose Action id is ambiguous across the Project's Plans", () => {
    const { workspace, head } = fixture({ withInactivePlan: true, withDuplicateActionId: true });
    const request = completeAsk("complete-ambiguous-id", "first", head)
      .replace("target_ref: action/first", "target_ref: plan/side-plan#first");
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-ambiguous-id", disposition: "accepted"
    })).toThrow(/not unique across this Project's Plans/);
  });

  it("refuses completing an Action that is already done, writing nothing", () => {
    const { workspace, repo, head } = fixture({ firstDone: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-done", "first", head) });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-done", disposition: "accepted"
    })).toThrow(/already done/);
    // The refusal happens before any rewrite: the Action's next_action is
    // exactly what the fixture set it to, not a second completed form.
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("next_action: Finish the first Action.");
  });

  it("preserves settled documents when the fingerprint goes stale before apply", () => {
    const { workspace, repo, head } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-stale-preview", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-stale-preview", disposition: "accepted"
    });
    const planPath = path.join(repo, "docs/plans/demo-plan.md");
    writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\n<!-- concurrent edit -->\n`, "utf8");
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-stale-preview", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    })).toThrow(/current preview/);
    expect(readFileSync(planPath, "utf8")).not.toContain("status: done");
  });
});

describe("Agent Ask complete — the settling worktree's own Action claim", () => {
  /** A candidate worktree of `repo`, optionally holding a claim on `actionId`. */
  function claimedCandidate(
    repo: string,
    workspace: string,
    name: string,
    actionId: string | null
  ): { path: string; head: string; generation: string | null } {
    const candidate = path.join(path.dirname(repo), name);
    execFileSync("git", ["worktree", "add", "-q", "-b", `claude/${name}`, candidate], { cwd: repo });
    const generation = actionId === null ? null : withDatabase(workspace, (db) => reserveAgentWorktree(db, {
      repositoryPath: repo,
      worktreePath: candidate,
      branch: `claude/${name}`,
      now: CLAIM_NOW,
      project: "demo",
      actionId
    }).claim_generation);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: candidate, encoding: "utf8" }).trim();
    return { path: candidate, head, generation };
  }

  it("refuses a completion whose Action is not the one this worktree claims, and writes nothing", () => {
    const { workspace, repo } = fixture();
    // `go`'s queue-walk gave this worktree `second`; it is trying to complete
    // `first`, which another live session is holding.
    const candidate = claimedCandidate(repo, workspace, "candidate-wrong-action", "second");
    const proposal = runAgentAskPreviewCommand({
      workspace, request: completeAsk("complete-wrong-claim", "first", candidate.head), dir: candidate.path
    });

    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-wrong-claim",
      disposition: "accepted", cwd: candidate.path
    })).toThrow(/claim does not name the Action this settlement completes/);

    // Refused during resolution, before the preview fingerprint exists: no
    // document was written, and the claim it does hold is untouched.
    expect(actionStatus(candidate.path, "first")).toBe("open");
    withDatabase(workspace, (db) => {
      expect(getActiveActionClaim(db, repo, "demo", "second", CLAIM_NOW)?.claim_generation).toBe(candidate.generation);
    });
  });

  it("keeps the worktree's claim through a candidate completion, so go cannot re-dispatch the Action before merge", () => {
    const { workspace, repo } = fixture();
    const candidate = claimedCandidate(repo, workspace, "candidate-right-action", "first");
    const proposal = runAgentAskPreviewCommand({
      workspace, request: completeAsk("complete-right-claim", "first", candidate.head), dir: candidate.path
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-right-claim",
      disposition: "accepted", cwd: candidate.path
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-right-claim", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, cwd: candidate.path
    });

    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).not.toContain("Released this worktree's claim");
    expect(actionStatus(candidate.path, "first")).toBe("done");
    // Issue #538: the completion exists only on the candidate branch. The base
    // checkout's pointer still names `first` until the pull request merges, so
    // the claim must survive or the next `go` hands `first` to a second worktree.
    expect(actionStatus(repo, "first")).toBe("open");
    withDatabase(workspace, (db) => {
      expect(getActiveActionClaim(db, repo, "demo", "first", CLAIM_NOW)?.claim_generation).toBe(candidate.generation);
      expect(getActiveWorktreeReservation(db, repo, candidate.path, CLAIM_NOW)).toMatchObject({
        action_id: "first", branch: "claude/candidate-right-action"
      });
    });
  });

  it("refuses to write when the claim is superseded between resolution and the document write", () => {
    const { workspace, repo } = fixture();
    const candidate = claimedCandidate(repo, workspace, "candidate-superseded", "first");
    const proposal = runAgentAskPreviewCommand({
      workspace, request: completeAsk("complete-superseded", "first", candidate.head), dir: candidate.path
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-superseded",
      disposition: "accepted", cwd: candidate.path
    });

    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-superseded", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, cwd: candidate.path,
      hooks: {
        // This session lapsed and a second one reclaimed `first` and did
        // genuinely new work. This session, still alive and merely slow,
        // reaches its write with the generation it started with.
        beforeDocumentWrite() {
          withDatabase(workspace, (db) => {
            db.prepare("UPDATE agent_worktree_reservations SET expires_at = ?").run(CLAIM_NOW.toISOString());
            reserveAgentWorktree(db, {
              repositoryPath: repo,
              // A live claim needs a worktree that exists (Issue #625).
              worktreePath: existingDirectory(path.join(path.dirname(repo), "candidate-reclaimed")),
              branch: "claude/candidate-reclaimed",
              now: CLAIM_NOW,
              project: "demo",
              actionId: "first"
            });
          });
        }
      }
    })).toThrow(/no longer the one this settlement started with/);

    // Nothing written, and the newer session's claim is exactly where it was.
    expect(actionStatus(candidate.path, "first")).toBe("open");
    withDatabase(workspace, (db) => {
      expect(getActiveActionClaim(db, repo, "demo", "first", CLAIM_NOW)?.worktree_path)
        .toBe(canonicalPath(path.join(path.dirname(repo), "candidate-reclaimed")));
    });
  });

  it("leaves an unclaimed checkout's completion exactly as it was before claims existed", () => {
    const { workspace, repo } = fixture();
    const candidate = claimedCandidate(repo, workspace, "candidate-unclaimed", null);
    const proposal = runAgentAskPreviewCommand({
      workspace, request: completeAsk("complete-unclaimed", "first", candidate.head), dir: candidate.path
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-unclaimed",
      disposition: "accepted", cwd: candidate.path
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-unclaimed", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, cwd: candidate.path
    });

    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).not.toContain("Released this worktree's claim");
    expect(actionStatus(candidate.path, "first")).toBe("done");
  });

  /** One Action's status as the checked-in active Plan currently records it. */
  function actionStatus(checkout: string, actionId: string): string | undefined {
    const plan = discoverDocs(checkout).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    return plan?.type === "plan" ? plan.actions.find((action) => action.id === actionId)?.status : undefined;
  }
});

/**
 * Claims carry a 24-hour TTL, and the production code that reads one back --
 * `settleAgentAsk`, `runAdvanceCommand` -- looks it up against the real clock.
 * A fixed past instant would make these tests pass today and fail tomorrow, so
 * the claim clock is the real one.
 */
const CLAIM_NOW = new Date();

function fixture(options: {
  secondDependsOnFirst?: boolean;
  secondDone?: boolean;
  firstDone?: boolean;
  withOpenDecision?: boolean;
  /** Add a third open Action after `second`. */
  withThird?: boolean;
  /** Write an approved Decision that defers `second` with `effect: defer`. */
  secondDeferredByDecision?: boolean;
  /** Explicit queue order; defaults to document order. */
  queueOrder?: string[];
  /** Add a second, inactive draft Plan with its own two open Actions. */
  withInactivePlan?: boolean;
  /** Add a second, approved active Plan whose Actions are already explicitly ordered. */
  withActiveSidePlan?: boolean;
  /** Give the inactive Plan's first Action the same id as demo-plan's `first`. */
  withDuplicateActionId?: boolean;
  /** Repo-relative path replacing `first`'s prose `expected_artifact`. */
  expectedArtifactPath?: string;
  /** Write `expectedArtifactPath` to disk before the fixture's initial commit. */
  writeExpectedArtifact?: boolean;
} = {}): { workspace: string; repo: string; head: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-complete-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  // A real Arcadia repository already tracks `.arcadia/asks/archive/`, so a
  // freshly drafted Ask file is the only new thing under `.arcadia/` and git
  // reports it by its own path rather than collapsing the whole directory.
  mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
  writeFileSync(path.join(repo, ".arcadia/asks/archive/.gitkeep"), "", "utf8");
  if (options.withOpenDecision || options.secondDeferredByDecision) mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc(options), "utf8");
  if (options.expectedArtifactPath && options.writeExpectedArtifact) {
    mkdirSync(path.dirname(path.join(repo, options.expectedArtifactPath)), { recursive: true });
    writeFileSync(path.join(repo, options.expectedArtifactPath), "proof\n", "utf8");
  }
  if (options.withInactivePlan) {
    writeFileSync(path.join(repo, "docs/plans/side-plan.md"), inactivePlanDoc(options.withDuplicateActionId), "utf8");
  }
  if (options.withActiveSidePlan) {
    writeFileSync(path.join(repo, "docs/plans/side-plan.md"),
      inactivePlanDoc(false)
        .replace("status: draft", "status: active")
        .replace(
          "token_budget: Deterministic completion with one accepted evidence pass.",
          "token_budget: Deterministic completion with one accepted evidence pass.\nrecommended_model: gpt-5.6-sol"
        ),
      "utf8");
  }
  if (options.withOpenDecision) {
    writeFileSync(path.join(repo, "docs/decisions/0001-review-first.md"), [
      "---", "arcadia: v1", "type: decision", 'id: "0001"', "slug: review-first", "project: demo",
      "status: open", "question: Does the independent review pass?", "confidence: high", "plan: demo-plan",
      "action: first", "updated: 2026-09-01", "---", "", "# Decision 0001: Does the independent review pass?", ""
    ].join("\n"), "utf8");
  }
  if (options.secondDeferredByDecision) {
    writeFileSync(path.join(repo, "docs/decisions/0057-defer-second.md"), [
      "---", "arcadia: v1", "type: decision", 'id: "0057"', "slug: defer-second", "project: demo",
      "status: approved", "question: Defer the second Action?", "confidence: high", "plan: demo-plan",
      "action: second", "answer: Defer until later", "decided: 2026-09-01",
      "options:", "  - label: Defer until later", "    consequence: The second Action stops dispatching.",
      "    recommended: true", "    effect: defer",
      "  - label: Keep it dispatchable", "    consequence: It keeps dispatching.", "    recommended: false",
      "updated: 2026-09-01", "---", "", "# Decision 0057: Defer the second Action?", ""
    ].join("\n"), "utf8");
  }
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "ask-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Ask Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add Ask fixture"], { cwd: repo });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const actionIds = options.withThird ? ["first", "second", "third"] : ["first", "second"];
  if (options.withActiveSidePlan) actionIds.push("side-one", "side-two");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Test Agent Ask completion.", goal: "Complete work safely.",
      status: "active", currentMilestone: "Completion", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: actionIds.map((id) => `demo/${id}`),
      order: options.queueOrder ?? actionIds.map((id) => `demo/${id}`),
      requestId: "fixture-order",
      apply: true
    });
  });
  return { workspace, repo, head };
}

function completeAsk(requestId: string, actionId: string, candidateRevision: string): string {
  return [
    "agent_ask: v1", `request_id: ${requestId}`, "project: demo", "intent: complete",
    `target_ref: action/${actionId}`, "desired_result: Accept the completion evidence for the first Action",
    "rationale: Every declared criterion is met.", `candidate_revision: ${candidateRevision}`,
    "evidence:", '  - criterion: "First proof exists."', "    status: met", "    note: Verified by the operator.",
    "requested_authority: apply_if_approved", ""
  ].join("\n");
}

function projectDoc(): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Complete work safely.", "milestone: Completion", "active_plan: demo-plan", "current_action: first",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

/** A second Plan that is not `active_plan` and is in no queue. */
function inactivePlanDoc(duplicateFirstActionId = false): string {
  const firstId = duplicateFirstActionId ? "first" : "side-one";
  return ["---", "arcadia: v1", "type: plan", "slug: side-plan", "project: demo", "status: draft",
    "milestone: Parallel work", "token_impact: medium",
    "token_budget: Deterministic completion with one accepted evidence pass.",
    "updated: 2026-09-01", "actions:",
    `  - id: ${firstId}`, "    title: Side Action One", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the first side Action.",
    "    expected_artifact: Side proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Side proof exists.", "    depends_on: []", "    decisions: []", "    references: []",
    "  - id: side-two", "    title: Side Action Two", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the second side Action.",
    "    expected_artifact: Second side proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Second side proof exists.", "    depends_on: []", "    decisions: []", "    references: []",
    "questions: []", "---", "", "# Side plan", ""].join("\n");
}

function planDoc(options: {
  secondDependsOnFirst?: boolean;
  secondDone?: boolean;
  firstDone?: boolean;
  withOpenDecision?: boolean;
  withThird?: boolean;
  /** Repo-relative path replacing `first`'s prose `expected_artifact`. */
  expectedArtifactPath?: string;
}): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Completion", "current_action: first", "token_impact: medium",
    "token_budget: Deterministic completion with one accepted evidence pass.",
    "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:",
    "  - id: first", "    title: First Action", `    status: ${options.firstDone ? "done" : "open"}`,
    "    responsibility: agent", "    effort: session", "    next_action: Finish the first Action.",
    `    expected_artifact: ${options.expectedArtifactPath ?? "First proof"}`, "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - First proof exists.", "    depends_on: []",
    `    decisions: [${options.withOpenDecision ? "review-first" : ""}]`, "    references: []",
    "  - id: second", "    title: Second Action", `    status: ${options.secondDone ? "done" : "open"}`,
    "    responsibility: agent", "    effort: session", "    next_action: Finish the second Action.",
    "    expected_artifact: Second proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Second proof exists.",
    `    depends_on: [${options.secondDependsOnFirst ? "first" : ""}]`, "    decisions: []", "    references: []",
    ...(options.withThird ? [
      "  - id: third", "    title: Third Action", "    status: open",
      "    responsibility: agent", "    effort: session", "    next_action: Finish the third Action.",
      "    expected_artifact: Third proof", "    clarification: clarified", "    confidence: high",
      "    acceptance_criteria:", "      - Third proof exists.", "    depends_on: []", "    decisions: []", "    references: []"
    ] : []),
    "questions: []", "---", "", "# Demo plan", ""].join("\n");
}

/** A directory that exists, standing in for a live claim's worktree (Issue #625). */
function existingDirectory(directory: string): string {
  mkdirSync(directory, { recursive: true });
  return directory;
}
