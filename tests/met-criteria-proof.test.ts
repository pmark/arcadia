import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { metCriteriaProblems, metCriteriaProofRefusal } from "../src/sessions/contradictedCriteria.js";
import { CHECKS_VERIFIED_ELSEWHERE_NOTE } from "../src/sessions/actionBrief.js";

// PRs #2948 and #2950: the worker's real completion Ask evidence, saved verbatim, marked every criterion met while
// nothing called the new module (#2948) or nothing scheduled the new script (#2950).
type Evidence = Array<{ criterion: string; status: string; note: string | null }>;
const fixture = (name: string): Evidence =>
  (JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", "met-criteria-proof", name), "utf8")) as { evidence: Evidence }).evidence;

const entry = (note: string | null, status = "met", criterion = "The script is scheduled on the host timer.") => ({ criterion, status, note });
const TEST_FILE_TEXT = [
  'describe("park and continue", () => {',
  '  it("parks Action a and admits the next independent Action d", () => {});',
  "});"
].join("\n");
const reader = (files: Record<string, string>) => (file: string): string | null => files[file] ?? null;

describe("met-criterion proof check on the real completion Asks", () => {
  it("refuses #2950's completion: the note itself says 'Not done here' for scheduling and supersession", () => {
    const evidence = fixture("pr2950-completion-ask.json");
    const problems = metCriteriaProblems(evidence);
    expect(problems).toEqual([{ criterion: evidence[0]?.criterion, kind: "incomplete", phrase: "Not done here" }]);
    const reason = metCriteriaProofRefusal(evidence);
    expect(reason).toContain("A check on every push to main fails loudly");
    expect(reason).toContain('its own note says "Not done here"');
    expect(reason).toContain("do that work and say so, or mark the criterion skipped or failed");
  });

  it("refuses #2948's completion: every criterion is marked met on 'I inspected the code' with no test title or result", () => {
    const evidence = fixture("pr2948-completion-ask.json");
    expect(evidence).toHaveLength(5);
    const problems = metCriteriaProblems(evidence);
    expect(problems.map((problem) => problem.kind)).toEqual(Array(5).fill("unproved"));
    expect(problems.map((problem) => problem.criterion)).toEqual(evidence.map((item) => item.criterion));
    const reason = metCriteriaProofRefusal(evidence);
    expect(reason).toContain("is marked met on inspection");
    expect(reason).toContain("a test file plus the quoted title of the test in it");
    expect(reason).toContain("a command you ran with its result");
    expect(reason).toContain("a receipt id, a commit id, or a pull request number");
  });

  it("settles #2948's evidence once each note names the test file and the quoted title of a test in it", () => {
    const evidence = fixture("pr2948-completion-ask.json").map((item) => ({
      ...item,
      note: `${item.note} Test: tests/park-and-continue.test.ts "parks Action a and admits the next independent Action d".`
    }));
    const read = reader({ "tests/park-and-continue.test.ts": TEST_FILE_TEXT });
    expect(metCriteriaProofRefusal(evidence, { readFileAtRevision: read })).toBeNull();
  });
});

describe("not-done markers", () => {
  it.each([
    ["Not done here: scheduling the script on the host timer. This must follow.", "Not done here"],
    ["The script is written; nothing schedules it yet.", "nothing schedules"],
    ["The module is complete but has no callers in src.", "no callers"],
    ["The function is not wired into the tick.", "not wired"],
    ["Added it; not yet scheduled on the timer.", "not yet scheduled"],
    ["Added the module. Wiring it is a follow-up.", "follow-up"],
    ["Written; left as a followup for the next Action.", "followup"]
  ])("refuses a met note %j with the exact phrase", (note, phrase) => {
    const reason = metCriteriaProofRefusal([entry(note)]);
    expect(reason).toContain("The script is scheduled on the host timer.");
    expect(reason).toContain(`its own note says "${phrase}"`);
    expect(reason).toContain("mark the criterion skipped or failed");
  });

  it("is case-insensitive for 'Not done here' even when the sentence also says must (the #2890 check skips such sentences)", () => {
    expect(metCriteriaProofRefusal([entry("NOT DONE HERE: the timer entry, which must be added.")])).toContain("NOT DONE HERE");
  });

  it("does not refuse denials, comparisons or descriptions of a check", () => {
    for (const note of [
      "Ran tests/x.test.ts: 3 passed. No follow-up is needed.",
      "Ran tests/x.test.ts: 3 passed, without a follow-up.",
      "The old path had no callers before the fix; now the tick calls it. 3 passed.",
      "The test asserts that a module with no importer outside tests fails the check: 2 passed.",
      "Ran pnpm exec vitest run tests/x.test.ts: 4 tests passed; no callers remain of the removed helper."
    ]) {
      expect(metCriteriaProofRefusal([entry(note)]), note).toBeNull();
    }
  });

  it("judges only met entries, so an honest failed or skipped entry may say so", () => {
    expect(metCriteriaProofRefusal([entry("Not done here: nothing schedules it.", "failed"), entry("A follow-up covers it.", "skipped")])).toBeNull();
  });
});

describe("a met criterion that rests on inspection must name a concrete proof", () => {
  const inspected = "I inspected the code in src/production/x.ts";

  it("refuses inspection prose, including the brief's own 'host runs this check' wording, with no proof", () => {
    expect(metCriteriaProofRefusal([entry(inspected)])).toContain("marked met on inspection");
    expect(metCriteriaProofRefusal([entry(`${inspected} and its test; ${CHECKS_VERIFIED_ELSEWHERE_NOTE}`)])).toContain('("inspected")');
    // A test file named without the title of a test in it is not a proof.
    expect(metCriteriaProofRefusal([entry(`${inspected} and added tests/x.test.ts.`)])).toContain("names no proof");
  });

  it("still settles a check only the host or CI runs, in the brief's own words, when the note claims no test", () => {
    expect(metCriteriaProofRefusal([entry(`Inspected git diff; ${CHECKS_VERIFIED_ELSEWHERE_NOTE}`, "met", "pnpm pre-pr passes.")])).toBeNull();
    // The words themselves mention tests; stripping them must leave no test claim, or this exemption would never apply.
    expect(metCriteriaProofRefusal([entry(`${inspected}, the build config; ${CHECKS_VERIFIED_ELSEWHERE_NOTE}`)])).toBeNull();
    // The same words beside a test claim are refused: the host runs only the tests it is told about.
    expect(metCriteriaProofRefusal([entry(`${inspected}; a test covers it. ${CHECKS_VERIFIED_ELSEWHERE_NOTE}`)])).toContain("names no proof");
  });

  it.each([
    ["a command result", `${inspected}; ran pnpm exec vitest run tests/x.test.ts: 1 file, 4 tests passed.`],
    ["a receipt id", `${inspected}; settlement receipt asksettle_0123456789abcdef.`],
    ["a commit id", `${inspected}; landed in commit c7d7fba5f.`],
    ["a pull request", `${inspected}; merged in PR #2945.`]
  ])("accepts %s", (_label, note) => {
    expect(metCriteriaProofRefusal([entry(note)])).toBeNull();
  });

  it("accepts a test file with a quoted title that exists in it at the revision, shape-only when files cannot be read", () => {
    const note = `${inspected}; tests/park.test.ts "parks Action a and admits the next independent Action d".`;
    expect(metCriteriaProofRefusal([entry(note)])).toBeNull();
    expect(metCriteriaProofRefusal([entry(note)], { readFileAtRevision: reader({ "tests/park.test.ts": TEST_FILE_TEXT }) })).toBeNull();
    expect(metCriteriaProofRefusal([entry(note)], { readFileAtRevision: () => { throw new Error("no repository"); } })).toBeNull();
  });

  it("refuses a quoted title that is not in the named file, and a named file that does not exist at the revision", () => {
    const note = `${inspected}; tests/park.test.ts "a test that nobody wrote".`;
    expect(metCriteriaProofRefusal([entry(note)], { readFileAtRevision: reader({ "tests/park.test.ts": TEST_FILE_TEXT }) })).toContain("names no proof");
    expect(metCriteriaProofRefusal([entry(note)], { readFileAtRevision: reader({}) })).toContain("names no proof");
    // A path that climbs out of the repository is never read.
    expect(metCriteriaProofRefusal([entry(`${inspected}; ../x.test.ts "parks Action a and admits"`)], { readFileAtRevision: () => TEST_FILE_TEXT })).toContain("names no proof");
  });

  it("fails open, exactly as before, on notes it cannot classify: empty, or not inspection prose and naming no proof", () => {
    for (const note of [null, "", "   ", "Verified by the agent.", "Verified in the candidate worktree.", "docs/contract.md was produced.", "n"]) {
      expect(metCriteriaProofRefusal([entry(note)]), String(note)).toBeNull();
    }
  });
});
