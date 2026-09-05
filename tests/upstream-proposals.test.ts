import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { renderPortfolioSuccess, runPortfolioCommand } from "../src/commands/portfolio.js";
import { withDatabase } from "../src/db/connection.js";
import {
  getReviewItemByDocRef,
  upsertProject,
  upsertProjectMetadata,
  WAY_PROPOSAL_REVIEW_INTENT
} from "../src/db/repositories.js";
import { parseDoc } from "../src/docs/parse.js";
import { WAY_PROPOSAL_INTENT } from "../src/docs/sync.js";
import { readAgentsContextBlock } from "../src/projects/contextSetup.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-proposals-"));
  temporary.push(directory);
  return directory;
}

function workspaceWithProject(repoRoot: string, slug = "demo"): string {
  const workspace = path.join(scratch(), "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Exercise upstream proposals.",
      status: "active",
      currentMilestone: "Initial",
      nextAction: "Start",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
    expect(project.slug).toBe(slug);
  });
  return workspace;
}

function writeDoc(repoRoot: string, relativePath: string, content: string): void {
  const absolute = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const TRIGGER_PROPOSAL = `---
arcadia: v1
type: proposal
project: demo
question: Can Arcadia evaluate reactivation triggers so deferred items revive on their own?
---

# Trigger evaluation

## Why this project needs it

Three deferred items name conditions nobody re-reads.

## What we would build locally

A trigger evaluator in \`scripts/\`, which is the thing this proposal avoids.
`;

describe("upstream Way-change proposals", () => {
  it("ingests a filed proposal as a pending request rather than a narrative record", () => {
    const repo = scratch();
    writeDoc(repo, "docs/proposals/trigger-evaluation.md", TRIGGER_PROPOSAL);
    const workspace = workspaceWithProject(repo);

    const result = runDocsSyncCommand({ workspace, apply: true });
    const changes = result.data.projects[0].changes.filter((change) => change.entity === "proposal");

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ action: "create", ref: "proposal/trigger-evaluation" });
    // The old behavior, and the thing this Action exists to end.
    expect(result.data.projects[0].changes.some((change) => change.entity === "narrative")).toBe(false);

    const item = withDatabase(workspace, (db) => getReviewItemByDocRef(db, "proposal/trigger-evaluation"));
    expect(item).toMatchObject({ status: "open", resolved_intent: WAY_PROPOSAL_INTENT });
    expect(item?.decision_needed).toContain("reactivation triggers");
    expect(item?.recommendation).toContain("trigger evaluator");
  });

  it("costs an agent nothing but the question itself to file", () => {
    const repo = scratch();
    // No slug, no project, no updated, no `question:` field — a cloud container
    // with no Arcadia installed can still produce this.
    writeDoc(repo, "docs/proposals/demo-probing.md", `---
arcadia: v1
type: proposal
---

# Can Arcadia probe a demo target so a PR's QA plan is evidence-backed?
`);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const item = withDatabase(workspace, (db) => getReviewItemByDocRef(db, "proposal/demo-probing"));
    expect(item?.decision_needed).toBe("Can Arcadia probe a demo target so a PR's QA plan is evidence-backed?");
    expect(item?.status).toBe("open");
  });

  it("surfaces unresolved proposals under Waiting on you with their project and question", () => {
    const repo = scratch();
    writeDoc(repo, "docs/proposals/trigger-evaluation.md", TRIGGER_PROPOSAL);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const portfolio = runPortfolioCommand({ workspace });
    expect(portfolio.data.totals.openProposals).toBe(1);
    // A Way-change request is not a Decision the operator owes inside this
    // project, so it must not inflate that count.
    expect(portfolio.data.totals.openDecisions).toBe(0);

    const lines = renderPortfolioSuccess(portfolio);
    const waiting = lines.indexOf("Waiting on you:");
    expect(waiting).toBeGreaterThan(-1);
    expect(lines[waiting + 1]).toContain("[Demo]");
    expect(lines[waiting + 1]).toContain("reactivation triggers");
    expect(lines[waiting + 1]).toContain("(proposal)");
  });

  it("stops asking once the proposal records the Decision that answered it", () => {
    const repo = scratch();
    writeDoc(repo, "docs/proposals/trigger-evaluation.md", TRIGGER_PROPOSAL);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });
    expect(runPortfolioCommand({ workspace }).data.totals.openProposals).toBe(1);

    writeDoc(
      repo,
      "docs/proposals/trigger-evaluation.md",
      TRIGGER_PROPOSAL.replace("---\n\n# Trigger", 'decision: "0031"\n---\n\n# Trigger')
    );
    const second = runDocsSyncCommand({ workspace, apply: true });
    expect(second.data.projects[0].changes.filter((change) => change.entity === "proposal")[0]).toMatchObject({
      action: "update",
      ref: "proposal/trigger-evaluation"
    });

    const item = withDatabase(workspace, (db) => getReviewItemByDocRef(db, "proposal/trigger-evaluation"));
    expect(item?.status).toBe("approved");
    expect(item?.decision_note).toBe("Answered by Decision 0031.");

    const portfolio = runPortfolioCommand({ workspace });
    expect(portfolio.data.totals.openProposals).toBe(0);
    expect(renderPortfolioSuccess(portfolio).some((line) => line.includes("(proposal)"))).toBe(false);
  });

  it("re-reads an unchanged proposal without rewriting it", () => {
    const repo = scratch();
    writeDoc(repo, "docs/proposals/trigger-evaluation.md", TRIGGER_PROPOSAL);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const second = runDocsSyncCommand({ workspace, apply: true });
    expect(second.data.projects[0].changes.filter((change) => change.entity === "proposal")[0]).toMatchObject({
      action: "unchanged"
    });
  });

  it("leaves a proposal that asks nothing as a scoped-out supporting record", () => {
    const { doc, errors } = parseDoc(
      "docs/proposals/future-work.md",
      "/tmp/docs/proposals/future-work.md",
      "---\narcadia: v1\ntype: proposal\nstatus: proposed\n---\n"
    );
    expect(errors).toEqual([]);
    expect(doc).toMatchObject({ type: "scoped_out", sourceType: "proposal" });
  });

  it("keeps the query layer's intent label identical to the one sync writes", () => {
    expect(WAY_PROPOSAL_REVIEW_INTENT).toBe(WAY_PROPOSAL_INTENT);
  });

  it("states the file-a-proposal rule in the shared AGENTS.md region", () => {
    const block = readAgentsContextBlock();
    expect(block).toContain("file a\nproposal and continue without it");
    expect(block).toContain("Do not implement Arcadia commands, parsers,");
    expect(block).toContain("docs/proposals/<slug>.md");
  });
});
