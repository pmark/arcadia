import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPreservedOperatorQaPlan } from "../src/sessions/candidatePreservation.js";
import {
  detectTestRun,
  OPERATOR_QA_PLAN_MAX_CHARS,
  operatorQaPlanSource,
  renderOperatorQaPlan,
  type OperatorQaPlanFacts,
  type OperatorQaPlanSource
} from "../src/sessions/operatorQaPlan.js";

const COMMIT = "7f1390376f4d49215cd29fd98145d40198475613";
const BASE = "0d3d2cedc5548da41896201688a1dc0210208ea4";

function source(overrides: Partial<OperatorQaPlanSource> = {}): OperatorQaPlanSource {
  return {
    kind: "action-acceptance",
    actionKey: "three-action-rehearsal/write-start-marker",
    actionTitle: "Implement MARKER.md",
    acceptanceCriteria: ["MARKER.md exists and contains exactly the line \"three-action rehearsal start\" followed by a trailing newline."],
    validationCommands: ["node scripts/check-rehearsal.mjs"],
    ...overrides
  };
}

function facts(overrides: Partial<OperatorQaPlanFacts> = {}): OperatorQaPlanFacts {
  return {
    branch: "claude/write-start-marker-20261005T155147519Z",
    baseBranch: "main",
    baseRevision: BASE,
    commitSha: COMMIT,
    changedFiles: [{ status: "A", path: "MARKER.md" }],
    ...overrides
  };
}

function rendered(input: OperatorQaPlanSource = source(), at: OperatorQaPlanFacts = facts()): string {
  const result = renderOperatorQaPlan(input, at);
  expect(result.status).toBe("rendered");
  return result.body;
}

