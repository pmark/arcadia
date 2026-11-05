/**
 * The Operator QA plan a host-preserved candidate pull request carries as its
 * body.
 *
 * Independent QA judges an "Operator QA plan" criterion that may never be
 * reported not-applicable, and it reads that plan from the pull-request body.
 * A one-line placeholder therefore fails every preserved candidate. This module
 * renders a concrete, runnable plan instead, built only from governed records
 * (the Action's declared acceptance criteria and title, the Project's declared
 * validation commands) and Git facts (branch, candidate commit, base revision,
 * changed files, which named paths exist at the commit). No model writes any of
 * it, and the same inputs always render the same bytes.
 *
 * No command is ever derived from criterion text: a criterion may say "never
 * run `git push --force`", and lifting that span into a "run" step would invert
 * it. The only commands the plan tells the operator to run are Git's own fetch
 * and detached-worktree checkout (local Git bookkeeping and a throwaway
 * directory), Git's read-only inspection commands, the Project's declared
 * validation commands, and two the host chooses when a criterion calls for them:
 * this repository's test runner on the candidate's changed test files and any
 * test file the Action names (the only thing criterion text contributes is that
 * path, which must exist at the commit), and a read of the pull request's
 * required checks.
 *
 * Each step's expected result is only what its command can show (2026-11-05: QA
 * failed every candidate on a `git diff` that "showed" tests pass and a
 * `git show` of one file that "showed" the changed-file set and CI results). A
 * criterion gets read-only inspection steps, with its text quoted to compare
 * against; no step says its output shows a criterion holds, since wording cannot
 * tell which criteria an output can show. The parts the plan can recognize are
 * pointed at the step that shows them: a changed-file limit at Step 2's list, a
 * required-CI claim at the required-checks step (a criterion made only of those
 * two inspects no file), and a test passing at a run. A run is called proof only
 * when it covers what the criterion names; otherwise the step says a person judges
 * that from the run.
 *
 * Refusal, not a placeholder: when the Action declares no acceptance criteria
 * (or the source is missing, or the plan cannot fit a pull-request body), the
 * renderer refuses. Preservation still goes ahead -- losing the candidate's
 * work would be worse -- but the body states "QA plan unavailable: <reason>"
 * and the preservation receipt records `qaPlanRefusal`. Independent QA then
 * correctly fails the Operator QA plan criterion on that body; nothing here
 * relaxes QA's no-not-applicable rule.
 */

/** Governed inputs, resolved by the caller from the Action's Plan and Project metadata. */
export interface OperatorQaPlanSource {
  kind: "action-acceptance";
  /** `<project>/<action>`. */
  actionKey: string;
  actionTitle: string | null;
  acceptanceCriteria: readonly string[];
  /** The Project's declared objective validation commands host validation ran. */
  validationCommands: readonly string[];
}

export interface ChangedFile {
  /** Git's name-status letter (A, M, D, T, ...). */
  status: string;
  path: string;
}

/** Git facts read after the candidate commit exists. */
export interface OperatorQaPlanFacts {
  branch: string;
  baseBranch: string;
  baseRevision: string;
  commitSha: string;
  /** Null when the changed files could not be read; the plan then refuses. */
  changedFiles: readonly ChangedFile[] | null;
  /**
   * Whether a path a criterion names exists at the candidate commit. Defaults
   * to "changed and not deleted"; the host passes a `git cat-file -e` probe.
   */
  pathExists?: (path: string) => boolean;
  /**
   * How this repository runs one test file at the candidate commit
   * ({@link detectTestRun}). Absent: no named-test run, and the plan says so.
   */
  testRun?: OperatorQaTestRun | null;
}

/** Host-chosen commands that run a test file; nothing here comes from criterion text. */
export interface OperatorQaTestRun {
  /** How the throwaway worktree gets its dependencies. */
  setup: "bridge" | "install";
  runner: string;
}

export type OperatorQaPlanResult =
  | { status: "rendered"; body: string }
  | { status: "refused"; reason: string; body: string };

/** GitHub caps a pull-request body at 65,536 characters; stay well inside it. */
export const OPERATOR_QA_PLAN_MAX_CHARS = 60_000;
const MAX_CRITERION_CHARS = 1_000;
const MAX_LISTED_FILES = 200;
const MAX_PATHS_PER_CRITERION = 5;
const MAX_LITERAL_CHARS = 200;
const MAX_COMMAND_CHARS = 200;

const HEADING = "## Operator QA plan";
const BRIDGE_SCRIPT = "scripts/bridge-worktree-deps.mjs";
/** What a test runner takes as a file; `tests/fixtures/x.json` is under `tests/` but is not one. */
const RUNNABLE_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const GOVERNED_RECORDS = "Arcadia's governed records (this Action's Agent Ask under `.arcadia/asks/` and, on a settled head, `MISSION_LOG.md`, `PROJECT.md` and the Plan)";

