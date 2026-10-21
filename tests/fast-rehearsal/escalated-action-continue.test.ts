import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ActionWork, LaunchRecord } from "./helpers/executor.js";
import { FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Operator decision 2026-10-21 (Release Manager session): under an active
 * production policy, an in-scope Action held by an operator escalation (its
 * review repair rounds exhausted, its candidate preserved and un-integrated)
 * must not block admission of other in-scope Actions that do not depend on
 * it. Live clean run: Action 1 escalated, Actions 2 and 3 never launched.
 * Real worker tick, scheduler and lifecycle; only reviewers, GitHub, tmux and
 * the agent are faked.
 */
const IDS = ["held-a", "held-b", "held-c"] as const;
const [HELD, SECOND, THIRD] = IDS;
const CHECK = "node scripts/check-held.mjs";
const fileOf = (id: string) => `docs/held/${id}.md`;
const work = (id: string, extra: Record<string, string> = {}): ActionWork => ({ files: { [fileOf(id)]: `${id} done\n`, ...extra }, validation: CHECK });

const fixture = (dependencies: Record<string, string[]>) => ({
  firstAction: HELD,
  genesisFiles: {
    "scripts/check-held.mjs": `import { existsSync, readFileSync } from "node:fs";
for (const id of ${JSON.stringify(IDS)}) {
  const file = \`docs/held/\${id}.md\`;
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

let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

/** Drive the first Action through three failed repair rounds to its `review_repair_rounds_exhausted` escalation. */
function escalateFirst(world: FastRehearsal): void {
  world.expectError(/independent_verdict_failed|review_repair_rounds_exhausted|code-review: failed|verdict on [0-9a-f]+ (is fail|failed)|repair rounds/);
  world.github.failCriteria = ["correctness"];
  world.github.verdict = (role, pr) =>
    role === "code-review" && world.sessions().some((session) => session.branch === pr?.branch && session.action_id === HELD) ? "fail" : "pass";
  world.start();
  const first = world.untilLaunched(HELD, 3);
  world.execute(first.launch, HELD, "clean", work(HELD));
  for (const round of [1, 2, 3]) {
    const before = world.sessions().length;
    world.tickUntil(() => world.sessions().length > before && world.lease() !== null, 10);
    const session = world.lease()!;
    const launch = world.tmux.launches.find((entry) => entry.name === session.tmux_session_name) as LaunchRecord;
    world.execute(launch, HELD, "clean", work(HELD, { "REPAIR.md": `round ${round}\n` }));
  }
  world.tickUntil(() => world.escalations().some((e) => e.kind === "review_repair_rounds_exhausted"), 10);
}

describe("an escalated in-scope Action does not block independent in-scope Actions", () => {
  let world: FastRehearsal;
  beforeAll(() => {
    world = new FastRehearsal("escalated-action-independent", isolation, import.meta.filename, { fixturePlan: fixture({}), validationCommand: CHECK, workerMerge: true });
    worlds.push(world);
    escalateFirst(world);
    for (const id of [SECOND, THIRD]) {
      const launched = world.untilLaunched(id, 6);
      world.execute(launched.launch, id, "clean", work(id));
      world.untilIntegrated(id, 10);
    }
    world.ticks(3);
  }, SCENARIO_TIMEOUT_MS);

  it("launches and integrates the second and third Actions while the first stays escalated with its candidate", () => {
    expect(world.planAction(world.repo, SECOND)).toBe("done");
    expect(world.planAction(world.repo, THIRD)).toBe("done");
    expect(world.planAction(world.repo, HELD)).toBe("open");
    expect(world.escalations().map((e) => [e.actionKey, e.kind])).toEqual([[world.actionKey(HELD), "review_repair_rounds_exhausted"]]);
    expect(git(world.repo, ["ls-tree", "-r", "--name-only", "refs/heads/main"])).not.toContain(fileOf(HELD));
    expect(world.sessions().filter((s) => s.action_id === HELD)).toHaveLength(4);
  });

  it("logs the skip once for the held Action and escalation", () => {
    expect(world.log.filter((line) => line.includes("Continuing past") && line.includes(HELD))).toHaveLength(1);
  });
});

describe("an Action that depends on the escalated one is never launched", () => {
  let world: FastRehearsal;
  beforeAll(() => {
    world = new FastRehearsal("escalated-action-dependent", isolation, import.meta.filename, { fixturePlan: fixture({ [SECOND]: [HELD] }), validationCommand: CHECK, workerMerge: true });
    worlds.push(world);
    escalateFirst(world);
    const launched = world.untilLaunched(THIRD, 6);
    world.execute(launched.launch, THIRD, "clean", work(THIRD));
    world.untilIntegrated(THIRD, 10);
    world.ticks(4);
  }, SCENARIO_TIMEOUT_MS);

  it("continues past the held Action to the independent one only", () => {
    expect(world.sessions().map((s) => s.action_id)).not.toContain(SECOND);
    expect(world.planAction(world.repo, THIRD)).toBe("done");
    expect(world.planAction(world.repo, SECOND)).toBe("open");
    expect(world.escalations().map((e) => [e.actionKey, e.kind])).toEqual([[world.actionKey(HELD), "review_repair_rounds_exhausted"]]);
  });
});
