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
import { createProjectWithInitialWork, createWorkItemRecord, upsertProjectMetadata } from "../src/db/repositories.js";
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

const decisionVia = (id: string): string[] => [
  `Dashboard: /runs, To-do section, Approve a Decision option (POST /api/approvals {"kind":"decision","id":"${id}","project":"demo","option":"<option label>"}; no option sends the recommended one)`
];
const askVia = (id: string): string[] => [
  `Dashboard: /runs, To-do section, Accept or Reject (POST /api/approvals {"kind":"agent_ask","id":"${id}","project":"demo","disposition":"accepted"|"rejected"})`
];
const GO_AHEAD = [{ label: "Go ahead", consequence: "The step proceeds.", recommended: true }];

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
  options?: Array<{ label: string; consequence: string; recommended: boolean }>;
  gateQuestion?: string | null;
  evidence?: Array<{ criterion: string; status: string; note: string | null }>;
  /** Store the proposal as an older record that never had gateQuestion, evidence or options at all. */
  legacyShape?: boolean;
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
        targetRef: ask.targetRef ?? null, rationale: ask.rationale ?? null, actions: ask.actions ?? [], options: ask.options ?? [],
        gateQuestion: ask.gateQuestion ?? null, evidence: ask.evidence ?? []
      };
      if (ask.legacyShape) {
        delete (normalized as Partial<typeof normalized>).gateQuestion;
        delete (normalized as Partial<typeof normalized>).evidence;
        delete (normalized as Partial<typeof normalized>).options;
      }
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
      schema: "arcadia-todo-v1", agentWork: [], askUnavailable: null, view: "default",
      asOf: { at: "2026-10-08T12:00:00.000Z", workspace: path.basename(workspace), workspacePath: workspace },
      counts: { blocking: 1, other: 2, stale: 0, staleHidden: 0, byKind: { decision: 2, agent_ask: 1, review_item: 0, operator_task: 0, escalation: 0, clarify: 0, plan_action: 0 }, hidden: 0, agentFlaggedHidden: 0, askQuestions: 0, askHidden: 0, agentsDoing: 0, backBurner: { incubating: 0, newInSevenDays: 0 }, fixture: { projects: 0, items: 0 }, noRepoPath: { projects: 0, items: 0 } },
      items: [
        {
          key: "decision:demo/0001", kind: "decision", title: "Should the second step proceed?", project: "demo", blocking: true,
          createdAt: "2026-09-03", sourceRef: "docs/decisions/0001-block.md", origin: null,
          answer: "arcadia decision approve 0001 --project demo --answer 'Go ahead'",
          answerVia: decisionVia("0001"), options: GO_AHEAD
        },
        {
          key: "decision:demo/0002", kind: "decision", title: "Unrelated question 0002?", project: "demo", blocking: false,
          createdAt: "2026-09-10", sourceRef: "docs/decisions/0002-alert.md", origin: null,
          answer: "arcadia decision approve 0002 --project demo --answer 'Go ahead'",
          answerVia: decisionVia("0002"), options: GO_AHEAD
        },
        {
          key: "agent_ask:demo/proposal-1", kind: "agent_ask", title: "Amend the demo Action.", project: "demo", blocking: false,
          createdAt: "2026-09-05T00:00:00.000Z", sourceRef: "agent_ask_proposals:proposal-1", origin: "request:request-proposal-1 via:test",
          answer: "arcadia agent-ask settle --proposal proposal-1 --request-id <settlement-request-id> --disposition accepted",
          answerVia: askVia("proposal-1")
        }
      ],
      unavailable: []
    });

    const lines = render(data);
    expect(lines[0]).toBe(`Operator to-do: 1 blocking · 2 other · stale hidden: 0 (decisions 2, agent asks 1, review items 0, operator tasks 0, escalations 0, clarify 0, plan actions 0) (as of 2026-10-08T12:00:00.000Z, workspace ${path.basename(workspace)})`);
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
    expect(capped.data.counts).toEqual({ blocking: 1, other: 7, stale: 0, staleHidden: 0, byKind: { decision: 8, agent_ask: 0, review_item: 0, operator_task: 0, escalation: 0, clarify: 0, plan_action: 0 }, hidden: 2, agentFlaggedHidden: 0, askQuestions: 0, askHidden: 0, agentsDoing: 0, backBurner: { incubating: 0, newInSevenDays: 0 }, fixture: { projects: 0, items: 0 }, noRepoPath: { projects: 0, items: 0 } });
    expect(capped.data.items.filter((item) => !item.blocking).map((item) => item.key)).toEqual([
      "decision:demo/0008", "decision:demo/0007", "decision:demo/0006", "decision:demo/0005", "decision:demo/0004"
    ]);
    const lines = render(capped.data);
    expect(lines[0]).toBe(`Operator to-do: 1 blocking · 7 other · stale hidden: 0 (decisions 8, agent asks 0, review items 0, operator tasks 0, escalations 0, clarify 0, plan actions 0) (as of 2026-10-08T12:00:00.000Z, workspace ${path.basename(workspace)})`);
    // The cap note closes the Yours section; the Agents are doing section follows it.
    expect(lines.indexOf("2 more: --all")).toBeGreaterThan(lines.indexOf("Yours"));
    expect(lines.indexOf("2 more: --all")).toBeLessThan(lines.indexOf("Agents are doing"));
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
    expect(data.counts).toEqual({ blocking: 1, other: 1, stale: 0, staleHidden: 0, byKind: { decision: 2, agent_ask: 0, review_item: 0, operator_task: 0, escalation: 0, clarify: 0, plan_action: 0 }, hidden: 0, agentFlaggedHidden: 0, askQuestions: 0, askHidden: 0, agentsDoing: null, backBurner: null, fixture: { projects: 0, items: 0 }, noRepoPath: { projects: 0, items: 0 } });
    expect(data.items.map((item) => item.key)).toEqual(["decision:demo/0001", "decision:demo/0002"]);
    expect(data.unavailable).toEqual([expect.stringMatching(/^workspace sources unavailable: no workspace at .*arcadia init <path>/)]);
    const lines = render(data);
    expect(lines.filter((line) => line.startsWith("workspace sources unavailable:"))).toHaveLength(1);
    expect(lines[0]).toBe("Operator to-do: 1 blocking · 1 other · stale hidden: 0 (decisions 2, agent asks 0, review items 0, operator tasks 0, escalations 0, clarify 0, plan actions 0) (as of 2026-10-08T12:00:00.000Z)");
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
    expect(lines).toContain("0 blocking · 0 other · stale hidden: 0 (decisions 0, agent asks 0, review items 0, operator tasks 0, escalations 0, clarify 0, plan actions 0)");
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
      blocking: 2, other: 3, stale: 4, staleHidden: 4, byKind: { decision: 1, agent_ask: 4, review_item: 0, operator_task: 0, escalation: 0, clarify: 0, plan_action: 0 }, hidden: 0,
      agentFlaggedHidden: 0, askQuestions: 0, askHidden: 0, agentsDoing: 0, backBurner: { incubating: 0, newInSevenDays: 0 }, fixture: { projects: 0, items: 0 }, noRepoPath: { projects: 0, items: 0 }
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

  it("leaves every member of a longer Supersedes cycle visible, not only mutual pairs (#1084)", () => {
    const workspace = fixtureWorkspace(staleRepo(), [
      { id: "old", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Old.", rationale: "An early proposal." },
      { id: "cyc-a", createdAt: "2026-09-06T00:00:00.000Z", desiredResult: "A.", rationale: "Supersedes: cyc-b" },
      { id: "cyc-b", createdAt: "2026-09-06T01:00:00.000Z", desiredResult: "B.", rationale: "Supersedes: cyc-c" },
      { id: "cyc-c", createdAt: "2026-09-06T02:00:00.000Z", desiredResult: "C.", rationale: "Supersedes: cyc-a, old" }
    ]);

    const { data } = run({ workspace, now: NOW, all: true });

    const byKey = Object.fromEntries(data.items.map((item) => [item.key, item]));
    // The 3-cycle hides nobody inside it; a cycle member still supersedes an Ask outside the cycle.
    for (const id of ["cyc-a", "cyc-b", "cyc-c"]) {
      expect(byKey[`agent_ask:demo/${id}`], id).toBeDefined();
      expect(byKey[`agent_ask:demo/${id}`].staleReason, id).toBeUndefined();
    }
    expect(byKey["agent_ask:demo/old"].staleReason).toBe("superseded by Agent Ask cyc-c (explicit Supersedes line in its rationale)");
  });

  it("only a superseder in the same Project hides an Ask (#1084)", () => {
    const workspace = fixtureWorkspace(staleRepo(), [
      { id: "old", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Old.", rationale: "An early proposal." },
      { id: "foreign", createdAt: "2026-09-06T00:00:00.000Z", project: "other-project", desiredResult: "Foreign.", rationale: "Supersedes: old" },
      { id: "old-two", createdAt: "2026-09-05T01:00:00.000Z", desiredResult: "Old two.", rationale: "An early proposal." },
      { id: "local", createdAt: "2026-09-06T01:00:00.000Z", desiredResult: "Local.", rationale: "Supersedes: old-two" }
    ]);

    const { data } = run({ workspace, now: NOW, all: true });

    const byKey = Object.fromEntries(data.items.map((item) => [item.key, item]));
    expect(byKey["agent_ask:demo/old"].staleReason).toBeUndefined();
    expect(byKey["agent_ask:other-project/foreign"].staleReason).toBeUndefined();
    expect(byKey["agent_ask:demo/old-two"].staleReason).toBe("superseded by Agent Ask local (explicit Supersedes line in its rationale)");
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
      schema: "arcadia-todo-v1", agentWork: [], askUnavailable: null,
      view: "stale",
      asOf: { at: "2026-10-08T12:00:00.000Z", workspace: path.basename(workspace), workspacePath: workspace },
      counts: {
        blocking: 1, other: 0, stale: 2, staleHidden: 0, byKind: { decision: 1, agent_ask: 0, review_item: 0, operator_task: 0, escalation: 0, clarify: 0, plan_action: 0 }, hidden: 0,
        agentFlaggedHidden: 0, askQuestions: 0, askHidden: 0, agentsDoing: 0, backBurner: { incubating: 0, newInSevenDays: 0 }, fixture: { projects: 0, items: 0 }, noRepoPath: { projects: 0, items: 0 }
      },
      items: [
        {
          key: "decision:demo/0002", kind: "decision", title: "Was the first step wanted?", project: "demo", blocking: false,
          createdAt: "2026-09-04", sourceRef: "docs/decisions/0002-finished.md", origin: "action:first-step",
          answer: "arcadia decision approve 0002 --project demo --answer 'Go ahead'",
          answerVia: decisionVia("0002"), options: GO_AHEAD,
          staleReason: "its Action first-step is done in plan main-plan"
        },
        {
          key: "agent_ask:demo/done-complete", kind: "agent_ask", title: "Complete first-step.", project: "demo", blocking: false,
          createdAt: "2026-09-05T00:00:00.000Z", sourceRef: "agent_ask_proposals:done-complete", origin: "request:request-done-complete via:test",
          answer: "arcadia agent-ask settle --proposal done-complete --request-id <settlement-request-id> --disposition accepted",
          answerVia: askVia("done-complete"),
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

    // The demo Project's blocking Decision is listed even though its repository is under the temp directory;
    // only non-blocking items collapse.
    expect(data.items.map((item) => item.key)).toEqual(["decision:demo/0001"]);
    expect(data.counts.fixture).toEqual({ projects: 5, items: 3 });
    expect(data.unavailable).toEqual([]);
    expect(render(data).join("\n")).toContain("Fixture Projects collapsed: 5 Projects, 3 items not listed");

    // By slug alone, with no temp-directory rule: only the rehearsal-named Projects collapse.
    const bySlug = run({ workspace, now: NOW });
    expect(bySlug.data.counts.fixture.projects).toBe(3);
    expect(bySlug.data.items.map((item) => item.project).sort()).toEqual(["demo", "scratch"]);
    expect(bySlug.data.unavailable).toEqual([]);
  });
});

describe("arcadia todo: review_items", () => {
  interface FixtureReview {
    id: string;
    createdAt: string;
    decisionNeeded: string;
    intent?: string;
    status?: "open" | "deferred" | "approved" | "rejected";
    docRef?: string | null;
    workItemId?: string | null;
    /** Stored in context_json; `agentReview.status: flagged` waits on an agent, not the operator. */
    agentFlagged?: boolean;
  }

  /** Plan whose open Action `second-step` is eligible, so it is the selected Action and no Decision blocks it. */
  function selectableRepo(extra: Array<[string, string]> = []): string {
    const repo = temp("review-repo");
    write(repo, "PROJECT.md", projectDoc());
    write(repo, "docs/plans/main-plan.md", planDoc().replace('decisions: ["0001"]', "decisions: []"));
    for (const [file, content] of extra) write(repo, file, content);
    return repo;
  }

  function projectIdOf(workspace: string): string {
    return withDatabase(workspace, (db) => (db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }).id);
  }

  /** A work item of the Project; `docRef` is where the Plan Action it mirrors lives. */
  function addWorkItem(workspace: string, input: { status?: "open" | "done"; docRef?: string }): string {
    const projectId = projectIdOf(workspace);
    return withDatabase(workspace, (db) => {
      const item = createWorkItemRecord(db, {
        projectId, title: "Work", rawInput: "Work", queue: "work_queue", workClassification: "agent", nextAction: "Do the work",
        status: input.status ?? "open"
      });
      if (input.docRef) db.prepare("UPDATE work_items SET doc_ref = ? WHERE id = ?").run(input.docRef, item.id);
      return item.id;
    });
  }

  function addReviews(workspace: string, reviews: FixtureReview[]): void {
    const projectId = projectIdOf(workspace);
    withDatabase(workspace, (db) => {
      for (const review of reviews) {
        db.prepare(
          `INSERT INTO review_items (id, slug, work_item_id, project_id, status, decision_needed, source_input, proposed_action,
             resolved_intent, confidence_label, confidence, missing_fields, context_json, created_at, updated_at, doc_ref)
           VALUES (?, ?, ?, ?, ?, ?, 'source', 'propose', ?, 'medium', 0, '[]', ?, ?, ?, ?)`
        ).run(
          review.id, review.id.toUpperCase(), review.workItemId ?? null, projectId, review.status ?? "open", review.decisionNeeded,
          review.intent ?? "ActionClarification",
          JSON.stringify(review.agentFlagged ? { agentReview: { status: "flagged" } } : {}),
          review.createdAt, review.createdAt, review.docRef ?? null
        );
      }
    });
  }

  function keys(data: TodoData): string[] {
    return data.items.map((item) => item.key);
  }

  it("lists an ActionClarification and another kind, each with the source's own words, canonical answer and additive JSON", () => {
    const workspace = fixtureWorkspace(selectableRepo(), [
      { id: "proposal-1", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Amend the demo Action." }
    ]);
    addReviews(workspace, [
      { id: "review-clarify", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "Which database should the demo use?" },
      { id: "review-run", createdAt: "2026-09-02T00:00:00.000Z", decisionNeeded: "Accept the planning artifact?", intent: "CodexPlanningArtifactAcceptance", status: "deferred" },
      { id: "review-flagged", createdAt: "2026-09-03T00:00:00.000Z", decisionNeeded: "Waits on an agent.", status: "deferred", agentFlagged: true },
      { id: "review-answered", createdAt: "2026-09-04T00:00:00.000Z", decisionNeeded: "Already approved.", status: "approved" }
    ]);

    const { data } = run({ workspace, now: NOW });

    expect(data).toEqual({
      schema: "arcadia-todo-v1", agentWork: [], askUnavailable: null, view: "default",
      asOf: { at: "2026-10-08T12:00:00.000Z", workspace: path.basename(workspace), workspacePath: workspace },
      counts: { blocking: 0, other: 3, stale: 0, staleHidden: 0, byKind: { decision: 0, agent_ask: 1, review_item: 2, operator_task: 0, escalation: 0, clarify: 0, plan_action: 0 }, hidden: 0, agentFlaggedHidden: 1, askQuestions: 0, askHidden: 0, agentsDoing: 0, backBurner: { incubating: 0, newInSevenDays: 0 }, fixture: { projects: 0, items: 0 }, noRepoPath: { projects: 0, items: 0 } },
      items: [
        {
          key: "review_item:demo/review-clarify", kind: "review_item", title: "Which database should the demo use?", project: "demo", blocking: false,
          origin: "ActionClarification", createdAt: "2026-09-01T00:00:00.000Z", sourceRef: "review_items:review-clarify",
          answer: 'arcadia review approve review-clarify --answer "<answer>" --clarify',
          answerVia: [
            "Discord: reply to the clarification notification with the answer",
            "Mission Control: open the item and choose Answer & continue"
          ]
        },
        {
          key: "review_item:demo/review-run", kind: "review_item", title: "Accept the planning artifact?", project: "demo", blocking: false,
          origin: "CodexPlanningArtifactAcceptance", createdAt: "2026-09-02T00:00:00.000Z", sourceRef: "review_items:review-run",
          answer: "arcadia review show review-run",
          answerVia: ["then: arcadia review approve|reject|defer review-run"]
        },
        {
          key: "agent_ask:demo/proposal-1", kind: "agent_ask", title: "Amend the demo Action.", project: "demo", blocking: false,
          createdAt: "2026-09-05T00:00:00.000Z", sourceRef: "agent_ask_proposals:proposal-1", origin: "request:request-proposal-1 via:test",
          answer: "arcadia agent-ask settle --proposal proposal-1 --request-id <settlement-request-id> --disposition accepted",
          answerVia: askVia("proposal-1")
        }
      ],
      unavailable: []
    });
    // Open and deferred only, oldest first alongside the Agent Ask; an agent-flagged or decided item is not the operator's.
    const text = render(data).join("\n");
    expect(text).toContain("(decisions 0, agent asks 1, review items 2, operator tasks 0, escalations 0, clarify 0, plan actions 0)");
    expect(text).toContain("origin: ActionClarification");
    expect(text).toContain('answer: arcadia review approve review-clarify --answer "<answer>" --clarify');
  });

  it("keeps open Decisions first, newest first, with review_items among the other items oldest first", () => {
    const repo = selectableRepo([
      ["docs/decisions/0002-alert.md", decisionDoc("0002", "Unrelated question 0002?", "2026-09-10")]
    ]);
    const workspace = fixtureWorkspace(repo, [{ id: "proposal-a", createdAt: "2026-08-03T00:00:00.000Z", desiredResult: "Ask a." }]);
    addReviews(workspace, [
      { id: "review-new", createdAt: "2026-08-02T00:00:00.000Z", decisionNeeded: "Newer review." },
      { id: "review-old", createdAt: "2026-08-01T00:00:00.000Z", decisionNeeded: "Older review." }
    ]);

    expect(keys(run({ workspace, now: NOW }).data)).toEqual([
      "decision:demo/0002", "review_item:demo/review-old", "review_item:demo/review-new", "agent_ask:demo/proposal-a"
    ]);
  });

  it("dedupes by work_item_id and by doc_ref against a listed Decision", () => {
    const repo = selectableRepo([
      ["docs/decisions/0002-alert.md", decisionDoc("0002", "Is this the same question?", "2026-09-10")]
    ]);
    const workspace = fixtureWorkspace(repo);
    const workItemId = addWorkItem(workspace, {});
    addReviews(workspace, [
      // Raised from the open Decision document: the Decision is the one to-do item, not this row too.
      { id: "review-of-decision", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "Is this the same question?", docRef: "decision/decision-0002" },
      // Two questions on one work_item show once: the first listed (newest) one.
      { id: "review-first", createdAt: "2026-09-02T00:00:00.000Z", decisionNeeded: "First question.", workItemId },
      { id: "review-second", createdAt: "2026-09-03T00:00:00.000Z", decisionNeeded: "Second question.", workItemId },
      // A Decision this Project has no document for is not deduped (no evidence).
      { id: "review-unknown-doc", createdAt: "2026-09-04T00:00:00.000Z", decisionNeeded: "Unknown document.", docRef: "decision/no-such-slug" }
    ]);

    const { data } = run({ workspace, now: NOW });

    expect(keys(data).sort()).toEqual(["decision:demo/0002", "review_item:demo/review-second", "review_item:demo/review-unknown-doc"]);
    expect(data.counts.byKind).toEqual({ decision: 1, agent_ask: 0, review_item: 2, operator_task: 0, escalation: 0, clarify: 0, plan_action: 0 });
  });

  it("marks a review_item stale only on positive evidence: a done work_item or an answered Decision", () => {
    const answered = decisionDoc("0003", "Was this answered?", "2026-09-10").replace("status: open", "status: approved\nanswer: Go ahead\ndecided: 2026-09-11");
    const repo = selectableRepo([["docs/decisions/0003-answered.md", answered]]);
    const workspace = fixtureWorkspace(repo);
    const doneWork = addWorkItem(workspace, { status: "done" });
    const openWork = addWorkItem(workspace, { status: "open" });
    addReviews(workspace, [
      { id: "review-done-work", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "Done work question.", workItemId: doneWork },
      { id: "review-answered", createdAt: "2026-09-02T00:00:00.000Z", decisionNeeded: "Answered Decision question.", docRef: "decision/decision-0003" },
      { id: "review-live", createdAt: "2026-09-03T00:00:00.000Z", decisionNeeded: "Live question.", workItemId: openWork },
      { id: "review-no-evidence", createdAt: "2026-09-04T00:00:00.000Z", decisionNeeded: "No evidence either way.", docRef: "decision/gone" }
    ]);

    const hidden = run({ workspace, now: NOW });
    expect(keys(hidden.data)).toEqual(["review_item:demo/review-live", "review_item:demo/review-no-evidence"]);
    expect(hidden.data.counts).toMatchObject({ stale: 2, staleHidden: 2, byKind: { review_item: 2 } });

    const stale = run({ workspace, now: NOW, stale: true });
    expect(stale.data.items.map((item) => [item.key, item.staleReason])).toEqual([
      ["review_item:demo/review-done-work", `its work_item ${doneWork} is done`],
      ["review_item:demo/review-answered", "its Decision 0003 (decision/decision-0003) is already approved"]
    ]);
    expect(render(stale.data).join("\n")).toContain("stale: its work_item");
  });

  it("is blocking only when linked to the Action the operator gate selected; otherwise an alert", () => {
    const workspace = fixtureWorkspace(selectableRepo());
    const selectedWork = addWorkItem(workspace, { docRef: "plan/main-plan#second-step" });
    const otherWork = addWorkItem(workspace, { docRef: "plan/main-plan#some-other-step" });
    addReviews(workspace, [
      { id: "review-by-work", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "Blocks via its work item.", workItemId: selectedWork },
      { id: "review-by-ref", createdAt: "2026-09-02T00:00:00.000Z", decisionNeeded: "Blocks via its own doc_ref.", docRef: "plan/main-plan#second-step" },
      { id: "review-other", createdAt: "2026-09-03T00:00:00.000Z", decisionNeeded: "Another Action.", workItemId: otherWork },
      { id: "review-unlinked", createdAt: "2026-09-04T00:00:00.000Z", decisionNeeded: "Linked to nothing." }
    ]);

    const { data } = run({ workspace, now: NOW });

    expect(data.items.map((item) => [item.key, item.blocking])).toEqual([
      ["review_item:demo/review-by-work", true],
      ["review_item:demo/review-by-ref", true],
      ["review_item:demo/review-other", false],
      ["review_item:demo/review-unlinked", false]
    ]);
    expect(data.counts).toMatchObject({ blocking: 2, other: 2 });
  });

  it("lists a review_item of a Project with no repository, never blocking, and one with no Project as 'unknown'", () => {
    const workspace = fixtureWorkspace(path.join(tmpdir(), "arcadia-todo-no-such-repo"));
    addReviews(workspace, [{ id: "review-norepo", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "Asked without a repository." }]);
    withDatabase(workspace, (db) => {
      db.prepare(
        `INSERT INTO review_items (id, slug, status, decision_needed, source_input, proposed_action, resolved_intent, confidence_label,
           confidence, missing_fields, context_json, created_at, updated_at)
         VALUES ('review-stray', 'R-STRAY', 'open', 'Belongs to no Project.', 's', 'p', 'ActionClarification', 'medium', 0, '[]', '{}', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z')`
      ).run();
    });

    const { data } = run({ workspace, now: NOW });

    expect(data.items.map((item) => [item.key, item.project, item.blocking])).toEqual([
      ["review_item:demo/review-norepo", "demo", false],
      ["review_item:unknown/review-stray", "unknown", false]
    ]);
    expect(run({ workspace, now: NOW, project: "demo" }).data.items.map((item) => item.key)).toEqual(["review_item:demo/review-norepo"]);
  });

  it("keeps a review_item of a completed Project as stale under that Project, never dropping it (#1074)", () => {
    const workspace = fixtureWorkspace(selectableRepo());
    addReviews(workspace, [{ id: "review-live", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "Live Project question." }]);
    withDatabase(workspace, (db) => {
      const finished = createProjectWithInitialWork(db, {
        name: "Finished", mission: "Done.", status: "active", currentMilestone: "m", nextAction: "n", workClassification: "agent"
      });
      db.prepare("UPDATE projects SET status = 'completed' WHERE id = ?").run(finished.project.id);
      db.prepare(
        `INSERT INTO review_items (id, slug, project_id, status, decision_needed, source_input, proposed_action, resolved_intent, confidence_label,
           confidence, missing_fields, context_json, created_at, updated_at)
         VALUES ('review-finished', 'R-FINISHED', ?, 'open', 'Asked for a completed Project.', 's', 'p', 'ActionClarification', 'medium', 0, '[]', '{}',
           '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z')`
      ).run(finished.project.id);
    });

    const { data } = run({ workspace, now: NOW });

    // The completed Project is positive evidence: the item is stale (hidden by default, counted), not live and not dropped.
    expect(data.items.map((item) => [item.key, item.project, item.blocking])).toEqual([["review_item:demo/review-live", "demo", false]]);
    expect(data.counts).toMatchObject({ stale: 1, staleHidden: 1 });
    const stale = run({ workspace, now: NOW, stale: true }).data.items;
    expect(stale.map((item) => [item.key, item.project, item.staleReason])).toEqual([
      ["review_item:finished/review-finished", "finished", "its Project finished is completed"]
    ]);
    // A --project view is that Project's alone.
    expect(keys(run({ workspace, now: NOW, project: "demo" }).data)).toEqual(["review_item:demo/review-live"]);
  });

  it("counts the agent-flagged review_items it leaves out, in the counts line and in the JSON counts (#1074)", () => {
    const workspace = fixtureWorkspace(selectableRepo());
    addReviews(workspace, [
      { id: "review-live", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "For the operator." },
      { id: "review-flagged-1", createdAt: "2026-09-02T00:00:00.000Z", decisionNeeded: "Agent one.", status: "deferred", agentFlagged: true },
      { id: "review-flagged-2", createdAt: "2026-09-03T00:00:00.000Z", decisionNeeded: "Agent two.", status: "deferred", agentFlagged: true }
    ]);

    const view = run({ workspace, now: NOW });
    expect(keys(view.data)).toEqual(["review_item:demo/review-live"]);
    expect(view.data.counts.agentFlaggedHidden).toBe(2);
    expect(render(view.data)[0]).toContain("agent-flagged hidden: 2");
    // Every view and a --project view count the same; none lists the flagged items.
    expect(run({ workspace, now: NOW, all: true }).data.counts.agentFlaggedHidden).toBe(2);
    expect(run({ workspace, now: NOW, project: "demo" }).data.counts.agentFlaggedHidden).toBe(2);

    // With none flagged the counts line stays as it was.
    const clean = run({ workspace: fixtureWorkspace(selectableRepo()), now: NOW });
    expect(clean.data.counts.agentFlaggedHidden).toBe(0);
    expect(render(clean.data)[0]).not.toContain("agent-flagged");
  });

  it("matches the Plan as well as the Action id, so an Action id repeated in another Plan is not the selected one (#1074)", () => {
    const workspace = fixtureWorkspace(selectableRepo());
    const otherPlanWork = addWorkItem(workspace, { docRef: "plan/other-plan#second-step" });
    addReviews(workspace, [
      { id: "review-same-plan", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "Selected Action.", docRef: "plan/main-plan#second-step" },
      { id: "review-other-plan-ref", createdAt: "2026-09-02T00:00:00.000Z", decisionNeeded: "Same id, other Plan.", docRef: "plan/other-plan#second-step" },
      { id: "review-other-plan-work", createdAt: "2026-09-03T00:00:00.000Z", decisionNeeded: "Work item in the other Plan.", workItemId: otherPlanWork }
    ]);

    expect(run({ workspace, now: NOW }).data.items.map((item) => [item.key, item.blocking])).toEqual([
      ["review_item:demo/review-same-plan", true],
      ["review_item:demo/review-other-plan-ref", false],
      ["review_item:demo/review-other-plan-work", false]
    ]);
  });

  it("doc_ref dedupe: a rejected Decision makes the review_item stale; a deferred one is neither listed nor stale evidence (#1074)", () => {
    const rejected = decisionDoc("0004", "Was this rejected?", "2026-09-10").replace("status: open", "status: rejected\nanswer: No\ndecided: 2026-09-11");
    const deferred = decisionDoc("0005", "Is this parked?", "2026-09-10").replace("status: open", "status: deferred");
    const repo = selectableRepo([
      ["docs/decisions/0004-rejected.md", rejected],
      ["docs/decisions/0005-deferred.md", deferred]
    ]);
    const workspace = fixtureWorkspace(repo);
    addReviews(workspace, [
      { id: "review-rejected", createdAt: "2026-09-01T00:00:00.000Z", decisionNeeded: "Rejected Decision question.", docRef: "decision/decision-0004" },
      { id: "review-deferred", createdAt: "2026-09-02T00:00:00.000Z", decisionNeeded: "Deferred Decision question.", docRef: "decision/decision-0005" }
    ]);

    // A deferred Decision is not an open (listed) one: it dedupes nothing and is no positive evidence of staleness.
    const live = run({ workspace, now: NOW });
    expect(keys(live.data)).toEqual(["review_item:demo/review-deferred"]);
    expect(live.data.counts).toMatchObject({ stale: 1, staleHidden: 1 });
    expect(run({ workspace, now: NOW, stale: true }).data.items.map((item) => [item.key, item.staleReason])).toEqual([
      ["review_item:demo/review-rejected", "its Decision 0004 (decision/decision-0004) is already rejected"]
    ]);
  });

  it("with no workspace, still says plainly that workspace sources (Agent Asks, review items) are unavailable", () => {
    const repo = selectableRepo();
    const missing = path.join(temp("missing"), "no-workspace-here");
    const { data } = run({ workspace: missing, now: NOW, repoRoot: repo });
    expect(data.counts.byKind).toEqual({ decision: 0, agent_ask: 0, review_item: 0, operator_task: 0, escalation: 0, clarify: 0, plan_action: 0 });
    expect(data.unavailable).toEqual([expect.stringMatching(/^workspace sources unavailable: /)]);
    expect(render(data).at(-1)).toBe(data.unavailable[0]);
  });
});

describe("arcadia todo: production escalations and the operator-task ledger", () => {
  interface FixtureEscalation {
    actionKey: string;
    kind: string;
    message: string;
    remedy: string | null;
    firstDetectedAt: string;
  }

  function addEscalations(workspace: string, rows: FixtureEscalation[]): void {
    withDatabase(workspace, (db) => {
      for (const row of rows) {
        db.prepare(
          "INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(row.actionKey, row.kind, row.message, row.remedy, row.firstDetectedAt, row.firstDetectedAt);
      }
    });
  }

  /** `second-step` is eligible, so it is the selected Action; Decision 0002 is an open alert. */
  function selectableRepo(): string {
    const repo = temp("ledger-repo");
    write(repo, "PROJECT.md", projectDoc());
    write(repo, "docs/plans/main-plan.md", planDoc().replace('decisions: ["0001"]', "decisions: []"));
    write(repo, "docs/decisions/0002-alert.md", decisionDoc("0002", "Is this the same question?", "2026-09-10"));
    return repo;
  }

  function ledger(repo: string, events: Array<Record<string, unknown>>): void {
    write(repo, ".arcadia/operator-tasks.jsonl", `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  }

  function raised(id: string, at: string, asks: string, origin: { kind: string; id: string }, reference: string | null = null) {
    return { event: "raised", id, at, by: "agent", asks, why_only_you: "Only you hold the account.", origin, reference };
  }

  const gateMessage = (actionKey: string, id: string) => `Launch of ${actionKey} is held by pending Decision ${id}: Should the second step proceed?`;
  const keysOf = (data: TodoData): string[] => data.items.map((item) => item.key);

  it("lists an operator_gate_pending and a repair_budget_exhausted escalation as blocking, first, with the row's own words", () => {
    // fixtureRepo(): Decision 0001 blocks, 0002 is an alert.
    const workspace = fixtureWorkspace(fixtureRepo());
    addEscalations(workspace, [
      {
        actionKey: "demo/other-step", kind: "operator_gate_pending", firstDetectedAt: "2026-10-08T09:00:00.000Z",
        message: "Launch of demo/other-step is held by pending Agent Ask proposal proposal-9: Amend the plan.",
        remedy: "Run `arcadia agent-ask settle --proposal proposal-9 --request-id <id> --disposition accepted --preview`."
      },
      {
        actionKey: "demo/second-step", kind: "repair_budget_exhausted", firstDetectedAt: "2026-10-08T08:00:00.000Z",
        message: "Repair budget exhausted for demo/second-step after 3 failed launch attempt(s); most recent error: boom.",
        remedy: "Repair the underlying problem, then run `arcadia production reset-repair-budget demo/second-step`."
      }
    ]);

    const { data } = run({ workspace, now: NOW });

    expect(data.counts).toEqual({
      blocking: 3, other: 1, stale: 0, staleHidden: 0,
      byKind: { decision: 2, agent_ask: 0, review_item: 0, operator_task: 0, escalation: 2, clarify: 0, plan_action: 0 }, hidden: 0, agentFlaggedHidden: 0, askQuestions: 0, askHidden: 0, agentsDoing: 0, backBurner: { incubating: 0, newInSevenDays: 0 }, fixture: { projects: 0, items: 0 }, noRepoPath: { projects: 0, items: 0 }
    });
    // Escalations lead the blocking section (oldest first), then the blocking Decision; the alert Decision follows.
    expect(data.items.map((item) => [item.key, item.blocking])).toEqual([
      ["escalation:repair_budget_exhausted:demo/second-step", true],
      ["escalation:operator_gate_pending:demo/other-step", true],
      ["decision:demo/0001", true],
      ["decision:demo/0002", false]
    ]);
    expect(data.items[0]).toEqual({
      key: "escalation:repair_budget_exhausted:demo/second-step", kind: "escalation:repair_budget_exhausted",
      title: "Repair budget exhausted for demo/second-step after 3 failed launch attempt(s); most recent error: boom.",
      project: "demo", blocking: true, createdAt: "2026-10-08T08:00:00.000Z",
      sourceRef: "production_operator_escalations:demo/second-step", origin: "action:second-step",
      answer: "Repair the underlying problem, then run `arcadia production reset-repair-budget demo/second-step`."
    });
    const text = render(data).join("\n");
    expect(text).toContain("(decisions 2, agent asks 0, review items 0, operator tasks 0, escalations 2, clarify 0, plan actions 0)");
    expect(text).toContain("escalation:operator_gate_pending:demo/other-step");
  });

  it("shows an escalation whose gate is also a listed Decision once, as that Decision, marked blocking", () => {
    const workspace = fixtureWorkspace(fixtureRepo());
    addEscalations(workspace, [
      { actionKey: "demo/second-step", kind: "operator_gate_pending", message: gateMessage("demo/second-step", "0002"), remedy: "arcadia decision approve 0002 --project demo", firstDetectedAt: "2026-10-08T08:00:00.000Z" },
      { actionKey: "demo/third-step", kind: "operator_gate_pending", message: gateMessage("demo/third-step", "0001"), remedy: null, firstDetectedAt: "2026-10-08T08:30:00.000Z" }
    ]);

    const { data } = run({ workspace, now: NOW });

    expect(data.items.map((item) => [item.key, item.blocking])).toEqual([
      ["decision:demo/0001", true],
      // The row says the loop is held by 0002, so the one item for it is blocking, not an alert.
      ["decision:demo/0002", true]
    ]);
    expect(data.counts).toMatchObject({ blocking: 2, other: 0, byKind: { decision: 2, escalation: 0, clarify: 0, plan_action: 0 } });
  });

  it("does not merge an escalation into a Decision that is only cited in its message (Ask title, lapsed grant)", () => {
    const workspace = fixtureWorkspace(fixtureRepo());
    addEscalations(workspace, [
      {
        actionKey: "demo/ask-held", kind: "operator_gate_pending", firstDetectedAt: "2026-10-08T08:00:00.000Z",
        message: "Launch of demo/ask-held is held by pending Agent Ask proposal proposal-9: Amend the plan per Decision 0002.",
        remedy: "arcadia agent-ask settle --proposal proposal-9 --request-id <id> --disposition accepted --preview"
      },
      {
        actionKey: "demo/lapsed", kind: "integration_grant_lapsed", firstDetectedAt: "2026-10-08T08:30:00.000Z",
        message: "Integration grant lapsed at 2026-10-01T00:00:00.000Z (Decision 0002); the preserved candidate is not readied.",
        remedy: "Record a fresh integration Grant."
      }
    ]);

    const { data } = run({ workspace, now: NOW });

    expect(data.items.map((item) => [item.key, item.blocking])).toEqual([
      ["escalation:operator_gate_pending:demo/ask-held", true],
      ["escalation:integration_grant_lapsed:demo/lapsed", true],
      ["decision:demo/0001", true],
      // Only cited, never the gate: still an alert.
      ["decision:demo/0002", false]
    ]);
    expect(data.counts.byKind).toMatchObject({ decision: 2, escalation: 2, clarify: 0, plan_action: 0 });
  });

  it("lists an escalation of a Project outside the list, falls back to `arcadia production status` without a remedy, and honours --project", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0));
    addEscalations(workspace, [
      { actionKey: "ghost/lost-step", kind: "dependency_unresolved", message: "Dependency is not resolvable.", remedy: null, firstDetectedAt: "2026-10-08T07:00:00.000Z" }
    ]);

    const all = run({ workspace, now: NOW });
    expect(all.data.items.map((item) => [item.key, item.project, item.blocking, item.answer])).toEqual([
      ["escalation:dependency_unresolved:ghost/lost-step", "ghost", true, "arcadia production status"],
      ["decision:demo/0001", "demo", true, "arcadia decision approve 0001 --project demo --answer 'Go ahead'"]
    ]);
    expect(keysOf(run({ workspace, now: NOW, project: "demo" }).data)).toEqual(["decision:demo/0001"]);
  });

  it("treats an escalation and an Agent Ask of a completed Project as stale, so a retired Project's rows stop blocking", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0), [
      { id: "retired-ask", createdAt: "2026-09-06T00:00:00.000Z", project: "retired", desiredResult: "Leftover." }
    ]);
    withDatabase(workspace, (db) => {
      const retired = createProjectWithInitialWork(db, {
        name: "Retired", mission: "Done.", status: "active", currentMilestone: "m", nextAction: "n", workClassification: "agent"
      });
      db.prepare("UPDATE projects SET status = 'completed' WHERE id = ?").run(retired.project.id);
    });
    addEscalations(workspace, [
      { actionKey: "retired/write-marker", kind: "build_packet_approval_pending", message: "The previewed Action is not ready to launch.", remedy: null, firstDetectedAt: "2026-10-08T07:00:00.000Z" },
      { actionKey: "ghost/lost-step", kind: "dependency_unresolved", message: "Dependency is not resolvable.", remedy: null, firstDetectedAt: "2026-10-08T07:30:00.000Z" }
    ]);

    const { data } = run({ workspace, now: NOW });
    // An unknown Project's escalation still blocks; the completed Project's rows are stale, counted, not listed.
    expect(keysOf(data)).toEqual(["escalation:dependency_unresolved:ghost/lost-step", "decision:demo/0001"]);
    expect(data.counts).toMatchObject({ blocking: 2, stale: 2, staleHidden: 2 });
    expect(run({ workspace, now: NOW, stale: true }).data.items.map((item) => [item.key, item.staleReason])).toEqual([
      ["agent_ask:retired/retired-ask", "its Project retired is completed"],
      ["escalation:build_packet_approval_pending:retired/write-marker", "its Project retired is completed"]
    ]);
  });

  it("lists a waiting operator task with its own title and the canonical command; blocking only for the selected Action", () => {
    const repo = selectableRepo();
    ledger(repo, [
      raised("op-2026-09-01-selected", "2026-09-01T00:00:00.000Z", "Create the API key in the console.", { kind: "action", id: "second-step" }),
      raised("op-2026-09-02-other", "2026-09-02T00:00:00.000Z", "Approve the invoice.", { kind: "action", id: "some-other-step" }),
      raised("op-2026-09-03-closed", "2026-09-03T00:00:00.000Z", "Already done.", { kind: "action", id: "second-step" }),
      { event: "done", id: "op-2026-09-03-closed", at: "2026-09-04T00:00:00.000Z", by: "operator" }
    ]);
    const workspace = fixtureWorkspace(repo);

    const { data } = run({ workspace, now: NOW });

    expect(data.items.map((item) => [item.key, item.blocking])).toEqual([
      ["operator_task:demo/op-2026-09-01-selected", true],
      ["decision:demo/0002", false],
      ["operator_task:demo/op-2026-09-02-other", false]
    ]);
    expect(data.items[0]).toEqual({
      key: "operator_task:demo/op-2026-09-01-selected", kind: "operator_task", title: "Create the API key in the console.", project: "demo",
      blocking: true, origin: "action:second-step", createdAt: "2026-09-01T00:00:00.000Z",
      sourceRef: ".arcadia/operator-tasks.jsonl#op-2026-09-01-selected",
      answer: `arcadia operator-task show op-2026-09-01-selected --repo ${repo}`,
      answerVia: [
        `once done, the operator closes it: arcadia operator-task close op-2026-09-01-selected --operator --repo ${repo}`,
        `or decline: arcadia operator-task decline op-2026-09-01-selected --because "<reason>" --operator --repo ${repo}`
      ]
    });
    expect(data.counts).toMatchObject({ blocking: 1, other: 2, byKind: { decision: 1, operator_task: 2 } });
  });

  it("dedupes a ledger task against the Decision or review_item that already represents it", () => {
    const repo = selectableRepo();
    ledger(repo, [
      raised("op-by-origin", "2026-09-01T00:00:00.000Z", "Origin is the listed Decision.", { kind: "decision", id: "0002" }),
      raised("op-by-decision-ref", "2026-09-02T00:00:00.000Z", "Reference names the listed Decision.", { kind: "action", id: "some-step" }, "decision/decision-0002"),
      raised("op-by-review-ref", "2026-09-03T00:00:00.000Z", "Reference names a listed review item.", { kind: "action", id: "some-step" }, "review_items:review-represented"),
      raised("op-unrepresented", "2026-09-04T00:00:00.000Z", "Nothing else represents this.", { kind: "decision", id: "0099" }, "https://console.example.test")
    ]);
    const workspace = fixtureWorkspace(repo);
    withDatabase(workspace, (db) => {
      const projectId = (db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }).id;
      db.prepare(
        `INSERT INTO review_items (id, slug, project_id, status, decision_needed, source_input, proposed_action, resolved_intent, confidence_label,
           confidence, missing_fields, context_json, created_at, updated_at)
         VALUES ('review-represented', 'R-REP', ?, 'open', 'Represented elsewhere?', 's', 'p', 'ActionClarification', 'medium', 0, '[]', '{}',
           '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')`
      ).run(projectId);
    });

    const { data } = run({ workspace, now: NOW });

    expect(keysOf(data).sort()).toEqual([
      "decision:demo/0002", "operator_task:demo/op-unrepresented", "review_item:demo/review-represented"
    ]);
    expect(data.counts.byKind).toEqual({ decision: 1, agent_ask: 0, review_item: 1, operator_task: 1, escalation: 0, clarify: 0, plan_action: 0 });
  });

  it("reads the ledger without a workspace, and says plainly when it cannot be parsed", () => {
    const repo = selectableRepo();
    ledger(repo, [raised("op-local", "2026-09-01T00:00:00.000Z", "Do it by hand.", { kind: "action", id: "second-step" })]);
    const missing = path.join(temp("missing"), "no-workspace-here");

    const local = run({ workspace: missing, now: NOW, repoRoot: repo });
    expect(local.data.items.map((item) => [item.key, item.blocking])).toEqual([
      ["operator_task:demo/op-local", true],
      ["decision:demo/0002", false]
    ]);
    expect(local.data.unavailable).toEqual([expect.stringMatching(/^workspace sources unavailable: /)]);

    write(repo, ".arcadia/operator-tasks.jsonl", "{not json\n");
    const broken = run({ workspace: fixtureWorkspace(repo), now: NOW });
    expect(keysOf(broken.data)).toEqual(["decision:demo/0002"]);
    expect(broken.data.unavailable).toEqual([expect.stringMatching(/^project sources unavailable: demo: operator task ledger: /)]);
  });
});

describe("arcadia todo: unclarified captures and Plan Actions", () => {
  interface FixtureAction {
    id: string;
    responsibility?: "agent" | "requires_review";
    status?: "open" | "blocked";
    /** Set to make the Action `question_open` with this question (it then carries no next_action). */
    question?: string;
    dependsOn?: string[];
    decisions?: string[];
  }

  function plan(current: string, actions: FixtureAction[]): string {
    const lines = [
      "---", "arcadia: v1", "type: plan", "slug: main-plan", "project: demo", "status: active", "milestone: Prove it",
      `current_action: ${current}`, "token_impact: medium", "token_budget: One bounded pass.", "recommended_model: gpt-5.6-sol",
      "updated: 2026-09-02", "actions:"
    ];
    for (const action of actions) {
      lines.push(
        `  - id: ${action.id}`, `    title: Title of ${action.id}`, `    status: ${action.status ?? "open"}`,
        `    responsibility: ${action.responsibility ?? "agent"}`, "    effort: session",
        ...(action.question
          ? ["    clarification: question_open", "    gap_type: missing-decision", `    question: ${action.question}`]
          : [`    next_action: Do ${action.id}.`, "    expected_artifact: A receipt", "    clarification: clarified", "    confidence: high"]),
        "    acceptance_criteria:", "      - It happens.",
        `    depends_on: [${(action.dependsOn ?? []).join(", ")}]`,
        `    decisions: [${(action.decisions ?? []).map((id) => `"${id}"`).join(", ")}]`, "    references: []"
      );
    }
    lines.push("questions: []", "---", "", "# Main plan", "");
    return lines.join("\n");
  }

  /**
   * `review-step` is the selected Action and needs the operator. The rest each hit one rule: an alert question, the
   * four dedup rules (required Decision, Decision naming the Action, review_item doc_ref, ledger origin), an Action
   * behind an unmet dependency, a blocked one, and a ready agent Action.
   */
  function planRepo(options: { projectStatus?: string; pointer?: string } = {}): string {
    const repo = temp("plan-action-repo");
    write(repo, "PROJECT.md", projectDoc().replace("status: active", `status: ${options.projectStatus ?? "active"}`));
    write(repo, "docs/plans/main-plan.md", plan(options.pointer ?? "review-step", [
      { id: "review-step", responsibility: "requires_review" },
      { id: "ask-step", question: "Which provider should the step use?" },
      { id: "decided-step", responsibility: "requires_review", decisions: ["0001"] },
      { id: "named-step", question: "Does Decision 0002 cover this?" },
      { id: "reviewed-step", question: "Is this already a review item?" },
      { id: "ledger-step", responsibility: "requires_review" },
      { id: "later-step", responsibility: "requires_review", dependsOn: ["review-step"] },
      { id: "parked-step", responsibility: "requires_review", status: "blocked" },
      { id: "ready-step", responsibility: "agent" }
    ]));
    write(repo, "docs/decisions/0001-block.md", decisionDoc("0001", "Should the decided step proceed?", "2026-09-03"));
    write(repo, "docs/decisions/0002-named.md", decisionDoc("0002", "Does this cover the named step?", "2026-09-04").replace("updated:", "action: named-step\nupdated:"));
    write(repo, ".arcadia/operator-tasks.jsonl", `${JSON.stringify({
      event: "raised", id: "op-ledger", at: "2026-09-05T00:00:00.000Z", by: "agent", asks: "Do the ledger step.",
      why_only_you: "Only you hold the account.", origin: { kind: "action", id: "ledger-step" }, reference: null
    })}\n`);
    return repo;
  }

  function projectIdOf(workspace: string): string {
    return withDatabase(workspace, (db) => (db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }).id);
  }

  function addReviewItem(workspace: string, id: string, input: { docRef?: string | null; status?: string; workItemId?: string } = {}): void {
    const projectId = projectIdOf(workspace);
    withDatabase(workspace, (db) => {
      db.prepare(
        `INSERT INTO review_items (id, slug, work_item_id, project_id, status, decision_needed, source_input, proposed_action, resolved_intent,
           confidence_label, confidence, missing_fields, context_json, created_at, updated_at, doc_ref)
         VALUES (?, ?, ?, ?, ?, 'Question.', 's', 'p', 'ActionClarification', 'medium', 0, '[]', '{}', '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z', ?)`
      ).run(id, id.toUpperCase(), input.workItemId ?? null, projectId, input.status ?? "open", input.docRef ?? null);
    });
  }

  /** A work_item of the first Project; `captured: false` leaves capture_id empty. */
  function addCapture(
    workspace: string,
    input: { title: string; status?: "open" | "done"; clarification?: "unclarified" | "clarified" | null; captured?: boolean }
  ): string {
    const projectId = projectIdOf(workspace);
    return withDatabase(workspace, (db) => {
      const item = createWorkItemRecord(db, {
        projectId, title: input.title, rawInput: input.title, queue: "inbox", workClassification: "agent", nextAction: "Clarify it",
        status: input.status ?? "open",
        clarificationStatus: input.clarification === undefined ? "unclarified" : (input.clarification ?? undefined)
      });
      if (input.captured !== false) {
        db.prepare("INSERT INTO ask_capture_envelopes (id, request_id, fingerprint, original_text, ingress_source, captured_at, status, envelope_json) VALUES (?, ?, 'f', 'x', 'test', ?, 'completed', '{}')")
          .run(`capture-${item.id}`, `request-${item.id}`, "2026-09-07T00:00:00.000Z");
        db.prepare("UPDATE work_items SET capture_id = ?, created_at = ? WHERE id = ?").run(`capture-${item.id}`, "2026-09-07T00:00:00.000Z", item.id);
      }
      return item.id;
    });
  }

  /** The Plan fixture's workspace, with the review_item that represents `reviewed-step`. */
  function planWorkspace(options: { projectStatus?: string; pointer?: string } = {}): string {
    const workspace = fixtureWorkspace(planRepo(options));
    addReviewItem(workspace, "review-reviewed", { docRef: "plan/main-plan#reviewed-step" });
    return workspace;
  }

  const planActions = (data: TodoData) => data.items.filter((item) => item.kind === "plan_action");

  it("lists the selected Action that needs you as blocking and a question_open Action as an alert, with their own words", () => {
    const workspace = planWorkspace();
    const { data } = run({ workspace, now: NOW, all: true });

    expect(planActions(data).map((item) => [item.key, item.blocking, item.origin, item.title])).toEqual([
      ["plan_action:demo/main-plan#review-step", true, "requires_review", "Title of review-step"],
      ["plan_action:demo/main-plan#ask-step", false, "question_open", "Which provider should the step use?"]
    ]);
    expect(planActions(data)[0]).toMatchObject({
      project: "demo", createdAt: "2026-09-02", sourceRef: "docs/plans/main-plan.md#review-step",
      answer: "arcadia agent-ask preview --file <ask.yaml>"
    });
    expect(planActions(data)[0].answerVia?.join("\n")).toContain("arcadia next --project demo");
    expect(planActions(data)[1].answerVia?.join("\n")).not.toContain("arcadia next");
    expect(data.counts.byKind.plan_action).toBe(2);
  });

  it("a review_item on a question_open Action is blocking only when that Action is the selected one; the gate names no other question_open (#1074)", () => {
    // `reviewed-step` is question_open and represented by review item `review-reviewed`.
    const elsewhere = run({ workspace: planWorkspace(), now: NOW, all: true }).data;
    expect(elsewhere.items.filter((item) => item.kind === "review_item").map((item) => [item.key, item.blocking])).toEqual([
      ["review_item:demo/review-reviewed", false]
    ]);
    const selected = run({ workspace: planWorkspace({ pointer: "reviewed-step" }), now: NOW, all: true }).data;
    expect(selected.items.filter((item) => item.kind === "review_item").map((item) => [item.key, item.blocking])).toEqual([
      ["review_item:demo/review-reviewed", true]
    ]);
  });

  it("dedupes an Action against the Decision, review_item or ledger task that already represents it; parked, dependent and ready Actions never appear", () => {
    const workspace = planWorkspace();

    const { data } = run({ workspace, now: NOW, all: true });
    const keys = data.items.map((item) => item.key);

    // Shown once, by what represents them.
    expect(keys).toEqual(expect.arrayContaining(["decision:demo/0001", "decision:demo/0002", "review_item:demo/review-reviewed", "operator_task:demo/op-ledger"]));
    for (const id of ["decided-step", "named-step", "reviewed-step", "ledger-step", "later-step", "parked-step", "ready-step"]) {
      expect(keys).not.toContain(`plan_action:demo/main-plan#${id}`);
    }
    expect(planActions(data).map((item) => item.key)).toEqual(["plan_action:demo/main-plan#review-step", "plan_action:demo/main-plan#ask-step"]);
  });

  it("is blocking only for the selected Action: pointing elsewhere makes every Plan Action an alert", () => {
    const workspace = planWorkspace({ pointer: "ready-step" });
    const { data } = run({ workspace, now: NOW, all: true });
    // Same date, so the key breaks the tie.
    expect(planActions(data).map((item) => [item.key, item.blocking])).toEqual([
      ["plan_action:demo/main-plan#ask-step", false],
      ["plan_action:demo/main-plan#review-step", false]
    ]);
  });

  it("lists no Plan Action for a Project in a pause state", () => {
    const workspace = planWorkspace({ projectStatus: "paused" });
    const { data } = run({ workspace, now: NOW, all: true });
    expect(planActions(data)).toEqual([]);
    expect(data.counts.byKind.plan_action).toBe(0);
  });

  it("reads Plan Actions without a workspace, beside the single workspace-unavailable line", () => {
    const missing = path.join(temp("missing"), "no-workspace-here");
    const { data } = run({ workspace: missing, now: NOW, repoRoot: planRepo(), all: true });
    // Without the database there is no review_item to dedupe `reviewed-step` against, so it is still listed.
    expect(planActions(data).map((item) => [item.key, item.blocking])).toEqual([
      ["plan_action:demo/main-plan#review-step", true],
      ["plan_action:demo/main-plan#ask-step", false],
      ["plan_action:demo/main-plan#reviewed-step", false]
    ]);
    expect(data.unavailable).toEqual([expect.stringMatching(/^workspace sources unavailable: /)]);
    expect(render(data).filter((line) => line.startsWith("workspace sources unavailable:"))).toHaveLength(1);
  });

  it("lists an unclarified, captured, non-done work_item without an open review_item as a clarify alert", () => {
    const workspace = planWorkspace({ pointer: "ready-step" });
    const listed = addCapture(workspace, { title: "Tidy the garage" });
    addCapture(workspace, { title: "Already done", status: "done" });
    addCapture(workspace, { title: "Already clarified", clarification: "clarified" });
    addCapture(workspace, { title: "Never evaluated", clarification: null });
    addCapture(workspace, { title: "Not from a capture", captured: false });
    addReviewItem(workspace, "review-for-open", { workItemId: addCapture(workspace, { title: "Has an open question" }) });
    addReviewItem(workspace, "review-for-deferred", { workItemId: addCapture(workspace, { title: "Has a deferred question" }), status: "deferred" });
    const resolved = addCapture(workspace, { title: "Question was answered" });
    addReviewItem(workspace, "review-resolved", { workItemId: resolved, status: "approved" });

    const { data } = run({ workspace, now: NOW, all: true });
    const clarify = data.items.filter((item) => item.kind === "clarify");

    expect(clarify.map((item) => item.key).sort()).toEqual([`clarify:demo/${listed}`, `clarify:demo/${resolved}`].sort());
    expect(clarify.find((item) => item.key === `clarify:demo/${listed}`)).toMatchObject({
      title: "Tidy the garage", project: "demo", blocking: false, createdAt: "2026-09-07T00:00:00.000Z",
      sourceRef: `work_items:${listed}`, answer: `arcadia clarify --work ${listed} --apply`
    });
    expect(data.counts.byKind.clarify).toBe(2);
    expect(render(data).join("\n")).toContain(`answer: arcadia clarify --work ${listed} --apply`);
  });

  it("counts a Project with no repo_path on one line and lists none of its items", () => {
    const workspace = planWorkspace();
    withDatabase(workspace, (db) => {
      const bare = createProjectWithInitialWork(db, {
        name: "Bare", mission: "No repository.", status: "active", currentMilestone: "m", nextAction: "n", workClassification: "agent"
      });
      const item = createWorkItemRecord(db, {
        projectId: bare.project.id, title: "Bare capture", rawInput: "Bare capture", queue: "inbox", workClassification: "agent",
        nextAction: "Clarify it", clarificationStatus: "unclarified"
      });
      db.prepare("INSERT INTO ask_capture_envelopes (id, request_id, fingerprint, original_text, ingress_source, captured_at, status, envelope_json) VALUES ('capture-bare', 'request-bare', 'f', 'x', 'test', '2026-09-07T00:00:00.000Z', 'completed', '{}')").run();
      db.prepare("UPDATE work_items SET capture_id = 'capture-bare' WHERE id = ?").run(item.id);
    });

    const { data } = run({ workspace, now: NOW, all: true });

    expect(data.items.every((item) => item.project === "demo")).toBe(true);
    expect(data.counts.noRepoPath.projects).toBe(1);
    expect(data.counts.noRepoPath.items).toBeGreaterThanOrEqual(1);
    expect(data.counts.fixture).toEqual({ projects: 0, items: 0 });
    expect(data.unavailable).toEqual([]);
    expect(render(data).join("\n")).toContain(`Projects with no repo_path collapsed: 1 Projects, ${data.counts.noRepoPath.items} items not listed`);
  });

  it("golden: the default view as JSON, one item per new kind, additive under arcadia-todo-v1", () => {
    const repo = temp("golden-repo");
    write(repo, "PROJECT.md", projectDoc());
    write(repo, "docs/plans/main-plan.md", plan("review-step", [
      { id: "review-step", responsibility: "requires_review" },
      { id: "ask-step", question: "Which provider should the step use?" }
    ]));
    const workspace = fixtureWorkspace(repo);
    const captured = addCapture(workspace, { title: "Tidy the garage" });

    const { data } = run({ workspace, now: NOW });

    expect(data).toEqual({
      schema: "arcadia-todo-v1", agentWork: [], askUnavailable: null,
      view: "default",
      asOf: { at: "2026-10-08T12:00:00.000Z", workspace: path.basename(workspace), workspacePath: workspace },
      counts: {
        blocking: 1, other: 2, stale: 0, staleHidden: 0,
        byKind: { decision: 0, agent_ask: 0, review_item: 0, operator_task: 0, escalation: 0, clarify: 1, plan_action: 2 },
        hidden: 0, agentFlaggedHidden: 0, askQuestions: 0, askHidden: 0, agentsDoing: 0, backBurner: { incubating: 0, newInSevenDays: 0 }, fixture: { projects: 0, items: 0 }, noRepoPath: { projects: 0, items: 0 }
      },
      items: [
        {
          key: "plan_action:demo/main-plan#review-step", kind: "plan_action", title: "Title of review-step", project: "demo", blocking: true,
          origin: "requires_review", createdAt: "2026-09-02", sourceRef: "docs/plans/main-plan.md#review-step",
          answer: "arcadia agent-ask preview --file <ask.yaml>",
          answerVia: [
            "an Agent Ask with target_ref plan/main-plan#review-step that completes the Action once you have done the step (docs/agent-guidance/agent-asks.md)",
            "read it first: arcadia next --project demo"
          ]
        },
        {
          key: "plan_action:demo/main-plan#ask-step", kind: "plan_action", title: "Which provider should the step use?", project: "demo", blocking: false,
          origin: "question_open", createdAt: "2026-09-02", sourceRef: "docs/plans/main-plan.md#ask-step",
          answer: "arcadia agent-ask preview --file <ask.yaml>",
          answerVia: ["an Agent Ask with target_ref plan/main-plan#ask-step that records your answer, so the question is no longer open (docs/agent-guidance/agent-asks.md)"]
        },
        {
          key: `clarify:demo/${captured}`, kind: "clarify", title: "Tidy the garage", project: "demo", blocking: false,
          createdAt: "2026-09-07T00:00:00.000Z", sourceRef: `work_items:${captured}`, origin: `capture:capture-${captured} via:test`,
          answer: `arcadia clarify --work ${captured} --apply`,
          answerVia: [`dry run first (writes nothing): arcadia clarify --work ${captured}`]
        }
      ],
      unavailable: []
    });
  });
});

describe("arcadia todo: collapsed Projects never hide a blocking item", () => {
  function addBareProject(workspace: string, name: string, repoPath?: string): string {
    return withDatabase(workspace, (db) => {
      const bundle = createProjectWithInitialWork(db, {
        name, mission: `${name} mission.`, status: "active", currentMilestone: "m", nextAction: "n", workClassification: "agent"
      });
      if (repoPath) upsertProjectMetadata(db, { projectId: bundle.project.id, repoPath });
      return bundle.project.id;
    });
  }

  function escalate(workspace: string, actionKey: string): void {
    withDatabase(workspace, (db) => {
      db.prepare(
        "INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES (?, 'repair_budget_exhausted', 'Repair budget spent.', 'arcadia production status', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')"
      ).run(actionKey);
    });
  }

  it("lists a no-repo_path Project's escalation as blocking, and counts only its non-blocking Ask and review_item", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0), [
      { id: "bare-ask", createdAt: "2026-09-05T00:00:00.000Z", project: "bare", desiredResult: "Asked of the bare Project." }
    ]);
    const bareId = addBareProject(workspace, "Bare");
    escalate(workspace, "bare/stalled-action");
    withDatabase(workspace, (db) => {
      db.prepare(
        `INSERT INTO review_items (id, slug, project_id, status, decision_needed, source_input, proposed_action, resolved_intent, confidence_label,
           confidence, missing_fields, context_json, created_at, updated_at)
         VALUES ('review-bare', 'R-BARE', ?, 'open', 'Bare question?', 's', 'p', 'ActionClarification', 'medium', 0, '[]', '{}',
           '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z')`
      ).run(bareId);
    });

    const { data } = run({ workspace, now: NOW, all: true });

    // The escalation is listed and counted as blocking; the Ask and the review_item are only a count.
    expect(data.items.filter((item) => item.project === "bare").map((item) => [item.key, item.blocking])).toEqual([
      ["escalation:repair_budget_exhausted:bare/stalled-action", true]
    ]);
    expect(data.counts.blocking).toBe(2);
    expect(data.counts.byKind.escalation).toBe(1);
    expect(data.counts.noRepoPath).toEqual({ projects: 1, items: 2 });
    expect(render(data).join("\n")).toContain("Projects with no repo_path collapsed: 1 Projects, 2 items not listed");
  });

  it("lists a fixture Project's blocking item and collapses its non-blocking ones", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0), [
      { id: "rehearsal-ask", createdAt: "2026-09-05T00:00:00.000Z", project: "run-rehearsal-3", desiredResult: "A rehearsal ask." }
    ]);
    addBareProject(workspace, "Run Rehearsal 3", fixtureRepo(0));
    escalate(workspace, "run-rehearsal-3/stalled-action");

    const { data } = run({ workspace, now: NOW });

    expect(data.items.filter((item) => item.project === "run-rehearsal-3").map((item) => [item.key, item.blocking])).toEqual([
      ["escalation:repair_budget_exhausted:run-rehearsal-3/stalled-action", true]
    ]);
    expect(data.counts.blocking).toBe(2);
    expect(data.counts.fixture.projects).toBe(1);
    expect(data.counts.fixture.items).toBe(1);
  });
});

