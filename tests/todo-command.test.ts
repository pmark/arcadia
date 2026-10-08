import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Passes through, except that a repository whose path contains "boom" makes dispatch resolution throw, to
// prove one Project's failure does not drop the others.
vi.mock("../src/docs/dispatch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/docs/dispatch.js")>();
  return {
    ...original,
    resolveDispatch: (...args: Parameters<typeof original.resolveDispatch>) => {
      if (String(args[0]).includes("boom")) throw new Error("dispatch exploded");
      return original.resolveDispatch(...args);
    }
  };
});
import {
  AGENT_ASK_CAVEAT,
  runTodoCommand,
  renderTodoSuccess,
  type TodoCommandOptions,
  type TodoData
} from "../src/commands/todo.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `arcadia-todo-${prefix}-`));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function projectDoc(): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Prove the to-do view.", "milestone: Prove it", "active_plan: main-plan",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

/** The only open Action is `second-step`, which needs Decision 0001: nothing is eligible, so 0001 blocks. */
function planDoc(): string {
  return [
    "---", "arcadia: v1", "type: plan", "slug: main-plan", "project: demo", "status: active",
    "milestone: Prove it", "current_action: second-step", "token_impact: medium",
    "token_budget: One bounded pass.", "recommended_model: gpt-5.6-sol", "updated: 2026-09-01",
    "actions:",
    "  - id: second-step", "    title: Take the blocked second step", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Take the second step.",
    "    expected_artifact: A second receipt", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - The second step happens.", "    depends_on: []",
    "    decisions: [\"0001\"]", "    references: []",
    "questions: []", "---", "", "# Main plan", ""
  ].join("\n");
}

function decisionDoc(id: string, question: string, updated: string): string {
  return ["---", "arcadia: v1", "type: decision", `id: "${id}"`, `slug: decision-${id}`,
    "project: demo", "status: open", `question: ${question}`, `updated: ${updated}`,
    "options:",
    "  - label: Go ahead", "    consequence: The step proceeds.", "    recommended: true",
    "---", "", "# Decision", ""].join("\n");
}

function fixtureRepo(extraAlerts = 1): string {
  const repo = temp("repo");
  write(repo, "PROJECT.md", projectDoc());
  write(repo, "docs/plans/main-plan.md", planDoc());
  write(repo, "docs/decisions/0001-block.md", decisionDoc("0001", "Should the second step proceed?", "2026-09-03"));
  for (let index = 0; index < extraAlerts; index += 1) {
    const id = String(index + 2).padStart(4, "0");
    write(repo, `docs/decisions/${id}-alert.md`, decisionDoc(id, `Unrelated question ${id}?`, `2026-09-${String(10 + index).padStart(2, "0")}`));
  }
  return repo;
}

/** These fixtures live under the OS temp directory, so the fixture-Project rule is off unless a test turns it on. */
function run(options: TodoCommandOptions) {
  return runTodoCommand({ fixtureRoots: [], ...options });
}

interface FixtureAsk {
  id: string;
  createdAt: string;
  project?: string;
  desiredResult: string;
  intent?: string;
  targetRef?: string | null;
  rationale?: string | null;
  actions?: Array<{ id: string | null; targetRef: string | null }>;
  /** Insert a settlement with this disposition, so the proposal is no longer unsettled. */
  settled?: "accepted" | "rejected";
}

