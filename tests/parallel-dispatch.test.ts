import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runAdvanceCommand } from "../src/commands/advance.js";
import { runGoCommand } from "../src/commands/go.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { getActiveActionClaim, reserveAgentWorktree } from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  main: string;
  workspace: string;
  agentRoot: string;
}

/**
 * A repository whose active Plan holds four Actions: the pointer's (`alpha`),
 * two more with no prerequisites (`gamma`, `delta`), and one that depends on
 * the pointer's and therefore is not dependency-ready (`beta`).
 *
 * Unlike `tests/go.test.ts`'s fixture this registers the Project in the
 * workspace database, because the queue walk reads `buildAgentQueue`, which
 * resolves Actions through `project_metadata.repo_path`.
 */
function createFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-parallel-dispatch-"));
  roots.push(root);
  const main = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(main);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["config", "user.email", "arcadia@example.test"]);
  git(main, ["config", "user.name", "Arcadia Test"]);
  writeFileSync(path.join(main, "PROJECT.md"), projectDocument);
  mkdirSync(path.join(main, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(main, "docs", "plans", "parallel-plan.md"), planDocument);
  git(main, ["add", "."]);
  git(main, ["commit", "-qm", "initial"]);
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Parallel Project",
      mission: "Dispatch a different ready Action to each concurrent session.",
      status: "active",
      currentMilestone: "Parallel milestone",
      nextAction: "Implement alpha.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: main });
  });
  return { root, main, workspace, agentRoot: path.join(root, "agent-worktrees") };
}

/** One `go --apply --agent` against the repository's own governed pointer. */
function dispatch(fixture: Fixture, stamp: string) {
  return runGoCommand({
    repo: fixture.main,
    source: fixture.main,
    apply: true,
    agent: "claude",
    model: "claude-sonnet-5",
    workspace: fixture.workspace,
    agentWorktreeRoot: fixture.agentRoot,
    now: new Date(stamp)
  }).data;
}

describe("arcadia go — one ready Action per concurrent session", () => {
  it("lands two dispatches against the same current_action on two different ready Actions", () => {
    const fixture = createFixture();

    const first = dispatch(fixture, "2026-09-22T10:00:00.000Z");
    const second = dispatch(fixture, "2026-09-22T10:02:00.000Z");

    // The pointer's Action goes to whoever asked first, exactly as before.
    expect(first.dispatch.context?.action.id).toBe("alpha");
    expect(first.queueFallback).toBeNull();
    expect(first.nextWorktree?.branch).toBe("claude/alpha-20260922T100000000Z");

    // The 2026-09-22 collision: the second session, two minutes later, used to
    // be handed the identical Action. It now walks the queue instead.
    expect(second.dispatch.context?.action.id).toBe("gamma");
    expect(second.queueFallback).toMatchObject({ pointerActionId: "alpha", actionId: "gamma" });
    expect(second.nextWorktree?.branch).toBe("claude/gamma-20260922T100200000Z");

    // `current_action` never moved; it is still a single value naming alpha.
    expect(readPointer(fixture)).toBe("current_action: alpha");

    // Both claims are live, on two different Actions, from two different
    // worktrees — which is the whole point.
    withDatabase(fixture.workspace, (db) => {
      const now = new Date("2026-09-22T10:03:00.000Z");
      expect(getActiveActionClaim(db, fixture.main, "parallel-project", "alpha", now)?.worktree_path)
        .toBe(realpathSync(first.nextWorktree!.path));
      expect(getActiveActionClaim(db, fixture.main, "parallel-project", "gamma", now)?.worktree_path)
        .toBe(realpathSync(second.nextWorktree!.path));
    });
  });

  it("skips a dependency-blocked entry and an already-claimed one, then refuses when the walk runs out", () => {
    const fixture = createFixture();

    // Pre-claim gamma from outside `go`, so the walk has to skip an entry that
    // is dependency-ready but taken, as well as `beta`, which is neither.
    withDatabase(fixture.workspace, (db) => {
      reserveAgentWorktree(db, {
        repositoryPath: fixture.main,
        worktreePath: path.join(fixture.root, "elsewhere", "gamma"),
        branch: "claude/gamma-elsewhere",
        now: new Date("2026-09-22T09:00:00.000Z"),
        project: "parallel-project",
        actionId: "gamma"
      });
    });

    dispatch(fixture, "2026-09-22T10:00:00.000Z");
    const third = dispatch(fixture, "2026-09-22T10:02:00.000Z");

    // alpha is claimed, gamma is claimed, beta depends on the unfinished alpha
    // and so is never a candidate: delta is the only dependency-ready entry
    // left, and it is what the walk lands on.
    expect(third.dispatch.context?.action.id).toBe("delta");
    expect(third.queueFallback).toMatchObject({ pointerActionId: "alpha", actionId: "delta" });

    // With every ready Action claimed, the walk has nothing left to offer and
    // the pointer Action's own refusal is what the operator reads — the exact
    // message and remedy they would have seen before the fallback existed.
    const exhausted = expectValidation(() => dispatch(fixture, "2026-09-22T10:04:00.000Z"));
    expect(exhausted.message).toContain("Another live worktree already claims this Action");
    expect(exhausted.details).toMatchObject({ actionId: "alpha" });
  });

  it("leaves a repository-scoped refusal alone instead of walking past it", () => {
    const fixture = createFixture();
    dispatch(fixture, "2026-09-22T10:00:00.000Z");

    // An uncommitted candidate for the pointer's Action is a refusal about this
    // *repository's* unresolved state, not about which Action is free. Walking
    // past it would prepare a second worktree over work nobody has preserved.
    const orphan = path.join(fixture.agentRoot, "alpha-20260922T100000000Z", "repo");
    writeFileSync(path.join(orphan, "unsaved.txt"), "not committed\n");

    const refusal = expectValidation(() => dispatch(fixture, "2026-09-22T10:02:00.000Z"));
    expect(refusal.message).toContain("already holds uncommitted changes");
  });

  it("skips a fallback candidate's own unresolved worktree instead of stopping the walk on it", () => {
    const fixture = createFixture();
    // gamma was prepared by hand, abandoned with uncommitted changes, and holds
    // no claim. That is a refusal about *gamma*, not about this repository — a
    // repository-scoped refusal would already have stopped the pointer attempt
    // — so the walk has to get past it to reach the next free entry.
    const orphan = path.join(fixture.root, "abandoned-gamma");
    git(fixture.main, ["worktree", "add", "-q", "-b", "claude/gamma-20260922T090000000Z", orphan]);
    writeFileSync(path.join(orphan, "unsaved.txt"), "not committed\n");

    dispatch(fixture, "2026-09-22T09:00:00.000Z");
    const next = dispatch(fixture, "2026-09-22T10:00:00.000Z");

    expect(next.dispatch.context?.action.id).toBe("delta");
    expect(next.queueFallback).toMatchObject({ pointerActionId: "alpha", actionId: "delta" });
  });
});

