import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runGoCommand, type GoCommandOptions } from "../src/commands/go.js";
import { runGoBroker } from "../src/goBroker.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { getActiveActionClaim, reserveAgentWorktree } from "../src/sessions/index.js";
import { requirementIdentity } from "../src/sessions/roleLineage.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const PROJECT = "walk-project";
// Lets a test run code at the one point inside apply that sits between the two
// walked-input checks: after the first, before the second.
const gate = vi.hoisted(() => ({ armed: null as null | (() => void) }));

vi.mock("../src/ask/operatorGate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ask/operatorGate.js")>();
  return {
    ...actual,
    resolveOperatorGate: ((input: Parameters<typeof actual.resolveOperatorGate>[0]) => {
      const result = actual.resolveOperatorGate(input);
      if (gate.armed && input.selectedActionId === "gamma") {
        const hook = gate.armed;
        gate.armed = null;
        hook();
      }
      return result;
    }) as typeof actual.resolveOperatorGate
  };
});

beforeEach(() => vi.stubEnv("CODEX_SANDBOX", ""));
afterEach(() => {
  gate.armed = null;
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  main: string;
  workspace: string;
  agentRoot: string;
}

/** alpha is the pointer; gamma and delta are ready; beta waits on alpha. */
function createFixture(gamma: { dependsOn?: string[]; responsibility?: string } = {}): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-go-broker-walk-"));
  roots.push(root);
  const main = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(main, "docs", "plans"), { recursive: true });
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["config", "user.email", "arcadia@example.test"]);
  git(main, ["config", "user.name", "Arcadia Test"]);
  writeFileSync(path.join(main, "PROJECT.md"), `---
arcadia: v1
type: project
slug: ${PROJECT}
name: Walk Project
status: active
goal: Hand each concurrent broker go a different ready Action.
milestone: Walk milestone
active_plan: walk-plan
current_action: alpha
updated: 2026-11-02
---

# Walk Project
`);
  const action = (id: string, dependsOn: string[], responsibility = "agent") => `  - id: ${id}
    title: Action ${id}
    status: open
    responsibility: ${responsibility}
    effort: session
    clarification: clarified
    next_action: Implement ${id}.
    expected_artifact: docs/${id}.md
    acceptance_criteria:
      - The ${id} Artifact exists.
    depends_on: [${dependsOn.join(", ")}]
`;
  writeFileSync(path.join(main, "docs", "plans", "walk-plan.md"), `---
arcadia: v1
type: plan
slug: walk-plan
project: ${PROJECT}
status: active
milestone: Walk milestone
token_impact: medium
token_budget: "One bounded pass per Action."
recommended_model: claude-sonnet-5
current_action: alpha
updated: 2026-11-02
actions:
${action("alpha", [])}${action("beta", ["alpha"])}${action("gamma", gamma.dependsOn ?? [], gamma.responsibility)}${action("delta", [])}---

# Walk plan
`);
  git(main, ["add", "."]);
  git(main, ["commit", "-qm", "initial"]);
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Walk Project", mission: "Walk the queue.", status: "active",
      currentMilestone: "Walk milestone", nextAction: "Implement alpha.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: main });
  });
  return { root, main, workspace, agentRoot: path.join(root, "agent-worktrees") };
}

/** One ordinary broker `go` from the primary checkout with the real Go command. */
function brokerGo(
  fixture: Fixture,
  extra: (options: GoCommandOptions) => Partial<GoCommandOptions> = () => ({})
) {
  const options: GoCommandOptions[] = [];
  const result = runGoBroker(
    { source: fixture.main, agent: "claude", operation: "go" },
    (goOptions) => {
      options.push(goOptions);
      return runGoCommand({
        ...goOptions,
        model: "claude-sonnet-5",
        workspace: fixture.workspace,
        agentWorktreeRoot: fixture.agentRoot,
        now: new Date(),
        ...extra(goOptions)
      });
    },
    undefined, undefined, () => fixture.workspace
  );
  return { data: result.data as Awaited<ReturnType<typeof runGoCommand>>["data"], options };
}

function claimExternally(fixture: Fixture, actionId: string): void {
  const worktree = path.join(fixture.root, "elsewhere", actionId);
  mkdirSync(worktree, { recursive: true });
  withDatabase(fixture.workspace, (db) => {
    reserveAgentWorktree(db, {
      repositoryPath: fixture.main, worktreePath: worktree, branch: `claude/${actionId}-elsewhere`,
      now: new Date(), project: PROJECT, actionId
    });
  });
}

function claimed(fixture: Fixture, actionId: string): boolean {
  return withDatabase(fixture.workspace, (db) =>
    getActiveActionClaim(db, fixture.main, PROJECT, actionId, new Date()) !== null);
}

function refusal(run: () => unknown): ArcadiaError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    return error as ArcadiaError;
  }
  throw new Error("Expected the broker go to refuse");
}

