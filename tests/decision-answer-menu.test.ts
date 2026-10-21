import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDecisionNewCommand } from "../src/commands/decision.js";
import { runReviewAnswerCommand, runReviewRequiredCommand, runReviewResolveReplyCommand } from "../src/commands/review.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { createReviewItem, getProjectBySlug, getReviewItem, upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];
afterEach(() => {
  for (const d of temporary.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-answer-menu-"));
  temporary.push(root);
  const repoRoot = path.join(root, "repo");
  mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, "init", "-q", "-b", "main");
  git(repoRoot, "config", "user.email", "t@example.invalid");
  git(repoRoot, "config", "user.name", "T");
  git(repoRoot, "remote", "add", "origin", "https://github.com/acme/demo.git");
  writeFileSync(path.join(repoRoot, "README.md"), "demo\n");
  git(repoRoot, "add", "README.md");
  git(repoRoot, "commit", "-qm", "initial");
  const workspace = path.join(root, "ws");
  initWorkspace(workspace);
  const projectId = withDatabase(workspace, (db) => {
    const p = upsertProject(db, { name: "Demo", mission: "m", status: "active", currentMilestone: "I", nextAction: "S", workClassification: "agent" });
    upsertProjectMetadata(db, { projectId: p.id, repoPath: repoRoot });
    return p.id;
  });
  return { root, repoRoot, workspace, projectId };
}

function itemFor(workspace: string, projectId: string, slug: string, context?: object, number = "0001") {
  return withDatabase(workspace, (db) => {
    const item = createReviewItem(db, {
      projectId, decisionNeeded: "Which?", recommendation: null, sourceInput: `docs/decisions/${number}-${slug}.md (${slug})`, proposedAction: "Answer",
      resolvedIntent: "ActionClarification", confidenceLabel: "high", confidence: 1, missingFields: [],
      ...(context ? { context } : {})
    });
    db.prepare("UPDATE review_items SET doc_ref = ? WHERE id = ?").run(`decision/${slug}`, item.id);
    return item.id;
  });
}

const OPTIONS = [
  { label: "Ship it", consequence: "Ships now.", recommended: true },
  { label: "Wait", consequence: "Waits a week." }
];

function withDecision(options = OPTIONS) {
  const f = fixture();
  const made = runDecisionNewCommand({ workspace: f.workspace, project: "demo", slug: "pick", question: "Pick?", options });
  const id = itemFor(f.workspace, f.projectId, "pick");
  return { ...f, id, number: made.data.id };
}

const menuOf = (workspace: string, id: string) =>
  runReviewRequiredCommand({ workspace }).data.items.find((i) => i.id === id)?.answerMenu;

describe("lettered Decision answers", () => {
  it("lists lettered options with consequences and the recommended marker", () => {
    const f = withDecision();
    const menu = menuOf(f.workspace, f.id);
    expect(menu?.answerable).toBe(true);
    expect(menu?.options).toEqual([
      { letter: "A", label: "Ship it", consequence: "Ships now.", recommended: true },
      { letter: "B", label: "Wait", consequence: "Waits a week.", recommended: false }
    ]);
  });

  it("a letter records the option's exact label; no wording is typed", () => {
    const f = withDecision();
    runReviewResolveReplyCommand({ workspace: f.workspace, id: f.id, reply: "b" });
    expect(readFileSync(path.join(f.repoRoot, "docs/decisions", `${f.number}-pick.md`), "utf8")).toContain("answer: Wait");
    expect(withReadOnlyDatabase(f.workspace, (db) => getReviewItem(db, f.id))?.status).toBe("approved");
  });

  it("'<number> <letter>' resolves without an id", () => {
    const f = withDecision();
    runReviewResolveReplyCommand({ workspace: f.workspace, reply: `${f.number} A` });
    expect(withReadOnlyDatabase(f.workspace, (db) => getReviewItem(db, f.id))?.decision_note).toBe("Ship it");
  });

  it("review answer takes only a valid letter", () => {
    const f = withDecision();
    expect(() => runReviewAnswerCommand({ workspace: f.workspace, id: f.id, letter: "Ship it" })).toThrow(/single choice letter/);
    expect(() => runReviewAnswerCommand({ workspace: f.workspace, id: f.id, letter: "Z" })).toThrow(/not one of/);
    runReviewAnswerCommand({ workspace: f.workspace, id: f.id, letter: "A" });
    expect(withReadOnlyDatabase(f.workspace, (db) => getReviewItem(db, f.id))?.decision_note).toBe("Ship it");
  });

  it("a Decision with no options gets Approve / Reject / Defer letters", () => {
    const f = withDecision([]);
    expect(menuOf(f.workspace, f.id)?.options.map((o) => o.label)).toEqual(["Approve", "Reject", "Defer"]);
    runReviewAnswerCommand({ workspace: f.workspace, id: f.id, letter: "A" });
    expect(withReadOnlyDatabase(f.workspace, (db) => getReviewItem(db, f.id))?.status).toBe("approved");
  });

  it("a Decision whose document is not on the base branch is not answerable, names the remedy, and shows no path", () => {
    const f = fixture();
    const id = itemFor(f.workspace, f.projectId, "0132-never-pushed", { candidateBranch: "claude/settle-x" });
    const menu = menuOf(f.workspace, id);
    expect(menu?.answerable).toBe(false);
    expect(menu?.blocked?.message).toMatch(/not published/);
    expect(menu?.blocked?.message).not.toContain(f.repoRoot);
    let error: Error | undefined;
    try { runReviewResolveReplyCommand({ workspace: f.workspace, id, reply: "A" }); } catch (e) { error = e as Error; }
    expect(error?.message).toMatch(/Not answerable yet/);
    expect(error?.message).not.toContain(f.repoRoot);
    expect(withReadOnlyDatabase(f.workspace, (db) => getReviewItem(db, id))?.status).toBe("open");
  });

  it("names the pull-request link once the branch is on the remote, and a missing branch generically", () => {
    const f = fixture();
    git(f.repoRoot, "update-ref", "refs/remotes/origin/claude/settle-x", "HEAD");
    const id = itemFor(f.workspace, f.projectId, "0132-x", { candidateBranch: "claude/settle-x" });
    expect(menuOf(f.workspace, id)?.blocked?.pullRequestsUrl).toBe("https://github.com/acme/demo/pulls?q=is%3Apr%20head%3Aclaude%2Fsettle-x");
    expect(menuOf(f.workspace, id)?.blocked?.message).toMatch(/Merge the pull request for branch claude\/settle-x/);
    const other = itemFor(f.workspace, f.projectId, "0133-y");
    expect(menuOf(f.workspace, other)?.blocked?.message).toMatch(/Merge the pull request that adds it/);
  });

  it("becomes answerable by itself once the document is on the checkout", () => {
    const f = fixture();
    const id = itemFor(f.workspace, f.projectId, "pick");
    expect(menuOf(f.workspace, id)?.answerable).toBe(false);
    runDecisionNewCommand({ workspace: f.workspace, project: "demo", slug: "pick", question: "Pick?", options: OPTIONS });
    expect(menuOf(f.workspace, id)?.answerable).toBe(true);
  });

  it("docs sync from a candidate worktree records the candidate branch on the item", () => {
    const f = fixture();
    const made = runDecisionNewCommand({ workspace: f.workspace, project: "demo", slug: "cand", question: "Pick?", options: OPTIONS });
    const file = path.join(f.repoRoot, "docs/decisions", `${made.data.id}-cand.md`);
    const content = readFileSync(file, "utf8");
    rmSync(file);
    const wt = path.join(f.root, "wt");
    git(f.repoRoot, "worktree", "add", "-q", "-b", "claude/cand", wt);
    mkdirSync(path.join(wt, "docs/decisions"), { recursive: true });
    writeFileSync(path.join(wt, "docs/decisions", `${made.data.id}-cand.md`), content);
    withDatabase(f.workspace, (db) => {
      syncProjectDocs(db, getProjectBySlug(db, "demo")!, { apply: true, repoRoot: wt });
      const row = db.prepare("SELECT context_json FROM review_items WHERE doc_ref LIKE 'decision/%'").get() as { context_json: string };
      expect(JSON.parse(row.context_json).candidateBranch).toBe("claude/cand");
    });
  });
});