/**
 * The test run a repository's own manifest at the candidate commit supports, or
 * null when it does not show one: this plan names a runner only when it knows it.
 */
export function detectTestRun(packageJson: string | null, exists: (path: string) => boolean): OperatorQaTestRun | null {
  if (packageJson === null) return null;
  let manifest: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; packageManager?: unknown } | null;
  try {
    manifest = JSON.parse(packageJson) as typeof manifest;
  } catch {
    return null;
  }
  const vitest = manifest?.dependencies?.vitest ?? manifest?.devDependencies?.vitest;
  const pnpm = (typeof manifest?.packageManager === "string" && manifest.packageManager.startsWith("pnpm@")) || exists("pnpm-lock.yaml");
  if (!vitest || !pnpm) return null;
  return { setup: exists(BRIDGE_SCRIPT) ? "bridge" : "install", runner: "pnpm exec vitest run" };
}

/** Build the plan source from an Action definition as the validation binding carries it. */
export function operatorQaPlanSource(input: {
  actionKey: string;
  action: { title?: unknown; acceptanceCriteria?: unknown } | null | undefined;
  validationCommands: unknown;
}): OperatorQaPlanSource {
  const criteria = Array.isArray(input.action?.acceptanceCriteria)
    ? input.action.acceptanceCriteria.filter((value): value is string => typeof value === "string")
    : [];
  const commands = Array.isArray(input.validationCommands)
    ? input.validationCommands.filter((value): value is string => typeof value === "string")
    : [];
  return {
    kind: "action-acceptance",
    actionKey: input.actionKey,
    actionTitle: typeof input.action?.title === "string" ? input.action.title : null,
    acceptanceCriteria: criteria,
    validationCommands: commands
  };
}

export function renderOperatorQaPlan(source: OperatorQaPlanSource, facts: OperatorQaPlanFacts): OperatorQaPlanResult {
  const criteria = source.acceptanceCriteria.map((criterion) => criterion.trim()).filter(Boolean);
  if (criteria.length === 0) {
    return refusedOperatorQaPlan(source, facts, `Action ${source.actionKey} declares no acceptance criteria, so there is nothing concrete to check.`);
  }
  if (facts.changedFiles === null) {
    return refusedOperatorQaPlan(source, facts, "the candidate's changed files could not be read from Git.");
  }
  const body = renderPlan(source, criteria, { ...facts, changedFiles: facts.changedFiles });
  if (body.length > OPERATOR_QA_PLAN_MAX_CHARS) {
    return refusedOperatorQaPlan(source, facts,
      `the rendered plan is ${body.length} characters, over the ${OPERATOR_QA_PLAN_MAX_CHARS}-character pull-request body limit.`);
  }
  return { status: "rendered", body };
}

/** The explicit "QA plan unavailable" body; never a placeholder procedure. */
export function refusedOperatorQaPlan(
  source: Pick<OperatorQaPlanSource, "actionKey">,
  facts: Pick<OperatorQaPlanFacts, "branch" | "baseBranch" | "baseRevision" | "commitSha">,
  reason: string
): OperatorQaPlanResult & { status: "refused" } {
  const body = [
    HEADING,
    "",
    `QA plan unavailable: ${inlineText(reason)}`,
    "",
    "Arcadia did not write a placeholder procedure. Independent QA should fail the Operator QA plan criterion until the Action's acceptance criteria are recorded in its Plan and the candidate is preserved again.",
    "",
    `- **Action:** ${code(source.actionKey)}`,
    `- **Candidate:** branch ${code(facts.branch)} at commit ${code(facts.commitSha)}`,
    `- **Base:** ${code(facts.baseBranch)} at ${code(facts.baseRevision)}`
  ].join("\n");
  return { status: "refused", reason, body };
}

