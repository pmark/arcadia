import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSessionReconcileCommand } from "../../src/commands/advance.js";
import { runAgentAskPendingCommand, runAgentAskSettleCommand } from "../../src/commands/agentAsk.js";
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
function stopFirstAsTerminal(world: FastRehearsal): ReturnType<FastRehearsal["execute"]> {
  world.expectError(/reconciliation outcome was incomplete_resumable|differs from its exact canonical completion settlement/);
  world.start();
  const { launch } = world.untilLaunched(STOPPED, 3);
  const result = world.execute(launch, STOPPED, "extra-commit-after-settle", work(STOPPED));
  world.tickUntil(() => world.escalations().some((e) => e.kind === "terminal_candidate_not_integrable"), 6);
  return result;
}
const parkRows = (world: FastRehearsal) => withReadOnlyDatabase(world.workspace, (db) =>
  db.prepare("SELECT action_key FROM production_action_parks").all() as Array<{ action_key: string }>);
const parkCauses = (world: FastRehearsal) => withReadOnlyDatabase(world.workspace, (db) =>
  (db.prepare("SELECT action_key, cause FROM production_action_parks").all() as Array<{ action_key: string; cause: string }>).map((r) => [r.action_key, r.cause]));
const trips = (world: FastRehearsal): number => withReadOnlyDatabase(world.workspace, (db) => {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_night_breaker_trips'").get();
  return exists ? (db.prepare("SELECT COUNT(*) AS n FROM production_night_breaker_trips").get() as { n: number }).n : 0;
});

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

