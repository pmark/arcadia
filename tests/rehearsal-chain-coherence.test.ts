import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocs } from "../src/docs/discover.js";
import { chainActionIds, renderChainPlan, renderChainProject, ChainPlanError, type ChainRunParams } from "../src/operatorActions/rehearsalChain.js";
import { capitalNumberWord, chainCoherenceProblems, coherenceFilePaths, numberWord, readCoherenceFiles, type CoherenceFile } from "../src/operatorActions/rehearsalChainCoherence.js";

/**
 * The fixture-coherence guard and the renderings it protects (run 7's Action 1
 * failed QA on a real "Managed documents" finding: the fixture PROJECT.md said
 * "three dependent Actions" and its Plan was titled "Autonomous three-Action
 * rehearsal" beside Action text saying "Action 1 of 9").
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const run7Fixture = path.join(import.meta.dirname, "fixtures", "rehearsal-chain", "run7-f478438");
const PLAN_FILE = "docs/plans/autonomous-three-action-rehearsal.md";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const RUN8 = JSON.parse(readFileSync(path.join(library, "rehearsal-chain", "params", "run8-2026-10-06.json"), "utf8")) as ChainRunParams;
const params = (actionCount: number, runId = "run8-2026-10-06", runLabel = "run 8"): ChainRunParams => ({ ...RUN8, actionCount, runId, runLabel });

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

/** G1's genesis, rendered from G1's own heredocs (what run 1 to run 5 started from). */
function g1Genesis(): CoherenceFile[] {
  const directory = temp("coherence-g1-");
  const script = readFileSync(path.join(library, `${G1}.sh`), "utf8");
  const constants = script.slice(0, script.indexOf('case "${1:-run}" in')).split("\n").filter((line) => /^[A-Z_]+=/.test(line) && !line.includes("$(")).join("\n");
  const end = "} # end render_fixture";
  const start = script.indexOf("render_fixture() {");
  const program = [constants, 'REPO="pmark/arcadia-three-action-rehearsal-t1"', "FIXTURE_DATE=2026-10-04", script.slice(start, script.indexOf(end) + end.length), `render_fixture ${JSON.stringify(directory)}`].join("\n");
  const run = spawnSync("bash", ["-c", program], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return readCoherenceFiles(directory);
}
const fileOf = (files: CoherenceFile[], file: string) => files.find((entry) => entry.path === file)!;
const withFile = (files: CoherenceFile[], file: string, text: string) => files.map((entry) => entry.path === file ? { ...entry, text } : entry);

/** The fixture exactly as run 7's reset left it on GitHub main (f478438a): its PROJECT.md and Plan (the files that carried the contradiction), plus G1's untouched guidance files. */
function run7State(): CoherenceFile[] {
  const genesis = g1Genesis();
  return [
    fileOf(genesis, "AGENTS.md"), fileOf(genesis, "CONSTITUTION.md"),
    { path: "PROJECT.md", text: readFileSync(path.join(run7Fixture, "PROJECT.md.txt"), "utf8") },
    { path: PLAN_FILE, text: readFileSync(path.join(run7Fixture, "autonomous-three-action-rehearsal.md.txt"), "utf8") }
  ];
}
const lineNumbers = (problems: string[]) => problems.map((problem) => { const [file, line] = problem.split(":"); return `${file}:${line}`; });

describe("number words", () => {
  it("renders 1 to 12 and refuses anything else", () => {
    expect([1, 3, 9, 12].map(numberWord)).toEqual(["one", "three", "nine", "twelve"]);
    expect(capitalNumberWord(9)).toBe("Nine");
    expect(() => numberWord(13)).toThrow();
    expect(() => numberWord(0)).toThrow();
  });
});

describe("the coherence guard refuses a stated Action count other than N", () => {
  const nine = (text: string) => chainCoherenceProblems([{ path: "docs/x.md", text }], 9);
  it.each([
    ["three-Action", "Run the bounded three-Action rehearsal", 3],
    ["three dependent Actions", "Demonstrate three dependent Actions preserved, independently reviewed.", 3],
    ["Three serial Actions", "Disposable fixture Plan. Three serial Actions, each preserved to a draft pull", 3],
    ["a digit count", "token_budget: 3 trivial file-edit Actions in one serial chain", 3],
    ["a wrapped phrase", "Disposable fixture Plan. Three serial\nActions, each preserved", 3],
    ["a hyphenated digit", "A 3-Action rehearsal.", 3],
    ["Action k of M with another total", "(rehearsal run 7, run id run7-2026-10-06, Action 1 of 3 in one serial chain; earlier attempts stay)", 3],
    ["an Action beyond the chain", "Action 10 of 9 in one serial chain", 0],
    ["coding Sessions", "model use is bounded to the 3 coding Sessions and their two independent reviews each.", 3]
  ])("%s", (_label, text, stated) => {
    const problems = nine(text);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^docs\/x\.md:\d+: /);
    expect(problems[0]).toContain(text.split("\n")[0].slice(0, 20));
    if (stated > 0) expect(problems[0]).toContain(` ${stated} `);
  });
  it("names the file, the line and the text", () => {
    const problems = chainCoherenceProblems([{ path: "PROJECT.md", text: "---\nfoo: bar\noutcome: Demonstrate three dependent Actions preserved.\n---\n" }], 9);
    expect(problems).toEqual(['PROJECT.md:3: states 3 Actions but this run\'s chain has 9 ("three dependent Actions"): outcome: Demonstrate three dependent Actions preserved.']);
  });
  it.each([
    ["an Action id", "depends_on: [chain-step-04]\n  - id: chain-step-09"],
    ["the project slug", "slug: three-action-rehearsal\nproject: three-action-rehearsal\nactive_plan: autonomous-three-action-rehearsal"],
    ["a queue key", "three-action-rehearsal/chain-step-04"],
    ["the fixture manifest and repository names", ".arcadia-three-action-rehearsal.json pmark/arcadia-three-action-rehearsal-20261004"],
    ["the genesis check's marker lines", 'exactly the line "three-action rehearsal start" and "THREE-ACTION REHEARSAL START" then "three-action rehearsal verified"'],
    ["chain step 04's marker", 'exactly the line "chain step 04 follows three-action rehearsal verified" plus a trailing newline'],
    ["the registered Project name", "name: Three Action Rehearsal\n# Three Action Rehearsal"],
    ["an earlier run's note with this run's total", "(rehearsal run 7, run id run7-2026-10-06, Action 1 of 9 in one serial chain; earlier attempts and candidates stay as evidence)"],
    ["the right count", "Disposable fixture Plan. Nine serial Actions; 9 trivial file-edit Actions; the 9 coding Sessions; a nine-Action chain; Action 9 of 9"],
    ["counts of other things", "assert all three lines in order; its two independent reviews each; one line per chain step from 04 to 09 in step order; appending one line to CHAIN.md"],
    ["the genesis check sentence", "The genesis check node scripts/check-rehearsal.mjs passes."]
  ])("does not flag %s", (_label, text) => {
    expect(nine(text)).toEqual([]);
  });
  it("is N-aware: the same text is coherent for exactly its own N", () => {
    const text = "Disposable fixture proving three serial Actions run unattended; Action 2 of 3";
    expect(chainCoherenceProblems([{ path: "x.md", text }], 3)).toEqual([]);
    expect(chainCoherenceProblems([{ path: "x.md", text }], 9)).toHaveLength(2);
    expect(() => chainCoherenceProblems([], 0)).toThrow();
  });
  it("reads PROJECT.md, AGENTS.md, CONSTITUTION.md and every Markdown file under docs/, and nothing else", () => {
    const root = temp("coherence-files-");
    for (const file of ["PROJECT.md", "AGENTS.md", "CONSTITUTION.md", "README.md", "docs/plans/a.md", "docs/notes/deep/b.md", "docs/plans/c.txt", "scripts/check-rehearsal.mjs"]) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), "x\n");
    }
    expect(coherenceFilePaths(root)).toEqual(["PROJECT.md", "AGENTS.md", "CONSTITUTION.md", "docs/notes/deep/b.md", "docs/plans/a.md"]);
  });
});

