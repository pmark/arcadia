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
  it("renders one criterion as a concrete step bound to the exact Action, commit, base and files", () => {
    const body = rendered();
    expect(body.startsWith("## Operator QA plan\n")).toBe(true);
    expect(body).toContain("- **Action:** `three-action-rehearsal/write-start-marker` — Implement MARKER.md");
    expect(body).toContain(`- **Candidate:** branch \`claude/write-start-marker-20261005T155147519Z\` at commit \`${COMMIT}\``);
    expect(body).toContain(`- **Base:** \`main\` at \`${BASE}\``);
    expect(body).toContain(`git worktree add --detach ../qa-7f1390376f4d ${COMMIT}`);
    expect(body).toContain(`\`git diff --name-status ${BASE} ${COMMIT}\``);
    expect(body).toContain("exactly 1 changed file:\n  - `A` `MARKER.md`");
    expect(body).toContain("### Step 3 — Acceptance criterion 1 of 1");
    expect(body).toContain(`- **Do:** print the exact bytes of \`MARKER.md\` with \`git show ${COMMIT}:MARKER.md | od -c\`; then run \`grep -Fxn -- 'three-action rehearsal start' MARKER.md\`.`);
    expect(body).toContain("- **Expected:** `od -c` shows every byte, a newline as `\\n`, and `grep -Fxn` prints each quoted text that is a whole line");
    expect(body).toContain("### Step 4 — Re-run the declared validation\n\n- **Do:** run `node scripts/check-rehearsal.mjs`.\n- **Expected:** `echo $?` immediately after it prints `0`");
    expect(body).toContain("the operator procedure below is also the end-user procedure");
  });

  it("is deterministic: the same inputs render the same bytes", () => {
    expect(rendered()).toBe(rendered());
  });

  it("renders several criteria in order, with each named command and file", () => {
    const body = rendered(source({
      acceptanceCriteria: [
        "MARKER.md contains exactly the start line followed by \"THREE-ACTION REHEARSAL START\".",
        "tests/marker.test.mjs exists and passes under node --test, asserting both lines appear in order; \"node scripts/check-rehearsal.mjs\" passes.",
        "`pnpm test` passes."
      ]
    }), facts({ changedFiles: [{ status: "M", path: "MARKER.md" }, { status: "A", path: "tests/marker.test.mjs" }] }));
    const steps = [...body.matchAll(/### Step (\d+) — Acceptance criterion (\d) of 3/g)].map((match) => [match[1], match[2]]);
    expect(steps).toEqual([["3", "1"], ["4", "2"], ["5", "3"]]);
    expect(body).toContain(`print the exact bytes of \`tests/marker.test.mjs\` with \`git show ${COMMIT}:tests/marker.test.mjs | od -c\`; then run \`node scripts/check-rehearsal.mjs\`; then run \`node --test\`.`);
    expect(body).toContain("that output is exactly what the criterion as worded above requires; and `echo $?` immediately after each command prints `0`.");
    expect(body).toContain("- **Do:** run `pnpm test`.\n- **Expected:** `echo $?` immediately after the command prints `0`.");
    // The declared validation command already ran in step 4, so it is not repeated.
    expect(body).toContain("### Step 6 — Re-run the declared validation\n\n- **Do:** nothing further: every declared validation command already ran: `node scripts/check-rehearsal.mjs` (step 4).");
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
    expect(body).toContain("- **Surface:** this repository's code at the candidate commit, exercised by the commands below from a local checkout.");
    expect(body).not.toContain("no service, URL or build");
  });

  it("escapes Markdown, HTML and mentions in governed text so a criterion cannot restructure the body", () => {
    const body = rendered(source({
      actionTitle: "Title with **bold** and <img src=x>",
      acceptanceCriteria: ["Line one\n## Injected heading\n- [x] fake <script>alert(1)</script> `cmd` ping @operator &amp; | table |"]
    }));
    const criterionLine = body.split("\n").find((line) => line.startsWith("- **Criterion:**"))!;
    expect(criterionLine).toBe(
      "- **Criterion:** Line one ## Injected heading - \\[x\\] fake \\<script\\>alert(1)\\</script\\> \\`cmd\\` ping @​operator \\&amp; \\| table \\|"
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