// #3136 review round 1: a park ends when its own cause stops holding, never only on done-in-base.
describe("a terminal park ends when its own cause stops holding", () => {
  let world: FastRehearsal;
  let result: ReturnType<FastRehearsal["execute"]>;
  beforeAll(() => {
    world = build("park-terminal-release");
    result = stopFirstAsTerminal(world);
    runIndependent(world, [SECOND, THIRD]);
  }, SCENARIO_TIMEOUT_MS);

  it("ends the park when the candidate moves off the refused head, and judges the new head afresh", () => {
    expect(parkRows(world)).toEqual([{ action_key: world.actionKey(STOPPED) }]);
    writeFileSync(path.join(result.brief.worktree, "SECOND-EXTRA.md"), "another commit\n");
    git(result.brief.worktree, ["add", "SECOND-EXTRA.md"]);
    git(result.brief.worktree, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-qm", "second extra commit"]);
    const newHead = git(result.brief.worktree, ["rev-parse", "HEAD"]).trim();
    world.ticks(3);
    expect(world.log.filter((line) => line.includes(`Released the park of ${world.actionKey(STOPPED)}: its candidate moved off the refused head`))).toHaveLength(1);
    const [entry] = world.escalations();
    expect(entry).toMatchObject({ actionKey: world.actionKey(STOPPED), kind: "terminal_candidate_not_integrable" });
    expect(entry.message).toContain(`at ${newHead})`);
    // Judged afresh at the new head: the same Action-local refusal parks it again, with a second receipt.
    expect(parkReceipts(world).map((r) => r.action_key)).toEqual([world.actionKey(STOPPED), world.actionKey(STOPPED)]);
  });

  // #3136 review round 2, blocking 2: a worktree-changed park ends once the worktree is readable and clean at that head.
  it("ends a worktree-changed park once the stray file is moved out, and judges the clean worktree afresh", () => {
    world.expectError(/worktree is missing or changed/);
    writeFileSync(path.join(result.brief.worktree, "THIRD-EXTRA.md"), "a third commit\n");
    git(result.brief.worktree, ["add", "THIRD-EXTRA.md"]);
    git(result.brief.worktree, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-qm", "third extra commit"]);
    const stray = path.join(result.brief.worktree, "stray-notes.txt");
    writeFileSync(stray, "left in the worktree\n");
    world.ticks(3);
    expect(parkCauses(world)).toEqual([[world.actionKey(STOPPED), "The terminal candidate worktree is missing or changed."]]);
    world.ticks(2);
    expect(parkCauses(world)).toEqual([[world.actionKey(STOPPED), "The terminal candidate worktree is missing or changed."]]);
    rmSync(stray);
    world.ticks(3);
    expect(world.log.filter((line) => line.includes(`Released the park of ${world.actionKey(STOPPED)}: its worktree is clean again`))).toHaveLength(1);
    // Judged afresh: the clean head still differs from its settlement, so the same Action is parked on that cause.
    expect(parkCauses(world)).toEqual([[world.actionKey(STOPPED), "The terminal candidate differs from its exact canonical completion settlement."]]);
  });
});

// #3136 review round 2, blocking 1: Off and a re-grant never end a park, so the parked candidate never claims the
// repository again and the next independent Action integrates.
describe("a park survives production Off and a re-grant", () => {
  let world: FastRehearsal;
  beforeAll(() => {
    world = build("park-survives-off");
    stopFirstAsTerminal(world);
    const second = world.untilLaunched(SECOND, 6);
    world.execute(second.launch, SECOND, "clean", work(SECOND));
    world.untilIntegrated(SECOND, 10);
    // Off before the third Action is admitted, so it is admitted only under the re-grant.
    world.deactivate("off-while-parked");
    world.ticks(3);
    world.activate("re-grant-while-parked");
    runIndependent(world, [THIRD]);
  }, SCENARIO_TIMEOUT_MS);

  it("keeps the park and its escalation across Off, records no second receipt, and integrates the next Action", () => {
    expect(world.planAction(world.repo, THIRD)).toBe("done");
    expect(world.planAction(world.repo, STOPPED)).toBe("open");
    expect(parkRows(world)).toEqual([{ action_key: world.actionKey(STOPPED) }]);
    expect(parkReceipts(world).map((r) => r.action_key)).toEqual([world.actionKey(STOPPED)]);
    expect(escalationKinds(world)).toEqual([[world.actionKey(STOPPED), "terminal_candidate_not_integrable"]]);
    expect(world.log.filter((line) => line.includes("integration is ambiguous"))).toEqual([]);
    expect(world.log.filter((line) => line.includes("Released the park"))).toEqual([]);
  });
});

describe("a real night-breaker trip, then a re-grant, does not trip again", () => {
  let world: FastRehearsal;
  let tripsAfterTrip: number;
  beforeAll(() => {
    world = build("park-trip-regrant");
    stopFirstAsTerminal(world);
    // The second Action stops on the same cause: the breaker turns production Off on its next pass.
    const second = world.untilLaunched(SECOND, 6);
    world.execute(second.launch, SECOND, "extra-commit-after-settle", work(SECOND));
    world.tickUntil(() => trips(world) === 1, 8);
    world.ticks(2);
    tripsAfterTrip = trips(world);
    world.activate("re-grant-after-trip");
    runIndependent(world, [THIRD]);
  }, SCENARIO_TIMEOUT_MS);

  it("keeps both parks, records no new receipt, and integrates the third Action without a second trip", () => {
    expect(tripsAfterTrip).toBe(1);
    expect(trips(world)).toBe(1);
    expect(world.planAction(world.repo, THIRD)).toBe("done");
    expect(parkRows(world).map((r) => r.action_key).sort()).toEqual([world.actionKey(STOPPED), world.actionKey(SECOND)].sort());
    expect(parkReceipts(world).map((r) => r.action_key)).toEqual([world.actionKey(STOPPED), world.actionKey(SECOND)]);
    expect(world.log.filter((line) => line.includes("integration is ambiguous"))).toEqual([]);
  });
});

// #3136 review round 2, blocking 1: a candidate whose park ended is judged on its own, never as "ambiguous" against the
// in-flight Action's exit.
describe("a released park's candidate waits behind the pointer's own candidate", () => {
  let world: FastRehearsal;
  let result: ReturnType<FastRehearsal["execute"]>;
  beforeAll(() => {
    world = build("park-release-race");
    result = stopFirstAsTerminal(world);
    const second = world.untilLaunched(SECOND, 6);
    world.execute(second.launch, SECOND, "clean", work(SECOND));
    // The parked candidate moves while the second Action's exit is still being judged: its park ends on this pass.
    writeFileSync(path.join(result.brief.worktree, "RACE-EXTRA.md"), "moved during the next exit\n");
    git(result.brief.worktree, ["add", "RACE-EXTRA.md"]);
    git(result.brief.worktree, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-qm", "race extra commit"]);
    world.untilIntegrated(SECOND, 10);
    runIndependent(world, [THIRD]);
  }, SCENARIO_TIMEOUT_MS);

  it("integrates the second and third Actions, then re-parks the released candidate afresh", () => {
    expect(world.planAction(world.repo, SECOND)).toBe("done");
    expect(world.planAction(world.repo, THIRD)).toBe("done");
    expect(world.log.filter((line) => line.includes("integration is ambiguous"))).toEqual([]);
    expect(world.log.filter((line) => line.includes(`Released the park of ${world.actionKey(STOPPED)}: its candidate moved off the refused head`))).toHaveLength(1);
    expect(parkRows(world)).toEqual([{ action_key: world.actionKey(STOPPED) }]);
    expect(escalationKinds(world)).toEqual([[world.actionKey(STOPPED), "terminal_candidate_not_integrable"]]);
  });
});

describe("a terminal park ends once its candidate is no longer pending", () => {
  let world: FastRehearsal;
  let result: ReturnType<FastRehearsal["execute"]>;
  beforeAll(() => {
    // Both others depend on the parked Action, so main stays at the candidate's base and the remedy's fast-forward applies.
    world = build("park-terminal-landed", { [SECOND]: [STOPPED], [THIRD]: [STOPPED] });
    result = stopFirstAsTerminal(world);
    world.ticks(2);
  }, SCENARIO_TIMEOUT_MS);

  it("ends the park when the operator lands the settlement commit, as the escalation's remedy says", () => {
    expect(parkRows(world)).toEqual([{ action_key: world.actionKey(STOPPED) }]);
    git(world.repo, ["merge", "--ff-only", "--quiet", result.settlementCommit!]);
    git(world.repo, ["push", "-q", "origin", "refs/heads/main:refs/heads/main"]);
    world.ticks(3);
    expect(world.planAction(world.repo, STOPPED)).toBe("done");
    expect(parkRows(world)).toEqual([]);
    expect(world.escalations()).toEqual([]);
  });
});

describe("an Action gated only on its own pending completion Ask is parked and admission continues", () => {
  let world: FastRehearsal;
  let parksWhileHeld: ParkRow[];
  let launchedWhileHeld: string[];
  let branch: string;
  let branchHead: string;
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
    // Its candidate is discarded as prepareSession's refusal says (its branch is kept); the Ask still gates the Action.
    branch = first.session.branch;
    branchHead = git(world.repo, ["rev-parse", `refs/heads/${branch}`]).trim();
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
    expect(git(world.repo, ["rev-parse", `refs/heads/${branch}`]).trim()).toBe(branchHead);
  });

  // #3136 review round 1: rejecting the own completion Ask (the governed reset) ends the park; a fresh attempt follows.
  it("ends the park once its own completion Ask is rejected, and admits a fresh attempt", () => {
    const [pending] = runAgentAskPendingCommand({ workspace: world.workspace }).data.pending;
    const preview = runAgentAskSettleCommand({ workspace: world.workspace, proposal: pending.requestId, requestId: "reject-own-completion", disposition: "rejected" });
    runAgentAskSettleCommand({ workspace: world.workspace, proposal: pending.requestId, requestId: "reject-own-completion", disposition: "rejected",
      preview: preview.data.receipt.previewFingerprint, apply: true });
    world.untilLaunched(STOPPED, 6);
    expect(world.log.filter((line) => line.includes(`Released the park of ${world.actionKey(STOPPED)}: its own completion Ask is no longer pending`))).toHaveLength(1);
    expect(parkRows(world)).toEqual([]);
    expect(world.sessions().filter((s) => s.action_id === STOPPED)).toHaveLength(2);
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
