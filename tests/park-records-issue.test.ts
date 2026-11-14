import { afterEach, describe, expect, it } from "vitest";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { ensureProductionTickTables, recordOperatorEscalation } from "../src/production/tick.js";
import { isolateProcess, type IsolatedProcess } from "./fast-rehearsal/helpers/environment.js";
import { FastRehearsal, SCENARIO_TIMEOUT_MS } from "./fast-rehearsal/helpers/world.js";

/**
 * Issue #2629 (Decision 0223 A): parking an Action on an Action-local
 * repair_budget_exhausted hold records a GitHub Issue naming the Action, the
 * failure and the revival trigger. Real worker tick; only GitHub (an injected
 * command runner), tmux and the agent are faked (the fast-rehearsal harness).
 */
const PARKED = "parked-a";
const OTHER = "parked-b";
const ISSUE_URL = "https://github.com/example/repo/issues/9001";
const LAST_ERROR = "Resumed Session exited incomplete without changing its candidate.";

const fixturePlan = {
  firstAction: PARKED,
  genesisFiles: { "scripts/check-parked.mjs": "process.exit(0);\n" },
  actionsYaml: [PARKED, OTHER].map((id) => `  - id: ${id}
    title: Implement docs/parked/${id}.md containing the line "${id} done".
    status: open
    responsibility: agent
    effort: session
    next_action: Implement docs/parked/${id}.md containing the line "${id} done".
    expected_artifact: docs/parked/${id}.md
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - docs/parked/${id}.md contains the line "${id} done" and nothing else.
    depends_on: []
    decisions: []
`).join("")
};

interface GhCall { args: string[] }
let isolation: IsolatedProcess | undefined;
let world: FastRehearsal | undefined;
afterEach(() => { world?.dispose(); isolation?.restore(); world = undefined; isolation = undefined; });

/** A world with PARKED parked on a repair_budget_exhausted hold; `localAttempts` 3 is Action-local, 0 a global cause. */
function parkWorld(name: string, options: { localAttempts: number; kind?: string; failFiling?: boolean }) {
  isolation = isolateProcess();
  const w = new FastRehearsal(name, isolation, import.meta.filename, { fixturePlan, validationCommand: "node scripts/check-parked.mjs", workerMerge: true });
  world = w;
  w.start();
  const ghCalls: GhCall[] = [];
  const bodies: string[] = [];
  const titles: string[] = [];
  const original = w.gh.runCommand;
  Object.defineProperty(w.gh, "runCommand", {
    value: ((input: Parameters<typeof original>[0]) => {
      if (input.command === "gh" && input.args[0] === "issue") {
        ghCalls.push({ args: input.args });
        if (input.args[1] === "create") {
          if (options.failFiling) return { status: 1, stdout: "", stderr: "gh: not authenticated", error: null };
          titles.push(input.args[input.args.indexOf("--title") + 1] ?? "");
          bodies.push(input.args[input.args.indexOf("--body") + 1] ?? "");
          return { status: 0, stdout: `${ISSUE_URL}\n`, stderr: "", error: null };
        }
        return { status: 0, stdout: "[]", stderr: "", error: null };
      }
      return original(input);
    })
  });
  const key = w.actionKey(PARKED);
  const now = new Date(w.now.getTime());
  withDatabase(w.workspace, (db) => {
    ensureProductionTickTables(db);
    const at = now.toISOString();
    db.prepare(`INSERT INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at, local_attempts)
      VALUES (?, 3, ?, ?, ?, ?)`).run(key, LAST_ERROR, at, at, options.localAttempts);
    recordOperatorEscalation(db, {
      actionKey: key, kind: options.kind ?? "repair_budget_exhausted",
      message: `Repair budget exhausted for ${key} after 3 failed launch attempt(s); most recent error: ${LAST_ERROR}`,
      remedy: `Repair the underlying problem, then run \`arcadia production reset-repair-budget ${key}\`.`, now
    });
  });
  const state = () => withReadOnlyDatabase(w.workspace, (db) => ({
    counters: db.prepare("SELECT attempts, local_attempts FROM production_repair_attempts WHERE action_key = ?").get(key),
    escalation: db.prepare("SELECT kind, message, remedy FROM production_operator_escalations WHERE action_key = ?").get(key)
  }));
  const creates = () => ghCalls.filter((call) => call.args[1] === "create");
  return { w, key, ghCalls, bodies, titles, creates, state };
}

describe("Issue #2629: an Action-local repair-budget park records one GitHub Issue", () => {
  it("files exactly one Issue per park episode, naming the Action, the failure and the revival trigger, and none on later ticks", () => {
    const park = parkWorld("park-records-issue-local", { localAttempts: 3 });
    const before = park.state();
    park.w.ticks(1);
    expect(park.creates()).toHaveLength(1);
    park.w.ticks(4);
    expect(park.creates()).toHaveLength(1);
    expect(park.titles[0]).toContain(park.key);
    const body = park.bodies[0] ?? "";
    expect(body).toContain(park.key);
    expect(body).toContain(LAST_ERROR);
    expect(body).toContain(`arcadia production reset-repair-budget ${park.key}`);
    expect(body).toMatch(/<!-- repair-budget-parked:[^>]+ -->/);
    expect(park.w.log.filter((line) => line.includes(`Filed ${ISSUE_URL}`))).toHaveLength(1);
    // The park itself is untouched: same escalation, same counters, still open.
    expect(park.state()).toEqual(before);
    expect(park.w.planAction(park.w.repo, PARKED)).toBe("open");
  }, SCENARIO_TIMEOUT_MS);

  it("a filing failure only logs: bounded attempts, and the park, counters and escalation are unchanged", () => {
    const park = parkWorld("park-records-issue-failing", { localAttempts: 3, failFiling: true });
    const before = park.state();
    park.w.ticks(6);
    expect(park.creates().length).toBeGreaterThanOrEqual(1);
    expect(park.creates().length).toBeLessThanOrEqual(3);
    expect(park.w.log.some((line) => line.includes("park is unchanged") && line.includes("not authenticated"))).toBe(true);
    expect(park.state()).toEqual(before);
    expect(park.w.planAction(park.w.repo, PARKED)).toBe("open");
  }, SCENARIO_TIMEOUT_MS);

  it("files nothing for a global-cause exhaustion", () => {
    const park = parkWorld("park-records-issue-global", { localAttempts: 0 });
    park.w.ticks(3);
    expect(park.creates()).toHaveLength(0);
  }, SCENARIO_TIMEOUT_MS);

  it("files nothing for another held kind", () => {
    const park = parkWorld("park-records-issue-otherkind", { localAttempts: 3, kind: "completion_loopback_denied" });
    park.w.ticks(3);
    expect(park.creates()).toHaveLength(0);
  }, SCENARIO_TIMEOUT_MS);
});
