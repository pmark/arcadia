import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withReadOnlyDatabase } from "../src/db/connection.js";
import { getMechanicalRepair, isProductionOwnedRepairHead } from "../src/production/mechanicalRepair.js";
import type { AgentSession } from "../src/sessions/index.js";
import { git, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Acceptance of Action wire-mechanical-repair-into-production: the real worker
 * tick (not the library alone) runs the deterministic repair round on red
 * required checks, and the independent review treats its push as the
 * candidate's next head. The failures are the recorded ones of #2752, #2758,
 * #2765 and #2766 (the fixtures of tests/mechanical-repair.test.ts).
 */
const LINT_2752 = `lint\tRun lint\ttests/start-run-derive.test.ts
lint\tRun lint\t  412:31  error  This assertion is unnecessary since it does not change the type of the expression  @typescript-eslint/no-unnecessary-type-assertion
lint\tRun lint\t
lint\tRun lint\t✖ 1 problem (1 error, 0 warnings)
lint\tRun lint\t  1 error and 0 warnings potentially fixable with the \`--fix\` option.
`;
const FINGERPRINT_2766 = `check\tRun guidance check
check\tRun guidance check\tError: Canonical guidance fingerprint is stale: docs/agent-guidance/operator-actions.md. Refresh docs/agent-guidance/fingerprints.json with the reviewed procedure bytes.
`;
const MIXED_2758 = `${FINGERPRINT_2766}
test\tRun tests\t FAIL  tests/production-replay.test.ts > replay binds the card
test\tRun tests\t AssertionError: expected 'a' to be 'b'
test\tRun tests\t Test Files  2 failed | 300 passed (302)
`;
const MIXED_2765 = `${FINGERPRINT_2766}
lint\tRun lint\t✖ 3 problems (3 errors, 0 warnings)
lint\tRun lint\t  2 errors and 0 warnings potentially fixable with the \`--fix\` option.
test\tRun tests\t FAIL  tests/production-successor-press.test.ts > pins the fixture
`;

const RUN_URL = "https://github.com/pmark/rehearsal/actions/runs/4242/job/1";
const RED = [
  { name: "lint", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: RUN_URL, workflowName: "CI" },
  { name: "unit-1", status: "COMPLETED", conclusion: "CANCELLED", detailsUrl: "https://github.com/pmark/rehearsal/actions/runs/4242/job/2", workflowName: "CI" }
];
const GREEN = [{ name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/fast", workflowName: "CI" }];
const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];

const rehearsals: Rehearsal[] = [];
afterEach(() => { for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose(); });

/** Action A finished with a lintable file, preserved and readied; its required checks read red with `log`. */
function redCandidate(log: string) {
  const runs: string[][] = [];
  const rehearsal = new Rehearsal({
    independentReviewers: "tick",
    mechanicalRepair: {
      run: (command, args, cwd) => {
        runs.push([command, ...args]);
        // The generator's effect: eslint --fix rewrites the file it was given.
        if (args.includes("eslint")) appendFileSync(path.join(cwd, "src/lintme.ts"), "// eslint --fix\n");
        return { status: 0 };
      }
    }
  });
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  rehearsal.activate();
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
  const a: AgentSession = rehearsal.lease()!;
  rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
  rehearsal.agentEdit(a, "src/lintme.ts", "export const value = 1 as number;\n");
  rehearsal.agentFinish(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  let checks = RED;
  rehearsal.github.checks = (pr) => (pr.branch === a.branch ? checks : GREEN);
  rehearsal.github.failedLog = () => log;
  expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
  rehearsal.tick(); // ready
  const head = git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim();
  return { rehearsal, a, head, runs, turnGreen: () => { checks = GREEN; } };
}

const roundOf = (rehearsal: Rehearsal, head: string) => withReadOnlyDatabase(rehearsal.workspace, (db) => getMechanicalRepair(db, rehearsal.actionA, head));
const escalationKind = (rehearsal: Rehearsal) => rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA)?.kind;

describe("the worker tick runs the deterministic repair round on red required checks", () => {
  it("#2752: one round runs eslint --fix, commits and pushes a production-owned head to the candidate branch", () => {
    const { rehearsal, a, head, runs } = redCandidate(LINT_2752);
    rehearsal.tick(); // required checks red: the deterministic round runs in this tick
    expect(runs).toEqual([["pnpm", "exec", "eslint", "--fix", "--", "src/lintme.ts"]]);
    const repaired = git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim();
    expect(repaired).not.toBe(head);
    expect(git(rehearsal.repo, ["rev-parse", `${repaired}^`]).trim()).toBe(head);
    expect(git(rehearsal.repo, ["log", "-1", "--format=%an <%ae>", repaired]).trim()).toBe("Arcadia Controller <controller@arcadia.local>");
    expect(rehearsal.github.pushes.at(-1)).toEqual({ branch: a.branch, commitSha: repaired });
    expect(rehearsal.github.headOf(a.branch)).toBe(repaired);
    expect(roundOf(rehearsal, head)).toMatchObject({ outcome: "repaired", repaired_head: repaired, classes: "lint-autofixable" });
    expect(withReadOnlyDatabase(rehearsal.workspace, (db) => isProductionOwnedRepairHead(db, rehearsal.actionA, repaired))).toBe(true);
    // No bounded repair Session was launched for it.
    expect(rehearsal.lease()).toBeNull();
    // One round per head: the next tick runs no second generator.
    rehearsal.tick();
    expect(runs).toHaveLength(1);
  });

  it("#2766: refreshes the fingerprint only of a guidance document the candidate changed, else hands off", () => {
    const { rehearsal, head, runs } = redCandidate(FINGERPRINT_2766);
    rehearsal.tick();
    // The fixture candidate changed no guidance document, so the fingerprint generator refuses and nothing runs or commits.
    expect(runs).toEqual([]);
    expect(roundOf(rehearsal, head)).toMatchObject({ outcome: "handoff" });
    expect(roundOf(rehearsal, head)!.reason).toContain("operator-actions.md");
  });

  it.each([["#2758", MIXED_2758], ["#2765", MIXED_2765]])("%s: hands off to the bounded repair Session without running any generator", (_name, log) => {
    const { rehearsal, a, head, runs } = redCandidate(log);
    rehearsal.tick();
    expect(runs).toEqual([]);
    expect(git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim()).toBe(head);
    expect(rehearsal.github.headOf(a.branch)).toBe(head);
    expect(roundOf(rehearsal, head)).toMatchObject({ outcome: "handoff", repaired_head: null });
    // No reviewer runs on red checks, and no second round starts on the next tick.
    expect(rehearsal.github.reviewerCalls).toHaveLength(0);
    rehearsal.tick();
    expect(runs).toEqual([]);
  });
});

describe("the independent review treats the production-owned repair push as a new head", () => {
  it("reviews the repaired head once its checks are green, never review_head_moved", () => {
    const { rehearsal, head, a, turnGreen } = redCandidate(LINT_2752);
    rehearsal.tick(); // deterministic round
    const repaired = git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim();
    expect(repaired).not.toBe(head);
    turnGreen();
    rehearsal.tick();
    rehearsal.tick();
    expect(rehearsal.github.reviewerCalls.length).toBeGreaterThan(0);
    expect(rehearsal.github.reviewerCalls.every((call) => call.head === repaired)).toBe(true);
    expect(escalationKind(rehearsal)).not.toBe("review_head_moved");
  });

  it("any other moved head is still review_head_moved", () => {
    const { rehearsal, head, a, turnGreen } = redCandidate(LINT_2752);
    rehearsal.tick(); // deterministic round
    turnGreen();
    // Someone else pushes a commit that is no production-owned repair head onto the candidate's PR branch.
    const other = path.join(rehearsal.root, "foreign");
    git(rehearsal.root, ["clone", "-q", rehearsal.github.origin, other]);
    git(other, ["checkout", "-q", a.branch]);
    git(other, ["reset", "-q", "--hard", head]);
    appendFileSync(path.join(other, "MARKER.md"), "foreign\n");
    git(other, ["-c", "user.name=Someone", "-c", "user.email=someone@example.test", "-c", "commit.gpgsign=false", "commit", "-qam", "foreign push"]);
    git(other, ["push", "-q", "-f", "origin", `HEAD:refs/heads/${a.branch}`]);
    rehearsal.tick();
    rehearsal.tick();
    expect(escalationKind(rehearsal)).toBe("review_head_moved");
    expect(rehearsal.github.reviewerCalls).toHaveLength(0);
  });
});

describe("repository: the repair library is wired into production", () => {
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.ts$/.test(entry) ? [full] : [];
  });

  it("src/production/mechanicalRepair.ts has a caller outside tests", () => {
    const callers = sourceFiles(path.resolve("src"))
      .filter((file) => !file.endsWith("src/production/mechanicalRepair.ts") && !/\.test\.ts$/.test(file))
      .filter((file) => /from "(?:\.\/|\.\.\/production\/)mechanicalRepair\.js"/.test(readFileSync(file, "utf8")));
    expect(callers.map((file) => path.relative(path.resolve("src"), file))).toEqual(expect.arrayContaining(["production/mechanicalRepairWiring.ts"]));
    // The tick, not only a helper, reaches it.
    expect(readFileSync(path.resolve("src/production/tick.ts"), "utf8")).toMatch(/attemptMechanicalRepair\(/);
  });
});