function renderPlan(
  source: OperatorQaPlanSource,
  criteria: string[],
  facts: OperatorQaPlanFacts & { changedFiles: readonly ChangedFile[] }
): string {
  const short = facts.commitSha.slice(0, 12);
  const checkout = `../qa-${short}`;
  const documentsOnly = facts.changedFiles.length > 0 && facts.changedFiles.every((file) => isDocumentPath(file.path));
  const validation = source.validationCommands.map((command) => command.trim()).filter(Boolean);
  const pathExists = facts.pathExists
    ?? ((candidate: string) => facts.changedFiles.some((file) => file.path === candidate && !file.status.startsWith("D")));
  const judged = criteria.map((criterion) => {
    const named = criterionPaths(criterion, facts.changedFiles);
    const passing = passingCommands(criterion, named, validation);
    const claims = criterionClaims(criterion);
    return { criterion, named, passing, claims, testsPass: passing === null && claims.testsPass !== null };
  });
  const validationStep = criteria.length + 3;
  const runTargets = testRunTargets(judged, facts.changedFiles, pathExists, facts.testRun);
  const runStep = runTargets.length > 0 ? validationStep + 1 : null;
  const checksStep = judged.some((entry) => entry.claims.requiredChecks) ? validationStep + (runStep === null ? 1 : 2) : null;
  const lines: string[] = [
    HEADING,
    "",
    `Rendered by Arcadia host preservation from the Action's declared acceptance criteria and Git facts; no model wrote it. Step 1 fetches the candidate branch and adds a detached local worktree at the exact commit: it changes only local Git bookkeeping and creates a throwaway directory you can remove afterwards with ${code(`git worktree remove ${checkout}`)}. Every later step except ${runStep === null ? "the declared validation" : "the test-file run and the declared validation"} only reads Git data${checksStep === null ? "" : ` or, in Step ${checksStep}, the pull request's checks on GitHub`}, and only ${runStep === null ? "the declared validation runs" : "those run"} candidate code.`,
    "",
    `- **Action:** ${code(source.actionKey)}${source.actionTitle ? ` — ${inlineText(source.actionTitle)}` : ""}`,
    `- **Candidate:** branch ${code(facts.branch)} at commit ${code(facts.commitSha)}`,
    `- **Base:** ${code(facts.baseBranch)} at ${code(facts.baseRevision)}`,
    documentsOnly
      ? "- **Surface:** no service, URL or build. Every changed file is a document or an Arcadia governed record; the strongest proof is the file content at the candidate commit and the Project's declared checks, both below."
      : "- **Surface:** this repository's code at the candidate commit, exercised by the Project's declared validation commands from a local checkout.",
    "- **Reachability:** local checkout only. Preservation starts no service, opens no URL and deploys nothing; no demo is implied.",
    `- **Expected change:** ${criteria.length === 1 ? "the acceptance criterion holds" : `each of the ${criteria.length} acceptance criteria holds`} at the candidate commit, and only the files listed in step 2 differ from the base.`,
    "- **End users:** the operator procedure below is also the end-user procedure.",
    "",
    "### Step 1 — Check out the exact candidate",
    "",
    `- **Do:** run ${code(`git fetch origin ${shellWord(facts.branch)} && git worktree add --detach ${checkout} ${facts.commitSha} && cd ${checkout}`)} from a clone of this repository. Run every later step from that directory.`,
    `- **Expected:** ${code("git rev-parse HEAD")} prints ${code(facts.commitSha)}.`,
    "",
    "### Step 2 — Confirm what changed",
    "",
    `- **Do:** run ${code(`git -c core.quotePath=false diff --name-status --no-renames ${facts.baseRevision} ${facts.commitSha}`)}.`,
    `- **Expected:** exactly ${facts.changedFiles.length} changed ${facts.changedFiles.length === 1 ? "file" : "files"}${facts.changedFiles.length > MAX_LISTED_FILES ? ` (the first ${MAX_LISTED_FILES} are listed)` : ""}:`,
    ...(facts.changedFiles.length === 0
      ? ["  - none: the candidate commit's tree equals the base."]
      : facts.changedFiles.slice(0, MAX_LISTED_FILES).map((file) => `  - ${code(file.status)} ${code(file.path)}`))
  ];

  criteria.forEach((criterion, index) => {
    lines.push("", `### Step ${index + 3} — Acceptance criterion ${index + 1} of ${criteria.length}`, "");
    const { named, passing, claims, testsPass } = judged[index];
    const quoted = `“${inlineText(truncate(criterion, MAX_CRITERION_CHARS))}”`;
    if (passing === null && claims.provenElsewhereOnly) {
      lines.push(`- **Do:** ${[
        ...(claims.scope ? ["compare Step 2's changed-file list with this criterion"] : []),
        ...(claims.requiredChecks ? [`read the required checks in Step ${checksStep}`] : [])
      ].join("; then ")}.`);
      lines.push(`- **Expected:** ${[
        ...(claims.scope ? [`Step 2's list shows every file the candidate changes: apart from ${GOVERNED_RECORDS}, it names only the files this criterion allows.`] : []),
        ...(claims.requiredChecks ? [`Step ${checksStep}'s output shows each required check passing on the pull request's head.`] : [])
      ].join(" ")} This step inspects no file: one file's content cannot show that. The criterion, exactly as worded: ${quoted}`);
      return;
    }
    const absent = named.filter((candidate) => !pathExists(candidate));
    const existing = named.filter((candidate) => pathExists(candidate));
    const provenElsewhere = passing !== null || testsPass || claims.scope || claims.requiredChecks;
    const present = inspectedPaths(existing, named, facts.changedFiles, provenElsewhere, criterion);
    const substituted = present.length > 0 && existing.length > 0 && !present.every((candidate) => existing.includes(candidate)) ? existing : [];
    const literals = present.length > 0 ? criterionLiterals(criterion) : [];
    const bytes = /newline|byte|whitespace|exactly|empty/i.test(criterion);
    const actions: string[] = [];
    for (const target of present) {
      const show = `git show ${facts.commitSha}:${shellWord(target)}`;
      actions.push(`inspect ${code(target)} with ${code(bytes ? `${show} | od -c` : show)}`);
      for (const literal of literals) actions.push(`run ${code(`${show} | grep -Fxn -- ${shellQuote(literal)}`)}`);
    }
    if (present.length === 0) {
      const scope = absent.length > 0 ? ` -- ${absent.map(shellWord).join(" ")}` : "";
      actions.push(`read the change with ${code(`git diff ${facts.baseRevision} ${facts.commitSha}${scope}`)}`);
    }
    lines.push(`- **Do:** ${actions.join("; then ")}.`);
    if (substituted.length > 0) {
      lines.push(`- **Substitution:** the existing ${substituted.length === 1 ? "path" : "paths"} the criterion names, ${substituted.map((candidate) => code(candidate)).join(", ")}, ${substituted.length === 1 ? "was" : "were"} not changed by this candidate, so this step does not inspect ${substituted.length === 1 ? "it" : "them"} and inspects the candidate's changed test ${present.length === 1 ? "file" : "files"} instead.`);
    }
    const outputs = [
      ...(present.length > 0 ? [bytes ? `${code("od -c")} shows every byte (a newline as ${code("\\n")})` : "the file content is shown"] : []),
      ...(literals.length > 0 ? [`${code("grep -Fxn")} prints each quoted text that is a whole line with its line number, and nothing when no line matches`] : []),
      ...(present.length === 0 ? ["the diff shows what changed"] : [])
    ];
    if (provenElsewhere) {
      // Inspection cannot show that a command or test passes (Issue #986), which
      // files changed or a CI result: bound the Expected line to what inspection
      // shows and point each of those at the step whose output does show it.
      const limits = [
        ...(passing ? ["that a command passes"] : []),
        ...(testsPass ? ["that a test passes"] : []),
        ...(claims.requiredChecks ? ["that a required check passes"] : []),
        ...(claims.scope && present.length > 0 ? ["which files changed"] : [])
      ];
      // A command the criterion assigns to required CI has that proof, not "no direct proof".
      const check = passing && claims.requiredChecks ? { ...passing, undeclared: false } : passing;
      // A run is proof only of what it covers: every test file this criterion names, or the one file it means.
      const namedTests = named.filter((candidate) => TEST_PATH.test(candidate));
      const runsNamed = namedTests.length > 0 && namedTests.every((candidate) => runTargets.includes(candidate));
      const changedPaths = facts.changedFiles.filter((file) => !file.status.startsWith("D")).map((file) => file.path);
      const runTied = runTargets.length === 1 && claims.testsPass !== null && claims.testsPass !== "unscoped"
        && (claims.testsPass !== "changed-file" || changedPaths.includes(runTargets[0]));
      const ran = runTargets.map((target) => code(target)).join(", ");
      const proofs = [
        ...(check ? passProof(check, validation, validationStep, runsNamed ? runStep : null) : []),
        ...(testsPass ? [runStep === null
          ? "No step in this plan runs those tests, so it offers no direct proof that they pass."
          : runTied
            ? `Whether those tests pass is shown only by Step ${runStep}, which runs ${ran}: its exit-zero result is that proof.`
            : `Step ${runStep} runs ${ran}. This plan cannot tell whether that covers what this criterion means, so it claims no proof: judge that from the run.`] : []),
        ...(claims.scope ? [`The changed-file limit is judged on Step 2's list: apart from ${GOVERNED_RECORDS}, it names only the files this criterion allows.`] : []),
        ...(claims.requiredChecks ? [`Whether required CI passes is shown only by Step ${checksStep}'s read of the pull request's required checks.`] : [])
      ];
      lines.push(`- **Expected:** ${outputs.join("; ")}. ${inspectionScope(present, limits.join(" or "))} ${[...proofs, unprovenParts(check)].join(" ")} The criterion, exactly as worded: ${quoted}`);
      return;
    }
    if (substituted.length > 0) {
      // The substituted file shows what the candidate's test asserts, not the named path's content.
      lines.push(`- **Expected:** ${outputs.join("; ")}. That is all this inspection shows: what the changed test ${present.length === 1 ? "file asserts" : "files assert"}, not the content of ${substituted.map((candidate) => code(candidate)).join(", ")}. The criterion, exactly as worded: ${quoted}`);
      return;
    }
    lines.push(`- **Expected:** ${outputs.join("; ")}. Compare that output with this criterion; any part it cannot show, such as a run's result, stays unproven by this step. The criterion, exactly as worded: ${quoted}`);
  });

  lines.push("", `### Step ${validationStep} — Run the Project's declared validation`, "");
  if (validation.length === 0) {
    lines.push("- **Do:** nothing further: the Project declares no validation commands.",
      "- **Expected:** no further output; the inspection steps above are the whole check.");
  } else {
    lines.push(`- **Do:** run ${validation.map((command) => code(truncate(command, MAX_COMMAND_CHARS))).join("; then ")}.`,
      `- **Expected:** ${code("echo $?")} immediately after ${validation.length === 1 ? "it" : "each"} prints ${code("0")}, as host validation recorded before preservation.`);
  }
  if (runStep !== null && facts.testRun) {
    const run = `${facts.testRun.runner} ${runTargets.map(shellWord).join(" ")}`;
    lines.push("", `### Step ${runStep} — Run the candidate's test ${runTargets.length === 1 ? "file" : "files"}`, "",
      `- **Do:** ${facts.testRun.setup === "bridge"
        ? `run ${code(`node ${BRIDGE_SCRIPT}`)} to link the clone's installed dependencies into this throwaway worktree (a clone with none needs ${code("pnpm install")} first)`
        : `run ${code("pnpm install --frozen-lockfile")} to install dependencies in this throwaway worktree`}; then run ${code(run)}.`,
      `- **Expected:** the run's summary reports every test passed and none failed, and ${code("echo $?")} immediately after it prints ${code("0")}. This runs ${runTargets.length === 1 ? "that file" : "those files"} at this commit and nothing else in the suite.`);
  }
  if (checksStep !== null) {
    lines.push("", `### Step ${checksStep} — Read the required checks on the pull request's head`, "",
      `- **Do:** run ${code(`gh pr checks ${shellWord(facts.branch)} --required`)}.`,
      `- **Expected:** every listed check reads ${code("pass")} and ${code("echo $?")} immediately after it prints ${code("0")}; ${code("8")} means a check is still pending and ${code("1")} that one failed. It reads the pull request for this branch at its current head: this commit, or this commit with a governed settlement commit on top. It shows each job's result, not what the job ran.`);
  }
  lines.push("", "Merge, deployment and publication remain separate operator gates.");
  return lines.join("\n");
}

