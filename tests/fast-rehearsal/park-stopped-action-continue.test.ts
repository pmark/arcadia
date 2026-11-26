import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSessionReconcileCommand } from "../../src/commands/advance.js";
import { runDocsSyncCommand } from "../../src/commands/docs.js";
import { withDatabase, withReadOnlyDatabase } from "../../src/db/connection.js";
import { listProductionParks } from "../../src/production/nightBreaker.js";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ActionWork } from "./helpers/executor.js";
import { FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Plan one-stop-never-ends-the-card-20261126, Action continue-past-a-stopped-action (#3107, Decision 0283): card B's
 * shape. An in-scope Action stopped as terminal_candidate_not_integrable on an Action-local guard, or gated only on its
 * own pending completion Ask, is parked with one receipt and admission moves on to the next Action that does not depend
 * on it. An operator gate naming an unanswered Decision still stops as before. Real worker tick, scheduler and
 * lifecycle; only reviewers, GitHub, tmux and the agent are faked (the fast-rehearsal harness).
 */
const IDS = ["stop-a", "stop-b", "stop-c"] as const;
const [STOPPED, SECOND, THIRD] = IDS;
const CHECK = "node scripts/check-stop.mjs";
const fileOf = (id: string) => `docs/stop/${id}.md`;
const work = (id: string): ActionWork => ({ files: { [fileOf(id)]: `${id} done\n` }, validation: CHECK });

const fixture = (dependencies: Record<string, string[]>) => ({
  firstAction: STOPPED,
  genesisFiles: {
    "scripts/check-stop.mjs": `import { existsSync, readFileSync } from "node:fs";
for (const id of ${JSON.stringify(IDS)}) {
  const file = \`docs/stop/\${id}.md\`;
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
    depends_on: [${(dependencies[id] ?? []).join(", ")}]
    decisions: []
`).join("")
});

type ParkRow = { action_key: string; condition: string; cause: string; project: string };
const parkReceipts = (world: FastRehearsal): ParkRow[] => withReadOnlyDatabase(world.workspace, (db) => {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_park_receipts'").get();
  return exists ? db.prepare("SELECT action_key, condition, cause, project FROM production_park_receipts ORDER BY parked_at, id").all() as ParkRow[] : [];
});
const escalationKinds = (world: FastRehearsal) => world.escalations().map((e) => [e.actionKey, e.kind]);

let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

function build(name: string, dependencies: Record<string, string[]> = {}): FastRehearsal {
  const world = new FastRehearsal(name, isolation, import.meta.filename, { fixturePlan: fixture(dependencies), validationCommand: CHECK, workerMerge: true });
  worlds.push(world);
  return world;
}

/** Card B (#3107): the first Action settles, then a commit lands on top of its settlement, so the terminal guard refuses it. */
function stopFirstAsTerminal(world: FastRehearsal): void {
  world.expectError(/reconciliation outcome was incomplete_resumable|differs from its exact canonical completion settlement/);
  world.start();
  const { launch } = world.untilLaunched(STOPPED, 3);
  world.execute(launch, STOPPED, "extra-commit-after-settle", work(STOPPED));
  world.tickUntil(() => world.escalations().some((e) => e.kind === "terminal_candidate_not_integrable"), 6);
}

function runIndependent(world: FastRehearsal, ids: readonly string[]): void {
  for (const id of ids) {
    const launched = world.untilLaunched(id, 6);
    world.execute(launched.launch, id, "clean", work(id));
    world.untilIntegrated(id, 10);
  }
  world.ticks(3);
}

describe("card B: an Action stopped as terminal_candidate_not_integrable is parked and admission continues", () => {
  let world: FastRehearsal;
  let stoppedHead: string;
  beforeAll(() => {
    world = build("park-terminal-candidate");
    stopFirstAsTerminal(world);
    stoppedHead = world.github.headOf(world.pullRequestFor(STOPPED)!.branch)!;
    runIndependent(world, [SECOND, THIRD]);
  }, SCENARIO_TIMEOUT_MS);

  it("admits and integrates the second and third Actions while the first keeps its escalation and preserved candidate", () => {
    expect(world.planAction(world.repo, SECOND)).toBe("done");
    expect(world.planAction(world.repo, THIRD)).toBe("done");
    expect(world.planAction(world.repo, STOPPED)).toBe("open");
    expect(escalationKinds(world)).toEqual([[world.actionKey(STOPPED), "terminal_candidate_not_integrable"]]);
    expect(world.github.headOf(world.pullRequestFor(STOPPED)!.branch)).toBe(stoppedHead);
    expect(git(world.repo, ["ls-tree", "-r", "--name-only", "refs/heads/main"])).not.toContain(fileOf(STOPPED));
    expect(world.sessions().filter((s) => s.action_id === STOPPED)).toHaveLength(1);
  });

  it("writes exactly one park receipt (action, condition, cause) that the night breaker counts", () => {
    expect(parkReceipts(world)).toEqual([{
      action_key: world.actionKey(STOPPED), condition: "terminal_candidate_not_integrable",
      cause: "The terminal candidate differs from its exact canonical completion settlement.", project: world.projectSlug
    }]);
    const counted = withDatabase(world.workspace, (db) => listProductionParks(db, world.now.getTime()));
    expect(counted.map((p) => [p.actionKey, p.condition])).toEqual([[world.actionKey(STOPPED), "terminal_candidate_not_integrable"]]);
    expect(world.log.filter((line) => line.includes("Continuing past") && line.includes(STOPPED))).toHaveLength(1);
  });
});

describe("an Action that depends on the parked one is never admitted", () => {
  let world: FastRehearsal;
  beforeAll(() => {
    world = build("park-terminal-dependent", { [THIRD]: [STOPPED] });
    stopFirstAsTerminal(world);
    runIndependent(world, [SECOND]);
    world.ticks(3);
  }, SCENARIO_TIMEOUT_MS);

  it("admits the independent Action only", () => {
    expect(world.planAction(world.repo, SECOND)).toBe("done");
    expect(world.sessions().map((s) => s.action_id)).not.toContain(THIRD);
    expect(world.planAction(world.repo, THIRD)).toBe("open");
    expect(parkReceipts(world).map((r) => r.action_key)).toEqual([world.actionKey(STOPPED)]);
  });

  // N4 (#3118 review): the breaker's own count drops a park recorded before its latest trip (and after 24 hours); the
  // per-Action park record does not, so the parked Action and its dependent are never admitted again.
  it("keeps the park after the breaker stops counting it", () => {
    withDatabase(world.workspace, (db) => {
      db.prepare(`INSERT INTO production_night_breaker_trips (request_id, policy_revision, trips_json, reasons_json, message, tripped_at, ping_id)
        VALUES ('night-breaker-fixture', 0, '[]', '[]', 'fixture trip', ?, 'ping_fixture')`).run(world.now.getTime());
    });
    world.advanceClock(60_000);
    world.ticks(4);
    expect(withDatabase(world.workspace, (db) => listProductionParks(db, world.now.getTime()))).toEqual([]);
    expect(world.sessions().filter((s) => s.action_id === STOPPED)).toHaveLength(1);
    expect(world.sessions().map((s) => s.action_id)).not.toContain(THIRD);
    expect(escalationKinds(world)).toEqual([[world.actionKey(STOPPED), "terminal_candidate_not_integrable"]]);
  });
});

describe("an Action gated only on its own pending completion Ask is parked and admission continues", () => {
  let world: FastRehearsal;
  let parksWhileHeld: ParkRow[];
  let launchedWhileHeld: string[];
  beforeAll(() => {
    world = build("park-own-completion-gate");
    world.start();
    const first = world.untilLaunched(STOPPED, 3);
    const result = world.execute(first.launch, STOPPED, "interrupted-after-settlement-commit", work(STOPPED));
    // An operator reconciles the Session before the worker does: the agent's `complete` proposal stays pending.
    runSessionReconcileCommand({ workspace: world.workspace, repo: world.repo, session: first.session.id, requestId: `operator-reconcile-${first.session.id}` });
    world.tickUntil(() => world.escalations().some((e) => e.kind === "operator_gate_pending"), 6);
    // While its resumable candidate still holds the repository, that custody is a global stop: nothing is parked.
    world.ticks(3);
    parksWhileHeld = parkReceipts(world);
    launchedWhileHeld = world.sessions().map((s) => s.action_id);
    // Its candidate is discarded as prepareSession's refusal says; the Ask still gates the Action.
    git(world.repo, ["worktree", "remove", "--force", result.brief.worktree]);
    runIndependent(world, [SECOND, THIRD]);
  }, SCENARIO_TIMEOUT_MS);

  it("parks nothing while the Action's resumable candidate holds the repository", () => {
    expect(parksWhileHeld).toEqual([]);
    expect(launchedWhileHeld).toEqual([STOPPED]);
  });

  it("admits the second and third Actions while the first keeps its gate escalation", () => {
    expect(world.planAction(world.repo, SECOND)).toBe("done");
    expect(world.planAction(world.repo, THIRD)).toBe("done");
    expect(world.planAction(world.repo, STOPPED)).toBe("open");
    expect(escalationKinds(world)).toEqual([[world.actionKey(STOPPED), "operator_gate_pending"]]);
    expect(parkReceipts(world).map((r) => [r.action_key, r.condition])).toEqual([[world.actionKey(STOPPED), "operator_gate_pending"]]);
  });
});

describe("an operator gate that names an unanswered Decision still stops as today", () => {
  const DECISION_ID = "0900";
  let world: FastRehearsal;
  beforeAll(() => {
    world = build("gate-unanswered-decision");
    world.start();
    const relativePath = path.join("docs", "decisions", `${DECISION_ID}-confirm-stop-a.md`);
    mkdirSync(path.join(world.repo, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(world.repo, relativePath), [
      "---", "arcadia: v1", "type: decision", `id: "${DECISION_ID}"`, "slug: confirm-stop-a", `project: ${world.projectSlug}`,
      "status: open", "question: Write stop A now?", "confidence: high", `plan: ${world.planSlug}`,
      `action: ${STOPPED}`, "updated: 2026-11-26",
      "options:", "  - label: Write it now", "    consequence: stop-a dispatches.", "    recommended: true",
      "  - label: Hold it", "    consequence: stop-a stays gated.", "    recommended: false",
      "---", "", `# Decision ${DECISION_ID}: Write stop A now?`, ""
    ].join("\n"));
    git(world.repo, ["add", relativePath]);
    git(world.repo, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-qm", "Open a Decision gating stop-a"]);
    runDocsSyncCommand({ workspace: world.workspace, project: world.projectSlug, apply: true });
    world.ticks(6);
  }, SCENARIO_TIMEOUT_MS);

  it("parks nothing, launches nothing and keeps the gate escalation", () => {
    expect(world.sessions()).toEqual([]);
    expect(escalationKinds(world)).toEqual([[world.actionKey(STOPPED), "operator_gate_pending"]]);
    expect(parkReceipts(world)).toEqual([]);
  });
});

// N3 (#3118 review): admission continues past parks now, so a pass whose night breaker fails to run admits nothing.
describe("a pass whose night breaker fails admits nothing", () => {
  let world: FastRehearsal;
  let failed: ReturnType<FastRehearsal["ticks"]>;
  beforeAll(() => {
    world = build("breaker-fails-closed");
    world.start();
    // A park-receipt table the breaker cannot read makes its pass throw.
    withDatabase(world.workspace, (db) => db.exec("CREATE TABLE production_park_receipts (unreadable TEXT)"));
    failed = world.ticks(3);
  }, SCENARIO_TIMEOUT_MS);

  it("launches nothing while the breaker fails, and admits again once it runs", () => {
    for (const tick of failed) expect(tick.launch).toMatchObject({ attempted: false, outcome: "skipped", reason: expect.stringContaining("night breaker could not run") });
    expect(world.sessions()).toEqual([]);
    expect(world.log.some((line) => line.includes("Night breaker pass failed"))).toBe(true);
    withDatabase(world.workspace, (db) => db.exec("DROP TABLE production_park_receipts"));
    world.untilLaunched(STOPPED, 3);
    expect(world.sessions().map((s) => s.action_id)).toEqual([STOPPED]);
  });
});
