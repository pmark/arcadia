import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { namedTestFiles } from "../../src/sessions/completionValidation.js";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Replay of failure "b" of the 2026-10-20 unattended Claude run (Issue #1636,
 * fixed by #1637, which carried a unit test but no replay): the Action's
 * acceptance criteria NAME a test file, the real completion validator runs it
 * before accepting the completion, but the headless Session's allow list held
 * only the Project's `validationCommands`, so the agent's own run of the named
 * test was denied. It could not verify its work and four Sessions in a row
 * ended `incomplete_resumable`.
 *
 * The fixture's Action 2 names `tests/marker.test.mjs`, so the real tick,
 * launched through the `claude-code-cli` headless path, writes a real
 * per-Session settings file and passes it with `--settings`. The agent
 * stand-in (the scripted executor) here behaves as the live agent did: it
 * reads that settings file, tries to run the named test, and finishes only if
 * the allow list lets it (Claude matches each Bash rule exactly, with `\(`,
 * `\)`, `\*` and `\\` escapes). Denied, it stops without completing -- the
 * live loop. The completion validator then runs for real on the candidate
 * (under `unconfinedForTests` where Seatbelt cannot nest) and must accept.
 * With #1637's allow-list change reverted this scenario fails at the
 * assertion that the named test was permitted. Offline and fast (seconds);
 * the validator's own bound is 900 s, which a one-test file never approaches.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
let allow: string[] = [];
let namedTests: string[] = [];
let attempted: string[] = [];
let permitted = false;
let two: ExecutorResult;
let exitTick: ReturnType<FastRehearsal["tick"]>;

/**
 * A Claude `Bash(<command>)` rule matches one simple command exactly, with the rule's own escapes
 * (backslash-escaped parens, asterisk and backslash) removed; a trailing unescaped ` *` also matches that command with any arguments.
 */
function allows(rules: string[], command: string): boolean {
  return rules.some((rule) => {
    const body = /^Bash\((.*)\)$/s.exec(rule)?.[1];
    if (body === undefined) return false;
    const unescape = (text: string) => text.replace(/\\([\\()*])/g, "$1");
    if (/(?<!\\) \*$/.test(body)) {
      const prefix = unescape(body.slice(0, -2));
      return command === prefix || command.startsWith(`${prefix} `);
    }
    return unescape(body) === command;
  });
}

beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("headless-named-test", isolation, import.meta.filename);
  // `start()` in its steps, with one fixture change between them: the shared fixture names its
  // Plan file `two-action-rehearsal-bootstrap.md` but its slug `two-action-rehearsal-v4-bootstrap`,
  // while a Session reads the Action's criteria from `docs/plans/<slug>.md` at its base (as every
  // real Plan is named). Name the file by its slug so the headless allow list sees the criteria.
  world.createFixtureRepository();
  git(world.repo, ["mv", "docs/plans/two-action-rehearsal-bootstrap.md", `docs/plans/${world.planSlug}.md`]);
  git(world.repo, ["commit", "-q", "-m", "fixture: name the Plan file by its slug"]);
  git(world.repo, ["push", "-q", "origin", "main"]);
  world.approve(world.registerProject());
  world.activate();

  const first = world.untilLaunched(ACTION_1, 3);
  world.execute(first.launch, ACTION_1);
  world.untilIntegrated(ACTION_1);

  const second = world.untilLaunched(ACTION_2, 4);
  const args = second.launch.args;
  const settingsFile = args[args.indexOf("--settings") + 1];
  allow = (JSON.parse(readFileSync(settingsFile, "utf8")) as { permissions: { allow: string[] } }).permissions.allow;
  // The agent runs the test its own criteria name, in the two forms agents use.
  const brief = args.at(-1)!.split("\n");
  const start = brief.indexOf("Acceptance criteria (verbatim, in the plan's order):");
  const criteria: string[] = [];
  for (const line of brief.slice(start + 1)) {
    const item = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (!item) break;
    criteria.push(item[1]);
  }
  namedTests = namedTestFiles(criteria);
  attempted = namedTests.flatMap((file) => [`pnpm vitest run ${file}`, `pnpm exec vitest run ${file}`]);
  permitted = namedTests.length > 0 && namedTests.every((file) => allows(allow, `pnpm vitest run ${file}`) || allows(allow, `pnpm exec vitest run ${file}`));
  // Denied its own verification the live Sessions stopped without completing.
  if (!permitted) world.expectError(/reconciliation outcome was incomplete_resumable/);
  two = world.execute(second.launch, ACTION_2, permitted ? "clean" : "exits-without-completing");
  exitTick = world.tick();
}, SCENARIO_TIMEOUT_MS);

afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("failure b (Issue #1636): a headless Session can run the test its Action names", () => {
  it("launches Action 2 headless with a settings file and the Action names a test file", () => {
    expect(world.sessions().find((s) => s.action_id === ACTION_2)?.provider).toBe("claude-code-cli");
    expect(namedTests).toEqual(["tests/marker.test.mjs"]);
  });

  it("allows the named test's run commands and the dependency bridge, nothing broader", () => {
    expect(allows(allow, "node scripts/bridge-worktree-deps.mjs")).toBe(true);
    for (const command of attempted) expect(allows(allow, command), command).toBe(true);
    expect(permitted).toBe(true);
    // A different test file or a wildcard is still refused.
    expect(allows(allow, "pnpm vitest run tests/other.test.ts")).toBe(false);
    expect(allows(allow, "pnpm vitest run tests/other.test.ts 2>&1")).toBe(false);
    expect(allows(allow, "pnpm vitest run")).toBe(false);
    expect(allows(allow, "pnpm exec vitest run tests/other.test.ts")).toBe(false);
  });

  it("lets the agent verify and complete: the completion validator accepts it on the first Session, with no resume", () => {
    expect(two.interrupted ?? null).toBeNull();
    expect(exitTick.reconciled.map((entry) => entry.outcome)).toEqual(["accepted_completion"]);
    expect(world.sessions().filter((s) => s.action_id === ACTION_2)).toHaveLength(1);
    world.tickUntil((r) => r.handoff?.preservation.kind === "preserved", 3);
    world.untilIntegrated(ACTION_2);
    const plan = git(world.repo, ["show", `HEAD:docs/plans/${world.planSlug}.md`]);
    expect(new RegExp(`- id: ${ACTION_2}\\n(?:(?!  - id:)[^\\n]*\\n)*?    status: done`).test(plan)).toBe(true);
    expect(world.finish().errors.filter((error) => !error.expected)).toEqual([]);
  });
});
