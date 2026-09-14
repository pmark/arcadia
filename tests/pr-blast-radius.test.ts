import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { assessPrBlastRadius, computeBlastRadius } from "../src/stewardship/prBlastRadius.js";

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove blast-radius assessment.
active_plan: demo-plan
current_action: demo-action
updated: 2026-09-01
---

# Test Project
`;

const planDocument = `---
arcadia: v1
type: plan
slug: demo-plan
project: test-project
status: active
milestone: Prove blast-radius assessment.
current_action: demo-action
token_impact: medium
token_budget: One bounded assessment; all checks are deterministic.
recommended_model: sonnet
recommended_reasoning_effort: high
updated: 2026-09-01
actions:
  - id: demo-action
    title: Demo action
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Demo action.
    expected_artifact: docs/demo.md
    acceptance_criteria:
      - The demo artifact exists.
---

# Demo plan
`;

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-blast-radius-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "src", "production"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(repo, "README.md"), "hello\n");
  writeFileSync(path.join(repo, "src", "production", "policy.ts"), "export const x = 1;\n");
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "demo-plan.md"), planDocument);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  const baseRevision = git(repo, ["rev-parse", "HEAD"]).trim();
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove blast-radius assessment.", goal: "Prove blast-radius assessment.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
  });
  return { root, repo, workspace, baseRevision };
}

describe("computeBlastRadius", () => {
  it("proceeds on a narrow, safe change with no matched safety paths", () => {
    const { repo, baseRevision } = fixture();
    writeFileSync(path.join(repo, "docs", "notes.md"), "a note\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "docs: add a note"]);
    const candidateRevision = git(repo, ["rev-parse", "HEAD"]).trim();

    const assessment = computeBlastRadius(repo, baseRevision, candidateRevision);
    expect(assessment.escalate).toBe(false);
    expect(assessment.matchedSafetyPaths).toEqual([]);
    expect(assessment.touchedPaths).toEqual(["docs/notes.md"]);
    expect(assessment.reasons).toEqual([]);
  });

  it("escalates when a controller-safety path is touched", () => {
    const { repo, baseRevision } = fixture();
    writeFileSync(path.join(repo, "src", "production", "policy.ts"), "export const x = 2;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "feat: change policy"]);
    const candidateRevision = git(repo, ["rev-parse", "HEAD"]).trim();

    const assessment = computeBlastRadius(repo, baseRevision, candidateRevision);
    expect(assessment.escalate).toBe(true);
    expect(assessment.matchedSafetyPaths).toEqual(["src/production/policy.ts"]);
  });

  it("escalates on a large diff even outside named safety paths, since size alone is a reason but never a safety-path claim", () => {
    const { repo, baseRevision } = fixture();
    writeFileSync(path.join(repo, "docs", "big.md"), Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n") + "\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "docs: add a very large file"]);
    const candidateRevision = git(repo, ["rev-parse", "HEAD"]).trim();

    const assessment = computeBlastRadius(repo, baseRevision, candidateRevision);
    expect(assessment.escalate).toBe(true);
    expect(assessment.matchedSafetyPaths).toEqual([]);
    expect(assessment.reasons.some((reason) => reason.includes("narrow-change threshold"))).toBe(true);
  });
});

describe("assessPrBlastRadius", () => {
  it("records an approved review item and opens no Decision for a safe change, and never reassesses an already-assessed revision", () => {
    const f = fixture();
    writeFileSync(path.join(f.repo, "docs", "notes.md"), "a note\n");
    git(f.repo, ["add", "."]);
    git(f.repo, ["commit", "-m", "docs: add a note"]);
    const candidateRevision = git(f.repo, ["rev-parse", "HEAD"]).trim();

    const result = withDatabase(f.workspace, (db) => assessPrBlastRadius({
      db, projectSlug: "test-project", planSlug: "demo-plan", actionId: "demo-action",
      repoRoot: f.repo, baseRevision: f.baseRevision, candidateRevision
    }));

    expect(result.outcome).toBe("proceed");
    expect(result.decisionRequestId).toBeNull();
    expect(result.created).toBe(true);

    const replay = withDatabase(f.workspace, (db) => assessPrBlastRadius({
      db, projectSlug: "test-project", planSlug: "demo-plan", actionId: "demo-action",
      repoRoot: f.repo, baseRevision: f.baseRevision, candidateRevision
    }));
    expect(replay.reviewItemId).toBe(result.reviewItemId);
    expect(replay.created).toBe(false);
    expect(replay.outcome).toBe("proceed");

    const count = withDatabase(f.workspace, (db) =>
      (db.prepare("SELECT COUNT(*) as n FROM review_items WHERE resolved_intent = 'PrBlastRadiusAssessment'").get() as { n: number }).n
    );
    expect(count).toBe(1);
  });

  it("opens exactly one Decision when escalating, and never duplicates it on replay", () => {
    const f = fixture();
    writeFileSync(path.join(f.repo, "src", "production", "policy.ts"), "export const x = 2;\n");
    git(f.repo, ["add", "."]);
    git(f.repo, ["commit", "-m", "feat: change policy"]);
    const candidateRevision = git(f.repo, ["rev-parse", "HEAD"]).trim();

    const result = withDatabase(f.workspace, (db) => assessPrBlastRadius({
      db, projectSlug: "test-project", planSlug: "demo-plan", actionId: "demo-action",
      repoRoot: f.repo, baseRevision: f.baseRevision, candidateRevision
    }));

    expect(result.outcome).toBe("escalated");
    expect(result.decisionRequestId).toBe(`assess-pr-blast-radius-${candidateRevision}`);

    const settlementCount = () => withDatabase(f.workspace, (db) =>
      (db.prepare("SELECT COUNT(*) as n FROM agent_ask_settlements WHERE request_id = ?").get(result.decisionRequestId) as { n: number }).n
    );
    expect(settlementCount()).toBe(1);

    const replay = withDatabase(f.workspace, (db) => assessPrBlastRadius({
      db, projectSlug: "test-project", planSlug: "demo-plan", actionId: "demo-action",
      repoRoot: f.repo, baseRevision: f.baseRevision, candidateRevision
    }));
    expect(replay.created).toBe(false);
    expect(replay.reviewItemId).toBe(result.reviewItemId);
    expect(replay.outcome).toBe("escalated");
    expect(settlementCount()).toBe(1);
  });

  it("refuses on an unresolvable Project rather than guessing", () => {
    const f = fixture();
    expect(() => withDatabase(f.workspace, (db) => assessPrBlastRadius({
      db, projectSlug: "no-such-project", planSlug: "demo-plan", actionId: "demo-action",
      repoRoot: f.repo, baseRevision: f.baseRevision, candidateRevision: f.baseRevision
    }))).toThrow(/was not found/);
  });
});
