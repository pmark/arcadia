import { classifyAuthorityPaths, type AuthorityBoundary } from "../decisions/batchMerge.js";
import { tryGit } from "../git/worktrees.js";

/**
 * Decision 0098's gate list over a candidate's own change. A leaf module so
 * both the review repair loop and the independent verdict gate (Decision
 * 0169's QA-plan waiver) judge exactly the same list.
 */

/** Paths the candidate's own commits change, with the completion Ask records themselves left out. */
export function agentChangedPaths(repoRoot: string, from: string, to: string): string[] | null {
  const output = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", `${from}...${to}`]);
  if (output === null) return null;
  return output.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith(".arcadia/asks/"));
}

/**
 * Launch-authority and loop code the batch-merge classifier does not name:
 * Decision 0098's gate list includes "launch-authority code" and the code
 * implementing this loop and its gates, so a candidate changing any of it is
 * never repaired unattended. An entry ending in "/" gates the whole tree:
 * every module under `src/sessions/` prepares, launches, briefs, reconciles
 * or settles Sessions.
 */
export const REPAIR_GATED_PATHS: readonly string[] = [
  "src/sessions/",
  "src/production/reviewRepair.ts",
  "src/production/policy.ts",
  "src/production/workerMerge.ts",
  "src/production/independentReview.ts",
  "src/production/candidateChangeGate.ts"
];

export const isRepairGatedPath = (file: string) => REPAIR_GATED_PATHS.some((entry) => entry.endsWith("/") ? file.startsWith(entry) : file === entry);

const TEST_PATH = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
/**
 * A skipped, conditional, focused, to-do or expected-failure test in any of
 * the runners' spellings: a modifier anywhere in a member chain that starts
 * at describe/it/test/suite/bench (`it.skipIf(c)(...)`,
 * `test.concurrent.skip(...)`, `describe.sequential.only(...)`,
 * `test.fails(...)`, `describe.each(...).skip`), the x/f prefixes, and a
 * runtime skip (`ctx.skip()` with or without a condition, `this.skip()`, any
 * bare `.skip()`). A preceding `.` or word character never starts the chain,
 * so a regex `RE.test(x)` is neither a test nor a skip.
 */
const SKIPPED_TEST = /(?<![.\w])(?:describe|it|test|suite|bench)(?:\.\w+|\([^\n]*?\))*\.(?:skip|only|todo|fails|skipIf|runIf)\b|\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(|\bctx\.skip\(|\.skip\(\s*\)/;
/** One test case: `it(`, `test(`, or either with a modifier chain (`it.each(...)(` counts once). */
const TEST_CASE = /(?<![.\w])(?:it|test)(?:\.\w+)*\s*\(/g;
const THRESHOLD_FILE = /(^|\/)(vitest|vite|jest|playwright)\.config\.[cm]?[jt]s$|(^|\/)(package\.json|\.c8rc(\.json)?|\.nycrc(\.json)?|codecov\.ya?ml)$|(^|\/)\.github\//i;
const THRESHOLD_LINE = /threshold|coverage|minimum|maxWorkers|timeout|retries|bail/i;

const countCases = (content: string | null) => (content ?? "").match(TEST_CASE)?.length ?? 0;

/**
 * The rest of Decision 0098's gate list over the candidate's own change
 * (`from...to`): deleted test files, fewer test cases in a surviving test
 * file, an added skip/only/todo/fails/conditional marker, or a changed line
 * about a check threshold in test or CI configuration. Each entry names what
 * it found; unreadable Git is itself a gate.
 */
export function testWeakeningGates(repoRoot: string, from: string, to: string): string[] {
  const reasons: string[] = [];
  const mergeBase = tryGit(repoRoot, ["merge-base", from, to]);
  const deleted = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--diff-filter=D", "--name-only", `${from}...${to}`]);
  const modified = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--diff-filter=M", "--name-only", `${from}...${to}`]);
  const patch = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", "-U0", `${from}...${to}`]);
  if (!mergeBase || deleted === null || modified === null || patch === null) return ["the candidate's diff could not be read"];
  const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
  const deletedTests = lines(deleted).filter((file) => TEST_PATH.test(file));
  if (deletedTests.length > 0) reasons.push(`it deletes test files (${deletedTests.join(", ")})`);
  const fewer = lines(modified).filter((file) => TEST_PATH.test(file)).flatMap((file) => {
    const before = countCases(tryGit(repoRoot, ["show", `${mergeBase}:${file}`]));
    const after = countCases(tryGit(repoRoot, ["show", `${to}:${file}`]));
    return after < before ? [`${file}: ${before} -> ${after}`] : [];
  });
  if (fewer.length > 0) reasons.push(`it removes test cases (${fewer.join(", ")})`);
  let file = "";
  const skipped = new Set<string>();
  const thresholds = new Set<string>();
  for (const line of patch.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) { file = header[1]; continue; }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+") && TEST_PATH.test(file) && SKIPPED_TEST.test(line)) skipped.add(file);
    if ((line.startsWith("+") || line.startsWith("-")) && THRESHOLD_FILE.test(file) && THRESHOLD_LINE.test(line)) thresholds.add(file);
  }
  if (skipped.size > 0) reasons.push(`it adds a skipped or focused test (${[...skipped].join(", ")})`);
  if (thresholds.size > 0) reasons.push(`it changes a check threshold or test/CI configuration (${[...thresholds].join(", ")})`);
  return reasons;
}

/**
 * Every Decision 0098 gate on a candidate's own change (`from...to`), as one
 * reason, or null: checked-in authority paths, launch-authority and
 * repair-loop code, and the test-weakening gates. Applied to the failed
 * candidate before a repair launches and to a repair's own candidate before
 * it is readied or reviewed.
 */
export function candidateChangeGate(repoRoot: string, from: string, to: string): string | null {
  const paths = agentChangedPaths(repoRoot, from, to);
  if (paths === null) return "the candidate's changed paths could not be read";
  const boundaries: AuthorityBoundary[] = paths.length > 0 ? classifyAuthorityPaths(paths) : [];
  const launchCode = paths.filter(isRepairGatedPath);
  const reasons: string[] = [];
  if (boundaries.length > 0) reasons.push(`it touches checked-in authority boundaries (${boundaries.join(", ")})`);
  if (launchCode.length > 0) reasons.push(`it changes launch-authority or repair-loop code (${launchCode.join(", ")})`);
  reasons.push(...testWeakeningGates(repoRoot, from, to));
  return reasons.length > 0 ? reasons.join("; ") : null;
}