describe("arcadia advance — a prepared worktree resolves its own claim", () => {
  it("briefs the worktree on the Action it claims, never on the governed pointer", () => {
    const fixture = createFixture();
    dispatch(fixture, "2026-09-22T10:00:00.000Z");
    const fallback = dispatch(fixture, "2026-09-22T10:02:00.000Z");

    const inside = runAdvanceCommand({
      workspace: fixture.workspace,
      repo: fallback.nextWorktree!.path
    }).data;

    // `current_action` still says alpha. This worktree was dispatched to gamma
    // and is briefed on gamma; reading the pointer here would hand it work
    // another live session already holds.
    expect(readPointer(fixture)).toBe("current_action: alpha");
    expect(inside.claimedAction).toBe("gamma");
    expect(inside.transition?.dispatch.context?.action.id).toBe("gamma");
    expect(inside.transition?.kind).toBe("launch");

    // Running it again changes nothing: the claim, not queue order, decides.
    // An in-progress worktree is never reassigned, however the queue moves.
    const again = runAdvanceCommand({ workspace: fixture.workspace, repo: fallback.nextWorktree!.path }).data;
    expect(again.claimedAction).toBe("gamma");
    expect(again.transition?.dispatch.context?.action.id).toBe("gamma");
  });

  it("still resolves the governed pointer in a checkout that holds no claim", () => {
    const fixture = createFixture();

    const inMain = runAdvanceCommand({ workspace: fixture.workspace, repo: fixture.main }).data;

    expect(inMain.claimedAction).toBeNull();
    expect(inMain.transition?.dispatch.context?.action.id).toBe("alpha");
  });
});

function readPointer(fixture: Fixture): string {
  const content = readFileSync(path.join(fixture.main, "PROJECT.md"), "utf8");
  return content.split(/\r?\n/).find((line) => line.startsWith("current_action:")) ?? "";
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function expectValidation(run: () => unknown): ArcadiaError {
  try {
    run();
    throw new Error("Expected validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    return error as ArcadiaError;
  }
}

const projectDocument = `---
arcadia: v1
type: project
slug: parallel-project
name: Parallel Project
status: active
goal: Dispatch a different ready Action to each concurrent session.
milestone: Parallel milestone
active_plan: parallel-plan
current_action: alpha
updated: 2026-09-22
---

# Parallel Project

## Mission

Dispatch a different ready Action to each concurrent session.
`;

const planDocument = `---
arcadia: v1
type: plan
slug: parallel-plan
project: parallel-project
status: active
milestone: Parallel milestone
token_impact: medium
token_budget: "One bounded implementation pass per Action."
recommended_model: claude-sonnet-5
current_action: alpha
updated: 2026-09-22
actions:
  - id: alpha
    title: First Action
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Implement the first Action.
    expected_artifact: docs/alpha.md
    acceptance_criteria:
      - The first Action is done.
    depends_on: []
  - id: beta
    title: Second Action
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Implement the second Action.
    expected_artifact: docs/beta.md
    acceptance_criteria:
      - The second Action is done.
    depends_on: [alpha]
  - id: gamma
    title: Third Action
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Implement the third Action.
    expected_artifact: docs/gamma.md
    acceptance_criteria:
      - The third Action is done.
    depends_on: []
  - id: delta
    title: Fourth Action
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Implement the fourth Action.
    expected_artifact: docs/delta.md
    acceptance_criteria:
      - The fourth Action is done.
    depends_on: []
---

# Parallel plan
`;
