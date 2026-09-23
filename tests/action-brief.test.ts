import { execFileSync } from "node:child_process";
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
      agent: "opencode",
      baseRevision: head(repo)
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
      agent: "opencode",
      baseRevision: head(repo)
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
      agent: "codex",
      baseRevision: head(repo)
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
        agent,
        baseRevision: head(repo)
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
        agent: "opencode",
      baseRevision: head(repo)
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
        agent: "opencode",
      baseRevision: head(repo)
      });
      throw new Error("Expected ArcadiaError");
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      expect((error as ArcadiaError).code).toBe("VALIDATION_ERROR");
      expect((error as Error).message).toContain('plan "no-such-plan" was not found');
    }
  });

  it("embeds the Constitution committed at the base revision exactly once, with its fingerprint", () => {
    const repo = briefRepo();
    const rendered = brief(repo);
    expect(rendered).toMatch(/CONSTITUTION\.md \(sha256 [0-9a-f]{12}\) also binds this action/);
    expect(rendered.split("Approval boundaries are hard stops.").length - 1).toBe(1);
  });

  it("refuses to launch when the worktree's Constitution drifted from the base revision", () => {
    const repo = briefRepo();
    const base = head(repo);
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "# Constitution\n\n- Anything goes.\n");
    expect(() => brief(repo, base)).toThrow(/cannot launch: CONSTITUTION\.md in the worktree differs.*pinned to base revision/);
    rmSync(path.join(repo, "CONSTITUTION.md"));
    expect(() => brief(repo, base)).toThrow(/CONSTITUTION\.md in the worktree differs/);
  });

  it("refuses to launch when the Constitution is unreadable or the base revision is unknown", () => {
    const repo = briefRepo();
    const base = head(repo);
    rmSync(path.join(repo, "CONSTITUTION.md"));
    mkdirSync(path.join(repo, "CONSTITUTION.md"));
    expect(() => brief(repo, base)).toThrow(/cannot launch: .*could not be read/);
    expect(() => brief(repo, "0".repeat(40))).toThrow(/cannot be verified/);
  });

  it("does not mistake a checkout's CRLF conversion for a changed Constitution", () => {
    const repo = briefRepo();
    execFileSync("git", ["config", "core.autocrlf", "true"], { cwd: repo });
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "# Constitution\r\n\r\n## Authority\r\n\r\n- Approval boundaries are hard stops.\r\n");
    expect(brief(repo)).toContain("Approval boundaries are hard stops.");
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
        agent: "opencode",
      baseRevision: head(repo)
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
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.email=brief@example.invalid", "-c", "user.name=Brief", "add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.email=brief@example.invalid", "-c", "user.name=Brief", "commit", "-qm", "fixture"], { cwd: root });
  return root;
}

function head(repo: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

function brief(repo: string, baseRevision = head(repo)): string {
  return renderActionBrief({
    repoRoot: repo, projectSlug: "test-project", planSlug: "copy-proof", actionId: "define-contract",
    worktreePath: "/worktrees/define-contract", branch: "opencode/define-contract", agent: "opencode", baseRevision
  });
}
