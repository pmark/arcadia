import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withReadOnlyDatabase } from "../src/db/connection.js";
import { listReviewRepairs } from "../src/sessions/reviewRepair.js";
import { getMechanicalRepair, isProductionOwnedRepairHead } from "../src/production/mechanicalRepair.js";
import { BOOTSTRAP_MARKER, guidanceFingerprint, renderGuidanceFingerprints } from "../src/projects/agentGuidance.js";
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

/** An indexed procedure document under docs/agent-guidance/ (Decision 0098's agent_guidance boundary), and the ones the index lists outside it. */
const GUIDANCE_DOC = "docs/agent-guidance/operator-actions.md";
const OUTSIDE_DOC = "docs/planning-process.md";
const OUTSIDE_PATHS: Record<string, string> = { "managed-documents": "docs/managed-documents.md", planning: OUTSIDE_DOC, "working-copy": "docs/working-copy-safety.md" };
const staleLog = (doc: string) => FINGERPRINT_2766.replaceAll(GUIDANCE_DOC, doc);
/** A fixture guidance index and fingerprints, current for the genesis bytes of every indexed document. */
function guidanceGenesis(): Record<string, string> {
  const ids = ["continuation", "agent-asks", "operator-actions", "proposals", "principles", "pull-requests", "learning", "git-identity", "managed-documents", "planning", "working-copy"];
  // An indexed repository is audited for the Way bootstrap on every dispatch, so the fixture's root instructions carry it.
  const rules = ["Authority", "Governance", "Preservation", "Identity", "Handoff", "Operator steps", "Review", "Economy and truth", "Vocabulary"];
  const bootstrap = `# AGENTS\n\n${BOOTSTRAP_MARKER}\n\nRead docs/agent-guidance/index.json, docs/notes-to-self.md, CONSTITUTION.md and PROJECT.md.\n\n${rules.map((rule) => `- **${rule}:** fixture rule.\n`).join("")}`;
  const files: Record<string, string> = {
    "AGENTS.md": bootstrap,
    "CLAUDE.md": "# CLAUDE.md\n\n@AGENTS.md\n",
    "docs/agent-guidance/index.json": JSON.stringify({ schema: "arcadia-agent-guidance-v1", entries: ids.map((id) => ({ id, trigger: "t", path: OUTSIDE_PATHS[id] ?? `docs/agent-guidance/${id}.md`, read_before: "r" })) })
  };
  const prints: Record<string, string> = {};
  for (const id of ids) {
    files[OUTSIDE_PATHS[id] ?? `docs/agent-guidance/${id}.md`] = `${id}\n`;
    prints[id] = guidanceFingerprint(`${id}\n`);
  }
  files["docs/agent-guidance/fingerprints.json"] = renderGuidanceFingerprints(prints);
  return files;
}

/**
 * Action A finished with a lintable file, preserved and readied; its required checks read red with `log`.
 * With `guidance`, the candidate also edits the named guidance document, leaving its fingerprint stale.
 */
