import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentAskContractCommand, runAgentAskDraftCommand, runAgentAskPreviewCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
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
        expect.objectContaining({ id: "first", status: "done" }),
        expect.objectContaining({ id: "second", status: "open" })
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
    })).toThrow(/does not match the repository's current HEAD/);
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
    writeFileSync(path.join(candidate, "README.md"), "advance the candidate past the recorded revision\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: candidate });
    execFileSync("git", ["commit", "-qm", "Advance candidate"], { cwd: candidate });

    const draft = runAgentAskDraftCommand({
      workspace, dir: candidate, request: completeAsk("complete-from-candidate-stale", "first", head)
    });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: draft.data.preview!.proposal.id, requestId: "settle-complete-from-candidate-stale",
      disposition: "accepted", cwd: candidate
    })).toThrow(/does not match the repository's current HEAD/);
    // Refused before any write: the drafted file is still exactly where draft left it.
    expect(existsSync(draft.data.path)).toBe(true);
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

    const docs = discoverDocs(repo).docs;
    // The non-active Plan records its own progress.
    expect(docs.find((doc) => doc.type === "plan" && doc.slug === "side-plan")).toMatchObject({
      status: "draft",
      currentAction: "side-two",
      actions: [
        expect.objectContaining({ id: "side-one", status: "done" }),
        expect.objectContaining({ id: "side-two", status: "open" })
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

  it("refuses completing an Action that is already done", () => {
    const { workspace, head } = fixture({ firstDone: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-done", "first", head) });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-done", disposition: "accepted"
    })).toThrow(/already done/);
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
  /** Give the inactive Plan's first Action the same id as demo-plan's `first`. */
  withDuplicateActionId?: boolean;
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
  if (options.withInactivePlan) {
    writeFileSync(path.join(repo, "docs/plans/side-plan.md"), inactivePlanDoc(options.withDuplicateActionId), "utf8");
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
}): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Completion", "current_action: first", "token_impact: medium",
    "token_budget: Deterministic completion with one accepted evidence pass.",
    "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:",
    "  - id: first", "    title: First Action", `    status: ${options.firstDone ? "done" : "open"}`,
    "    responsibility: agent", "    effort: session", "    next_action: Finish the first Action.",
    "    expected_artifact: First proof", "    clarification: clarified", "    confidence: high",
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