describe("broker go from the primary checkout walks the ready queue", () => {
  it("hands two sequential requests two different ready Actions, never the same one twice", () => {
    const fixture = createFixture();
    const first = brokerGo(fixture);
    const second = brokerGo(fixture);
    const third = brokerGo(fixture);

    const dispatched = [first, second, third].map((result) => result.data.dispatch.context?.action.id);
    expect(dispatched).toEqual(["alpha", "gamma", "delta"]);
    expect(new Set(dispatched).size).toBe(3);
    expect(first.data.queueFallback).toBeNull();
    expect(second.data.queueFallback).toMatchObject({ pointerActionId: "alpha", actionId: "gamma" });

    // The first request had no claimed pointer, so it stayed strictly fenced; the
    // second observed alpha claimed and bound preview and apply to gamma.
    expect(first.options.every((options) => options.initialSelection?.walk === undefined)).toBe(true);
    expect(second.options).toHaveLength(2);
    for (const options of second.options) {
      expect(options.strictAction).toBe(true);
      expect(options.initialSelection?.walk).toMatchObject({ actionId: "gamma" });
      expect(options.initialSelection?.walk?.inputRevision).toEqual(expect.any(String));
    }
    expect(second.options[0].initialSelection).toEqual(second.options[1].initialSelection);

    // Every ready Action is now held, so a fourth request has nothing to walk to.
    const exhausted = refusal(() => brokerGo(fixture));
    expect(exhausted.message).toContain("Another live worktree already claims this Action");
    expect(readFileSync(path.join(fixture.main, "PROJECT.md"), "utf8")).toContain("current_action: alpha");
  });

  it("skips an externally claimed candidate when it observes the walk", () => {
    const fixture = createFixture();
    brokerGo(fixture);
    claimExternally(fixture, "gamma");
    const next = brokerGo(fixture);
    expect(next.data.dispatch.context?.action.id).toBe("delta");
    expect(next.options[0].initialSelection?.walk).toMatchObject({ actionId: "delta" });
  });

  it("refuses when the walked Action's governed input changes between preview and apply", () => {
    const fixture = createFixture();
    brokerGo(fixture);
    const plan = path.join(fixture.main, "docs", "plans", "walk-plan.md");

    const error = refusal(() => brokerGo(fixture, (options) => options.apply ? {
      testHooks: {
        beforeDispatchTransaction: () => writeFileSync(plan, readFileSync(plan, "utf8").replace("Implement gamma.", "Implement gamma differently."))
      }
    } : {}));

    expect(error.details).toMatchObject({ code: "go_selection_changed", expectedAction: "gamma" });
    expect(claimed(fixture, "gamma")).toBe(false);
    expect(claimed(fixture, "delta")).toBe(false);
  });

  it("refuses rather than walking on when the walked Action is claimed by someone else first", () => {
    const fixture = createFixture();
    brokerGo(fixture);

    const error = refusal(() => brokerGo(fixture, (options) => options.apply ? {
      testHooks: { beforeDispatchTransaction: () => claimExternally(fixture, "gamma") }
    } : {}));

    expect(error.message).toContain("Another live worktree already claims this Action");
    expect(claimed(fixture, "delta")).toBe(false);
  });

  it("refuses when the pointer Action is released after the walk was observed", () => {
    const fixture = createFixture();
    brokerGo(fixture);

    const error = refusal(() => brokerGo(fixture, (options) => options.apply ? {
      testHooks: {
        beforeDispatchTransaction: () => withDatabase(fixture.workspace, (db) => {
          db.prepare("DELETE FROM agent_worktree_reservations WHERE action_id = 'alpha'").run();
        })
      }
    } : {}));

    expect(error.details).toMatchObject({ code: "go_selection_changed" });
    expect(claimed(fixture, "gamma")).toBe(false);
  });

  it("refuses when the pointer moves between preview and apply, as before", () => {
    const fixture = createFixture();
    brokerGo(fixture);
    const project = path.join(fixture.main, "PROJECT.md");
    const plan = path.join(fixture.main, "docs", "plans", "walk-plan.md");

    const error = refusal(() => brokerGo(fixture, (options) => options.apply ? {
      testHooks: {
        beforeDispatchTransaction: () => {
          writeFileSync(project, readFileSync(project, "utf8").replace("current_action: alpha", "current_action: delta"));
          writeFileSync(plan, readFileSync(plan, "utf8").replace("current_action: alpha", "current_action: delta"));
        }
      }
    } : {}));

    expect(error.details).toMatchObject({ code: "go_selection_changed" });
    expect(claimed(fixture, "gamma")).toBe(false);
    expect(claimed(fixture, "delta")).toBe(false);
  });

  it("still stops the walk on a repository-scoped refusal about the pointer's own candidate", () => {
    const fixture = createFixture();
    const first = brokerGo(fixture);
    writeFileSync(path.join(first.data.nextWorktree!.path, "unsaved.txt"), "not committed\n");

    const error = refusal(() => brokerGo(fixture));

    expect(error.message).toContain("already holds uncommitted changes");
    expect(claimed(fixture, "gamma")).toBe(false);
  });

  it("skips a first-ready Action whose orphan candidate apply would refuse, and prepares the next one", () => {
    const fixture = createFixture();
    const orphan = path.join(fixture.root, "abandoned-gamma");
    git(fixture.main, ["worktree", "add", "-q", "-b", "claude/gamma-abandoned", orphan]);
    writeFileSync(path.join(orphan, "unsaved.txt"), "not committed\n");
    brokerGo(fixture);

    const next = brokerGo(fixture);
    const again = refusal(() => brokerGo(fixture));

    expect(next.data.dispatch.context?.action.id).toBe("delta");
    expect(next.options[0].initialSelection?.walk).toMatchObject({ actionId: "delta" });
    expect(again.message).toContain("Another live worktree already claims this Action");
    expect(claimed(fixture, "gamma")).toBe(false);
    expect(readFileSync(path.join(orphan, "unsaved.txt"), "utf8")).toBe("not committed\n");
    expect(git(orphan, ["status", "--porcelain"])).toContain("unsaved.txt");
  });

  it.each([
    ["dependency-blocked", { dependsOn: ["alpha"] }],
    ["requires_review", { responsibility: "requires_review" }]
  ])("never binds a %s Action and walks to the next ready one", (_label, gamma) => {
    const fixture = createFixture(gamma);
    brokerGo(fixture);
    const next = brokerGo(fixture);
    expect(next.data.dispatch.context?.action.id).toBe("delta");
    expect(next.options[0].initialSelection?.walk).toMatchObject({ actionId: "delta" });
    expect(claimed(fixture, "gamma")).toBe(false);
  });

  it("skips an operator-gated Action when it observes the walk", () => {
    const fixture = createFixture();
    mkdirSync(path.join(fixture.main, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(fixture.main, "docs", "decisions", "0001-block-gamma.md"), `---
arcadia: v1
type: decision
id: "0001"
slug: block-gamma
project: ${PROJECT}
action: gamma
status: open
question: Should gamma pause?
options:
  - label: Pause gamma
    consequence: Gamma waits for this Decision.
    recommended: true
updated: 2026-11-02
---

# Decision
`);
    git(fixture.main, ["add", "."]);
    git(fixture.main, ["commit", "-qm", "open a Decision that gates gamma"]);
    brokerGo(fixture);
    const next = brokerGo(fixture);
    expect(next.data.dispatch.context?.action.id).toBe("delta");
    expect(next.options[0].initialSelection?.walk).toMatchObject({ actionId: "delta" });
    expect(claimed(fixture, "gamma")).toBe(false);
  });

  describe("each walked-input check is independently load-bearing", () => {
    const plan = (fixture: Fixture) => path.join(fixture.main, "docs", "plans", "walk-plan.md");
    const edit = (fixture: Fixture, from: string, to: string) =>
      writeFileSync(plan(fixture), readFileSync(plan(fixture), "utf8").replace(from, to));

    it("refuses when the input changes after the first check and before the second", () => {
      const fixture = createFixture();
      brokerGo(fixture);
      const error = refusal(() => brokerGo(fixture, (options) => options.apply ? {
        testHooks: {
          beforeDispatchTransaction: () => {
            gate.armed = () => edit(fixture, "Implement gamma.", "Implement gamma late.");
          }
        }
      } : {}));
      expect(error.details).toMatchObject({ code: "go_selection_changed", expectedAction: "gamma" });
      expect(claimed(fixture, "gamma")).toBe(false);
    });

    it("refuses when the input changed before the first check, even if it reverts before the second", () => {
      const fixture = createFixture();
      brokerGo(fixture);
      const error = refusal(() => brokerGo(fixture, (options) => options.apply ? {
        testHooks: {
          beforeDispatchTransaction: () => {
            edit(fixture, "Implement gamma.", "Implement gamma early.");
            gate.armed = () => edit(fixture, "Implement gamma early.", "Implement gamma.");
          }
        }
      } : {}));
      expect(error.details).toMatchObject({ code: "go_selection_changed", expectedAction: "gamma" });
      expect(claimed(fixture, "gamma")).toBe(false);
    });
  });

  it("never lets enrollment walk, even when the broker's snapshot carries a walk", () => {
    const fixture = createFixture();
    brokerGo(fixture);
    const identity = requirementIdentity({
      projectSlug: PROJECT, planSlug: "walk-plan",
      action: resolveDispatch(fixture.main, PROJECT).context!.action
    });

    const error = refusal(() => brokerGo(fixture, () => ({
      strictAction: true,
      enrollment: { requestId: "enroll-request", actionId: "alpha", ...identity }
    })));

    expect(error.message).toContain("already claims this Action");
    expect(claimed(fixture, "gamma")).toBe(false);
    expect(claimed(fixture, "delta")).toBe(false);
  });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
