import { describe, expect, it } from "vitest";
import { renderOperatorQaPlan, type ChangedFile } from "../src/sessions/operatorQaPlan.js";

/**
 * Issue #2324: a path-like string quoted in an acceptance criterion as test
 * input is data, not a file. The criteria below are the real ones from
 * docs/plans/record-run-unattended-test-pins-20261107-part-2.md.
 */
const COMMIT = "766bae651ac230e7153b7393e8489545ecc61b64";
const BASE = "1156b7762f624a0d1f9dc6552028335b27dc9dc7";

const SETTLEMENT: ChangedFile[] = [
  { status: "M", path: "MISSION_LOG.md" },
  { status: "M", path: "PROJECT.md" },
  { status: "M", path: "docs/plans/record-run-unattended-test-pins-20261107-part-2.md" },
  { status: "R", path: ".arcadia/asks/archive/auto-settle.yaml" }
];

const NO_RUN_TAIL = "No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.";

const CASES: { name: string; testFile: string; criteria: string[] }[] = [
  {
    name: "pin-authoritative-control-path",
    testFile: "tests/pin-authoritative-control-path.test.ts",
    criteria: [
      "tests/pin-authoritative-control-path.test.ts is a new test file that imports isAuthoritativeControlPath from ../src/docs/discover.js and asserts isAuthoritativeControlPath returns true for \"PROJECT.md\", \"docs/plans/my-plan.md\", \"docs/decisions/0001-x.md\" and the backslash form \"docs\\\\plans\\\\my-plan.md\".",
      "The same test file asserts isAuthoritativeControlPath returns false for \"docs/notes.md\", \"docs/plan/x.md\", \"project.md\" and \"sub/PROJECT.md\".",
      NO_RUN_TAIL
    ]
  },
  {
    name: "pin-milestone-and-log-doc-refs",
    testFile: "tests/pin-milestone-and-log-doc-refs.test.ts",
    criteria: [
      "tests/pin-milestone-and-log-doc-refs.test.ts is a new test file that imports planMilestoneDocRef and logEntryDocRef from ../src/docs/types.js and asserts planMilestoneDocRef(\"my-plan\", \"Ship It: v2!\") returns \"plan/my-plan?milestone=ship-it-v2\" and planMilestoneDocRef(\"my-plan\", \"!!!\") returns \"plan/my-plan?milestone=milestone\".",
      "The same test file asserts logEntryDocRef(\"mission\", \"2026-07-25\", \"Hello, World\") returns \"log/mission#2026-07-25--hello-world\" and that logEntryDocRef(\"mission\", \"2026-07-25\", \"First\") differs from logEntryDocRef(\"mission\", \"2026-07-25\", \"Second\").",
      NO_RUN_TAIL
    ]
  },
  {
    name: "pin-launch-agent-workspace-arg",
    testFile: "tests/pin-launch-agent-workspace-arg.test.ts",
    criteria: [
      "tests/pin-launch-agent-workspace-arg.test.ts is a new test file that imports launchAgentWorkspace from ../src/runtime/launchAgents.js and asserts launchAgentWorkspace([\"node\", \"arcadia\", \"worker\", \"--workspace\", \"/w/one\"]) returns \"/w/one\".",
      "The same test file asserts launchAgentWorkspace returns null for [\"node\", \"arcadia\"], for [\"--workspace\"], for [\"--workspace\", \"--other\", \"/w\"], for [\"--workspace\", \"\"] and for [\"--workspace=/w/one\"].",
      NO_RUN_TAIL
    ]
  },
  {
    name: "pin-repository-frame-extraction",
    testFile: "tests/pin-repository-frame-extraction.test.ts",
    criteria: [
      "tests/pin-repository-frame-extraction.test.ts is a new test file that imports firstRepositoryFrame from ../src/soak/rehearsalSoak.js and asserts firstRepositoryFrame returns \"src/foo/bar.ts:12\" for a stack whose frames are, in order, node_modules/x/index.js:5:1, src/foo/bar.ts:12:3 and a frame in a file under tests/ whose name ends in .test.ts, at line 7, column 1.",
      "The same test file asserts firstRepositoryFrame(\"at scripts/run.mjs:9:2\") returns \"scripts/run.mjs:9\" and for a stack whose only frame is at line 3, column 1 of a file under tests/ whose name ends in .test.ts, it returns that same path followed by :3.",
      "The same test file asserts firstRepositoryFrame returns null for \"Error: no frames here\", for \"at node_modules/x/index.js:5:1\" and for \"\".",
      NO_RUN_TAIL
    ]
  }
];