function fixtureWorkspace(repo: string, asks: FixtureAsk[] = []): string {
  const workspace = temp("workspace");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const bundle = createProjectWithInitialWork(db, {
      name: "Demo", mission: "Prove the to-do view.", status: "active", currentMilestone: "Prove it",
      nextAction: "Prove it", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: bundle.project.id, repoPath: repo });
    for (const ask of asks) {
      db.prepare("INSERT INTO ask_capture_envelopes (id, request_id, fingerprint, original_text, ingress_source, captured_at, status, envelope_json) VALUES (?, ?, 'f', 'x', 'test', ?, 'completed', '{}')")
        .run(`capture-${ask.id}`, `request-${ask.id}`, ask.createdAt);
      const normalized = {
        project: ask.project ?? "demo", desiredResult: ask.desiredResult, intent: ask.intent ?? "amend",
        targetRef: ask.targetRef ?? null, rationale: ask.rationale ?? null, actions: ask.actions ?? [], options: []
      };
      db.prepare("INSERT INTO agent_ask_proposals (id, request_id, capture_id, fingerprint, format, intent_kind, project_ref, proposal_json, created_at) VALUES (?, ?, ?, 'f', 'strict', 'amend', ?, ?, ?)")
        .run(ask.id, `request-${ask.id}`, `capture-${ask.id}`, normalized.project, JSON.stringify({ id: ask.id, normalized }), ask.createdAt);
      if (ask.settled) {
        db.prepare("INSERT INTO agent_ask_settlements (id, proposal_id, request_id, operation_json, fingerprint, disposition, project_slug, effects_json, receipt_json, created_at) VALUES (?, ?, ?, '{}', 'f', ?, ?, '[]', '{}', ?)")
          .run(`settlement-${ask.id}`, ask.id, `settle-${ask.id}`, ask.settled, normalized.project, ask.createdAt);
      }
    }
  });
  return workspace;
}

function render(data: TodoData): string[] {
  return renderTodoSuccess({ ok: true, command: "todo", data, artifacts: [], warnings: [] });
}