const PASS_WORD = /\b(?:pass(?:es|ed)?|succeed(?:s|ed)?|exits?\s+(?:with\s+)?(?:(?:code|status)\s+)?(?:0|zero)|exit[- ](?:code[- ])?(?:0|zero))\b/i;
/** A negation governing the pass word: "does not pass", "never exits 0", "won't succeed". */
const GOVERNING_NEGATION = /(?:\b(?:not|never|cannot|no longer)|n't)[\s,]+(?:[^\s,]+[\s,]+){0,4}$/i;
/** Words that, anywhere in the command's clause, make it something other than a plain pass. */
const CLAUSE_VETO = /\b(?:fails?|failing|unless|non-?zero)\b/i;
const SCRIPT_PATH = /\.(?:m?js|cjs|m?ts|cts|sh|bash|zsh|py|rb|pl)$/i;
/** How far after the named command its pass word may sit, within one clause. */
const PASS_WINDOW_CHARS = 60;

/** A test file is run by a test command, never a command itself: `tests/x.mjs`, `x.test.ts`, `x.spec.js`. */
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|specs?)\/|\.(?:test|spec)\.[^/]+$/i;

interface PassingCheck {
  /** Declared validation commands the criterion says must pass, named directly or by the script they run. */
  declared: string[];
  /** The criterion says a command that is not declared must pass. */
  undeclared: boolean;
  /** The criterion says a test file must pass. */
  testFile: boolean;
}