function redCandidate(log: string, options: { guidance?: string; baseGreen?: boolean } = {}) {
  const runs: string[][] = [];
  const rehearsal = new Rehearsal({
    independentReviewers: "tick",
    ...(options.guidance ? { extraGenesisFiles: guidanceGenesis() } : {}),
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
  if (options.guidance) rehearsal.agentEdit(a, options.guidance, "edited by the candidate\n");
  rehearsal.agentFinish(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  let checks = RED;
  rehearsal.github.checks = (pr) => (pr.branch === a.branch ? checks : GREEN);
  rehearsal.github.failedLog = () => log;
  // With the base green the failure is attributed to the candidate, so the repair loop judges it (and its gate) instead of releasing it as inherited.
  if (options.baseGreen) rehearsal.github.baseCheckRuns = () => RED.map((check) => ({ name: check.name, status: "completed", conclusion: "success" }));
  expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
  rehearsal.tick(); // ready
  const head = git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim();
  return { rehearsal, a, head, runs, turnGreen: () => { checks = GREEN; }, turnRed: () => { checks = RED; } };
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

  it("#2766 (option C): refreshes the fingerprint of an indexed procedure document outside docs/agent-guidance/ that the candidate changed, then commits and pushes a production-owned head", () => {
    const { rehearsal, a, head, runs } = redCandidate(staleLog(OUTSIDE_DOC), { guidance: OUTSIDE_DOC });
    rehearsal.tick();
    // The fingerprint generator is in-process: no child command ran, and no other document's fingerprint moved.
    expect(runs).toEqual([]);
    const repaired = git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim();
    expect(repaired).not.toBe(head);
    expect(git(rehearsal.repo, ["rev-parse", `${repaired}^`]).trim()).toBe(head);
    expect(git(rehearsal.repo, ["log", "-1", "--format=%an <%ae>", repaired]).trim()).toBe("Arcadia Controller <controller@arcadia.local>");
    expect(git(rehearsal.repo, ["diff", "--name-only", head, repaired]).trim()).toBe("docs/agent-guidance/fingerprints.json");
    const fingerprints = (JSON.parse(git(rehearsal.repo, ["show", `${repaired}:docs/agent-guidance/fingerprints.json`])) as { fingerprints: Record<string, string> }).fingerprints;
    expect(fingerprints.planning).toBe(guidanceFingerprint("edited by the candidate\n"));
    expect(fingerprints.continuation).toBe(guidanceFingerprint("continuation\n"));
    expect(rehearsal.github.pushes.at(-1)).toEqual({ branch: a.branch, commitSha: repaired });
    expect(rehearsal.github.headOf(a.branch)).toBe(repaired);
    expect(roundOf(rehearsal, head)).toMatchObject({ outcome: "repaired", repaired_head: repaired, classes: "guidance-fingerprint" });
    expect(rehearsal.lease()).toBeNull();
  });

  it("#2766 (option C): a candidate that edits a document under docs/agent-guidance/ stays behind Decision 0098's gate; the generator never runs", () => {
    const { rehearsal, a, head, runs } = redCandidate(staleLog(GUIDANCE_DOC), { guidance: GUIDANCE_DOC, baseGreen: true });
    rehearsal.tick();
    expect(runs).toEqual([]);
    // attemptMechanicalRepair skips on the gate before any round is claimed: no row, no commit, no push.
    expect(roundOf(rehearsal, head)).toBeNull();
    expect(git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim()).toBe(head);
    expect(rehearsal.github.headOf(a.branch)).toBe(head);
    expect(rehearsal.log.some((line) => line.includes("Deterministic repair of"))).toBe(false);
    // The tick then falls through to the bounded repair step (src/production/reviewRepair.ts:900/950): a fingerprint failure names no failing test in
    // a file the candidate changed, so that row is released, no repair Session launches and no PR is touched; the worker's ordinary
    // required_checks_failed escalation stands for the operator.
    const rows = withReadOnlyDatabase(rehearsal.workspace, (db) => listReviewRepairs(db, rehearsal.actionA));
    expect(rows.map((row) => [row.outcome, row.repair_session_id])).toEqual([["released", null]]);
    expect(rows[0].reason).toContain("No failing test in the failed CI logs is in a file the candidate changed");
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA)?.kind).toBe("required_checks_failed");
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

  it("a repair push after a recorded verdict on the old head is reviewed as a new head, never review_head_moved", () => {
    const { rehearsal, head, a, turnGreen, turnRed } = redCandidate(LINT_2752);
    // Record a verdict on the old head first: green checks, then the tick's own reviewers judge it.
    turnGreen();
    rehearsal.tick();
    const onOldHead = rehearsal.github.reviewerCalls.filter((call) => call.head === head);
    expect(onOldHead.length).toBeGreaterThan(0);
    // A required check then reads red on that head and production's deterministic round pushes its repair.
    turnRed();
    rehearsal.tick();
    const repaired = git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim();
    expect(repaired).not.toBe(head);
    expect(rehearsal.github.headOf(a.branch)).toBe(repaired);
    turnGreen();
    rehearsal.tick();
    rehearsal.tick();
    expect(escalationKind(rehearsal)).not.toBe("review_head_moved");
    expect(rehearsal.github.reviewerCalls.some((call) => call.head === repaired)).toBe(true);
  });

  it("a PR showing the production-owned repair head ahead of the bound head waits for it as the next head (independentReview.ts production-owned branch), never review_head_moved", () => {
    const { rehearsal, head, a, turnGreen } = redCandidate(LINT_2752);
    rehearsal.tick(); // deterministic round: production pushes its repair head
    const repaired = git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim();
    expect(repaired).not.toBe(head);
    expect(rehearsal.github.headOf(a.branch)).toBe(repaired);
    // The candidate's bound head is still the settled one while the PR already shows production's repair head
    // (a worktree read behind the remote): the review step must wait, not call the PR head moved.
    git(a.worktree_path, ["reset", "-q", "--hard", head]);
    expect(git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim()).toBe(head);
    turnGreen();
    rehearsal.tick();
    rehearsal.tick();
    expect(escalationKind(rehearsal)).not.toBe("review_head_moved");
    expect(rehearsal.github.reviewerCalls).toHaveLength(0);
    expect(rehearsal.github.headOf(a.branch)).toBe(repaired);
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
