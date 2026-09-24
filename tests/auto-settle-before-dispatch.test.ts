import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attemptAutoSettlePendingCompletion,
  AUTO_SETTLE_EVIDENCE_INCOMPLETE,
  AUTO_SETTLE_NO_DRAFT,
  AUTO_SETTLE_SETTLED,
  AUTO_SETTLE_STALE_REVISION
} from "../src/ask/autoSettleBeforeDispatch.js";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const ACTION = { id: "first", acceptanceCriteria: ["First proof exists."] };

describe("attemptAutoSettlePendingCompletion", () => {
  it("settles a drafted complete Ask whose candidate_revision is stale only because later commits landed, and advances the pointer", () => {
    const { repo, workspace, draftHead, currentHead } = fixture({ draftAsk: true });

    const result = withDatabase(workspace, (db) => attemptAutoSettlePendingCompletion(db, {
      repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION
    }));

    expect(result).toMatchObject({ settled: true, reason: AUTO_SETTLE_SETTLED, nextActionKey: "demo/second" });
    expect(result.receiptId).toBeTruthy();

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

    // Settlement re-verified its own freshly computed HEAD, which is the
    // repository's HEAD after the extra commit -- proof the refreshed
    // candidate_revision (not the stale one the draft declared) is what was
    // actually recorded.
    const log = readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8");
    expect(log).toContain(currentHead);
    expect(log).not.toContain(draftHead);

    // The original drafted file is archived, not left in place.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    const archived = execFileSync("git", ["ls-files", ".arcadia/asks/archive"], { cwd: repo, encoding: "utf8" });
    expect(archived).toContain("agent-ask-complete-first.yaml");
    const stillDrafted = execFileSync("git", ["ls-files", ".arcadia/asks"], { cwd: repo, encoding: "utf8" })
      .split("\n").filter((line) => line && !line.includes("/archive/"));
    expect(stillDrafted).toEqual([]);
  });

  it("skips an ineligible draft targeting the same Action and settles a later eligible one", () => {
    const { repo, workspace } = fixture({ draftAsk: true, extraIneligibleDraft: true });

    const result = withDatabase(workspace, (db) => attemptAutoSettlePendingCompletion(db, {
      repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION
    }));

    expect(result).toMatchObject({ settled: true, reason: AUTO_SETTLE_SETTLED, nextActionKey: "demo/second" });
    expect(result.askPath).toContain("agent-ask-complete-first.yaml");
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({ currentAction: "second" });
    // The ineligible draft is untouched -- only the eligible one is archived.
    expect(execFileSync("git", ["ls-files", ".arcadia/asks"], { cwd: repo, encoding: "utf8" }))
      .toContain("agent-ask-complete-aaa-ineligible-first.yaml");
  });

  it("is idempotent: calling it again once the Action is already done finds no drafted Ask left to settle", () => {
    const { repo, workspace } = fixture({ draftAsk: true });
    withDatabase(workspace, (db) => attemptAutoSettlePendingCompletion(db, { repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION }));

    const second = withDatabase(workspace, (db) => attemptAutoSettlePendingCompletion(db, {
      repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION
    }));
    expect(second).toMatchObject({ settled: false, reason: AUTO_SETTLE_NO_DRAFT });
  });

  it("falls through with no drafted complete Ask for the current pointer", () => {
    const { repo, workspace } = fixture({ draftAsk: false });

    const result = withDatabase(workspace, (db) => attemptAutoSettlePendingCompletion(db, {
      repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION
    }));

    expect(result).toEqual({ settled: false, reason: AUTO_SETTLE_NO_DRAFT });
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({ currentAction: "first" });
  });

  it("falls through when the drafted Ask's evidence does not verbatim-cover every declared acceptance criterion", () => {
    const { repo, workspace } = fixture({ draftAsk: true, wrongCriterion: true });

    const result = withDatabase(workspace, (db) => attemptAutoSettlePendingCompletion(db, {
      repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION
    }));

    expect(result).toMatchObject({ settled: false, reason: AUTO_SETTLE_EVIDENCE_INCOMPLETE });
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({ currentAction: "first" });
  });

  it("falls through when the draft's candidate_revision is not an ancestor of HEAD (a genuinely divergent revision, not merely stale)", () => {
    const { repo, workspace, divergentSha } = fixture({ draftAsk: true, divergentCandidateRevision: true });

    const result = withDatabase(workspace, (db) => attemptAutoSettlePendingCompletion(db, {
      repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION
    }));

    expect(result).toMatchObject({ settled: false, reason: AUTO_SETTLE_STALE_REVISION });
    expect(divergentSha).toBeTruthy();
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({ currentAction: "first" });
  });

  it("falls through when settlement itself refuses (e.g. an unresolved required review Decision), with no partial write", () => {
    const { repo, workspace } = fixture({ draftAsk: true, withOpenDecision: true });

    const result = withDatabase(workspace, (db) => attemptAutoSettlePendingCompletion(db, {
      repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION
    }));

    expect(result.settled).toBe(false);
    expect(result.reason).toMatch(/unresolved required review Decision/i);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({ currentAction: "first" });
  });
});

