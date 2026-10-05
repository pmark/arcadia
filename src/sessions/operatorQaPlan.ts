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
 * changed files). No model writes any of it, and the same inputs always render
 * the same bytes.
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
}

export type OperatorQaPlanResult =
  | { status: "rendered"; body: string }
  | { status: "refused"; reason: string; body: string };

/** GitHub caps a pull-request body at 65,536 characters; stay well inside it. */
export const OPERATOR_QA_PLAN_MAX_CHARS = 60_000;
const MAX_CRITERION_CHARS = 1_000;
const MAX_LISTED_FILES = 200;
const MAX_COMMANDS_PER_CRITERION = 5;
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
    return refuse(source, facts, `Action ${source.actionKey} declares no acceptance criteria, so there is nothing concrete to check.`);
  }
  if (facts.changedFiles === null) {
    return refuse(source, facts, "the candidate's changed files could not be read from Git.");
  }
  const body = renderPlan(source, criteria, { ...facts, changedFiles: facts.changedFiles });
  if (body.length > OPERATOR_QA_PLAN_MAX_CHARS) {
    return refuse(source, facts,
      `the rendered plan is ${body.length} characters, over the ${OPERATOR_QA_PLAN_MAX_CHARS}-character pull-request body limit.`);
  }
  return { status: "rendered", body };
}

function refuse(source: OperatorQaPlanSource, facts: OperatorQaPlanFacts, reason: string): OperatorQaPlanResult {
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
  const lines: string[] = [
    HEADING,
    "",
    "Rendered by Arcadia host preservation from the Action's declared acceptance criteria and Git facts; no model wrote it.",
    "",
    `- **Action:** ${code(source.actionKey)}${source.actionTitle ? ` — ${inlineText(source.actionTitle)}` : ""}`,
    `- **Candidate:** branch ${code(facts.branch)} at commit ${code(facts.commitSha)}`,
    `- **Base:** ${code(facts.baseBranch)} at ${code(facts.baseRevision)}`,
    documentsOnly
      ? "- **Surface:** no service, URL or build. Every changed file is a document or an Arcadia governed record; the strongest proof is the file content at the candidate commit and the Project's declared checks, both run below."
      : "- **Surface:** this repository's code at the candidate commit, exercised by the commands below from a local checkout.",
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
    `- **Do:** run ${code(`git diff --name-status ${facts.baseRevision} ${facts.commitSha}`)}.`,
    `- **Expected:** exactly ${facts.changedFiles.length} changed ${facts.changedFiles.length === 1 ? "file" : "files"}${facts.changedFiles.length > MAX_LISTED_FILES ? ` (the first ${MAX_LISTED_FILES} are listed)` : ""}:`,
    ...(facts.changedFiles.length === 0
      ? ["  - none: the candidate commit's tree equals the base."]
      : facts.changedFiles.slice(0, MAX_LISTED_FILES).map((file) => `  - ${code(file.status)} ${code(file.path)}`))
  ];

  const ranAt = new Map<string, number>();
  criteria.forEach((criterion, index) => {
    const step = index + 3;
    lines.push("", `### Step ${step} — Acceptance criterion ${index + 1} of ${criteria.length}`, "");
    lines.push(`- **Criterion:** ${inlineText(truncate(criterion, MAX_CRITERION_CHARS))}`);
    const commands = criterionCommands(criterion);
    const paths = criterionPaths(criterion, facts.changedFiles, commands);
    const present = paths.filter((target) => !target.deleted).map((target) => shellWord(target.path));
    const literals = present.length > 0 ? criterionLiterals(criterion, commands) : [];
    const actions: string[] = [];
    for (const target of paths) {
      actions.push(target.deleted
        ? `confirm ${code(target.path)} no longer exists with ${code(`test ! -e ${shellWord(target.path)}`)}`
        : `print the exact bytes of ${code(target.path)} with ${code(`git show ${facts.commitSha}:${shellWord(target.path)} | od -c`)}`);
    }
    for (const literal of literals) actions.push(`run ${code(`grep -Fxn -- ${shellQuote(literal)} ${present.join(" ")}`)}`);
    for (const command of commands) {
      actions.push(`run ${code(command)}`);
      if (!ranAt.has(command)) ranAt.set(command, step);
    }
    if (actions.length === 0) {
      actions.push(`read the change with ${code(`git diff ${facts.baseRevision} ${facts.commitSha}`)} for exactly what this criterion names`);
    }
    lines.push(`- **Do:** ${actions.join("; then ")}.`);
    const expectations: string[] = [];
    if (paths.some((target) => !target.deleted)) {
      expectations.push(`${code("od -c")} shows every byte, a newline as ${code("\\n")}${literals.length > 0 ? `, and ${code("grep -Fxn")} prints each quoted text that is a whole line, with its line number (no output when no line matches)` : ""}; that output is exactly what the criterion as worded above requires`);
    }
    if (paths.some((target) => target.deleted)) expectations.push("each removed file is absent, so the test exits with status 0");
    if (commands.length > 0) expectations.push(`${code("echo $?")} immediately after ${commands.length === 1 ? "the command" : "each command"} prints ${code("0")}`);
    if (actions.length === 1 && paths.length === 0 && commands.length === 0) {
      expectations.push("the diff shows the criterion holds as worded above, with no change it does not call for");
    }
    lines.push(`- **Expected:** ${expectations.join("; and ")}.`);
  });

  const finalStep = criteria.length + 3;
  const remaining = validation.filter((command) => !ranAt.has(command));
  lines.push("", `### Step ${finalStep} — Re-run the declared validation`, "");
  if (validation.length === 0) {
    lines.push("- **Do:** nothing further: the Project declares no validation commands.",
      "- **Expected:** no further output; the acceptance steps above are the whole check.");
  } else if (remaining.length === 0) {
    const where = validation.map((command) => `${code(truncate(command, MAX_COMMAND_CHARS))} (step ${ranAt.get(command)})`).join(", ");
    lines.push(`- **Do:** nothing further: every declared validation command already ran: ${where}.`,
      `- **Expected:** those steps already showed ${code("echo $?")} printing ${code("0")}.`);
  } else {
    lines.push(`- **Do:** run ${remaining.map((command) => code(truncate(command, MAX_COMMAND_CHARS))).join("; then ")}.`,
      `- **Expected:** ${code("echo $?")} immediately after ${remaining.length === 1 ? "it" : "each"} prints ${code("0")}, as host validation recorded before preservation.`);
  }
  lines.push("", "Merge, deployment and publication remain separate operator gates.");
  return lines.join("\n");
}

