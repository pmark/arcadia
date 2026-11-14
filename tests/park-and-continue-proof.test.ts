import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { ensureProductionTickTables, recordOperatorEscalation } from "../src/production/tick.js";
import { git } from "./helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./fast-rehearsal/helpers/environment.js";
import type { ActionWork } from "./fast-rehearsal/helpers/executor.js";
import { FastRehearsal, SCENARIO_TIMEOUT_MS } from "./fast-rehearsal/helpers/world.js";

/**
 * Decision 0223 (D1, answer A) park-and-continue proof, deterministic and offline.
 * Serial three-Action run: slot 1 (parked-a) has an Action-local repair-budget
 * exhaustion injected (3/3 Action-local attempts plus the escalation the tick
 * records); slot 2 (parked-b) is independent; slot 3 (parked-c) depends on slot 1.
 * Real worker tick, scheduler and lifecycle; only reviewers, GitHub, tmux and the
 * agent are faked (the fast-rehearsal harness).
 */
const IDS = ["parked-a", "parked-b", "parked-c"] as const;
const [PARKED, SECOND, DEPENDENT] = IDS;
const CHECK = "node scripts/check-parked.mjs";
const fileOf = (id: string) => `docs/parked/${id}.md`;
const work = (id: string): ActionWork => ({ files: { [fileOf(id)]: `${id} done\n` }, validation: CHECK });

const fixturePlan = {
  firstAction: PARKED,
  genesisFiles: {
    "scripts/check-parked.mjs": `import { existsSync, readFileSync } from "node:fs";
for (const id of ${JSON.stringify(IDS)}) {
  const file = \`docs/parked/\${id}.md\`;
  if (existsSync(file) && !readFileSync(file, "utf8").startsWith(\`\${id} done\\n\`)) { console.error(file + " is wrong"); process.exit(1); }
}
`
  },
  actionsYaml: IDS.map((id) => `  - id: ${id}
    title: Implement ${fileOf(id)} containing the line "${id} done".
    status: open
    responsibility: agent
    effort: session
    next_action: Implement ${fileOf(id)} containing the line "${id} done".
    expected_artifact: ${fileOf(id)}
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - ${fileOf(id)} contains the line "${id} done" and nothing else.
    depends_on: [${id === DEPENDENT ? PARKED : ""}]
    decisions: []
`).join("")
};

type Counters = { attempts: number; local_attempts: number } | undefined;
let isolation: IsolatedProcess;
let world: FastRehearsal;
let counters: Counters;
let countersAfter: Counters;
const readCounters = (): Counters => withReadOnlyDatabase(world.workspace, (db) =>
  db.prepare("SELECT attempts, local_attempts FROM production_repair_attempts WHERE action_key = ?").get(world.actionKey(PARKED)) as Counters);

beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("park-and-continue-proof", isolation, import.meta.filename, { fixturePlan, validationCommand: CHECK, workerMerge: true });
  world.start();
  // Inject the exhaustion on slot 1: three Action-local attempts, and the escalation the tick records when the budget is spent.
  const now = new Date(world.now.getTime());
  withDatabase(world.workspace, (db) => {
    ensureProductionTickTables(db);
    const at = now.toISOString();
    db.prepare(`INSERT INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at, local_attempts)
      VALUES (?, 3, 'Resumed Session exited incomplete without changing its candidate.', ?, ?, 3)`).run(world.actionKey(PARKED), at, at);
    recordOperatorEscalation(db, {
      actionKey: world.actionKey(PARKED), kind: "repair_budget_exhausted",
      message: "Repair budget exhausted after 3 failed attempts.",
      remedy: `Repair the underlying problem, then run \`arcadia production reset-repair-budget ${world.actionKey(PARKED)}\`.`, now
    });
  });
  counters = readCounters();
  const launched = world.untilLaunched(SECOND, 6);
  world.execute(launched.launch, SECOND, "clean", work(SECOND));
  world.untilIntegrated(SECOND, 10);
  world.ticks(4);
  countersAfter = readCounters();
}, SCENARIO_TIMEOUT_MS);
afterAll(() => { world?.dispose(); isolation?.restore(); });

describe("Decision 0223 A: an Action-local repair-budget exhaustion parks the Action and the run continues", () => {
  it("parks slot 1 with its escalation, revival trigger and counters kept", () => {
    const parked = world.escalations().filter((e) => e.actionKey === world.actionKey(PARKED));
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ kind: "repair_budget_exhausted" });
    expect(parked[0]?.remedy).toContain(`arcadia production reset-repair-budget ${world.actionKey(PARKED)}`);
    expect(counters).toEqual({ attempts: 3, local_attempts: 3 });
    expect(countersAfter).toEqual(counters);
    expect(world.planAction(world.repo, PARKED)).toBe("open");
    expect(world.sessions().filter((s) => s.action_id === PARKED)).toHaveLength(0);
  });

  it("does not launch the dependent of the parked Action", () => {
    expect(world.sessions().map((s) => s.action_id)).not.toContain(DEPENDENT);
    expect(world.planAction(world.repo, DEPENDENT)).toBe("open");
  });

  it("admits slot 2 and the worker merges it while slot 1 stays parked", () => {
    expect(world.planAction(world.repo, SECOND)).toBe("done");
    const tree = git(world.repo, ["ls-tree", "-r", "--name-only", "refs/heads/main"]);
    expect(tree).toContain(fileOf(SECOND));
    expect(tree).not.toContain(fileOf(PARKED));
    expect(world.log.filter((line) => line.includes("Continuing past") && line.includes(PARKED))).toHaveLength(1);
  });
});