function fixture(options: {
  draftAsk: boolean;
  wrongCriterion?: boolean;
  divergentCandidateRevision?: boolean;
  withOpenDecision?: boolean;
  /** Also write a second, alphabetically-earlier draft targeting the same
   * Action with evidence that cannot settle, to prove it is skipped rather
   * than stopping the scan. */
  extraIneligibleDraft?: boolean;
}): { repo: string; workspace: string; draftHead: string; currentHead: string; divergentSha?: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-auto-settle-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
  writeFileSync(path.join(repo, ".arcadia/asks/archive/.gitkeep"), "", "utf8");
  if (options.withOpenDecision) mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc({ withOpenDecision: options.withOpenDecision }), "utf8");
  if (options.withOpenDecision) {
    writeFileSync(path.join(repo, "docs/decisions/0001-review-first.md"), [
      "---", "arcadia: v1", "type: decision", 'id: "0001"', "slug: review-first", "project: demo",
      "status: open", "question: Does the independent review pass?", "confidence: high", "plan: demo-plan",
      "action: first", "updated: 2026-09-01", "---", "", "# Decision 0001: Does the independent review pass?", ""
    ].join("\n"), "utf8");
  }
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "auto-settle-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Auto Settle Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add fixture"], { cwd: repo });
  const draftHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const primaryBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

  let divergentSha: string | undefined;
  if (options.divergentCandidateRevision) {
    // A commit that never reaches this branch's history at all -- a
    // genuinely divergent revision, not merely one that HEAD has moved past.
    execFileSync("git", ["checkout", "-qb", "side-branch"], { cwd: repo });
    writeFileSync(path.join(repo, "SIDE.md"), "side\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Divergent work"], { cwd: repo });
    divergentSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    execFileSync("git", ["checkout", "-q", primaryBranch], { cwd: repo });
  }

  if (options.draftAsk) {
    const candidateRevision = options.divergentCandidateRevision ? divergentSha! : draftHead;
    const added = [".arcadia/asks/agent-ask-complete-first.yaml"];
    writeFileSync(
      path.join(repo, ".arcadia/asks/agent-ask-complete-first.yaml"),
      completeAsk("complete-first", options.wrongCriterion ? "A different criterion entirely." : "First proof exists.", candidateRevision),
      "utf8"
    );
    if (options.extraIneligibleDraft) {
      // Sorts before the eligible draft above, so the scan meets it first.
      added.push(".arcadia/asks/agent-ask-complete-aaa-ineligible-first.yaml");
      writeFileSync(
        path.join(repo, ".arcadia/asks/agent-ask-complete-aaa-ineligible-first.yaml"),
        completeAsk("complete-aaa-ineligible-first", "A different criterion entirely.", candidateRevision),
        "utf8"
      );
    }
    execFileSync("git", ["add", ...added], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Draft complete Ask(s) for first"], { cwd: repo });
  }

  // A commit that lands after the draft -- the ordinary reason
  // candidate_revision goes stale with nothing wrong about the evidence.
  writeFileSync(path.join(repo, "NOTES.md"), "unrelated later work\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Unrelated later commit"], { cwd: repo });
  const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

  initWorkspace(workspace);
  withDatabase(workspace, (database) => {
    const project = upsertProject(database, {
      name: "Demo", mission: "Test auto-settle before dispatch.", goal: "Never launch a redundant Session.",
      status: "active", currentMilestone: "Completion", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(database, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(database, {
      currentKeys: ["demo/first", "demo/second"],
      order: ["demo/first", "demo/second"],
      requestId: "fixture-order",
      apply: true
    });
  });

  return { repo, workspace, draftHead, currentHead, divergentSha };
}

function completeAsk(requestId: string, criterion: string, candidateRevision: string): string {
  return [
    "agent_ask: v1", `request_id: ${requestId}`, "project: demo", "intent: complete",
    "target_ref: action/first", "desired_result: Accept the completion evidence for the first Action",
    "rationale: Every declared criterion is met.", `candidate_revision: ${candidateRevision}`,
    "evidence:", `  - criterion: "${criterion}"`, "    status: met", "    note: Verified by the agent.",
    "requested_authority: apply_if_approved", ""
  ].join("\n");
}

function projectDoc(): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Never launch a redundant Session.", "milestone: Completion", "active_plan: demo-plan", "current_action: first",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

function planDoc(options: { withOpenDecision?: boolean } = {}): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Completion", "current_action: first", "token_impact: medium",
    "token_budget: Deterministic completion with one accepted evidence pass.",
    "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:",
    "  - id: first", "    title: First Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the first Action.",
    "    expected_artifact: First proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - First proof exists.", "    depends_on: []",
    `    decisions: [${options.withOpenDecision ? "review-first" : ""}]`, "    references: []",
    "  - id: second", "    title: Second Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the second Action.",
    "    expected_artifact: Second proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Second proof exists.",
    "    depends_on: []", "    decisions: []", "    references: []",
    "questions: []", "---", "", "# Demo plan", ""].join("\n");
}
