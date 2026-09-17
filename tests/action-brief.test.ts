import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { renderActionBrief } from "../src/sessions/actionBrief.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("renderActionBrief", () => {
  it("renders the authoritative Action brief for a Session", () => {
    const repo = briefRepo();
    const brief = renderActionBrief({
      repoRoot: repo,
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: "opencode/define-contract",
      agent: "opencode"
    });

    expect(brief).toContain("Project: test-project");
    expect(brief).toContain("Plan: copy-proof — docs/plans/copy-proof.md");
    expect(brief).toContain("Action: define-contract");
    expect(brief).toContain("Title: Define the contract");
    expect(brief).toContain("Candidate worktree: /worktrees/define-contract");
    expect(brief).toContain("Branch: opencode/define-contract");
    expect(brief).toContain("Define the bounded contract.");
  });

  it("carries every acceptance criterion verbatim and in the plan's order", () => {
    const repo = briefRepo();
    const brief = renderActionBrief({
      repoRoot: repo,
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: "opencode/define-contract",
      agent: "opencode"
    });

    const first = brief.indexOf("The contract exists.");
    const second = brief.indexOf("The contract is published.");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(brief).toContain("Acceptance criteria (verbatim, in the plan's order):");
    expect(brief).toContain("  1. The contract exists.");
    expect(brief).toContain("  2. The contract is published.");
  });

  it("states the standing constraints and the exact completion protocol", () => {
    const repo = briefRepo();
    const brief = renderActionBrief({
      repoRoot: repo,
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: "opencode/define-contract",
      agent: "codex"
    });

    expect(brief).toContain("do not merge, deploy, publish, push to shared");
    expect(brief).toContain("Approval boundaries are hard stops.");
    expect(brief).toContain("Run the repository's declared validation and make it pass.");
    expect(brief).toContain("arcadia-preserve-broker-codex");
    expect(brief).toContain("Settle a `complete` Agent Ask with `candidate_revision` equal to this worktree's HEAD");
    expect(brief).toContain("`met` evidence entry per acceptance criterion above, verbatim and in order.");
  });

  it("names the provider's own fixed preservation launcher for every configured provider", () => {
    const repo = briefRepo();
    for (const [agent, launcher] of [["codex", "arcadia-preserve-broker-codex"], ["claude", "arcadia-preserve-broker-claude"], ["opencode", "arcadia-preserve-broker-opencode"]] as const) {
      const brief = renderActionBrief({
        repoRoot: repo,
        projectSlug: "test-project",
        planSlug: "copy-proof",
        actionId: "define-contract",
        worktreePath: "/worktrees/define-contract",
        branch: "opencode/define-contract",
        agent
      });
      expect(brief).toContain(launcher);
    }
  });

  it("fails closed with a named error when the Action is missing", () => {
    const repo = briefRepo();
    expect(() =>
      renderActionBrief({
        repoRoot: repo,
        projectSlug: "test-project",
        planSlug: "copy-proof",
        actionId: "does-not-exist",
        worktreePath: "/worktrees/define-contract",
        branch: "opencode/define-contract",
        agent: "opencode"
      })
    ).toThrowError(/Action "does-not-exist" was not found in plan "copy-proof"/);
  });

  it("fails closed with a named error when the plan is missing", () => {
    const repo = briefRepo();
    try {
      renderActionBrief({
        repoRoot: repo,
        projectSlug: "test-project",
        planSlug: "no-such-plan",
        actionId: "define-contract",
        worktreePath: "/worktrees/define-contract",
        branch: "opencode/define-contract",
        agent: "opencode"
      });
      throw new Error("Expected ArcadiaError");
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      expect((error as ArcadiaError).code).toBe("VALIDATION_ERROR");
      expect((error as Error).message).toContain('plan "no-such-plan" was not found');
    }
  });

  it("fails closed when the Action declares no acceptance criteria", () => {
    const repo = briefRepo();
    try {
      renderActionBrief({
        repoRoot: repo,
        projectSlug: "test-project",
        planSlug: "copy-proof",
        actionId: "legacy-action",
        worktreePath: "/worktrees/legacy-action",
        branch: "opencode/legacy-action",
        agent: "opencode"
      });
      throw new Error("Expected ArcadiaError");
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      expect((error as ArcadiaError).code).toBe("VALIDATION_ERROR");
      expect((error as Error).message).toContain('Action "legacy-action" declares no acceptance criteria');
    }
  });
});

function briefRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-brief-"));
  roots.push(root);
  mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(root, "CONSTITUTION.md"), "# Constitution\n\n## Authority\n\n- Approval boundaries are hard stops.\n");
  writeFileSync(path.join(root, "docs", "plans", "copy-proof.md"), `---
arcadia: v1
type: plan
slug: copy-proof
project: test-project
status: active
milestone: Prove the Session contract
current_action: define-contract
token_impact: medium
token_budget: One bounded Session.
recommended_model: sonnet
recommended_reasoning_effort: high
updated: 2026-09-17
actions:
  - id: define-contract
    title: Define the contract
    status: open
    responsibility: codex
    effort: session
    clarification: clarified
    next_action: Define the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
      - The contract is published.
  - id: legacy-action
    title: Legacy action
    status: open
    responsibility: agent
    next_action: Finish the legacy action.
    acceptance_criteria: []
---
`);
  return root;
}