describe("arcadia todo: gate details and answer paths on Decisions and Agent Asks", () => {
  function gatedRepo(): string {
    const repo = temp("gated-repo");
    write(repo, "PROJECT.md", projectDoc());
    write(repo, "docs/plans/main-plan.md", planDoc());
    write(repo, "docs/decisions/0001-gated.md", [
      "---", "arcadia: v1", "type: decision", 'id: "0001"', "slug: decision-0001", "project: demo", "status: open",
      "question: Should the second step proceed?", "gate_question: resists_reversal", "updated: 2026-09-03",
      "options:",
      "  - label: Go ahead", "    consequence: The step proceeds.", "    recommended: true",
      "  - label: Hold", "    consequence: Nothing changes until you decide again.",
      "evidence:", "  - docs/reports/example.json", "  - PR 1068 review",
      "---", "", "# Decision", ""
    ].join("\n"));
    write(repo, "docs/decisions/0003-references.md", [
      "---", "arcadia: v1", "type: decision", 'id: "0003"', "slug: decision-0003", "project: demo", "status: open",
      "question: Does the references fallback work?", "updated: 2026-09-05",
      "references:", "  - docs/proposals/cited.md",
      "---", "", "# Decision", ""
    ].join("\n"));
    write(repo, "docs/decisions/0002-bare.md", decisionDoc("0002", "A bare question?", "2026-09-04").replace("options:\n  - label: Go ahead\n    consequence: The step proceeds.\n    recommended: true\n", ""));
    return repo;
  }

  function addDecisionReview(workspace: string, id: string, docRef: string, status = "open"): void {
    withDatabase(workspace, (db) => {
      const projectId = (db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }).id;
      db.prepare(
        `INSERT INTO review_items (id, slug, work_item_id, project_id, status, decision_needed, source_input, proposed_action, resolved_intent,
           confidence_label, confidence, missing_fields, context_json, created_at, updated_at, doc_ref)
         VALUES (?, ?, NULL, ?, ?, 'Should the second step proceed?', 's', 'p', 'ActionClarification', 'medium', 0, '[]', '{}',
           '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z', ?)`
      ).run(id, id.toUpperCase(), projectId, status, docRef);
    });
  }

  const dashboardLine =
    'Dashboard: /runs, To-do section, Approve a Decision option (POST /api/approvals {"kind":"decision","id":"0001","project":"demo","option":"<option label>"}; no option sends the recommended one)';

  it("a Decision carries its gate question, options with consequences, evidence and its dashboard path", () => {
    const { data } = run({ workspace: fixtureWorkspace(gatedRepo()), now: NOW, all: true });
    const gated = data.items.find((item) => item.key === "decision:demo/0001");
    expect(gated).toMatchObject({
      gateQuestion: "resists_reversal",
      options: [
        { label: "Go ahead", consequence: "The step proceeds.", recommended: true },
        { label: "Hold", consequence: "Nothing changes until you decide again.", recommended: false }
      ],
      evidence: [{ text: "docs/reports/example.json" }, { text: "PR 1068 review" }]
    });
    // No review item was raised from this Decision, so there is no Discord reply path to list.
    expect(gated?.answerVia).toEqual([dashboardLine]);
    expect(render(data).join("\n")).toContain("option (recommended): Go ahead — The step proceeds.");
  });

  it("carries the Discord reply path of the review item raised from an open Decision, and only then", () => {
    const workspace = fixtureWorkspace(gatedRepo());
    addDecisionReview(workspace, "review-of-0001", "decision/decision-0001");
    // An answered review item adds nothing.
    addDecisionReview(workspace, "review-answered", "decision/decision-0002", "approved");
    const { data } = run({ workspace, now: NOW, all: true });

    // The review item is listed as the Decision, once.
    expect(data.items.filter((item) => item.kind === "review_item")).toEqual([]);
    const gated = data.items.find((item) => item.key === "decision:demo/0001");
    expect(gated?.answerVia).toEqual([
      dashboardLine,
      "Discord: reply to the requires-review notification for review item review-of-0001 (REVIEW-OF-0001) with your answer; review resolve-reply writes it into the Decision document",
      'or: arcadia review resolve-reply "<answer>" --id review-of-0001'
    ]);
    const other = data.items.find((item) => item.key === "decision:demo/0002");
    expect(other?.answerVia?.join(" ")).not.toContain("Discord");
  });

  it("an Agent Ask has no Discord path", () => {
    const workspace = fixtureWorkspace(gatedRepo(), [{ id: "any-ask", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Whatever." }]);
    const ask = run({ workspace, now: NOW, all: true }).data.items.find((item) => item.key === "agent_ask:demo/any-ask");
    expect(ask?.answerVia?.join(" ")).not.toContain("Discord");
  });

  it("lists no dashboard path when there is no workspace to settle through", () => {
    const { data } = run({ workspace: path.join(temp("missing"), "nope"), repoRoot: gatedRepo(), now: NOW, all: true });
    const gated = data.items.find((item) => item.key === "decision:demo/0001");
    expect(gated).toBeDefined();
    expect(gated).not.toHaveProperty("answerVia");
  });

  it("reads a Decision's evidence from `references` when it has no `evidence` list", () => {
    const { data } = run({ workspace: fixtureWorkspace(gatedRepo()), now: NOW, all: true });
    expect(data.items.find((item) => item.key === "decision:demo/0003")?.evidence).toEqual([{ text: "docs/proposals/cited.md" }]);
  });

  it("nothing is synthesized: a Decision that records no options, gate question or evidence omits those fields", () => {
    const { data } = run({ workspace: fixtureWorkspace(gatedRepo()), now: NOW, all: true });
    const bare = data.items.find((item) => item.key === "decision:demo/0002");
    expect(bare).toBeDefined();
    expect(bare).not.toHaveProperty("options");
    expect(bare).not.toHaveProperty("gateQuestion");
    expect(bare).not.toHaveProperty("evidence");
  });

  it("an Agent Ask carries its stored gate question, options and evidence, and its dashboard path", () => {
    const workspace = fixtureWorkspace(gatedRepo(), [
      {
        id: "gated-ask", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Choose the provider.", intent: "decision",
        gateQuestion: "reasonable_disagreement",
        options: [{ label: "Local", consequence: "Runs on this Mac.", recommended: true }, { label: "Frontier", consequence: "Costs money.", recommended: false }],
        evidence: [{ criterion: "Both providers benchmarked", status: "met", note: "see report" }]
      },
      { id: "plain-ask", createdAt: "2026-09-06T00:00:00.000Z", desiredResult: "Nothing recorded." },
      { id: "old-ask", createdAt: "2026-09-07T00:00:00.000Z", desiredResult: "Stored before gate fields existed.", legacyShape: true }
    ]);
    const { data } = run({ workspace, now: NOW, all: true });
    const gated = data.items.find((item) => item.key === "agent_ask:demo/gated-ask");
    expect(gated).toMatchObject({
      gateQuestion: "reasonable_disagreement",
      options: [
        { label: "Local", consequence: "Runs on this Mac.", recommended: true },
        { label: "Frontier", consequence: "Costs money.", recommended: false }
      ],
      evidence: [{ text: "Both providers benchmarked", status: "met", note: "see report" }]
    });
    expect(gated?.answerVia).toEqual([
      'Dashboard: /runs, To-do section, Accept or Reject (POST /api/approvals {"kind":"agent_ask","id":"gated-ask","project":"demo","disposition":"accepted"|"rejected"})'
    ]);
    const plain = data.items.find((item) => item.key === "agent_ask:demo/plain-ask");
    expect(plain).not.toHaveProperty("options");
    expect(plain).not.toHaveProperty("gateQuestion");
    expect(plain).not.toHaveProperty("evidence");
    expect(plain?.answerVia).toHaveLength(1);
    // A stored proposal that never had gateQuestion, evidence or options still lists, with those fields omitted.
    const old = data.items.find((item) => item.key === "agent_ask:demo/old-ask");
    expect(old).toBeDefined();
    expect(old).not.toHaveProperty("options");
    expect(old).not.toHaveProperty("gateQuestion");
    expect(old).not.toHaveProperty("evidence");
  });
});

describe("arcadia todo: origin on every item kind", () => {
  it("takes a Decision's origin only from its own plan and action fields, else null", () => {
    const repo = fixtureRepo(0);
    write(repo, "docs/decisions/0003-both.md", decisionDoc("0003", "Both fields?", "2026-09-04").replace("updated:", "plan: main-plan\naction: second-step\nupdated:"));
    write(repo, "docs/decisions/0004-plan-only.md", decisionDoc("0004", "Plan only?", "2026-09-05").replace("updated:", "plan: main-plan\nupdated:"));
    write(repo, "docs/decisions/0005-action-only.md", decisionDoc("0005", "Action only?", "2026-09-06").replace("updated:", "action: second-step\nupdated:"));
    const { data } = run({ workspace: fixtureWorkspace(repo), now: NOW, all: true });
    const origins = Object.fromEntries(data.items.filter((item) => item.kind === "decision").map((item) => [item.key, item.origin]));
    expect(origins).toEqual({
      "decision:demo/0001": null,
      "decision:demo/0003": "plan:main-plan action:second-step",
      "decision:demo/0004": "plan:main-plan",
      "decision:demo/0005": "action:second-step"
    });
  });

  it("states an Agent Ask's request id and the ingress source of its capture envelope", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0), [{ id: "ask-1", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Do it." }]);
    withDatabase(workspace, (db) => {
      db.prepare("UPDATE ask_capture_envelopes SET ingress_source = 'ingress:discord' WHERE id = 'capture-ask-1'").run();
    });
    const { data } = run({ workspace, now: NOW, all: true });
    expect(data.items.find((item) => item.key === "agent_ask:demo/ask-1")?.origin).toBe("request:request-ask-1 via:ingress:discord");
  });

  it("carries the key `origin` (a string or null) on every item and prints it when set", () => {
    const workspace = fixtureWorkspace(fixtureRepo(1), [{ id: "ask-1", createdAt: "2026-09-05T00:00:00.000Z", desiredResult: "Do it." }]);
    const { data } = run({ workspace, now: NOW, all: true });
    expect(data.items.length).toBeGreaterThan(0);
    for (const item of data.items) {
      expect(Object.hasOwn(item, "origin")).toBe(true);
      expect(item.origin === null || typeof item.origin === "string").toBe(true);
    }
    expect(render(data).join("\n")).toContain("origin: request:request-ask-1 via:test");
  });
});