/** Plain documents and Arcadia's governed data files: nothing to run. */
function isDocumentPath(filePath: string): boolean {
  const lowered = filePath.toLowerCase();
  if (/^\.arcadia\/asks\/(?:archive\/)?[^/]+\.(?:ya?ml|json)$/.test(lowered)) return true;
  return /\.(?:md|markdown|rst|adoc|asciidoc|txt)$/.test(lowered) && !/(^|\/)(src|scripts|tests?|templates|fixtures)\//.test(lowered);
}

const RUNNERS = "node|deno|bun|tsx|python3?|bash|sh|pnpm|npm|npx|yarn|make|cargo|go|pytest|vitest|uv|mise|git";
const RUNNER_START = new RegExp(`^(?:${RUNNERS})(?:\\s|$)`);
/** An unquoted script run (`node scripts/check.mjs`), `node --test`, or a package-manager script. */
const UNQUOTED_COMMAND = new RegExp(
  "\\b(?:" +
    "(?:node|deno|bun|tsx|python3?|bash|sh)(?:\\s+--?[\\w-]+)*\\s+[\\w./-]+\\.(?:mjs|cjs|js|ts|mts|cts|py|sh)" +
    "|node\\s+--test" +
    "|(?:pnpm|npm|yarn)\\s+(?:run\\s+[\\w:.-]+|exec\\s+[\\w:.-]+|test|build|lint|typecheck|check(?::[\\w-]+)?)" +
  ")(?![\\w./-])",
  "g"
);

/** Runnable commands the criterion names: code spans and quotes first, then unquoted runs. */
function criterionCommands(criterion: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    const command = raw.replace(/\s+/g, " ").trim();
    if (!command || command.length > MAX_COMMAND_CHARS || /[`\p{Cc}]/u.test(command)) return;
    if (!RUNNER_START.test(command)) return;
    if (found.some((existing) => existing === command || existing.includes(command))) return;
    for (let i = found.length - 1; i >= 0; i -= 1) if (command.includes(found[i])) found.splice(i, 1);
    found.push(command);
  };
  for (const match of criterion.matchAll(/`([^`]+)`/g)) add(match[1]);
  for (const match of criterion.matchAll(/["“]([^"“”]+)["”]/g)) add(match[1]);
  const unquoted = criterion.replace(/`[^`]*`/g, " ").replace(/["“][^"“”]*["”]/g, " ");
  for (const match of unquoted.matchAll(UNQUOTED_COMMAND)) add(match[0]);
  return found.slice(0, MAX_COMMANDS_PER_CRITERION);
}

/** Quoted text in the criterion that is not a command: candidate whole lines to look for. */
function criterionLiterals(criterion: string, commands: string[]): string[] {
  const found: string[] = [];
  for (const match of criterion.matchAll(/["“]([^"“”]+)["”]/g)) {
    const literal = match[1];
    if (literal.trim() !== literal || !literal || literal.length > MAX_COMMAND_CHARS || /\p{Cc}/u.test(literal)) continue;
    if (commands.includes(literal.replace(/\s+/g, " ")) || found.includes(literal)) continue;
    found.push(literal);
  }
  return found.slice(0, MAX_COMMANDS_PER_CRITERION);
}

/** Files the criterion names: changed files by exact path, plus slash paths not already run as commands. */
function criterionPaths(
  criterion: string,
  changedFiles: readonly ChangedFile[],
  commands: string[]
): Array<{ path: string; deleted: boolean }> {
  const found: Array<{ path: string; deleted: boolean }> = [];
  const add = (filePath: string, deleted: boolean) => {
    if (found.some((entry) => entry.path === filePath)) return;
    if (commands.some((command) => command.split(" ").includes(filePath))) return;
    found.push({ path: filePath, deleted });
  };
  for (const file of changedFiles) {
    if (mentions(criterion, file.path)) add(file.path, file.status.startsWith("D"));
  }
  for (const match of criterion.matchAll(/(?<![\w./-])((?:[\w.-]+\/)+[\w-][\w.-]*\.[A-Za-z][\w]{0,9})(?![\w/-])/g)) {
    const changed = changedFiles.find((file) => file.path === match[1]);
    add(match[1], changed ? changed.status.startsWith("D") : false);
  }
  return found.slice(0, MAX_COMMANDS_PER_CRITERION);
}

function mentions(text: string, filePath: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(filePath, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + filePath.length] ?? "";
    if (!/[\w/-]/.test(before) && !/[\w/-]/.test(after) && !(after === "." && /[\w]/.test(text[at + filePath.length + 1] ?? ""))) {
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
    .replace(/@/g, "@​");
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
