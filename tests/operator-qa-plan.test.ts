import { describe, expect, it } from "vitest";
import {
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
    expect(body).toContain("- **Expected:** `od -c` shows every byte (a newline as `\\n`); `grep -Fxn` prints each quoted text that is a whole line with its line number, and nothing when no line matches; and that output shows this criterion holds, exactly as worded: “MARKER.md exists and contains exactly the line \"three-action rehearsal start\" followed by a trailing newline.”");
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
    expect(body).toContain(`- **Do:** read the change with \`git diff ${BASE} ${COMMIT}\`.\n- **Expected:** the diff shows what changed. That is all this inspection shows: a diff never shows that a command passes. This plan runs no command taken from criterion text; the only proof of passing it offers is Step 6, the Project's declared validation, where \`echo $?\` prints \`0\` after each declared command. The criterion, exactly as worded: “\\\`pnpm test\\\` passes.”`);
    expect(body).toContain("Whether it passes is proven only by Step 6, the Project's declared validation: `echo $?` immediately after `node scripts/check-rehearsal.mjs` prints `0`. The criterion, exactly as worded: “tests/marker.test.mjs exists and passes");
    expect(body).not.toContain("that output shows this criterion holds, exactly as worded: “tests/marker.test.mjs");
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
      "- **Expected:** the file content is shown. That is all this inspection shows: that `scripts/check-rehearsal.mjs` exists at the candidate commit and what it contains. Showing a file's source never shows that a command passes. Whether it passes is proven only by Step 5, the Project's declared validation: `echo $?` immediately after `node scripts/check-rehearsal.mjs` prints `0`. The criterion, exactly as worded: “The genesis check node scripts/check-rehearsal.mjs passes.”",
      "",
      ""
    ].join("\n"));
    // Criterion 1 is not a check: its wording is unchanged.
    expect(body).toContain("and that output shows this criterion holds, exactly as worded: “MARKER.md exists and contains exactly the line");
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
      expect(expected).toMatch(validationCommands.length > 0 ? /Step 4, the Project's declared validation/ : /offers no proof that it passes/);
    }
    expect(rendered(source({ acceptanceCriteria: ["`pnpm lint` succeeds."], validationCommands: ["pnpm lint", "pnpm test"] })))
      .toContain("Whether it passes is proven only by Step 4, the Project's declared validation: `echo $?` immediately after `pnpm lint` prints `0`.");
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
      "- **Expected:** the diff shows what changed; and that output shows this criterion holds, exactly as worded: “Line one ## Injected heading - \\[x\\] fake \\<script\\>alert(1)\\</script\\> \\`cmd\\` ping @\u200boperator \\&amp; \\| table \\|”"
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