describe("arcadia todo", () => {
  it("lists a blocking Decision, an alert Decision and an Agent Ask with the source's own words and canonical answers", () => {
    const repo = fixtureRepo();
    const workspace = fixtureWorkspace(repo, [{ id: "proposal-1", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Amend the demo Action." }]);

    const { data } = run({ workspace, now: NOW });

    expect(data).toEqual({
      schema: "arcadia-todo-v1", view: "default",
      asOf: { at: "2026-10-08T12:00:00.000Z", workspace: path.basename(workspace), workspacePath: workspace },
      counts: { blocking: 1, other: 2, stale: 0, staleHidden: 0, byKind: { decision: 2, agent_ask: 1 }, hidden: 0, fixture: { projects: 0, items: 0 } },
      items: [
        {
          key: "decision:demo/0001", kind: "decision", title: "Should the second step proceed?", project: "demo", blocking: true,
          createdAt: "2026-09-03", sourceRef: "docs/decisions/0001-block.md",
          answer: "arcadia decision approve 0001 --project demo --answer 'Go ahead'"
        },
        {
          key: "decision:demo/0002", kind: "decision", title: "Unrelated question 0002?", project: "demo", blocking: false,
          createdAt: "2026-09-10", sourceRef: "docs/decisions/0002-alert.md",
          answer: "arcadia decision approve 0002 --project demo --answer 'Go ahead'"
        },
        {
          key: "agent_ask:demo/proposal-1", kind: "agent_ask", title: "Amend the demo Action.", project: "demo", blocking: false,
          createdAt: "2026-09-05T00:00:00.000Z", sourceRef: "agent_ask_proposals:proposal-1",
          answer: "arcadia agent-ask settle --proposal proposal-1 --request-id <settlement-request-id> --disposition accepted"
        }
      ],
      unavailable: []
    });

    const lines = render(data);
    expect(lines[0]).toBe(`Operator to-do: 1 blocking · 2 other · stale hidden: 0 (decisions 2, agent asks 1) (as of 2026-10-08T12:00:00.000Z, workspace ${path.basename(workspace)})`);
    expect(lines.filter((line) => line === AGENT_ASK_CAVEAT)).toHaveLength(1);
    expect(AGENT_ASK_CAVEAT).toContain("positive evidence only");
  });

  it("gives the same Decision id in two Projects distinct keys", () => {
    const repo = fixtureRepo(0);
    const workspace = fixtureWorkspace(repo);
    const otherRepo = temp("other-repo");
    write(otherRepo, "PROJECT.md", projectDoc().replace("slug: demo", "slug: other").replace("name: Demo", "name: Other"));
    write(otherRepo, "docs/decisions/0001-block.md", decisionDoc("0001", "Other Project question?", "2026-09-04").replace("project: demo", "project: other"));
    withDatabase(workspace, (db) => {
      const bundle = createProjectWithInitialWork(db, {
        name: "Other", mission: "A second Project.", status: "active", currentMilestone: "m", nextAction: "n", workClassification: "agent"
      });
      upsertProjectMetadata(db, { projectId: bundle.project.id, repoPath: otherRepo });
    });

    const { data } = run({ workspace, now: NOW, all: true });

    expect(data.items.map((item) => item.key).sort()).toEqual(["decision:demo/0001", "decision:other/0001"]);
    expect(new Set(data.items.map((item) => item.key)).size).toBe(2);
  });

  it("shows every blocking item, caps the others at five (Decisions newest-first), and says how many more", () => {
    const repo = fixtureRepo(7);
    const workspace = fixtureWorkspace(repo);

    const capped = run({ workspace, now: NOW });
    expect(capped.data.counts).toEqual({ blocking: 1, other: 7, stale: 0, staleHidden: 0, byKind: { decision: 8, agent_ask: 0 }, hidden: 2, fixture: { projects: 0, items: 0 } });
    expect(capped.data.items.filter((item) => !item.blocking).map((item) => item.key)).toEqual([
      "decision:demo/0008", "decision:demo/0007", "decision:demo/0006", "decision:demo/0005", "decision:demo/0004"
    ]);
    const lines = render(capped.data);
    expect(lines[0]).toBe(`Operator to-do: 1 blocking · 7 other · stale hidden: 0 (decisions 8, agent asks 0) (as of 2026-10-08T12:00:00.000Z, workspace ${path.basename(workspace)})`);
    expect(lines.at(-1)).toBe("2 more: --all");
    expect(lines.indexOf("Blocking:")).toBeLessThan(lines.indexOf("Other (Decisions newest first, then oldest first):"));

    const all = run({ workspace, now: NOW, all: true });
    expect(all.data.counts.hidden).toBe(0);
    expect(all.data.items).toHaveLength(8);
    expect(render(all.data).join("\n")).not.toContain("more: --all");
  });

  it("lists open Decisions first, newest first, then the other items oldest first, under the cap and in every view", () => {
    // Decisions 0002 (older) and 0003 (newer) are alerts; the Agent Asks are older than both.
    const repo = fixtureRepo(2);
    const asks = ["a", "b", "c", "d", "e"].map((name, index) => ({
      id: `proposal-${name}`, createdAt: `2026-08-0${index + 1}T00:00:00.000Z`, desiredResult: `Ask ${name}.`
    }));
    const workspace = fixtureWorkspace(repo, asks);

    const capped = run({ workspace, now: NOW });
    const order = ["decision:demo/0003", "decision:demo/0002", "agent_ask:demo/proposal-a", "agent_ask:demo/proposal-b", "agent_ask:demo/proposal-c"];
    expect(capped.data.items.map((item) => item.key)).toEqual(["decision:demo/0001", ...order]);
    expect(capped.data.counts.hidden).toBe(2);
    expect(render(capped.data)).toContain("2 more: --all");

    const all = run({ workspace, now: NOW, all: true });
    expect(all.data.items.map((item) => item.key)).toEqual([
      "decision:demo/0001", ...order, "agent_ask:demo/proposal-d", "agent_ask:demo/proposal-e"
    ]);
  });

  it("filters to one Project and refuses an unknown one", () => {
    const workspace = fixtureWorkspace(fixtureRepo());
    expect(run({ workspace, now: NOW, project: "demo" }).data.counts.blocking).toBe(1);
    expect(() => run({ workspace, now: NOW, project: "nope" })).toThrow(/Project not found/);
  });

  it("keeps an Agent Ask for a Project it cannot match instead of dropping it", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0), [
      { id: "stray", createdAt: "2026-09-06T00:00:00.000Z", project: "elsewhere", desiredResult: "Do something elsewhere." }
    ]);
    const { data } = run({ workspace, now: NOW });
    expect(data.items.map((item) => [item.key, item.project, item.blocking])).toEqual([
      ["decision:demo/0001", "demo", true],
      ["agent_ask:elsewhere/stray", "elsewhere", false]
    ]);
  });

  it("reports a Project with no readable repository as unavailable rather than silently omitting its Decisions", () => {
    const workspace = fixtureWorkspace(path.join(tmpdir(), "arcadia-todo-no-such-repo"));
    const { data } = run({ workspace, now: NOW });
    expect(data.items).toEqual([]);
    expect(data.unavailable).toHaveLength(1);
    expect(data.unavailable[0]).toMatch(/^project sources unavailable: demo has no repository at /);
    expect(render(data).at(-1)).toBe(data.unavailable[0]);
  });

  it("degrades to the checkout's Decisions with one explicit remedy line when the workspace cannot be read", () => {
    const repo = fixtureRepo();
    const missing = path.join(temp("missing"), "no-workspace-here");

    const { data } = run({ workspace: missing, now: NOW, repoRoot: repo });

    expect(data.asOf).toMatchObject({ workspace: null, workspacePath: null });
    expect(data.counts).toEqual({ blocking: 1, other: 1, stale: 0, staleHidden: 0, byKind: { decision: 2, agent_ask: 0 }, hidden: 0, fixture: { projects: 0, items: 0 } });
    expect(data.items.map((item) => item.key)).toEqual(["decision:demo/0001", "decision:demo/0002"]);
    expect(data.unavailable).toEqual([expect.stringMatching(/^workspace sources unavailable: no workspace at .*arcadia init <path>/)]);
    const lines = render(data);
    expect(lines.filter((line) => line.startsWith("workspace sources unavailable:"))).toHaveLength(1);
    expect(lines[0]).toBe("Operator to-do: 1 blocking · 1 other · stale hidden: 0 (decisions 2, agent asks 0) (as of 2026-10-08T12:00:00.000Z)");
  });

  it("names the configuration remedy when no workspace resolves at all", () => {
    const home = temp("home");
    const repo = fixtureRepo(0);
    vi.stubEnv("HOME", home);
    vi.stubEnv("ARCADIA_CONFIG_PATH", path.join(home, "none.json"));
    vi.stubEnv("ARCADIA_WORKSPACE", "");
    vi.stubEnv("ARCADIA_INVOKED_FROM", repo);
    vi.stubEnv("ARCADIA_REQUIRE_INLINE_WORKSPACE", "");

    const { data } = run({ now: NOW, repoRoot: repo });

    expect(data.unavailable).toEqual([
      "workspace sources unavailable: pass --workspace <path>, set ARCADIA_WORKSPACE=<path> inline on this command, or run from inside an initialized workspace"
    ]);
    expect(data.items.map((item) => item.key)).toEqual(["decision:demo/0001"]);
  });

  it("states plainly when nothing is waiting", () => {
    const repo = temp("empty");
    write(repo, "PROJECT.md", projectDoc());
    write(repo, "docs/plans/main-plan.md", planDoc());
    const workspace = fixtureWorkspace(repo);
    const lines = render(run({ workspace, now: NOW }).data).join("\n");
    expect(lines).toContain("0 blocking · 0 other · stale hidden: 0 (decisions 0, agent asks 0)");
    expect(lines).toContain("Nothing is waiting on you");
  });
});