describe("Operator QA plan rendering", () => {
  it("renders one criterion as a read-only inspection bound to the exact Action, commit, base and files", () => {
    const body = rendered();
    expect(body.startsWith("## Operator QA plan\n")).toBe(true);
    expect(body).toContain("Step 1 fetches the candidate branch and adds a detached local worktree at the exact commit: it changes only local Git bookkeeping and creates a throwaway directory you can remove afterwards with `git worktree remove ../qa-7f1390376f4d`. Every later step except the declared validation only reads Git data, and only the declared validation runs candidate code.");
    expect(body).not.toContain("read-only Git inspection");
    expect(body).toContain("- **Action:** `three-action-rehearsal/write-start-marker` — Implement MARKER.md");
    expect(body).toContain(`- **Candidate:** branch \`claude/write-start-marker-20261005T155147519Z\` at commit \`${COMMIT}\``);
    expect(body).toContain(`- **Base:** \`main\` at \`${BASE}\``);
    expect(body).toContain(`git worktree add --detach ../qa-7f1390376f4d ${COMMIT}`);
    expect(body).toContain(`\`git -c core.quotePath=false diff --name-status --no-renames ${BASE} ${COMMIT}\``);
    expect(body).toContain("exactly 1 changed file:\n  - `A` `MARKER.md`");
    expect(body).toContain("### Step 3 — Acceptance criterion 1 of 1");
    expect(body).toContain(`- **Do:** inspect \`MARKER.md\` with \`git show ${COMMIT}:MARKER.md | od -c\`; then run \`git show ${COMMIT}:MARKER.md | grep -Fxn -- 'three-action rehearsal start'\`.`);
    expect(body).toContain("- **Expected:** `od -c` shows every byte (a newline as `\\n`); `grep -Fxn` prints each quoted text that is a whole line with its line number, and nothing when no line matches. Compare that output with this criterion; any part it cannot show, such as a run's result, stays unproven by this step. The criterion, exactly as worded: “MARKER.md exists and contains exactly the line \"three-action rehearsal start\" followed by a trailing newline.”");
    expect(body).toContain("### Step 4 — Run the Project's declared validation\n\n- **Do:** run `node scripts/check-rehearsal.mjs`.\n- **Expected:** `echo $?` immediately after it prints `0`");
    expect(body).toContain("the operator procedure below is also the end-user procedure");
  });

  it("is deterministic: the same inputs render the same bytes", () => {
    expect(rendered()).toBe(rendered());
  });

  it("renders several criteria in order, each with inspection steps only", () => {
    const body = rendered(source({
      acceptanceCriteria: [
        "MARKER.md contains exactly the start line followed by \"THREE-ACTION REHEARSAL START\".",
        "tests/marker.test.mjs exists and passes under node --test, asserting both lines appear in order; \"node scripts/check-rehearsal.mjs\" passes.",
        "`pnpm test` passes."
      ]
    }), facts({ changedFiles: [{ status: "M", path: "MARKER.md" }, { status: "A", path: "tests/marker.test.mjs" }] }));
    const steps = [...body.matchAll(/### Step (\d+) — Acceptance criterion (\d) of 3/g)].map((match) => [match[1], match[2]]);
    expect(steps).toEqual([["3", "1"], ["4", "2"], ["5", "3"]]);
    expect(body).toContain(`- **Do:** inspect \`tests/marker.test.mjs\` with \`git show ${COMMIT}:tests/marker.test.mjs\`; then run \`git show ${COMMIT}:tests/marker.test.mjs | grep -Fxn -- 'node scripts/check-rehearsal.mjs'\`.`);
    // A backticked command in a criterion is never lifted into a run step.
    expect(body).toContain(`- **Do:** read the change with \`git diff ${BASE} ${COMMIT}\`.\n- **Expected:** the diff shows what changed. That is all this inspection shows: a diff never shows that a command passes. This plan runs no command taken from criterion text, and none of the Project's declared validation commands in Step 6 is the command this criterion names: Step 6's exit-zero result proves only that those declared commands pass, so this plan offers no direct proof that this criterion's command passes. Any other part of this criterion must show in this step's output. The criterion, exactly as worded: “\\\`pnpm test\\\` passes.”`);
    expect(body).toContain("Whether the named command passes is proven only by Step 6, the Project's declared validation: `echo $?` immediately after `node scripts/check-rehearsal.mjs` prints `0`. A named test file passing is shown only by a run, never by its source; the run this plan offers is Step 6, the Project's declared validation, exiting `0`. Any part of this criterion that is not a command or test file passing must show in this step's output. The criterion, exactly as worded: “tests/marker.test.mjs exists and passes");
    expect(body).not.toContain("not among the Project's declared validation commands");
    expect(body).not.toContain("stays unproven by this step. The criterion, exactly as worded: “tests/marker.test.mjs");
    expect(body).not.toContain("run `pnpm test`");
    expect(body).not.toContain("run `node --test`");
    expect(body).toContain("### Step 6 — Run the Project's declared validation\n\n- **Do:** run `node scripts/check-rehearsal.mjs`.");
  });

  it("never claims that showing a check's source proves the check passes (Issue #986, rehearsal run 5 Action 1)", () => {
    const criteria = [
      "MARKER.md exists and contains exactly the line \"three-action rehearsal start\" followed by a trailing newline, with no other content.",
      "The genesis check node scripts/check-rehearsal.mjs passes."
    ];
    const body = rendered(source({ acceptanceCriteria: criteria }), facts({
      changedFiles: [{ status: "A", path: "MARKER.md" }, { status: "M", path: "PROJECT.md" }],
      pathExists: (candidate) => ["MARKER.md", "PROJECT.md", "scripts/check-rehearsal.mjs"].includes(candidate)
    }));
    const step = body.slice(body.indexOf("### Step 4 — Acceptance criterion 2 of 2"), body.indexOf("### Step 5"));
    expect(step).toBe([
      "### Step 4 — Acceptance criterion 2 of 2",
      "",
      `- **Do:** inspect \`scripts/check-rehearsal.mjs\` with \`git show ${COMMIT}:scripts/check-rehearsal.mjs\`.`,
      "- **Expected:** the file content is shown. That is all this inspection shows: that `scripts/check-rehearsal.mjs` exists at the candidate commit and what it contains. Showing a file's source never shows that a command passes. Whether the named command passes is proven only by Step 5, the Project's declared validation: `echo $?` immediately after `node scripts/check-rehearsal.mjs` prints `0`. Any other part of this criterion must show in this step's output. The criterion, exactly as worded: “The genesis check node scripts/check-rehearsal.mjs passes.”",
      "",
      ""
    ].join("\n"));
    // Criterion 1 is not a check: its wording is unchanged.
    expect(body).toContain("stays unproven by this step. The criterion, exactly as worded: “MARKER.md exists and contains exactly the line");
    // The declared-validation step is unchanged.
    expect(body).toContain("### Step 5 — Run the Project's declared validation\n\n- **Do:** run `node scripts/check-rehearsal.mjs`.\n- **Expected:** `echo $?` immediately after it prints `0`, as host validation recorded before preservation.");

    // Whatever names the command and however it is shaped, no check criterion's
    // Expected line says the inspection output shows that the criterion holds.
    const shapes: Array<[string, readonly string[]]> = [
      ["`scripts/check.sh` exits 0 on the candidate.", ["pnpm test"]],
      ["tests/marker.test.mjs exists and passes under node --test.", []],
      ["`pnpm lint` succeeds.", ["pnpm lint", "pnpm test"]]
    ];
    for (const [criterion, validationCommands] of shapes) {
      const plan = rendered(source({ acceptanceCriteria: [criterion], validationCommands }), facts({
        changedFiles: [{ status: "A", path: "tests/marker.test.mjs" }, { status: "A", path: "scripts/check.sh" }]
      }));
      const expected = plan.split("\n").find((line) => line.startsWith("- **Expected:**") && line.includes("exactly as worded"))!;
      expect(expected).not.toMatch(/shows this criterion holds/);
      expect(expected).toMatch(/never shows that a command passes/);
      expect(expected).not.toMatch(/(?:source|inspection|diff|output) (?:shows|proves) (?:that )?(?:it|the check|the command|this criterion) (?:passes|holds)/);
    }
    // A declared command named exactly is the proof; another command, even a near
    // namesake, is not, and the plan says it offers no direct proof.
    const proof = (criterion: string, validationCommands: readonly string[]) =>
      rendered(source({ acceptanceCriteria: [criterion], validationCommands }), facts()).split("\n").find((line) => line.includes("exactly as worded")) ?? "missing";
    expect(proof("`scripts/check.sh` exits 0 on the candidate.", ["pnpm test"])).toContain("none of the Project's declared validation commands in Step 4 is the command this criterion names: Step 4's exit-zero result proves only that those declared commands pass, so this plan offers no direct proof that this criterion's command passes.");
    expect(proof("tests/marker.test.mjs exists and passes under node --test.", [])).toContain("A named test file passing is shown only by a run, never by its source, and the Project declares no validation commands, so this plan offers no run that shows it.");
    expect(proof("`scripts/check.sh` exits 0 on the candidate.", [])).toContain("the Project declares no validation commands, so this plan offers no proof that the named command passes.");
    // A bare script path is the declared command that runs exactly that script.
    for (const criterion of ["scripts/check-rehearsal.mjs passes.", "`scripts/check-rehearsal.mjs` exits 0."]) {
      expect(proof(criterion, ["pnpm lint", "node scripts/check-rehearsal.mjs"]), criterion)
        .toContain("Whether the named command passes is proven only by Step 4, the Project's declared validation: `echo $?` immediately after `node scripts/check-rehearsal.mjs` prints `0`. Any other part of this criterion must show in this step's output.");
    }
    for (const nearNamesake of ["`pnpm test:unit` passes.", "`pnpm test -- --grep x` passes."]) {
      expect(proof(nearNamesake, ["pnpm test"])).toContain("offers no direct proof that this criterion's command passes");
      expect(proof(nearNamesake, ["pnpm test"])).not.toContain("Whether the named command passes is proven");
    }
    expect(proof("pnpm test:unit passes.", ["pnpm test"])).not.toContain("Whether the named command passes is proven");
    expect(proof("`pnpm lint` and `pnpm test` pass; pnpm lint succeeds and pnpm test passes.", ["pnpm lint", "pnpm test"]))
      .toContain("Whether the named commands pass is proven only by Step 4, the Project's declared validation: `echo $?` immediately after each of `pnpm lint` and `pnpm test` prints `0`. Any other part");
    // A criterion mixing a declared command with an undeclared one says the plan offers no direct proof for the latter.
    for (const mixed of ["`pnpm test` passes and `scripts/extra.sh` exits 0.", "`pnpm lint` passes and `pnpm test` passes."]) {
      expect(proof(mixed, mixed.includes("extra") ? ["pnpm test"] : ["pnpm lint"]), mixed)
        .toContain("This criterion also names a command that is not among the Project's declared validation commands; this plan runs no command taken from criterion text, so it offers no direct proof that that command passes. Any part of this criterion that is not a command passing must show in this step's output.");
    }
    // A compound criterion still asks the inspection output to show its file-content parts.
    expect(rendered(source({ acceptanceCriteria: ["MARKER.md contains exactly \"hello\" and `pnpm test` passes."], validationCommands: ["pnpm test"] })))
      .toContain("and nothing when no line matches. That is all this inspection shows: that `MARKER.md` exists at the candidate commit and what it contains. Showing a file's source never shows that a command passes. Whether the named command passes is proven only by Step 4, the Project's declared validation: `echo $?` immediately after `pnpm test` prints `0`. Any other part of this criterion must show in this step's output.");
    // Only a declared command whose own clause passes is cited as proof.
    expect(proof("`pnpm lint` fails on the old tree but `pnpm test` passes.", ["pnpm lint", "pnpm test"]))
      .toContain("immediately after `pnpm test` prints `0`.");
    // A negation that does not govern the pass word, a colon or a version number does not hide the check.
    for (const criterion of [
      "`pnpm test` reports no failures and passes.",
      "Running `pnpm test` with no network passes.",
      "`pnpm test` (including the new no-op case) passes.",
      "Run `pnpm test`: it passes.",
      "`pnpm test` on node v2.0 passes."
    ]) expect(proof(criterion, ["pnpm test"]), criterion).toContain("Whether the named command passes is proven only by Step 4");
  });

  it("pins Step 4 of all three rehearsal fixture Actions, with no self-declared gap for a test file the declared check runs (Issue #986)", () => {
    // Criteria verbatim from the fixture Plan (pmark/arcadia-three-action-rehearsal-20261004,
    // docs/plans/autonomous-three-action-rehearsal.md on main).
    const fixture: Record<string, [string, string]> = {
      "write-start-marker": [
        "MARKER.md exists and contains exactly the line \"three-action rehearsal start\" followed by a trailing newline, with no other content.",
        "The genesis check node scripts/check-rehearsal.mjs passes."
      ],
      "transform-start-marker": [
        "MARKER.md contains exactly the start line followed by \"THREE-ACTION REHEARSAL START\", each with a trailing newline.",
        "tests/marker.test.mjs exists and passes under node --test, asserting both lines appear in order; \"node scripts/check-rehearsal.mjs\" passes."
      ],
      "verify-final-rehearsal": [
        "MARKER.md contains exactly the start, transformed and verified lines in that order, each with a trailing newline.",
        "tests/marker.test.mjs asserts all three lines in order and \"node scripts/check-rehearsal.mjs\" passes."
      ]
    };
    const show = `git show ${COMMIT}:`;
    const inspectBoth = `- **Do:** inspect \`tests/marker.test.mjs\` with \`${show}tests/marker.test.mjs\`; then run \`${show}tests/marker.test.mjs | grep -Fxn -- 'node scripts/check-rehearsal.mjs'\`; then inspect \`scripts/check-rehearsal.mjs\` with \`${show}scripts/check-rehearsal.mjs\`; then run \`${show}scripts/check-rehearsal.mjs | grep -Fxn -- 'node scripts/check-rehearsal.mjs'\`.`;
    const bothScope = "the file content is shown; `grep -Fxn` prints each quoted text that is a whole line with its line number, and nothing when no line matches. That is all this inspection shows: that `tests/marker.test.mjs`, `scripts/check-rehearsal.mjs` exist at the candidate commit and what they contain. Showing a file's source never shows that a command passes.";
    const proven = "Whether the named command passes is proven only by Step 5, the Project's declared validation: `echo $?` immediately after `node scripts/check-rehearsal.mjs` prints `0`.";
    const expected: Record<string, string[]> = {
      "write-start-marker": [
        `- **Do:** inspect \`scripts/check-rehearsal.mjs\` with \`${show}scripts/check-rehearsal.mjs\`.`,
        `- **Expected:** the file content is shown. That is all this inspection shows: that \`scripts/check-rehearsal.mjs\` exists at the candidate commit and what it contains. Showing a file's source never shows that a command passes. ${proven} Any other part of this criterion must show in this step's output. The criterion, exactly as worded: “The genesis check node scripts/check-rehearsal.mjs passes.”`
      ],
      "transform-start-marker": [
        inspectBoth,
        `- **Expected:** ${bothScope} ${proven} A named test file passing is shown only by a run, never by its source; the run this plan offers is Step 5, the Project's declared validation, exiting \`0\`. Any part of this criterion that is not a command or test file passing must show in this step's output. The criterion, exactly as worded: “tests/marker.test.mjs exists and passes under node --test, asserting both lines appear in order; "node scripts/check-rehearsal.mjs" passes.”`
      ],
      "verify-final-rehearsal": [
        inspectBoth,
        `- **Expected:** ${bothScope} ${proven} Any other part of this criterion must show in this step's output. The criterion, exactly as worded: “tests/marker.test.mjs asserts all three lines in order and "node scripts/check-rehearsal.mjs" passes.”`
      ]
    };
    for (const [action, criteria] of Object.entries(fixture)) {
      const body = rendered(source({ actionKey: `three-action-rehearsal/${action}`, acceptanceCriteria: criteria }), facts({
        changedFiles: [{ status: "M", path: "MARKER.md" }, { status: "A", path: "tests/marker.test.mjs" }],
        pathExists: (candidate) => ["MARKER.md", "tests/marker.test.mjs", "scripts/check-rehearsal.mjs"].includes(candidate)
      }));
      const step = body.slice(body.indexOf("### Step 4 — Acceptance criterion 2 of 2"), body.indexOf("### Step 5"));
      expect(step, action).toBe(["### Step 4 — Acceptance criterion 2 of 2", "", ...expected[action], "", ""].join("\n"));
      expect(step, action).not.toMatch(/no direct proof|not among the Project's declared validation commands|offers no (?:proof|run)/);
    }
  });

  it("keeps the ordinary wording for criteria that are not a command that must pass (Issue #986 false positives)", () => {
    for (const criterion of [
      "The value passed to `renderPlan` is trimmed.",
      "A second pass over `docs/` reads every file.",
      "`arcadia settle` with a stale id does not succeed.",
      "`scripts/check.sh` never exits 0 when MARKER.md is missing.",
      "The genesis check node scripts/check-rehearsal.mjs fails, then passes once fixed.",
      "MARKER.md exists.",
      "The function `parse` passes its input through unchanged.",
      "The `--strict` flag passes validation.",
      "Expose `isPass` so a user passes.",
      "`pnpm test` does not, on any platform, pass.",
      "`pnpm test` is not expected to ever pass.",
      "`pnpm test` passes on main but fails on the candidate."
    ]) {
      const body = rendered(source({ acceptanceCriteria: [criterion], validationCommands: ["node scripts/check-rehearsal.mjs", "pnpm test"] }));
      expect(body, criterion).toContain(`stays unproven by this step. The criterion, exactly as worded: “${criterion.replace(/`/g, "\\`")}”`);
      expect(body, criterion).not.toContain("never shows that a command passes");
    }
    expect(rendered(source({ acceptanceCriteria: ["`pnpm lint` succeeds."], validationCommands: ["pnpm lint", "pnpm test"] })))
      .toContain("Whether the named command passes is proven only by Step 4, the Project's declared validation: `echo $?` immediately after `pnpm lint` prints `0`.");
  });

  it("never turns a negated or mutating criterion into a run step", () => {
    const body = rendered(source({
      acceptanceCriteria: [
        "Never run `git push --force origin main`; the base branch is not rewritten.",
        "Do not \"make next\" or `go` from here; `git check-ignore` stays unused, and `rm -rf dist` is not run.",
        "CHANGELOG.md mentions \"git push --force origin main\" only as forbidden."
      ],
      validationCommands: []
    }), facts({ changedFiles: [{ status: "M", path: "CHANGELOG.md" }] }));
    const runSteps = body.split("\n").filter((line) => line.includes("run `") || line.includes("run ``"));
    expect(runSteps.every((line) => line.includes("git fetch origin") || line.includes("git -c core.quotePath=false diff") || line.includes("| grep -Fxn -- "))).toBe(true);
    for (const forbidden of ["run `git push", "run `make", "run `go", "run `git check-ignore", "run `rm "]) expect(body).not.toContain(forbidden);
    expect(body).toContain(`run \`git show ${COMMIT}:CHANGELOG.md | grep -Fxn -- 'git push --force origin main'\``);
    expect(body).toContain("exactly as worded: “Never run \\`git push --force origin main\\`; the base branch is not rewritten.”");
    expect(body).toContain("- **Do:** nothing further: the Project declares no validation commands.");
  });

  it("inspects only named paths that exist at the commit, and reads the diff for the rest", () => {
    const changedFiles = [{ status: "D", path: "docs/old.md" }, { status: "M", path: "src/kept.ts" }];
    const exists = new Set(["src/kept.ts", "src/untouched.ts"]);
    const body = rendered(source({
      acceptanceCriteria: ["docs/old.md is removed.", "src/kept.ts still imports src/untouched.ts.", "src/missing.ts is not created."]
    }), facts({ changedFiles, pathExists: (candidate) => exists.has(candidate) }));
    expect(body).toContain(`- **Do:** read the change with \`git diff ${BASE} ${COMMIT} -- docs/old.md\`.`);
    expect(body).toContain(`inspect \`src/kept.ts\` with \`git show ${COMMIT}:src/kept.ts\`; then inspect \`src/untouched.ts\` with \`git show ${COMMIT}:src/untouched.ts\`.`);
    expect(body).toContain(`- **Do:** read the change with \`git diff ${BASE} ${COMMIT} -- src/missing.ts\`.`);
    expect(body).not.toContain("git show " + COMMIT + ":docs/old.md");
  });

  describe("a criterion that names a path as a sample (Issue #1999)", () => {
    const SAMPLE = "apps/dashboard/package.json";
    const TEST_FILE = "tests/pr-blast-radius.test.ts";
    const criterion = `The negative table asserts that ${SAMPLE} and four other paths do not match.`;
    const exists = (...paths: string[]) => (candidate: string) => paths.includes(candidate);
    const stepOf = (body: string) => body.slice(body.indexOf("### Step 3"), body.indexOf("### Step 4"));

    it("inspects the changed test file, not the unchanged path the criterion names", () => {
      const body = rendered(source({ acceptanceCriteria: [criterion], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: TEST_FILE }, { status: "M", path: "src/stewardship/prBlastRadius.ts" }],
        pathExists: exists(SAMPLE, TEST_FILE, "src/stewardship/prBlastRadius.ts")
      }));
      const step = stepOf(body);
      expect(step).toContain(`- **Do:** inspect \`${TEST_FILE}\` with \`git show ${COMMIT}:${TEST_FILE}\`.`);
      expect(step).not.toContain(`git show ${COMMIT}:${SAMPLE}`);
      expect(step).not.toMatch(/inspect `apps\/dashboard/);
      // The criterion text itself is still quoted exactly as worded.
      expect(step).toContain(SAMPLE);
    });

    it("inspects every changed test file, and never a deleted one", () => {
      const body = rendered(source({ acceptanceCriteria: [criterion], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: TEST_FILE }, { status: "M", path: "tests/other.test.ts" }, { status: "D", path: "tests/gone.test.ts" }, { status: "M", path: "src/a.ts" }],
        pathExists: exists(SAMPLE, TEST_FILE, "tests/other.test.ts", "src/a.ts")
      }));
      const step = stepOf(body);
      expect(step).toContain(`inspect \`${TEST_FILE}\` with \`git show ${COMMIT}:${TEST_FILE}\`; then inspect \`tests/other.test.ts\` with`);
      expect(step).not.toContain("gone.test.ts");
      expect(step).not.toContain(`git show ${COMMIT}:${SAMPLE}`);
    });

    it("keeps inspecting a named file the candidate changed, even beside a changed test file", () => {
      const changedNamed = rendered(source({ acceptanceCriteria: [`${SAMPLE} gains no new dependency.`], validationCommands: [] }), facts({
        changedFiles: [{ status: "M", path: SAMPLE }, { status: "A", path: TEST_FILE }],
        pathExists: exists(SAMPLE, TEST_FILE)
      }));
      expect(stepOf(changedNamed)).toContain(`- **Do:** inspect \`${SAMPLE}\` with \`git show ${COMMIT}:${SAMPLE}\`.`);
      expect(stepOf(changedNamed)).not.toContain(TEST_FILE);
      // A criterion naming a changed test file inspects that file.
      const namedTest = rendered(source({ acceptanceCriteria: [`${TEST_FILE} asserts the negative table.`], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: TEST_FILE }, { status: "M", path: "tests/other.test.ts" }],
        pathExists: exists(TEST_FILE, "tests/other.test.ts")
      }));
      expect(stepOf(namedTest)).toContain(`- **Do:** inspect \`${TEST_FILE}\` with \`git show ${COMMIT}:${TEST_FILE}\`.`);
      expect(stepOf(namedTest)).not.toContain("tests/other.test.ts");
      // Naming one changed and one unchanged path keeps both named paths.
      const both = rendered(source({ acceptanceCriteria: [`${SAMPLE} and ${TEST_FILE} agree.`], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: TEST_FILE }, { status: "M", path: "tests/other.test.ts" }],
        pathExists: exists(SAMPLE, TEST_FILE, "tests/other.test.ts")
      }));
      expect(stepOf(both)).toContain(`inspect \`${SAMPLE}\` with`);
      expect(stepOf(both)).toContain(`inspect \`${TEST_FILE}\` with`);
      expect(stepOf(both)).not.toContain("tests/other.test.ts");
    });

    it("keeps the named path when the candidate changed no test file, or the path does not exist", () => {
      const noTests = rendered(source({ acceptanceCriteria: [criterion], validationCommands: [] }), facts({
        changedFiles: [{ status: "M", path: "src/a.ts" }], pathExists: exists(SAMPLE, "src/a.ts")
      }));
      expect(stepOf(noTests)).toContain(`inspect \`${SAMPLE}\` with \`git show ${COMMIT}:${SAMPLE}\``);
      const absent = rendered(source({ acceptanceCriteria: [criterion], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: TEST_FILE }], pathExists: exists(TEST_FILE)
      }));
      expect(stepOf(absent)).toContain(`- **Do:** read the change with \`git diff ${BASE} ${COMMIT} -- ${SAMPLE}\`.`);
    });

    it("states the substitution and claims only what the substituted file shows", () => {
      const body = rendered(source({ acceptanceCriteria: [criterion], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: TEST_FILE }], pathExists: exists(SAMPLE, TEST_FILE)
      }));
      const step = stepOf(body);
      expect(step).toContain(`- **Substitution:** the existing path the criterion names, \`${SAMPLE}\`, was not changed by this candidate, so this step does not inspect it and inspects the candidate's changed test file instead.`);
      expect(step).toContain(`not the content of \`${SAMPLE}\``);
      expect(step).not.toContain("shows this criterion holds");
      // No substitution, no substitution text.
      const plain = rendered(source({ acceptanceCriteria: [`${SAMPLE} gains no new dependency.`], validationCommands: [] }), facts({
        changedFiles: [{ status: "M", path: SAMPLE }], pathExists: exists(SAMPLE)
      }));
      expect(plain).not.toContain("Substitution");
    });

    it("never redirects away from a named test file or a named source file", () => {
      const namedTest = rendered(source({ acceptanceCriteria: ["`tests/existing.test.ts` asserts the negative table."], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: "tests/other.test.ts" }], pathExists: exists("tests/existing.test.ts", "tests/other.test.ts")
      }));
      expect(stepOf(namedTest)).toContain(`inspect \`tests/existing.test.ts\` with \`git show ${COMMIT}:tests/existing.test.ts\``);
      expect(stepOf(namedTest)).not.toContain("tests/other.test.ts");
      expect(stepOf(namedTest)).not.toContain("Substitution");
      const namedSource = rendered(source({ acceptanceCriteria: ["`src/guard.ts` still refuses a stale head."], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: "tests/b.test.ts" }], pathExists: exists("src/guard.ts", "tests/b.test.ts")
      }));
      expect(stepOf(namedSource)).toContain(`inspect \`src/guard.ts\` with \`git show ${COMMIT}:src/guard.ts\``);
      expect(stepOf(namedSource)).not.toContain("tests/b.test.ts");
      expect(stepOf(namedSource)).toContain("Compare that output with this criterion");
    });

    it("redirects the run i sample criterion as written, naming other absent paths without saying it names only one", () => {
      // The Action pin-blast-radius-safety-patterns, criterion 2, verbatim.
      const real = "The same test asserts no pattern matches any of: src/commands/x.ts, tests/x.ts, docs/x.md, apps/dashboard/package.json and src/production.";
      const body = rendered(source({ acceptanceCriteria: [real], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: "tests/pr-blast-radius.test.ts" }, { status: "A", path: "src/stewardship/prBlastRadius.ts" }],
        pathExists: exists("apps/dashboard/package.json", "tests/pr-blast-radius.test.ts", "src/stewardship/prBlastRadius.ts")
      }));
      const step = stepOf(body);
      expect(step).toContain(`inspect \`tests/pr-blast-radius.test.ts\` with \`git show ${COMMIT}:tests/pr-blast-radius.test.ts\``);
      expect(step).not.toContain(`git show ${COMMIT}:apps/dashboard/package.json`);
      expect(step).toContain("- **Substitution:** the existing path the criterion names, `apps/dashboard/package.json`, was not changed by this candidate");
      expect(step).not.toContain("names only");
    });

    it("does not redirect a criterion about what a named non-code file says", () => {
      for (const subject of ['docs/guide.md contains exactly the line "foo".', "docs/guide.md states the install command.", "docs/guide.md describes the new flag."]) {
        const body = rendered(source({ acceptanceCriteria: [subject], validationCommands: [] }), facts({
          changedFiles: [{ status: "A", path: "tests/guide.test.ts" }], pathExists: exists("docs/guide.md", "tests/guide.test.ts")
        }));
        expect(stepOf(body), subject).toContain(`inspect \`docs/guide.md\` with`);
        expect(stepOf(body), subject).not.toContain("tests/guide.test.ts");
        expect(stepOf(body), subject).not.toContain("Substitution");
      }
    });

    it("does not redirect a criterion that a command must pass", () => {
      const body = rendered(source({ acceptanceCriteria: ["scripts/check.sh passes."], validationCommands: ["bash scripts/check.sh"] }), facts({
        changedFiles: [{ status: "A", path: TEST_FILE }], pathExists: exists("scripts/check.sh", TEST_FILE)
      }));
      expect(stepOf(body)).toContain(`inspect \`scripts/check.sh\` with \`git show ${COMMIT}:scripts/check.sh\``);
      expect(stepOf(body)).not.toContain(TEST_FILE);
    });
  });

  it("says a documents-only patch has no runnable surface and names the proof", () => {
    const body = rendered(source(), facts({ changedFiles: [
      { status: "A", path: ".arcadia/asks/archive/agent-ask-complete-write-start-marker-2026-10-05.yaml" },
      { status: "A", path: "MARKER.md" },
      { status: "M", path: "docs/plans/autonomous-three-action-rehearsal.md" }
    ] }));
    expect(body).toContain("- **Surface:** no service, URL or build. Every changed file is a document or an Arcadia governed record");
    expect(body).toContain("the strongest proof is the file content at the candidate commit");
  });

  it("names the code surface for a patch that changes code", () => {
    const body = rendered(source(), facts({ changedFiles: [{ status: "M", path: "src/index.ts" }, { status: "A", path: "MARKER.md" }] }));
    expect(body).toContain("- **Surface:** this repository's code at the candidate commit, exercised by the Project's declared validation commands from a local checkout.");
    expect(body).not.toContain("no service, URL or build");
  });

  it("escapes Markdown, HTML and mentions in governed text so a criterion cannot restructure the body", () => {
    const body = rendered(source({
      actionTitle: "Title with **bold** and <img src=x>",
      acceptanceCriteria: ["Line one\n## Injected heading\n- [x] fake <script>alert(1)</script> `cmd` ping @operator &amp; | table |"]
    }));
    const expectedLine = body.split("\n").find((line) => line.startsWith("- **Expected:** the diff shows"))!;
    expect(expectedLine).toBe(
      "- **Expected:** the diff shows what changed. Compare that output with this criterion; any part it cannot show, such as a run's result, stays unproven by this step. The criterion, exactly as worded: “Line one ## Injected heading - \\[x\\] fake \\<script\\>alert(1)\\</script\\> \\`cmd\\` ping @\u200boperator \\&amp; \\| table \\|”"
    );
    expect(body).toContain("— Title with \\*\\*bold\\*\\* and \\<img src=x\\>");
    expect(body).not.toMatch(/^## Injected/m);
    expect(body).not.toContain("<script>");
    expect(body).not.toMatch(/@operator/);
  });

  it("fences code spans and shell-quotes refs that contain backticks or shell syntax", () => {
    const body = rendered(source(), facts({ branch: "claude/x`$(touch y)", changedFiles: [{ status: "A", path: "a`b.md" }] }));
    expect(body).toContain("``git fetch origin 'claude/x`$(touch y)' && git worktree add");
    expect(body).toContain("  - `A` ``a`b.md``");
  });

  it("caps long criteria and long file lists, and stays within the pull-request body limit", () => {
    const changedFiles = Array.from({ length: 450 }, (_, index) => ({ status: "A", path: `docs/reports/file-${String(index).padStart(3, "0")}.md` }));
    const body = rendered(source({ acceptanceCriteria: ["x".repeat(5_000), "MARKER.md exists."] }), facts({ changedFiles }));
    expect(body).toContain("exactly 450 changed files (the first 200 are listed):");
    expect(body).toContain("docs/reports/file-199.md");
    expect(body).not.toContain("docs/reports/file-200.md");
    expect(body).toContain(`${"x".repeat(1_000)}… (truncated; the full text is in the Action's Plan)`);
    expect(body).not.toContain("x".repeat(1_001));
    expect(body.length).toBeLessThanOrEqual(OPERATOR_QA_PLAN_MAX_CHARS);
  });

  it("refuses a plan that cannot fit a pull-request body rather than truncating it silently", () => {
    const criteria = Array.from({ length: 80 }, (_, index) => `${index}: ${"y".repeat(990)}`);
    const result = renderOperatorQaPlan(source({ acceptanceCriteria: criteria }), facts());
    expect(result.status).toBe("refused");
    expect(result.status === "refused" && result.reason).toMatch(/over the 60000-character pull-request body limit/);
    expect(result.body).toContain("QA plan unavailable: the rendered plan is");
    expect(result.body.length).toBeLessThan(2_000);
  });

  it("refuses, writing no placeholder procedure, when the Action declares no acceptance criteria", () => {
    for (const acceptanceCriteria of [[], ["   ", ""]]) {
      const result = renderOperatorQaPlan(source({ acceptanceCriteria }), facts());
      expect(result).toMatchObject({
        status: "refused",
        reason: "Action three-action-rehearsal/write-start-marker declares no acceptance criteria, so there is nothing concrete to check."
      });
      expect(result.body).toContain("QA plan unavailable: Action three-action-rehearsal/write-start-marker declares no acceptance criteria");
      expect(result.body).toContain(`at commit \`${COMMIT}\``);
      expect(result.body).not.toContain("### Step");
    }
  });

  it("refuses when the changed files could not be read", () => {
    const result = renderOperatorQaPlan(source(), facts({ changedFiles: null }));
    expect(result).toMatchObject({ status: "refused", reason: "the candidate's changed files could not be read from Git." });
  });

  // Real Actions and the real report wording, 2026-11-05: "Step 5 claims a diff shows tests pass, and Step 6
  // claims one file's contents show the set of changed files and CI results ... no step runs the named tests or checks CI."
  describe("a step's expected result is only what its command can show", () => {
    const VITEST = { setup: "bridge", runner: "pnpm exec vitest run" } as const;
    const SCOPE_AND_CI = (file: string) => `The change touches only ${file}. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.`;
    const stepOf = (body: string, n: number) => body.slice(body.indexOf(`### Step ${n} `), body.indexOf(`### Step ${n + 1} `));

    const TEST_FILE = "tests/recovery-replay.test.ts";
    const SELF_CHECK = "node scripts/preservation-self-check.mjs";
    const recoverySource = source({
      actionKey: "arcadia/pin-recovery-unparseable-time-order",
      acceptanceCriteria: [
        `${TEST_FILE} gains a test in which classifyRecoverySignals receives two failing operator-qa-plan repair rows, the first with an unparseable at value and the second with a parseable one, and returns the signal of the parseable row first.`,
        "A second new test gives two such repair rows that both have unparseable at values and asserts that their signals keep input order.",
        "Every other test in that file passes unchanged.",
        SCOPE_AND_CI(TEST_FILE)
      ],
      validationCommands: [SELF_CHECK]
    });
    const recoveryFacts = facts({
      branch: "claude/pin-recovery-unparseable-time-order-20261105T040649785Z",
      changedFiles: [{ status: "A", path: ".arcadia/asks/agent-ask-complete-x.yaml" }, { status: "M", path: TEST_FILE }],
      testRun: VITEST
    });

    it("renders the real pin-recovery-unparseable-time-order plan truthfully, step by step", () => {
      const body = rendered(recoverySource, recoveryFacts);
      // A diff shows the file was not edited; it never shows a test passing, and the step says who does.
      expect(stepOf(body, 5)).toBe([
        "### Step 5 — Acceptance criterion 3 of 4",
        "",
        `- **Do:** read the change with \`git diff ${BASE} ${COMMIT}\`.`,
        `- **Expected:** the diff shows what changed. That is all this inspection shows: a diff never shows that a test passes. Whether those tests pass is shown only by Step 8, which runs \`${TEST_FILE}\`: its exit-zero result is that proof. Any other part of this criterion must show in this step's output. The criterion, exactly as worded: “Every other test in that file passes unchanged.”`,
        "",
        ""
      ].join("\n"));
      // Nothing to inspect: one file's content cannot show the changed-file set or a CI result.
      expect(stepOf(body, 6)).toBe([
        "### Step 6 — Acceptance criterion 4 of 4",
        "",
        "- **Do:** compare Step 2's changed-file list with this criterion; then read the required checks in Step 9.",
        `- **Expected:** Step 2's list shows every file the candidate changes: apart from Arcadia's governed records (this Action's Agent Ask under \`.arcadia/asks/\` and, on a settled head, \`MISSION_LOG.md\`, \`PROJECT.md\` and the Plan), it names only the files this criterion allows. Step 9's output shows each required check passing on the pull request's head. This step inspects no file: one file's content cannot show that. The criterion, exactly as worded: “${SCOPE_AND_CI(TEST_FILE)}”`,
        "",
        ""
      ].join("\n"));
      expect(stepOf(body, 7)).toContain(`### Step 7 — Run the Project's declared validation\n\n- **Do:** run \`${SELF_CHECK}\`.`);
      expect(stepOf(body, 8)).toBe([
        "### Step 8 — Run the candidate's test file",
        "",
        `- **Do:** run \`node scripts/bridge-worktree-deps.mjs\` to link the clone's installed dependencies into this throwaway worktree (a clone with none needs \`pnpm install\` first); then run \`pnpm exec vitest run ${TEST_FILE}\`.`,
        "- **Expected:** the run's summary reports every test passed and none failed, and `echo $?` immediately after it prints `0`. This runs that file at this commit and nothing else in the suite.",
        "",
        ""
      ].join("\n"));
      expect(body.slice(body.indexOf("### Step 9 "))).toBe([
        "### Step 9 — Read the required checks on the pull request's head",
        "",
        "- **Do:** run `gh pr checks claude/pin-recovery-unparseable-time-order-20261105T040649785Z --required`.",
        "- **Expected:** every listed check reads `pass` and `echo $?` immediately after it prints `0`; `8` means a check is still pending and `1` that one failed. It reads the pull request for this branch at its current head: this commit, or this commit with a governed settlement commit on top. It shows each job's result, not what the job ran.",
        "",
        "Merge, deployment and publication remain separate operator gates."
      ].join("\n"));
      expect(body).toContain("Every later step except the test-file run and the declared validation only reads Git data or, in Step 9, the pull request's checks on GitHub, and only those run candidate code.");
      // No step claims its output shows a criterion holds.
      expect(body).not.toContain("shows this criterion holds");
      expect(rendered(recoverySource, recoveryFacts)).toBe(body);
    });

    it("renders the real pin-work-monitor-malformed-record compound criterion, keeping its diff for the parts a diff shows", () => {
      const file = "tests/work-monitor-failures.test.ts";
      const body = rendered(source({
        acceptanceCriteria: [
          "The alteration applies only to the batched branch listing and is cleared after each test, and every other test in that file passes unchanged.",
          `${file} gains a test.`,
          SCOPE_AND_CI(file)
        ],
        validationCommands: [SELF_CHECK]
      }), facts({ changedFiles: [{ status: "M", path: file }], testRun: VITEST }));
      expect(stepOf(body, 3)).toContain(`read the change with \`git diff ${BASE} ${COMMIT}\``);
      expect(stepOf(body, 3)).toContain("a diff never shows that a test passes");
      expect(stepOf(body, 3)).toContain("Any other part of this criterion must show in this step's output.");
      expect(stepOf(body, 3)).not.toContain("shows this criterion holds");
      expect(body).toContain(`pnpm exec vitest run ${file}`);
    });

    it("never pastes a CI or scope claim onto a file's content when the criterion also needs that file read", () => {
      const body = rendered(source({ acceptanceCriteria: ["src/a.ts gains a guard. The change touches only src/a.ts and required CI is green."], validationCommands: [] }), facts({
        changedFiles: [{ status: "M", path: "src/a.ts" }]
      }));
      const step = stepOf(body, 3);
      expect(step).toContain(`inspect \`src/a.ts\` with \`git show ${COMMIT}:src/a.ts\``);
      expect(step).toContain("Showing a file's source never shows that a required check passes or which files changed.");
      expect(step).toContain("The changed-file limit is judged on Step 2's list");
      expect(step).toContain("Whether required CI passes is shown only by Step 5's read of the pull request's required checks.");
      expect(step).not.toContain("shows this criterion holds");
    });

    it("says it has no run when the repository shows no runner, rather than inventing a command", () => {
      const body = rendered(recoverySource, { ...recoveryFacts, testRun: null });
      expect(body).not.toContain("vitest");
      expect(body).not.toContain("Run the candidate's test");
      expect(stepOf(body, 5)).toContain("No step in this plan runs those tests, so it offers no direct proof that they pass.");
      expect(stepOf(body, 6)).toContain("Step 8's output shows each required check passing");
      expect(body).toContain("Every later step except the declared validation only reads Git data or, in Step 8, the pull request's checks on GitHub, and only the declared validation runs candidate code.");
    });

    it("runs a named test file instead of pointing at a validation that does not run it", () => {
      const named = "tests/marker.test.ts";
      const body = rendered(source({ acceptanceCriteria: [`${named} exists and passes.`], validationCommands: [SELF_CHECK] }), facts({
        changedFiles: [{ status: "A", path: named }], testRun: VITEST
      }));
      expect(stepOf(body, 3)).toContain("A named test file passing is shown only by a run, never by its source; Step 5 runs it, and its exit-zero result is that proof.");
      expect(stepOf(body, 3)).not.toContain("the run this plan offers is Step 4");
      expect(body).toContain(`pnpm exec vitest run ${named}`);
    });

    it("takes only paths from criterion text, and only test files that exist at the commit", () => {
      const run = (criterion: string, changedFiles = [{ status: "M", path: "src/a.ts" }], pathExists?: (candidate: string) => boolean) =>
        rendered(source({ acceptanceCriteria: [criterion], validationCommands: [] }), facts({ changedFiles, testRun: VITEST, ...(pathExists ? { pathExists } : {}) }));
      // Absent, deleted, a fixture rather than a test, or a flag-shaped name: no run.
      expect(run("tests/gone.test.ts is deleted.", [{ status: "D", path: "tests/gone.test.ts" }])).not.toContain("vitest");
      expect(run("tests/fixtures/x.json is added.", [{ status: "A", path: "tests/fixtures/x.json" }])).not.toContain("vitest");
      expect(run("-x/y.test.ts is added.", [{ status: "A", path: "-x/y.test.ts" }], () => true)).not.toContain("vitest");
      // A file name is shell-quoted when it needs to be; a backticked command never becomes the run.
      const quoted = run("tests/a b.test.ts gains a test.", [{ status: "A", path: "tests/a b.test.ts" }]);
      expect(quoted).toContain("`pnpm exec vitest run 'tests/a b.test.ts'`");
      expect(run("`rm -rf tests` is never run, and tests/a.test.ts gains a test.", [{ status: "M", path: "tests/a.test.ts" }])).not.toContain("run `rm");
      // A test-passing claim with no named file runs the candidate's own changed test files.
      const fallback = run("Every test passes.", [{ status: "M", path: "tests/a.test.ts" }, { status: "D", path: "tests/b.test.ts" }, { status: "M", path: "src/a.ts" }]);
      expect(fallback).toContain("`pnpm exec vitest run tests/a.test.ts`");
      expect(fallback).not.toContain("vitest run tests/a.test.ts tests/b.test.ts");
    });

    it("calls a run proof only when it covers what the criterion names", () => {
      const tests = (...paths: string[]) => paths.map((file) => ({ status: "M", path: file }));
      const run = (acceptanceCriteria: string[], changedFiles: Array<{ status: string; path: string }>, pathExists?: (candidate: string) => boolean) =>
        rendered(source({ acceptanceCriteria, validationCommands: [] }), facts({ changedFiles, testRun: VITEST, ...(pathExists ? { pathExists } : {}) }));
      const NO_CLAIM = "This plan cannot tell whether that covers what this criterion means, so it claims no proof: judge that from the run.";

      // The review's case: another criterion names a file the candidate must not edit. The run covers both; neither is called proof.
      const wrongFile = run(["Do not edit tests/old.test.ts.", "Every other test in the changed file passes unchanged."], tests("tests/new.test.ts"), (candidate) => ["tests/old.test.ts", "tests/new.test.ts"].includes(candidate));
      expect(stepOf(wrongFile, 4)).toContain(`Step 6 runs \`tests/old.test.ts\`, \`tests/new.test.ts\`. ${NO_CLAIM}`);
      expect(stepOf(wrongFile, 4)).not.toContain("that proof");
      expect(wrongFile).toContain("`pnpm exec vitest run tests/old.test.ts tests/new.test.ts`");
      // "the changed file" is never tied to a file the candidate did not change.
      const unchangedOnly = run(["Do not edit tests/old.test.ts.", "Every other test in the changed file passes unchanged."], tests("src/a.ts"), (candidate) => ["tests/old.test.ts", "src/a.ts"].includes(candidate));
      expect(stepOf(unchangedOnly, 4)).toContain(NO_CLAIM);

      // The review's other case: six changed test files all run, and no exit zero is called the proof of "all tests".
      const six = ["a", "b", "c", "d", "e", "f"].map((name) => `tests/${name}.test.ts`);
      const all = run(["All tests pass."], tests(...six));
      expect(all).toContain(`\`pnpm exec vitest run ${six.join(" ")}\``);
      expect(stepOf(all, 3)).toContain(NO_CLAIM);
      // Even a single changed file: "all tests" is more than the file.
      expect(stepOf(run(["All tests pass."], tests("tests/a.test.ts")), 3)).toContain(NO_CLAIM);
      expect(stepOf(run(["The full suite passes."], tests("tests/a.test.ts")), 3)).toContain(NO_CLAIM);

      // Tied: the one file the plan can mean, or a file the criterion names itself.
      for (const criteria of [["tests/a.test.ts gains a test.", "Every other test in that file passes unchanged."], ["Every other test in the changed file passes unchanged."]]) {
        expect(run(criteria, tests("tests/a.test.ts")), criteria[0]).toContain("which runs `tests/a.test.ts`: its exit-zero result is that proof.");
      }
      // "That file" is wording: a run of some other file is no proof when the file the Action names is gone, or none is named.
      const namedIsGone = run(["tests/old.test.ts gains a test.", "Every other test in that file passes unchanged."], tests("tests/new.test.ts"), (candidate) => candidate === "tests/new.test.ts");
      expect(namedIsGone).toContain("`pnpm exec vitest run tests/new.test.ts`");
      expect(stepOf(namedIsGone, 4)).toContain(`Step 6 runs \`tests/new.test.ts\`. ${NO_CLAIM}`);
      expect(stepOf(namedIsGone, 4)).not.toContain("that proof");
      const changedIsGone = run(["tests/old.test.ts gains a test.", "Every other test in the changed file passes unchanged."], tests("tests/new.test.ts"), (candidate) => candidate === "tests/new.test.ts");
      expect(stepOf(changedIsGone, 4)).toContain(NO_CLAIM);
      expect(stepOf(run(["Every other test in that file passes unchanged."], tests("tests/a.test.ts")), 3)).toContain(NO_CLAIM);
      const twoFiles = run(["Every other test in that file passes unchanged."], tests("tests/a.test.ts", "tests/b.test.ts"));
      expect(stepOf(twoFiles, 3)).toContain(NO_CLAIM);
      const namesBoth = run(["tests/a.test.ts and tests/b.test.ts exist and pass."], tests("tests/a.test.ts", "tests/b.test.ts"));
      expect(stepOf(namesBoth, 3)).toContain("Step 5 runs it, and its exit-zero result is that proof.");
      // A named test file the run cannot cover is not called proved by it.
      const notCovered = run(["tests/a.test.ts and tests/b.mjs exist and pass."], tests("tests/a.test.ts", "tests/b.mjs"));
      expect(stepOf(notCovered, 3)).not.toContain("Step 5 runs it");
    });

    it("never says an output shows a criterion holds, for a criterion it cannot recognize either", () => {
      for (const criterion of ["The test fails without the fix and passes with it.", "The full suite passes.", "MARKER.md exists.", "The scan result equals the baseline."]) {
        const body = rendered(source({ acceptanceCriteria: [criterion], validationCommands: [] }), facts());
        expect(body, criterion).not.toMatch(/shows? (?:that )?(?:this|the) criterion holds/);
        expect(body, criterion).not.toContain("that proof");
      }
      expect(rendered(source({ acceptanceCriteria: ["The test fails without the fix and passes with it."], validationCommands: [] }), facts()))
        .toContain("any part it cannot show, such as a run's result, stays unproven by this step.");
    });

    it("names the branch for the checks step, since the first render has no pull request yet, and quotes it", () => {
      const body = rendered(source({ acceptanceCriteria: ["Required CI passes."], validationCommands: [] }), facts({ branch: "claude/x`$(touch y)" }));
      expect(body).toContain("``gh pr checks 'claude/x`$(touch y)' --required``");
    });

    it("keeps the ordinary wording, and adds no step, for wording that claims none of this", () => {
      for (const criterion of [
        "The test passes a stub to `parse`.",
        "A test does not pass an empty list.",
        "The new test never passes on the old tree.",
        "Every test passes on main but fails on the candidate.",
        "The CI workflow gains a lint job.",
        "`.github/workflows/ci.yml` does not require CI to pass for drafts.",
        "The function changes only the timestamp.",
        "MARKER.md has no other content."
      ]) {
        const body = rendered(source({ acceptanceCriteria: [criterion], validationCommands: [] }), facts({
          changedFiles: [{ status: "M", path: "tests/a.test.ts" }], testRun: VITEST
        }));
        expect(body, criterion).toContain("Compare that output with this criterion");
        expect(body, criterion).not.toContain("gh pr checks");
        expect(body, criterion).not.toContain("Run the candidate's test");
      }
    });

    it("gives a command the criterion assigns to required CI that proof, not a statement that none exists", () => {
      const body = rendered(source({ acceptanceCriteria: ["`pnpm lint` passes in required CI."], validationCommands: [SELF_CHECK] }), facts());
      expect(stepOf(body, 3)).toContain("Whether required CI passes is shown only by Step 5's read");
      expect(stepOf(body, 3)).not.toContain("no direct proof");
    });

    it("reads the runner from the candidate's own manifest, and names none it cannot see", () => {
      const manifest = (fields: object) => JSON.stringify({ name: "x", ...fields });
      const has = (...paths: string[]) => (candidate: string) => paths.includes(candidate);
      const vitest = { devDependencies: { vitest: "^4.1.0" } };
      expect(detectTestRun(manifest({ ...vitest, packageManager: "pnpm@11.7.0" }), has("scripts/bridge-worktree-deps.mjs"))).toEqual({ setup: "bridge", runner: "pnpm exec vitest run" });
      expect(detectTestRun(manifest(vitest), has("pnpm-lock.yaml"))).toEqual({ setup: "install", runner: "pnpm exec vitest run" });
      expect(detectTestRun(manifest(vitest), has())).toBeNull();
      expect(detectTestRun(manifest({ packageManager: "pnpm@11.7.0" }), has())).toBeNull();
      expect(detectTestRun("{not json", has("pnpm-lock.yaml"))).toBeNull();
      expect(detectTestRun("null", has("pnpm-lock.yaml"))).toBeNull();
      expect(detectTestRun(null, has("pnpm-lock.yaml"))).toBeNull();
      const installed = rendered(source({ acceptanceCriteria: ["tests/a.test.ts gains a test."], validationCommands: [] }), facts({
        changedFiles: [{ status: "A", path: "tests/a.test.ts" }], testRun: { setup: "install", runner: "pnpm exec vitest run" }
      }));
      expect(installed).toContain("run `pnpm install --frozen-lockfile` to install dependencies in this throwaway worktree; then run `pnpm exec vitest run tests/a.test.ts`.");
    });
  });

  it("builds its source only from the bound Action definition and declared commands", () => {
    expect(operatorQaPlanSource({ actionKey: "p/a", action: undefined, validationCommands: undefined })).toEqual({
      kind: "action-acceptance", actionKey: "p/a", actionTitle: null, acceptanceCriteria: [], validationCommands: []
    });
    expect(operatorQaPlanSource({
      actionKey: "p/a",
      action: { title: "T", acceptanceCriteria: ["one", 2, "two"] },
      validationCommands: ["pnpm test", null]
    })).toEqual({ kind: "action-acceptance", actionKey: "p/a", actionTitle: "T", acceptanceCriteria: ["one", "two"], validationCommands: ["pnpm test"] });
  });
});