function render(testCase: (typeof CASES)[number]): { body: string; changed: string[] } {
  const changedFiles: ChangedFile[] = [{ status: "A", path: testCase.testFile }, ...SETTLEMENT];
  const result = renderOperatorQaPlan({
    kind: "action-acceptance",
    actionKey: `record-run-unattended-test-pins-20261107-part-2/${testCase.name}`,
    actionTitle: testCase.name,
    acceptanceCriteria: testCase.criteria,
    validationCommands: []
  }, { branch: `claude/${testCase.name}`, baseBranch: "main", baseRevision: BASE, commitSha: COMMIT, changedFiles });
  expect(result.status).toBe("rendered");
  return { body: result.body, changed: changedFiles.map((file) => file.path) };
}

describe("Operator QA plan: quoted criterion text that is test data (Issue #2324)", () => {
  for (const testCase of CASES) {
    describe(testCase.name, () => {
      it("never scopes a git diff to a path the patch does not change", () => {
        const { body, changed } = render(testCase);
        for (const line of body.split("\n")) {
          for (const match of line.matchAll(/git diff [0-9a-f]{40} [0-9a-f]{40} -- ([^`]+)`/g)) {
            for (const scoped of match[1].split(" ")) expect(changed, `${scoped} in: ${line}`).toContain(scoped);
          }
        }
        expect(body).not.toMatch(/ -- (?:docs\/notes\.md|docs\/plan\/x\.md|sub\/PROJECT\.md|src\/foo\/bar\.ts|scripts\/run\.mjs)/);
      });

      it("never reads a changed file only quoted as test input, or runs a whole-line grep for it", () => {
        const { body } = render(testCase);
        expect(body).not.toContain("grep -Fxn");
        expect(body).not.toContain(`git show ${COMMIT}:PROJECT.md`);
        // An import specifier such as ../src/docs/discover.js is never shown or diffed.
        expect(body).not.toMatch(/git (?:show [0-9a-f]{40}:|diff [^`]* -- )\S*(?:discover|types|launchAgents|rehearsalSoak)\.js/);
        expect(body).toContain(`git show ${COMMIT}:${testCase.testFile}`);
      });

      it("renders the same bytes every time", () => {
        expect(render(testCase).body).toBe(render(testCase).body);
      });
    });
  }

  it("checks each quoted value against the test file with a fixed-string grep that is honest about its result", () => {
    const { body } = render(CASES[0]);
    const step3 = body.slice(body.indexOf("### Step 3"), body.indexOf("### Step 4"));
    const step4 = body.slice(body.indexOf("### Step 4"), body.indexOf("### Step 5"));
    const show = `git show ${COMMIT}:tests/pin-authoritative-control-path.test.ts`;
    expect(step3).toContain(`\`${show} | grep -Fn -- 'PROJECT.md'\``);
    expect(step3).toContain("prints each line of the file that contains a quoted value, with its line number, and nothing when no line contains it");
    // "The same test file" is the file the earlier criterion names.
    for (const value of ["docs/notes.md", "docs/plan/x.md", "project.md", "sub/PROJECT.md"]) {
      expect(step4).toContain(`\`${show} | grep -Fn -- '${value}'\``);
    }
    expect(step4).not.toContain("git diff");
  });

  it("keeps a quoted command that must pass, and a quoted line a file must contain, as before", () => {
    const result = renderOperatorQaPlan({
      kind: "action-acceptance",
      actionKey: "p/a",
      actionTitle: null,
      acceptanceCriteria: ["MARKER.md contains the line \"hello world\"."],
      validationCommands: []
    }, { branch: "b", baseBranch: "main", baseRevision: BASE, commitSha: COMMIT, changedFiles: [{ status: "A", path: "MARKER.md" }] });
    expect(result.status).toBe("rendered");
    expect(result.body).toContain(`git show ${COMMIT}:MARKER.md | grep -Fxn -- 'hello world'`);
  });

  const plan = (criteria: string[], changedFiles: ChangedFile[]): string => {
    const result = renderOperatorQaPlan({
      kind: "action-acceptance", actionKey: "p/a", actionTitle: null, acceptanceCriteria: criteria, validationCommands: []
    }, { branch: "b", baseBranch: "main", baseRevision: BASE, commitSha: COMMIT, changedFiles });
    expect(result.status).toBe("rendered");
    return result.body;
  };

  it("claims od -c only when the Do line runs it, including on a 'same test file' criterion", () => {
    const testFile = "tests/pin-way-trigger-parsing.test.ts";
    const body = plan([
      `${testFile} is a new test file that asserts parseTrigger returns "go".`,
      "The same test file asserts parseTrigger gives exactly \"stop\" for \"STOP \" and an empty result for \"\".",
      NO_RUN_TAIL
    ], [{ status: "A", path: testFile }]);
    const step4 = body.slice(body.indexOf("### Step 4"), body.indexOf("### Step 5"));
    expect(step4).toContain(`git show ${COMMIT}:${testFile} | od -c`);
    expect(step4).toContain("grep -Fn -- 'stop'");
    // Every od -c the Expected line names is one the Do line runs.
    expect(step4.includes("shows every byte")).toBe(step4.includes("| od -c`"));
  });

  it("does not let an earlier sentence's returns turn a later file-content quote into test input", () => {
    const body = plan(["Helper returns 5. MARKER.md contains the line \"hello world\"."], [{ status: "A", path: "MARKER.md" }]);
    expect(body).toContain(`git show ${COMMIT}:MARKER.md | grep -Fxn -- 'hello world'`);
    expect(body).not.toContain("test input");
  });

  it("lets a contains cue after returns win within one sentence, while a list after returns stays data", () => {
    const body = plan(["src/foo.ts exports f which returns \"bar\" and the file contains \"export const x\"."], [{ status: "M", path: "src/foo.ts" }]);
    expect(body).toContain(`git show ${COMMIT}:src/foo.ts | grep -Fxn -- 'export const x'`);
    // "bar" is test input, but no test file is named, so the step says it does not search for it.
    expect(body).not.toContain("-- 'bar'");
    expect(body).toContain("the values the criterion words as test input (`bar`) are not files");
    const four = plan([
      "tests/t.test.ts asserts f returns false for \"a1\", \"b2\", \"c3\" and \"d4\"."
    ], [{ status: "A", path: "tests/t.test.ts" }]);
    for (const value of ["a1", "b2", "c3", "d4"]) expect(four).toContain(`grep -Fn -- '${value}'`);
    expect(four).not.toContain("grep -Fxn");
  });

  it("greps every test file an earlier criterion names; an import specifier is neither diffed nor shown", () => {
    const unchanged = plan(["src/missing.ts is not created."], [{ status: "M", path: "README.md" }]);
    expect(unchanged).not.toContain("-- src/missing.ts");
    const imports = plan([
      "tests/t.test.ts is a new test file that imports f from ../src/docs/discover.js and asserts f returns \"a1\".",
      "No src/ change is made."
    ], [{ status: "A", path: "tests/t.test.ts" }]);
    expect(imports).not.toMatch(/git diff [0-9a-f]{40} [0-9a-f]{40} --/);
    expect(imports).not.toMatch(/git show [0-9a-f]{40}:\S*discover\.js/);
    expect(imports).not.toContain("is a path the criterion names");
    const two = plan([
      "tests/a.test.ts and tests/b.test.ts are new test files that assert f returns \"x1\".",
      "The same test file asserts f returns \"y2\"."
    ], [{ status: "A", path: "tests/a.test.ts" }, { status: "A", path: "tests/b.test.ts" }]);
    const step4 = two.slice(two.indexOf("### Step 4"));
    expect(step4).toContain(`${COMMIT}:tests/a.test.ts | grep -Fn -- 'y2'`);
    expect(step4).toContain(`${COMMIT}:tests/b.test.ts | grep -Fn -- 'y2'`);
  });
});
