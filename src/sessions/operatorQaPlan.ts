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
 * Nothing runnable is ever derived from criterion text: a criterion may say
 * "never run `git push --force`", and lifting that span into a "run" step would
 * invert it. The only commands the plan tells the operator to run are Git's own
 * fetch and detached-worktree checkout (local Git bookkeeping and a throwaway
 * directory), Git's read-only inspection commands and the Project's declared
 * validation commands. Each criterion gets read-only inspection steps, and its
 * expected result is the criterion text itself, quoted. A criterion that a
 * command must pass is the exception: inspection cannot show a pass, so its
 * expected result is limited to what inspection shows and points the proof of
 * passing at the declared-validation step's exit-zero result.
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
  const lines: string[] = [
    HEADING,
    "",
    `Rendered by Arcadia host preservation from the Action's declared acceptance criteria and Git facts; no model wrote it. Step 1 fetches the candidate branch and adds a detached local worktree at the exact commit: it changes only local Git bookkeeping and creates a throwaway directory you can remove afterwards with ${code(`git worktree remove ${checkout}`)}. Every later step except the declared validation only reads Git data, and only the declared validation runs candidate code.`,
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
    const named = criterionPaths(criterion, facts.changedFiles);
    const present = named.filter((candidate) => pathExists(candidate));
    const absent = named.filter((candidate) => !present.includes(candidate));
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
    const outputs = [
      ...(present.length > 0 ? [bytes ? `${code("od -c")} shows every byte (a newline as ${code("\\n")})` : "the file content is shown"] : []),
      ...(literals.length > 0 ? [`${code("grep -Fxn")} prints each quoted text that is a whole line with its line number, and nothing when no line matches`] : []),
      ...(present.length === 0 ? ["the diff shows what changed"] : [])
    ];
    const quoted = `“${inlineText(truncate(criterion, MAX_CRITERION_CHARS))}”`;
    if (requiresPassingCommand(criterion, named, validation)) {
      // Inspection cannot show that a command passes (Issue #986): bound the
      // Expected line to what inspection shows and point the proof of passing
      // at the declared-validation step and its exit-zero result.
      lines.push(`- **Expected:** ${outputs.join("; ")}. ${inspectionScope(present)} ${passProof(criterion, validation, criteria.length + 3)} The criterion, exactly as worded: ${quoted}`);
      return;
    }
    lines.push(`- **Expected:** ${outputs.join("; ")}; and that output shows this criterion holds, exactly as worded: ${quoted}`);
  });

  const finalStep = criteria.length + 3;
  lines.push("", `### Step ${finalStep} — Run the Project's declared validation`, "");
  if (validation.length === 0) {
    lines.push("- **Do:** nothing further: the Project declares no validation commands.",
      "- **Expected:** no further output; the inspection steps above are the whole check.");
  } else {
    lines.push(`- **Do:** run ${validation.map((command) => code(truncate(command, MAX_COMMAND_CHARS))).join("; then ")}.`,
      `- **Expected:** ${code("echo $?")} immediately after ${validation.length === 1 ? "it" : "each"} prints ${code("0")}, as host validation recorded before preservation.`);
  }
  lines.push("", "Merge, deployment and publication remain separate operator gates.");
  return lines.join("\n");
}

const PASS_WORDS = /\b(?:pass(?:es|ed|ing)?|succeed(?:s|ed)?|exits?\s+(?:with\s+)?(?:(?:code|status)\s+)?(?:0|zero)|exit[- ](?:code[- ])?(?:0|zero))\b/i;
const SCRIPT_PATH = /\.(?:m?js|cjs|m?ts|cts|sh|bash|zsh|py|rb|pl)$/i;

/**
 * A criterion satisfied by running a command: it says something must pass
 * (succeed, exit zero) and names a declared validation command, a script path
 * or an inline code span. Detection only changes the step's wording; it never
 * makes anything runnable.
 */
function requiresPassingCommand(criterion: string, named: readonly string[], validation: readonly string[]): boolean {
  if (!PASS_WORDS.test(criterion)) return false;
  return declaredCommandsIn(criterion, validation).length > 0
    || named.some((candidate) => SCRIPT_PATH.test(candidate))
    || /`[^`\n]+`/.test(criterion);
}

function declaredCommandsIn(criterion: string, validation: readonly string[]): string[] {
  return validation.filter((command) => mentions(criterion, command));
}

/** What an inspection step can show, and no more. */
function inspectionScope(present: readonly string[]): string {
  if (present.length === 0) return "That is all this inspection shows: a diff never shows that a command passes.";
  const files = present.map((target) => code(target)).join(", ");
  return present.length === 1
    ? `That is all this inspection shows: that ${files} exists at the candidate commit and what it contains. Showing a file's source never shows that a command passes.`
    : `That is all this inspection shows: that ${files} exist at the candidate commit and what they contain. Showing a file's source never shows that a command passes.`;
}

/** Where the proof of passing is: the declared-validation step's exit-zero result, never inspection. */
function passProof(criterion: string, validation: readonly string[], validationStep: number): string {
  const matched = declaredCommandsIn(criterion, validation);
  if (matched.length > 0) {
    const commands = matched.map((command) => code(truncate(command, MAX_COMMAND_CHARS))).join(" and ");
    return `Whether it passes is proven only by Step ${validationStep}, the Project's declared validation: ${code("echo $?")} immediately after ${commands} prints ${code("0")}.`;
  }
  if (validation.length > 0) {
    return `This plan runs no command taken from criterion text; the only proof of passing it offers is Step ${validationStep}, the Project's declared validation, where ${code("echo $?")} prints ${code("0")} after each declared command.`;
  }
  return "This plan runs no command taken from criterion text and the Project declares no validation commands, so this plan offers no proof that it passes.";
}

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