describe("G1's own genesis (N=3) is coherent and renders coherently", () => {
  it("is coherent for N=3 (marker lines, slugs and the Project name are not counts) and refuses N=9 with file, line and text", () => {
    const genesis = g1Genesis();
    expect(chainCoherenceProblems(genesis, 3)).toEqual([]);
    const refused = chainCoherenceProblems(genesis, 9);
    const where = [...new Set(lineNumbers(refused))];
    for (const expected of ["PROJECT.md:7", "PROJECT.md:8", "PROJECT.md:9", "PROJECT.md:17"]) expect(where).toContain(expected);
    expect(where.filter((entry) => entry.startsWith(PLAN_FILE)).length).toBeGreaterThanOrEqual(4);
    expect(refused).toContain("PROJECT.md:8: states 3 Actions but this run's chain has 9 (\"three dependent Actions\"): outcome: Demonstrate three dependent Actions preserved, independently reviewed and integrated by the production tick; delete after recorded review.");
    // Only statements of the chain's size are named: never an Action id, slug, marker line or the Project's name.
    expect(refused.some((problem) => /write-start-marker|three-action rehearsal start|THREE-ACTION REHEARSAL|chain-step/.test(problem.split(": ").slice(1, 2).join()))).toBe(false);
  });
  it("N=3: the chain render keeps G1's PROJECT.md byte for byte and leaves the Plan coherent for 3", () => {
    const genesis = g1Genesis();
    const project = renderChainProject(fileOf(genesis, "PROJECT.md").text, params(3), "2026-10-07");
    expect(project).toMatchObject({ changed: false, projectUpdatedBefore: "2026-10-04" });
    expect(project.project).toBe(fileOf(genesis, "PROJECT.md").text);
    const plan = renderChainPlan(fileOf(genesis, PLAN_FILE).text, params(3), "2026-10-07");
    expect(plan.plan).toContain("# Autonomous three-Action rehearsal chain");
    expect(plan.plan).toContain("milestone: Run the bounded three-Action rehearsal");
    expect(plan.plan).toContain("token_budget: 3 trivial file-edit Actions in one serial chain; model use is bounded to the 3 coding Sessions");
    expect(chainCoherenceProblems(withFile(genesis, PLAN_FILE, plan.plan), 3)).toEqual([]);
  });
  it("N=9: the chain render states nine everywhere, keeps the pointer and status fields, and passes the guard for 9 (and refuses 3)", () => {
    const genesis = g1Genesis();
    const project = renderChainProject(fileOf(genesis, "PROJECT.md").text, params(9), "2026-10-07");
    const plan = renderChainPlan(fileOf(genesis, PLAN_FILE).text, params(9), "2026-10-07");
    const amended = withFile(withFile(genesis, "PROJECT.md", project.project), PLAN_FILE, plan.plan);
    expect(project.changed).toBe(true);
    expect(chainCoherenceProblems(amended, 9)).toEqual([]);
    expect(chainCoherenceProblems(amended, 3).length).toBeGreaterThan(9);
    expect(plan.actions.map((action) => action.id)).toEqual(chainActionIds(9));
  });
});

