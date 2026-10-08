import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_ASK_CAVEAT, runTodoCommand, renderTodoSuccess, type TodoData } from "../src/commands/todo.js";
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

function fixtureWorkspace(
  repo: string,
  asks: Array<{ id: string; createdAt: string; project?: string; desiredResult: string }> = []
): string {
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
        project: ask.project ?? "demo", desiredResult: ask.desiredResult, intent: "amend", targetRef: null, actions: [], options: []
      };
      db.prepare("INSERT INTO agent_ask_proposals (id, request_id, capture_id, fingerprint, format, intent_kind, project_ref, proposal_json, created_at) VALUES (?, ?, ?, 'f', 'strict', 'amend', ?, ?, ?)")
        .run(ask.id, `request-${ask.id}`, `capture-${ask.id}`, normalized.project, JSON.stringify({ id: ask.id, normalized }), ask.createdAt);
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

    const { data } = runTodoCommand({ workspace, now: NOW });

    expect(data).toEqual({
      schema: "arcadia-todo-v1",
      asOf: { at: "2026-10-08T12:00:00.000Z", workspace },
      counts: { blocking: 1, other: 2, byKind: { decision: 2, agent_ask: 1 }, hidden: 0 },
      items: [
        {
          key: "decision:demo/0001", kind: "decision", title: "Should the second step proceed?", project: "demo", blocking: true,
          createdAt: "2026-09-03", sourceRef: "docs/decisions/0001-block.md",
          answer: "arcadia decision approve 0001 --project demo --answer 'Go ahead'"
        },
        {
          key: "agent_ask:demo/proposal-1", kind: "agent_ask", title: "Amend the demo Action.", project: "demo", blocking: false,
          createdAt: "2026-09-05T00:00:00.000Z", sourceRef: "agent_ask_proposals:proposal-1",
          answer: "arcadia agent-ask settle --proposal proposal-1 --request-id <settlement-request-id> --disposition accepted"
        },
        {
          key: "decision:demo/0002", kind: "decision", title: "Unrelated question 0002?", project: "demo", blocking: false,
          createdAt: "2026-09-10", sourceRef: "docs/decisions/0002-alert.md",
          answer: "arcadia decision approve 0002 --project demo --answer 'Go ahead'"
        }
      ],
      unavailable: []
    });

    const lines = render(data);
    expect(lines[0]).toBe(`Operator to-do: 1 blocking · 2 other (decisions 2, agent asks 1) (as of 2026-10-08T12:00:00.000Z, workspace ${workspace})`);
    expect(lines.filter((line) => line === AGENT_ASK_CAVEAT)).toHaveLength(1);
    expect(AGENT_ASK_CAVEAT).toBe("Agent Asks are listed while unsettled, not verified as still live; stale filtering arrives in a later slice.");
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

    const { data } = runTodoCommand({ workspace, now: NOW, all: true });

    expect(data.items.map((item) => item.key).sort()).toEqual(["decision:demo/0001", "decision:other/0001"]);
    expect(new Set(data.items.map((item) => item.key)).size).toBe(2);
  });

  it("shows every blocking item, caps the others at five oldest-first, and says how many more", () => {
    const repo = fixtureRepo(7);
    const workspace = fixtureWorkspace(repo);

    const capped = runTodoCommand({ workspace, now: NOW });
    expect(capped.data.counts).toEqual({ blocking: 1, other: 7, byKind: { decision: 8, agent_ask: 0 }, hidden: 2 });
    expect(capped.data.items.filter((item) => !item.blocking).map((item) => item.key)).toEqual([
      "decision:demo/0002", "decision:demo/0003", "decision:demo/0004", "decision:demo/0005", "decision:demo/0006"
    ]);
    const lines = render(capped.data);
    expect(lines[0]).toBe(`Operator to-do: 1 blocking · 7 other (decisions 8, agent asks 0) (as of 2026-10-08T12:00:00.000Z, workspace ${workspace})`);
    expect(lines.at(-1)).toBe("2 more: --all");
    expect(lines.indexOf("Blocking:")).toBeLessThan(lines.indexOf("Other (oldest first):"));

    const all = runTodoCommand({ workspace, now: NOW, all: true });
    expect(all.data.counts.hidden).toBe(0);
    expect(all.data.items).toHaveLength(8);
    expect(render(all.data).join("\n")).not.toContain("more: --all");
  });

  it("filters to one Project and refuses an unknown one", () => {
    const workspace = fixtureWorkspace(fixtureRepo());
    expect(runTodoCommand({ workspace, now: NOW, project: "demo" }).data.counts.blocking).toBe(1);
    expect(() => runTodoCommand({ workspace, now: NOW, project: "nope" })).toThrow(/Project not found/);
  });

  it("keeps an Agent Ask for a Project it cannot match instead of dropping it", () => {
    const workspace = fixtureWorkspace(fixtureRepo(0), [
      { id: "stray", createdAt: "2026-09-06T00:00:00.000Z", project: "elsewhere", desiredResult: "Do something elsewhere." }
    ]);
    const { data } = runTodoCommand({ workspace, now: NOW });
    expect(data.items.map((item) => [item.key, item.project, item.blocking])).toEqual([
      ["decision:demo/0001", "demo", true],
      ["agent_ask:elsewhere/stray", "elsewhere", false]
    ]);
  });

  it("reports a Project with no readable repository as unavailable rather than silently omitting its Decisions", () => {
    const workspace = fixtureWorkspace(path.join(tmpdir(), "arcadia-todo-no-such-repo"));
    const { data } = runTodoCommand({ workspace, now: NOW });
    expect(data.items).toEqual([]);
    expect(data.unavailable).toHaveLength(1);
    expect(data.unavailable[0]).toMatch(/^project sources unavailable: demo has no repository at /);
    expect(render(data).at(-1)).toBe(data.unavailable[0]);
  });

  it("degrades to the checkout's Decisions with one explicit remedy line when the workspace cannot be read", () => {
    const repo = fixtureRepo();
    const missing = path.join(temp("missing"), "no-workspace-here");

    const { data } = runTodoCommand({ workspace: missing, now: NOW, repoRoot: repo });

    expect(data.asOf.workspace).toBeNull();
    expect(data.counts).toEqual({ blocking: 1, other: 1, byKind: { decision: 2, agent_ask: 0 }, hidden: 0 });
    expect(data.items.map((item) => item.key)).toEqual(["decision:demo/0001", "decision:demo/0002"]);
    expect(data.unavailable).toEqual([expect.stringMatching(/^workspace sources unavailable: no workspace at .*arcadia init <path>/)]);
    const lines = render(data);
    expect(lines.filter((line) => line.startsWith("workspace sources unavailable:"))).toHaveLength(1);
    expect(lines[0]).toBe("Operator to-do: 1 blocking · 1 other (decisions 2, agent asks 0) (as of 2026-10-08T12:00:00.000Z)");
  });

  it("names the configuration remedy when no workspace resolves at all", () => {
    const home = temp("home");
    const repo = fixtureRepo(0);
    vi.stubEnv("HOME", home);
    vi.stubEnv("ARCADIA_CONFIG_PATH", path.join(home, "none.json"));
    vi.stubEnv("ARCADIA_WORKSPACE", "");
    vi.stubEnv("ARCADIA_INVOKED_FROM", repo);
    vi.stubEnv("ARCADIA_REQUIRE_INLINE_WORKSPACE", "");

    const { data } = runTodoCommand({ now: NOW, repoRoot: repo });

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
    const lines = render(runTodoCommand({ workspace, now: NOW }).data).join("\n");
    expect(lines).toContain("0 blocking · 0 other (decisions 0, agent asks 0)");
    expect(lines).toContain("Nothing is waiting on you");
  });
});