/**
 * A criterion satisfied by running a command: a declared validation command,
 * a script path, a test file or a command-shaped code span (several words,
 * not a flag), followed in the same clause by a pass word ("passes",
 * "succeeds", "exits 0") that no negation governs. Returns null when the
 * criterion is not one. A bare script path counts as the declared command
 * that runs exactly that script. Detection only changes the step's wording;
 * it never makes anything runnable.
 */
function passingCommands(criterion: string, named: readonly string[], validation: readonly string[]): PassingCheck | null {
  const passesAt = (end: number) => {
    const window = criterion.slice(end, end + PASS_WINDOW_CHARS).replace(/^`/, "");
    const clause = window.split(/[;!?]|\.(?=\s|$)/)[0];
    const pass = PASS_WORD.exec(clause);
    if (!pass || CLAUSE_VETO.test(clause)) return false;
    return !GOVERNING_NEGATION.test(clause.slice(0, pass.index));
  };
  const declared = validation.filter((command) => commandOccurrences(criterion, command).some(passesAt));
  const declaredText = (at: number, length: number) => declared.some((command) => criterion.slice(at, at + length).includes(command)
    || command.includes(criterion.slice(at, at + length)));
  let undeclared = false;
  let testFile = false;
  for (const target of named.filter((candidate) => SCRIPT_PATH.test(candidate))) {
    for (let at = criterion.indexOf(target); at >= 0; at = criterion.indexOf(target, at + 1)) {
      if (!passesAt(at + target.length) || declaredText(at, target.length)) continue;
      if (TEST_PATH.test(target)) {
        testFile = true;
        continue;
      }
      const running = validation.filter((command) => command.trim().split(/\s+/).some((word) => word === target || word === `./${target}`));
      if (running.length === 0) undeclared = true;
      for (const command of running) if (!declared.includes(command)) declared.push(command);
    }
  }
  for (const span of criterion.matchAll(/`([^`\n]+)`/g)) {
    const at = (span.index ?? 0) + 1;
    if (/\S\s+\S/.test(span[1]) && !span[1].trim().startsWith("-") && passesAt(at + span[1].length + 1) && !declaredText(at, span[1].length)) undeclared = true;
  }
  return declared.length > 0 || undeclared || testFile ? { declared, undeclared, testFile } : null;
}

/**
 * Where a declared command appears as itself, returning each occurrence's end.
 * In a code span the span must be exactly the command; in prose it must stand
 * between the text's edges, whitespace, quotes or sentence punctuation, and
 * not be followed by a flag: "pnpm test:unit" and "pnpm test -- x" are not
 * "pnpm test".
 */
function commandOccurrences(criterion: string, command: string): number[] {
  const ends: number[] = [];
  for (let at = criterion.indexOf(command); at >= 0; at = criterion.indexOf(command, at + 1)) {
    const end = at + command.length;
    const before = at === 0 ? "" : criterion[at - 1];
    const rest = criterion.slice(end);
    const bounded = before === "`"
      ? rest.startsWith("`")
      : (before === "" || /[\s"'“(]/.test(before)) && /^(?:["'”)]*(?:[.,;:!?](?=\s|$))?(?:$|\s+(?![\s-])))/.test(rest);
    if (bounded) ends.push(end);
  }
  return ends;
}

/**
 * The parts of a criterion that inspecting a file or diff cannot show: which
 * files changed, what required CI reported, and that a test passes without the
 * criterion naming the file ("every other test in that file passes unchanged").
 * Read per sentence, with code spans left out, so a backticked command stays
 * {@link passingCommands}'s and a negated or failing clause claims nothing.
 */
function criterionClaims(criterion: string): { scope: boolean; requiredChecks: boolean; testsPass: TestsPassScope | null; provenElsewhereOnly: boolean } {
  const sentences = criterion.split(/(?<=[.;!?])\s+/);
  const requiredChecks = sentences.some((sentence) => REQUIRED_CI.test(sentence) && CI_PROOF_WORD.test(sentence)
    && !CLAUSE_VETO.test(sentence) && !NEGATED_CI_PROOF.test(sentence));
  return {
    scope: sentences.some((sentence) => SCOPE_CLAIM.test(sentence)),
    requiredChecks,
    testsPass: sentences.map(claimsTestsPass).find((scope) => scope !== null) ?? null,
    provenElsewhereOnly: sentences.every((sentence) => SCOPE_ONLY.test(sentence) || (requiredChecks && CI_PROOF_ONLY.test(sentence)))
  };
}

/** What a test-passing claim covers: one file it points at, the candidate's changed file, or something the plan cannot tell. */
type TestsPassScope = "one-file" | "changed-file" | "unscoped";

function claimsTestsPass(sentence: string): TestsPassScope | null {
  for (const clause of sentence.replace(/`[^`\n]*`/g, " ").split(/,\s+and\s+/i)) {
    const found = TESTS_PASS.exec(clause);
    if (found === null || CLAUSE_VETO.test(clause) || GOVERNING_NEGATION.test(`${clause.slice(0, found.index)}${found[1]}`)) continue;
    const file = ONE_TEST_FILE.exec(clause);
    return !file ? "unscoped" : file[1] ? "changed-file" : "one-file";
  }
  return null;
}

/** "The change touches only x", beside other wording in its sentence. */
const SCOPE_CLAIM = /\btouch(?:es|ed)?\s+only\b|\b(?:change|patch|diff|candidate|pull request)\s+(?:changes|modifies|edits)\s+only\b|\bno other files?\b/i;
/** A whole sentence that is only a changed-file limit, with nothing else to inspect. */
const SCOPE_ONLY = /^(?:the\s+)?(?:change|patch|diff|candidate|pull request)\s+(?:touches|changes|modifies|edits)\s+only\s+[^\s,]+(?:(?:,\s+(?:and\s+)?|\s+and\s+)[^\s,]+)*[.;]?$/i;
/** `CI` is case-sensitive, so prose using "ci" as another abbreviation claims nothing. */
const REQUIRED_CI = /\bCI\b|\b[Rr]equired\s+(?:\w+\s+)?(?:checks?|jobs?)\b/;
const CI_PROOF_WORD = /\b(?:pass(?:es|ed)?|green|succeed(?:s|ed)?|proof|proves?|proven)\b/i;
const NEGATED_CI_PROOF = /(?:\b(?:not|never)|n't)\b[^.;]*\b(?:pass(?:es|ed)?|green|succeed(?:s|ed)?)\b/i;
/** A whole sentence that only assigns its proof to CI: "Proof that x passes comes from the required CI jobs ...". */
const CI_PROOF_ONLY = /^(?:proof|evidence)\b[^.;]*\bcomes?\s+from\s+(?:the\s+)?(?:required\s+)?(?:CI|checks?|jobs?)\b/i;
/** A test passing as a result, not passing something along: "The test passes a stub" claims nothing. */
const TESTS_PASS = /(\b(?:tests?|suite)\b[^.;]{0,60}?)\bpass(?:es|ed)?\b(?=\s*(?:$|[.,;:)])|\s+(?:unchanged|under|on|in|with|and|after|against|locally)\b)/i;

/** "in that file", "in the changed file": a claim about one file, with `changed` captured when it says which. */
const ONE_TEST_FILE = /\b(?:in|of|from)\s+(?:that|the|this)\s+(?:same\s+|named\s+|new\s+|(changed)\s+)?(?:test\s+)?file\b/i;

/**
 * The files the test-file step runs: every test file the Action names and every
 * one the candidate changed, whenever a criterion names one or claims tests pass,
 * never a silently chosen subset.
 */
function testRunTargets(
  judged: ReadonlyArray<{ named: readonly string[]; testsPass: boolean }>,
  changedFiles: readonly ChangedFile[],
  pathExists: (candidate: string) => boolean,
  testRun: OperatorQaTestRun | null | undefined
): string[] {
  if (!testRun) return [];
  const runnable = (candidate: string) => RUNNABLE_TEST.test(candidate) && !candidate.startsWith("-") && pathExists(candidate);
  const named = judged.flatMap((entry) => entry.named).filter(runnable);
  if (named.length === 0 && !judged.some((entry) => entry.testsPass)) return [];
  const changed = changedFiles.filter((file) => !file.status.startsWith("D")).map((file) => file.path).filter(runnable);
  return [...new Set([...named, ...changed])];
}

/** What an inspection step can show, and no more. */
function inspectionScope(present: readonly string[], limit: string): string {
  if (present.length === 0) return `That is all this inspection shows: a diff never shows ${limit}.`;
  const files = present.map((target) => code(target)).join(", ");
  return present.length === 1
    ? `That is all this inspection shows: that ${files} exists at the candidate commit and what it contains. Showing a file's source never shows ${limit}.`
    : `That is all this inspection shows: that ${files} exist at the candidate commit and what they contain. Showing a file's source never shows ${limit}.`;
}

/** Where the proof of passing is: a run's exit-zero result, never inspection. */
function passProof(passing: PassingCheck, validation: readonly string[], validationStep: number, namedTestStep: number | null): string[] {
  const sentences: string[] = [];
  const matched = passing.declared;
  if (matched.length > 0) {
    const commands = matched.map((command) => code(truncate(command, MAX_COMMAND_CHARS)));
    sentences.push(commands.length === 1
      ? `Whether the named command passes is proven only by Step ${validationStep}, the Project's declared validation: ${code("echo $?")} immediately after ${commands[0]} prints ${code("0")}.`
      : `Whether the named commands pass is proven only by Step ${validationStep}, the Project's declared validation: ${code("echo $?")} immediately after each of ${commands.slice(0, -1).join(", ")} and ${commands[commands.length - 1]} prints ${code("0")}.`);
    if (passing.undeclared) {
      sentences.push("This criterion also names a command that is not among the Project's declared validation commands; this plan runs no command taken from criterion text, so it offers no direct proof that that command passes.");
    }
  } else if (passing.undeclared) {
    sentences.push(validation.length > 0
      ? `This plan runs no command taken from criterion text, and none of the Project's declared validation commands in Step ${validationStep} is the command this criterion names: Step ${validationStep}'s exit-zero result proves only that those declared commands pass, so this plan offers no direct proof that this criterion's command passes.`
      : "This plan runs no command taken from criterion text and the Project declares no validation commands, so this plan offers no proof that the named command passes.");
  }
  if (passing.testFile && namedTestStep !== null) {
    sentences.push(`A named test file passing is shown only by a run, never by its source; Step ${namedTestStep} runs it, and its exit-zero result is that proof.`);
  } else if (passing.testFile) {
    sentences.push(validation.length > 0
      ? `A named test file passing is shown only by a run, never by its source; the run this plan offers is Step ${validationStep}, the Project's declared validation, exiting ${code("0")}.`
      : "A named test file passing is shown only by a run, never by its source, and the Project declares no validation commands, so this plan offers no run that shows it.");
  }
  return sentences;
}

/** What is left for the inspection itself to show. */
function unprovenParts(passing: PassingCheck | null): string {
  if (passing?.testFile) return "Any part of this criterion that is not a command or test file passing must show in this step's output.";
  return passing?.undeclared && passing.declared.length > 0
    ? "Any part of this criterion that is not a command passing must show in this step's output."
    : "Any other part of this criterion must show in this step's output.";
}

/**
 * The existing named paths a criterion's step inspects. A criterion may name an
 * unchanged data file only as a sample (Issue #1999: `apps/dashboard/package.json`
 * stood in for a negative-pattern table that lives in the candidate's own test
 * file), and inspecting that file cannot show the assertion. So when no named
 * path is one the candidate changed, none is a test file or source code (a
 * named test or source file is always inspected itself) and the candidate did
 * change test files, the step inspects those changed test files instead, and
 * says so. A criterion with a part another step proves keeps the named paths
 * (a command passing, proved by a run; a changed-file limit; required CI).
 */
function inspectedPaths(
  existing: readonly string[],
  named: readonly string[],
  changedFiles: readonly ChangedFile[],
  provenElsewhere: boolean,
  criterion: string
): string[] {
  if (provenElsewhere || existing.length === 0) return [...existing];
  // A criterion about what a named file says (a quoted line, "contains", "exactly") is about that file itself,
  // never a sample: grepping a test file cannot show it.
  if (criterionLiterals(criterion).length > 0 || /\b(?:contains?|exactly|content|lines?|reads?|says?|states?|includes?|mentions?|documents?|describes?)\b/i.test(criterion)) return [...existing];
  if (named.some((candidate) => changedFiles.some((file) => file.path === candidate))) return [...existing];
  if (existing.some((candidate) => TEST_PATH.test(candidate) || SOURCE_PATH.test(candidate))) return [...existing];
  const changedTests = changedFiles.filter((file) => !file.status.startsWith("D") && TEST_PATH.test(file.path)).map((file) => file.path);
  return changedTests.length > 0 ? changedTests.slice(0, MAX_PATHS_PER_CRITERION) : [...existing];
}

/** Source code files, which a criterion names to be read, never as a stand-in sample. */
const SOURCE_PATH = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|sh|bash|zsh|pl|php|cs|cpp|c|h)$/i;

/** Plain documents and Arcadia's governed data files: nothing to run. */
function isDocumentPath(filePath: string): boolean {
  const lowered = filePath.toLowerCase();
  if (/^\.arcadia\/asks\/(?:archive\/)?[^/]+\.(?:ya?ml|json)$/.test(lowered)) return true;
  return /\.(?:md|markdown|rst|adoc|asciidoc|txt)$/.test(lowered) && !/(^|\/)(src|scripts|tests?|templates|fixtures)\//.test(lowered);
}

/** Quoted text in the criterion: candidate whole lines to look for, read-only. */
function criterionLiterals(criterion: string): string[] {
  const found: string[] = [];
  for (const match of criterion.matchAll(/["“]([^"“”]+)["”]/g)) {
    const literal = match[1];
    if (!literal || literal.trim() !== literal || literal.length > MAX_LITERAL_CHARS || /\p{Cc}/u.test(literal)) continue;
    if (!found.includes(literal)) found.push(literal);
  }
  return found.slice(0, MAX_PATHS_PER_CRITERION);
}

/** Paths the criterion names: changed files by exact path, plus any slash path. */
function criterionPaths(criterion: string, changedFiles: readonly ChangedFile[]): string[] {
  const found: string[] = [];
  for (const file of changedFiles) {
    if (mentions(criterion, file.path) && !found.includes(file.path)) found.push(file.path);
  }
  for (const match of criterion.matchAll(/(?<![\w./-])((?:[\w.-]+\/)+[\w-][\w.-]*\.[A-Za-z]\w{0,9})(?![\w/-])/g)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found.slice(0, MAX_PATHS_PER_CRITERION);
}

function mentions(text: string, filePath: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(filePath, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + filePath.length] ?? "";
    if (!/[\w/-]/.test(before) && !/[\w/-]/.test(after) && !(after === "." && /\w/.test(text[at + filePath.length + 1] ?? ""))) {
      return true;
    }
    from = at + 1;
  }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}… (truncated; the full text is in the Action's Plan)`;
}

/**
 * Governed prose rendered inline: one line, Markdown inline syntax and raw
 * HTML escaped, and `@` broken so a criterion can never notify a GitHub user.
 * It always follows a bold label on its line, so block syntax cannot start.
 */
export function inlineText(value: string): string {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>|~]/g, (char) => `\\${char}`)
    .replace(/&(?=#?\w+;)/g, "\\&")
    .replace(/@/g, "@\u200b");
}

/** A Markdown code span that cannot be closed early by backticks in its content. */
export function code(value: string): string {
  const text = value.replace(/\p{Cc}/gu, "?");
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && text.trim()) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Always single-quoted, for literal text. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** A shell word safe to paste: plain refs and paths stay bare, anything else is single-quoted. */
function shellWord(value: string): string {
  return /^[\w./:@%+=-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