describe("run 7's actual fixture state at f478438 (the state run 8's reset starts from)", () => {
  it("the guard refuses it for N=9, naming exactly the PROJECT.md and Plan statements run 7's QA flagged, and nothing else", () => {
    const refused = chainCoherenceProblems(run7State(), 9);
    expect(refused.length).toBeGreaterThan(0);
    expect(lineNumbers(refused)).toEqual([
      "PROJECT.md:7", "PROJECT.md:8", "PROJECT.md:9", "PROJECT.md:17", `${PLAN_FILE}:7`, `${PLAN_FILE}:145`, `${PLAN_FILE}:147`
    ]);
    expect(refused[1]).toBe('PROJECT.md:8: states 3 Actions but this run\'s chain has 9 ("three dependent Actions"): outcome: Demonstrate three dependent Actions preserved, independently reviewed and integrated by the production tick; delete after recorded review.');
    expect(refused[5]).toBe(`${PLAN_FILE}:145: states 3 Actions but this run's chain has 9 ("three-Action"): # Autonomous three-Action rehearsal`);
    // Run 7's Action text ("Action 1 of 9", the nine "9 trivial file-edit Actions" budget, marker lines, chain-step ids) is coherent for 9 and is never named.
    expect(refused.some((problem) => problem.includes("Action 1 of 9") || problem.includes("token_budget") || problem.includes("chain-step"))).toBe(false);
    // It stated 9 in its Actions and 3 elsewhere: for N=3 the Action text is what contradicts.
    expect(chainCoherenceProblems(run7State(), 3).join("\n")).toContain("states a total of 9 Actions but this run's chain has 3");
  });
  it("the run-8 render of that state is coherent for 9: PROJECT.md pointer and status fields untouched, only the size statements and date change", () => {
    const state = run7State();
    const project = renderChainProject(fileOf(state, "PROJECT.md").text, params(9), "2026-10-06");
    const plan = renderChainPlan(fileOf(state, PLAN_FILE).text, params(9), "2026-10-06");
    expect(project).toMatchObject({ changed: true, projectUpdatedBefore: "2026-10-04" });
    const before = fileOf(state, "PROJECT.md").text.split("\n");
    const after = project.project.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.map((line, i) => [before[i], line] as const).filter(([b, a]) => a !== b).map(([, a]) => a);
    expect(changed).toEqual([
      "goal: Disposable fixture proving nine serial Actions run unattended from one bounded production Grant.",
      "outcome: Demonstrate nine dependent Actions preserved, independently reviewed and integrated by the production tick; delete after recorded review.",
      "milestone: Run the bounded nine-Action rehearsal",
      "updated: 2026-10-06",
      "Disposable fixture for the installed nine-Action autonomous rehearsal."
    ]);
    for (const kept of ["slug: three-action-rehearsal", "name: Three Action Rehearsal", "status: active", "active_plan: autonomous-three-action-rehearsal", "current_action: write-start-marker"]) expect(project.project).toContain(`\n${kept}\n`);
    // The Plan changes its milestone, title, body and every next_action (a fresh run note), nothing else but the date.
    const planBefore = fileOf(state, PLAN_FILE).text.split("\n");
    const planAfter = plan.plan.split("\n");
    expect(planAfter).toHaveLength(planBefore.length);
    const planChanged = planAfter.map((line, i) => [planBefore[i], line] as const).filter(([b, a]) => a !== b).map(([, a]) => a.startsWith("    next_action: ") ? "next_action" : a);
    // Run 7 already rendered the token budget and the date (2026-10-06), so only the milestone, every next_action's fresh run note, the title and the body paragraph change.
    expect(planChanged).toEqual([
      "milestone: Run the bounded nine-Action rehearsal", ...Array<string>(9).fill("next_action"), "# Autonomous nine-Action rehearsal chain", "Disposable fixture Plan. Nine serial Actions, each preserved to a draft pull"
    ]);
  });
  it("renders a tree Arcadia's own discovery accepts, coherent for 9, with the pointer at write-start-marker", () => {
    const state = run7State();
    const project = renderChainProject(fileOf(state, "PROJECT.md").text, params(9), "2026-10-06");
    const plan = renderChainPlan(fileOf(state, PLAN_FILE).text, params(9), "2026-10-06");
    const amended = withFile(withFile(state, "PROJECT.md", project.project), PLAN_FILE, plan.plan);
    expect(chainCoherenceProblems(amended, 9)).toEqual([]);
    const root = temp("coherence-amended-");
    for (const file of amended) {
      mkdirSync(path.dirname(path.join(root, file.path)), { recursive: true });
      writeFileSync(path.join(root, file.path), file.text);
    }
    const discovered = discoverDocs(root);
    expect(discovered.errors).toEqual([]);
    const projectDoc = discovered.docs.find((doc) => doc.type === "project");
    expect(projectDoc).toMatchObject({ slug: "three-action-rehearsal", activePlan: "autonomous-three-action-rehearsal", currentAction: "write-start-marker", milestone: "Run the bounded nine-Action rehearsal", status: "active" });
    const planDoc = discovered.docs.find((doc) => doc.type === "plan");
    expect(planDoc).toMatchObject({ slug: "autonomous-three-action-rehearsal", milestone: "Run the bounded nine-Action rehearsal" });
  });
  it("renders idempotently and refuses a reset date before PROJECT.md's own date", () => {
    const state = run7State();
    const once = renderChainProject(fileOf(state, "PROJECT.md").text, params(9), "2026-10-06");
    const twice = renderChainProject(once.project, params(9, "run9-2026-10-07", "run 9"), "2026-10-07");
    expect(twice).toMatchObject({ changed: false, project: once.project });
    expect(() => renderChainProject(fileOf(state, "PROJECT.md").text, params(9), "2026-10-03")).toThrow(expect.objectContaining({ reason: "RESET_DATE_BEFORE_PROJECT" }));
    expect(() => renderChainProject("no front matter", params(9), "2026-10-06")).toThrow(ChainPlanError);
    expect(() => renderChainProject(fileOf(state, "PROJECT.md").text.replace(/^goal: .*\n/m, ""), params(9), "2026-10-06")).toThrow(expect.objectContaining({ reason: "PROJECT_FIELD" }));
  });
  it("a base body paragraph the renderer does not know is left alone, so the guard (not the renderer) refuses it", () => {
    const state = run7State();
    const odd = fileOf(state, "PROJECT.md").text.replace("Disposable fixture for the installed three-Action autonomous rehearsal.", "This is the three-Action rehearsal, installed on the host.");
    const project = renderChainProject(odd, params(9), "2026-10-06");
    expect(project.project).toContain("This is the three-Action rehearsal, installed on the host.");
    expect(chainCoherenceProblems([{ path: "PROJECT.md", text: project.project }], 9).map((problem) => problem.split(":").slice(0, 2).join(":"))).toEqual(["PROJECT.md:17"]);
  });
});