/** A plan with one done Action, `first-step`, beside the open `second-step`. */
function planWithDoneAction(): string {
  return planDoc().replace(
    "actions:\n",
    [
      "actions:",
      "  - id: first-step", "    title: Take the finished first step", "    status: done",
      "    responsibility: agent", "    effort: session", "    next_action: Take the first step.",
      "    expected_artifact: A first receipt", "    clarification: clarified", "    confidence: high",
      "    acceptance_criteria:", "      - The first step happened.", "    depends_on: []",
      "    decisions: []", "    references: []",
      ""
    ].join("\n")
  );
}

function staleRepo(): string {
  const repo = temp("stale-repo");
  write(repo, "PROJECT.md", projectDoc());
  write(repo, "docs/plans/main-plan.md", planWithDoneAction());
  write(repo, "docs/decisions/0001-block.md", decisionDoc("0001", "Should the second step proceed?", "2026-09-03"));
  write(
    repo,
    "docs/decisions/0002-finished.md",
    decisionDoc("0002", "Was the first step wanted?", "2026-09-04").replace("updated:", "action: first-step\nupdated:")
  );
  return repo;
}

describe("arcadia todo: positive-evidence staleness", () => {
  const asks: FixtureAsk[] = [
    { id: "done-complete", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Complete first-step.", intent: "complete", targetRef: "action/first-step" },
    { id: "done-split", createdAt: "2026-09-05T01:00:00.000Z", desiredResult: "Split first-step.", intent: "split", targetRef: "first-step" },
    { id: "done-action", createdAt: "2026-09-05T02:00:00.000Z", desiredResult: "Amend first-step.", intent: "action", targetRef: "plan/main-plan#first-step" },
    { id: "unadopted", createdAt: "2026-09-05T03:00:00.000Z", desiredResult: "Complete an Action nobody adopted.", intent: "complete", targetRef: "action/ghost-action" },
    { id: "open-target", createdAt: "2026-09-05T04:00:00.000Z", desiredResult: "Complete second-step.", intent: "complete", targetRef: "action/second-step" },
    { id: "no-target", createdAt: "2026-09-05T05:00:00.000Z", desiredResult: "Propose something new.", intent: "action", targetRef: null },
    { id: "wrong-intent", createdAt: "2026-09-05T06:00:00.000Z", desiredResult: "Amend with a done target.", intent: "amend", targetRef: "action/first-step" }
  ];

  it("hides what positive evidence says is done, and never an un-adopted proposal (an Ask on the open selected Action is the live blocker)", () => {
    const workspace = fixtureWorkspace(staleRepo(), asks);

    const { data } = run({ workspace, now: NOW });

    expect(data.view).toBe("default");
    expect(data.items.map((item) => item.key)).toEqual([
      "decision:demo/0001",
      "agent_ask:demo/open-target",
      "agent_ask:demo/unadopted",
      "agent_ask:demo/no-target",
      "agent_ask:demo/wrong-intent"
    ]);
    expect(data.counts).toEqual({
      blocking: 2, other: 3, stale: 4, staleHidden: 4, byKind: { decision: 1, agent_ask: 4 }, hidden: 0,
      fixture: { projects: 0, items: 0 }
    });
    expect(data.items.every((item) => item.staleReason === undefined)).toBe(true);
    const lines = render(data);
    expect(lines[0]).toContain("2 blocking · 3 other · stale hidden: 4");
    expect(lines).toContain("4 stale hidden: --stale lists them with the evidence");
  });

  it("--stale lists only the stale items, each with its evidence", () => {
    const workspace = fixtureWorkspace(staleRepo(), asks);

    const { data } = run({ workspace, now: NOW, stale: true });

    expect(data.view).toBe("stale");
    expect(data.counts).toMatchObject({ stale: 4, staleHidden: 0, hidden: 0 });
    expect(data.items.map((item) => [item.key, item.staleReason])).toEqual([
      ["decision:demo/0002", "its Action first-step is done in plan main-plan"],
      ["agent_ask:demo/done-complete", "every Action it targets is done: first-step"],
      ["agent_ask:demo/done-split", "every Action it targets is done: first-step"],
      ["agent_ask:demo/done-action", "every Action it targets is done: first-step"]
    ]);
    const text = render(data).join("\n");
    expect(text).toContain("stale: its Action first-step is done in plan main-plan");
    expect(text).toContain("Operator to-do: 2 blocking · 3 other · stale: 4");
  });

  it("--all shows everything, stale last and labelled", () => {
    const workspace = fixtureWorkspace(staleRepo(), asks);

    const { data } = run({ workspace, now: NOW, all: true });

    expect(data.items).toHaveLength(9);
    expect(data.items.slice(-4).every((item) => item.staleReason !== undefined)).toBe(true);
    expect(data.counts).toMatchObject({ blocking: 2, other: 3, stale: 4, staleHidden: 0 });
    expect(render(data)[0]).toContain("stale: 4 (shown)");
  });

  it("treats a Project with no Plan evidence as live", () => {
    const workspace = fixtureWorkspace(staleRepo(), [
      { id: "mixed", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "x", intent: "complete", targetRef: "action/first-step" },
      { id: "elsewhere", createdAt: "2026-09-05T01:00:00.000Z", project: "other-project", desiredResult: "y", intent: "complete", targetRef: "action/first-step" }
    ]);
    const { data } = run({ workspace, now: NOW });
    // `mixed` targets a done Action and is stale; `elsewhere` is in a Project with no Plan evidence and is not.
    expect(data.items.map((item) => item.key)).toContain("agent_ask:other-project/elsewhere");
    expect(data.items.map((item) => item.key)).not.toContain("agent_ask:demo/mixed");
  });

  it("honours only an explicit Supersedes line, read from the stored rationale", () => {
    const workspace = fixtureWorkspace(staleRepo(), [
      { id: "old", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "First draft.", rationale: "An early proposal." },
      { id: "new", createdAt: "2026-09-06T00:00:00.000Z", desiredResult: "Second draft.", rationale: "Better.\nSupersedes: old, no-such-proposal" },
      { id: "mention", createdAt: "2026-09-07T00:00:00.000Z", desiredResult: "Mentions only.", rationale: "This replaces old in spirit." },
      { id: "ping", createdAt: "2026-09-08T00:00:00.000Z", desiredResult: "Ping.", rationale: "Supersedes: pong" },
      { id: "pong", createdAt: "2026-09-08T01:00:00.000Z", desiredResult: "Pong.", rationale: "Supersedes: ping" }
    ]);

    const { data } = run({ workspace, now: NOW, stale: true });

    expect(data.items.map((item) => [item.key, item.staleReason])).toContainEqual([
      "agent_ask:demo/old",
      "superseded by Agent Ask new (explicit Supersedes line in its rationale)"
    ]);
    // A free-text mention is not a Supersedes line, and two Asks naming each other cancel out.
    const staleKeys = data.items.map((item) => item.key);
    expect(staleKeys).not.toContain("agent_ask:demo/mention");
    expect(staleKeys).not.toContain("agent_ask:demo/ping");
    expect(staleKeys).not.toContain("agent_ask:demo/pong");
    expect(staleKeys).not.toContain("agent_ask:demo/new");
  });

  it("finds a Supersedes clause in the middle of a single-line rationale", () => {
    const workspace = fixtureWorkspace(staleRepo(), [
      { id: "agentask_aaaa", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "v2.", intent: "plan" },
      { id: "agentask_bbbb", createdAt: "2026-09-05T01:00:00.000Z", desiredResult: "v3.", intent: "plan" },
      { id: "agentask_cccc", createdAt: "2026-09-05T02:00:00.000Z", desiredResult: "v4.", intent: "plan" },
      {
        id: "agentask_dddd", createdAt: "2026-09-06T00:00:00.000Z", desiredResult: "v5.",
        rationale: "Rebuilt after review. Supersedes: agentask_aaaa, agentask_bbbb; agentask_cccc. See the Plan for why."
      }
    ]);

    const { data } = run({ workspace, now: NOW, stale: true });

    const reasons = Object.fromEntries(data.items.map((item) => [item.key, item.staleReason]));
    for (const id of ["agentask_aaaa", "agentask_bbbb", "agentask_cccc"]) {
      expect(reasons[`agent_ask:demo/${id}`]).toBe("superseded by Agent Ask agentask_dddd (explicit Supersedes line in its rationale)");
    }
    expect(reasons["agent_ask:demo/agentask_dddd"]).toBeUndefined();
  });

  it("counts a settled-accepted superseder but never a settled-rejected one", () => {
    const workspace = fixtureWorkspace(staleRepo(), [
      { id: "old-a", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Old A." },
      { id: "old-b", createdAt: "2026-09-05T01:00:00.000Z", desiredResult: "Old B." },
      { id: "accepted-new", createdAt: "2026-09-06T00:00:00.000Z", desiredResult: "New A.", rationale: "Done. Supersedes: old-a.", settled: "accepted" },
      { id: "rejected-new", createdAt: "2026-09-06T01:00:00.000Z", desiredResult: "New B.", rationale: "Done. Supersedes: old-b.", settled: "rejected" }
    ]);

    const { data } = run({ workspace, now: NOW, all: true });

    const byKey = Object.fromEntries(data.items.map((item) => [item.key, item]));
    expect(byKey["agent_ask:demo/old-a"].staleReason).toBe("superseded by Agent Ask accepted-new (explicit Supersedes line in its rationale)");
    expect(byKey["agent_ask:demo/old-b"]).toBeDefined();
    expect(byKey["agent_ask:demo/old-b"].staleReason).toBeUndefined();
    // Settled Asks are not themselves on the to-do list.
    expect(byKey["agent_ask:demo/accepted-new"]).toBeUndefined();
    expect(byKey["agent_ask:demo/rejected-new"]).toBeUndefined();
  });

  it("does not call a mixed Ask stale while an Action it proposes is not in any Plan", () => {
    const workspace = fixtureWorkspace(staleRepo(), [
      {
        id: "mixed-absent", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Split with a remainder.", intent: "split",
        targetRef: "action/first-step", actions: [{ id: "remainder-not-adopted", targetRef: null }]
      },
      {
        id: "mixed-adopted", createdAt: "2026-09-05T01:00:00.000Z", desiredResult: "Split with an adopted remainder.", intent: "split",
        targetRef: "action/first-step", actions: [{ id: "second-step", targetRef: null }]
      }
    ]);

    const { data } = run({ workspace, now: NOW, all: true });

    const byKey = Object.fromEntries(data.items.map((item) => [item.key, item]));
    expect(byKey["agent_ask:demo/mixed-absent"].staleReason).toBeUndefined();
    expect(byKey["agent_ask:demo/mixed-adopted"].staleReason).toBe("every Action it targets is done: first-step");
  });

  it("golden: the stale view as JSON", () => {
    const workspace = fixtureWorkspace(staleRepo(), [asks[0]]);
    expect(run({ workspace, now: NOW, stale: true }).data).toEqual({
      schema: "arcadia-todo-v1",
      view: "stale",
      asOf: { at: "2026-10-08T12:00:00.000Z", workspace: path.basename(workspace), workspacePath: workspace },
      counts: {
        blocking: 1, other: 0, stale: 2, staleHidden: 0, byKind: { decision: 1, agent_ask: 0 }, hidden: 0,
        fixture: { projects: 0, items: 0 }
      },
      items: [
        {
          key: "decision:demo/0002", kind: "decision", title: "Was the first step wanted?", project: "demo", blocking: false,
          createdAt: "2026-09-04", sourceRef: "docs/decisions/0002-finished.md",
          answer: "arcadia decision approve 0002 --project demo --answer 'Go ahead'",
          staleReason: "its Action first-step is done in plan main-plan"
        },
        {
          key: "agent_ask:demo/done-complete", kind: "agent_ask", title: "Complete first-step.", project: "demo", blocking: false,
          createdAt: "2026-09-05T00:00:00.000Z", sourceRef: "agent_ask_proposals:done-complete",
          answer: "arcadia agent-ask settle --proposal done-complete --request-id <settlement-request-id> --disposition accepted",
          staleReason: "every Action it targets is done: first-step"
        }
      ],
      unavailable: []
    });
  });
});

describe("arcadia todo: per-Project isolation and fixture grouping", () => {
  function addProject(workspace: string, name: string, repo: string): void {
    withDatabase(workspace, (db) => {
      const bundle = createProjectWithInitialWork(db, {
        name, mission: `${name} mission.`, status: "active", currentMilestone: "m", nextAction: "n", workClassification: "agent"
      });
      upsertProjectMetadata(db, { projectId: bundle.project.id, repoPath: repo });
    });
  }

  function otherRepo(prefix: string, slug: string, withProjectDoc = true): string {
    const repo = temp(prefix);
    if (withProjectDoc) write(repo, "PROJECT.md", projectDoc().replace("slug: demo", `slug: ${slug}`).replace("name: Demo", `name: ${slug}`));
    write(repo, "docs/decisions/0001-q.md", decisionDoc("0001", `${slug} question?`, "2026-09-04").replace("project: demo", `project: ${slug}`));
    return repo;
  }

  it("one Project whose dispatch fails becomes a line; the others are still listed", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0), [
      { id: "kept-ask", createdAt: "2026-09-05T00:00:00.000Z", project: "boom", desiredResult: "Asked of the failing Project." }
    ]);
    addProject(workspace, "Boom", otherRepo("boom-repo", "boom"));

    const { data } = run({ workspace, now: NOW });

    expect(data.items.map((item) => item.key)).toEqual(["decision:demo/0001", "agent_ask:boom/kept-ask"]);
    expect(data.unavailable).toEqual(["project sources unavailable: boom: dispatch exploded"]);
  });

  it("says so when a repository has no PROJECT.md, and still lists what it can read", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0));
    addProject(workspace, "Headless", otherRepo("headless-repo", "headless", false));

    const { data } = run({ workspace, now: NOW });

    expect(data.unavailable).toHaveLength(1);
    expect(data.unavailable[0]).toMatch(/^project sources unavailable: headless has no PROJECT\.md under .*headless-repo/);
    expect(data.items.map((item) => item.key)).toContain("decision:headless/0001");
  });

  it("collapses rehearsal and temp-directory Projects into one counts line", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0), [
      { id: "rehearsal-ask", createdAt: "2026-09-05T00:00:00.000Z", project: "run-rehearsal-3", desiredResult: "A rehearsal ask." }
    ]);
    addProject(workspace, "Rehearsal Run", otherRepo("rehearsal-repo", "rehearsal-run"));
    addProject(workspace, "Scratch", otherRepo("scratch-repo", "scratch"));
    addProject(workspace, "Missing Rehearsal", path.join(tmpdir(), "arcadia-todo-no-such-rehearsal-repo"));

    // Default fixture roots: the OS temp directory, where every one of these repositories lives.
    const { data } = runTodoCommand({ workspace, now: NOW });

    expect(data.items).toEqual([]);
    expect(data.counts.fixture).toEqual({ projects: 5, items: 4 });
    expect(data.unavailable).toEqual([]);
    expect(render(data).join("\n")).toContain("Fixture Projects collapsed: 5 Projects, 4 items not listed");

    // By slug alone, with no temp-directory rule: only the rehearsal-named Projects collapse.
    const bySlug = run({ workspace, now: NOW });
    expect(bySlug.data.counts.fixture.projects).toBe(3);
    expect(bySlug.data.items.map((item) => item.project).sort()).toEqual(["demo", "scratch"]);
    expect(bySlug.data.unavailable).toEqual([]);
  });
});