describe("host preservation's plan facts", () => {
  it("reads the test runner from the candidate commit, not the working tree", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "operator-qa-plan-"));
    try {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8" }).trim();
      git("init", "-q", "-b", "main");
      writeFileSync(path.join(repo, "README.md"), "base\n");
      git("add", ".");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      mkdirSync(path.join(repo, "tests"));
      writeFileSync(path.join(repo, "tests/a.test.ts"), "// test\n");
      writeFileSync(path.join(repo, "package.json"), JSON.stringify({ devDependencies: { vitest: "^4.1.0" }, packageManager: "pnpm@11.7.0" }));
      git("add", ".");
      git("commit", "-qm", "candidate");
      const commitSha = git("rev-parse", "HEAD");
      rmSync(path.join(repo, "package.json"));
      const plan = (commit: string) => renderPreservedOperatorQaPlan(source({ acceptanceCriteria: ["tests/a.test.ts gains a test."], validationCommands: [] }), {
        repositoryPath: repo, branch: "claude/x", baseBranch: "main", baseRevision: base, commitSha: commit
      }).body;
      expect(plan(commitSha)).toContain("then run `pnpm exec vitest run tests/a.test.ts`.");
      expect(plan(commitSha)).toContain("run `pnpm install --frozen-lockfile` to install dependencies");
      // A candidate whose manifest shows no runner gets no run step.
      git("add", "-A");
      git("commit", "-qm", "no manifest");
      expect(plan(git("rev-parse", "HEAD"))).not.toContain("vitest");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
