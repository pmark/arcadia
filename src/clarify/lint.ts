import type { WorkItemSummary } from "../domain/types.js";
import type { ClarifiedVerdict, ClarifyVerdict, QuestionOpenVerdict } from "./types.js";

/**
 * Deterministic lint for a clarified verdict, run before `clarified` is recorded.
 *
 * It is the cheap, model-free half of "an Action is actionable only when it is
 * gradeable": a verdict that fails here is downgraded to exactly one question
 * and never reaches a grader or the queue. The lint checks form, not quality.
 *
 *   1. `doneCondition` is non-empty.
 *   2. `nextAction` starts with a verb (the explicit list below).
 *   3. Every file path, Action id, Decision id and `arcadia ...` command named
 *      in `nextAction` or `doneCondition` appears in the source material. This
 *      is the guard against an invented fact: a model that names a file nobody
 *      mentioned has made it up.
 *
 * Known limits (documented, not hidden): reference detection is a pattern
 * match, so an Action id is recognised only after the word "Action" and only
 * with three or more kebab segments; a bare prose mention of a file with no
 * extension and no known root directory is not detected. A miss lets a verdict
 * through to the grader; it never blocks a valid one wrongly except for the
 * verb rule, which fails closed by design (an unlisted verb costs one question).
 */

/** What the lint may treat as evidence that a reference is real. */
export interface ClarifySourceMaterial {
  title?: string | null;
  rawInput?: string | null;
  currentNextAction?: string | null;
  expectedArtifact?: string | null;
  priorQuestion?: string | null;
  /** The operator's answer to the prior question; Arcadia keeps it in `clarification_source`. */
  priorAnswer?: string | null;
}

export type ClarifyLintCode = "missing-done-condition" | "not-a-verb" | "unsourced-reference";

export interface ClarifyLintFinding {
  code: ClarifyLintCode;
  detail: string;
  /** The references that could not be found in the source material. */
  references?: string[];
}

export interface ClarifyLintResult {
  passed: boolean;
  findings: ClarifyLintFinding[];
}

/**
 * The verb heuristic: the first word of `nextAction`, lower-cased, must be one
 * of these imperative verbs. It is deliberately an allowlist so the rule is
 * inspectable and testable; extend it when a real next action is wrongly
 * refused. Gerunds ("Fixing"), nouns ("Sync"), and hedges ("Maybe") fail.
 */
export const NEXT_ACTION_VERBS: ReadonlySet<string> = new Set([
  "add", "address", "adjust", "align", "allow", "analyze", "announce", "answer", "append", "apply", "approve",
  "archive", "ask", "assign", "attach", "audit", "backfill", "back", "benchmark", "book", "build",
  "call", "cancel", "capture", "change", "check", "choose", "clean", "clarify", "clear", "close", "collect", "commit",
  "compare", "complete", "configure", "confirm", "connect", "consolidate", "convert", "copy", "count", "create",
  "decide", "define", "delete", "deploy", "describe", "design", "detect", "document", "download", "draft", "drop",
  "edit", "email", "enable", "ensure", "enter", "estimate", "evaluate", "examine", "execute", "export", "extend",
  "extract", "fetch", "file", "fill", "find", "finish", "fix", "follow", "forward", "gather", "generate", "get",
  "grade", "grant", "grep", "handle", "hand", "identify", "implement", "import", "improve", "include", "index",
  "inspect", "install", "instrument", "introduce", "investigate", "invite", "join", "label", "launch", "link",
  "list", "locate", "log", "make", "map", "mark", "measure", "merge", "migrate", "monitor", "move", "name",
  "open", "order", "outline", "pay", "pick", "ping", "plan", "post", "prepare", "print", "prioritize", "produce",
  "propose", "publish", "pull", "push", "put", "query", "read", "rebase", "record", "refactor", "register",
  "reject", "release", "remove", "rename", "reorder", "repair", "replace", "reply", "report", "request",
  "research", "reserve", "reset", "resolve", "restart", "restore", "review", "revise", "revert", "rewrite",
  "run", "save", "schedule", "scan", "search", "select", "send", "set", "settle", "share", "ship", "show",
  "sign", "sketch", "sort", "split", "start", "state", "stop", "store", "submit", "summarize", "survey", "tag",
  "take", "test", "trace", "track", "trim", "triage", "unblock", "update", "upgrade", "upload", "use",
  "validate", "verify", "view", "visit", "wire", "write"
]);

/** File extensions that mark a token as a file path even with no directory. */
const FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonl", "md", "mdx", "sql", "yaml", "yml", "toml", "sh",
  "css", "html", "txt", "csv", "plist", "lock", "py", "swift"
]);

/** First path segments that mark a slash-containing token as a repository path. */
const PATH_ROOTS = new Set([
  "src", "docs", "tests", "test", "scripts", "apps", "runs", "dist", "public", "packages", "templates", "tools"
]);

/** Normalize text for containment checks: lower case, single spaces. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Join every source field into one normalized haystack. */
export function sourceHaystack(source: ClarifySourceMaterial): string {
  return normalize(
    [
      source.title,
      source.rawInput,
      source.currentNextAction,
      source.expectedArtifact,
      source.priorQuestion,
      source.priorAnswer
    ]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n")
  );
}

/** The source material for one Action, as the generator itself was shown it. */
export function sourceMaterialFor(workItem: WorkItemSummary): ClarifySourceMaterial {
  return {
    title: workItem.title,
    rawInput: workItem.raw_input,
    currentNextAction: workItem.next_action,
    expectedArtifact: workItem.expected_artifact,
    priorQuestion: workItem.open_question,
    priorAnswer: workItem.clarification_source
  };
}

interface Reference {
  kind: "path" | "action-id" | "decision-id" | "command";
  /** How the reference is shown to the operator. */
  label: string;
  /** Whether the normalized haystack proves it is real. */
  inSource: (haystack: string) => boolean;
}

export function extractReferences(text: string): Reference[] {
  const found = new Map<string, Reference>();
  const add = (reference: Reference): void => {
    found.set(`${reference.kind}:${reference.label.toLowerCase()}`, reference);
  };

  // URLs are not repository paths.
  const withoutUrls = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");

  for (const raw of withoutUrls.split(/[\s`"'(),;<>[\]{}]+/)) {
    const token = raw.replace(/[.:!?]+$/, "");
    if (token && isPathToken(token)) {
      const bare = token.replace(/^\.\//, "").replace(/\/+$/, "");
      add({ kind: "path", label: bare, inSource: (haystack) => haystack.includes(bare.toLowerCase()) });
    }
  }

  for (const match of text.matchAll(/\bactions?(?:\s+id)?\s+`?([a-z0-9]+(?:-[a-z0-9]+){2,})`?/gi)) {
    const id = match[1].toLowerCase();
    add({ kind: "action-id", label: `Action ${id}`, inSource: (haystack) => haystack.includes(id) });
  }

  for (const match of text.matchAll(/\bdecisions?\s+((?:#?\d{1,4}\b(?:\s*(?:,|and|&|\/)\s*)?)+)/gi)) {
    for (const number of match[1].match(/\d{1,4}/g) ?? []) {
      addDecision(add, Number.parseInt(number, 10));
    }
  }
  for (const match of text.matchAll(/\bdecision-(\d{4})\b/gi)) {
    addDecision(add, Number.parseInt(match[1], 10));
  }

  // `arcadia <subcommand>`: compared on the program and its first subcommand,
  // so flags and arguments after it do not have to be in the source.
  for (const match of text.matchAll(/\barcadia\s+([a-z][a-z0-9-]*)\b/g)) {
    const command = `arcadia ${match[1]}`;
    add({ kind: "command", label: command, inSource: (haystack) => haystack.includes(command) });
  }

  return [...found.values()];
}

function addDecision(add: (reference: Reference) => void, number: number): void {
  const padded = String(number).padStart(4, "0");
  add({
    kind: "decision-id",
    label: `Decision ${padded}`,
    inSource: (haystack) =>
      new RegExp(`\\bdecisions?[\\s\\S]{0,40}?(?<!\\d)#?0*${number}\\b|decision-0*${number}\\b|decisions/0*${number}-`).test(
        haystack
      )
  });
}

function isPathToken(token: string): boolean {
  const lastSegment = token.split("/").pop() ?? "";
  const extension = lastSegment.includes(".") ? lastSegment.split(".").pop()?.toLowerCase() : undefined;
  const hasKnownExtension = extension !== undefined && FILE_EXTENSIONS.has(extension) && lastSegment.length > extension.length + 1;

  if (!token.includes("/")) {
    return hasKnownExtension;
  }

  const first = token.replace(/^\.\//, "").split("/")[0].toLowerCase();
  if (hasKnownExtension) {
    return true;
  }
  if (token.startsWith("./") || token.startsWith("../") || token.startsWith("~/")) {
    return true;
  }
  if (token.startsWith("/")) {
    return token.indexOf("/", 1) > 0;
  }
  return PATH_ROOTS.has(first) || (first.startsWith(".") && first.length > 1);
}

/** Does `nextAction` open with one of the listed imperative verbs? */
export function startsWithVerb(nextAction: string): boolean {
  const first = nextAction
    .trim()
    .replace(/^[^a-z]+/i, "")
    .split(/[\s,;:`*"']+/)[0]
    ?.toLowerCase();
  return Boolean(first) && NEXT_ACTION_VERBS.has(first);
}

export function lintClarifiedVerdict(
  verdict: Pick<ClarifiedVerdict, "nextAction" | "doneCondition">,
  source: ClarifySourceMaterial
): ClarifyLintResult {
  const findings: ClarifyLintFinding[] = [];
  const doneCondition = verdict.doneCondition?.trim() ?? "";

  if (!doneCondition) {
    findings.push({ code: "missing-done-condition", detail: "no done-condition is stated" });
  }

  if (!startsWithVerb(verdict.nextAction)) {
    findings.push({
      code: "not-a-verb",
      detail: "the next action does not start with a verb (for example Add, Run, Write, Call)"
    });
  }

  const haystack = sourceHaystack(source);
  const unsourced = extractReferences(`${verdict.nextAction}\n${doneCondition}`).filter(
    (reference) => !reference.inSource(haystack)
  );
  if (unsourced.length > 0) {
    const references = unsourced.map((reference) => reference.label);
    findings.push({
      code: "unsourced-reference",
      detail: `${references.join(", ")} not found in the title, raw input, current next action, expected artifact or prior question and answer`,
      references
    });
  }

  return { passed: findings.length === 0, findings };
}

/** The one question a clarified verdict is downgraded to when it names no done-condition. */
export function missingDoneConditionQuestion(nextAction: string): string {
  return `How will anyone observe that "${nextAction}" is finished? State the done-condition in one sentence.`;
}

/**
 * Lint a clarified verdict against the Action's source material. A pass returns
 * the verdict untouched; a failure returns `question_open` carrying exactly one
 * question that names everything missing. Any other verdict passes through.
 */
export function enforceClarifyLint(
  verdict: ClarifyVerdict,
  source: ClarifySourceMaterial
): { verdict: ClarifyVerdict; findings: ClarifyLintFinding[] } {
  if (verdict.verdict !== "clarified") {
    return { verdict, findings: [] };
  }

  const result = lintClarifiedVerdict(verdict, source);
  if (result.passed) {
    return { verdict, findings: [] };
  }

  const onlyMissingDone = result.findings.every((finding) => finding.code === "missing-done-condition");
  const downgraded: QuestionOpenVerdict = {
    verdict: "question_open",
    gapType: result.findings.some((finding) => finding.code === "missing-done-condition")
      ? "missing-success-criteria"
      : "missing-definition",
    question: onlyMissingDone
      ? missingDoneConditionQuestion(verdict.nextAction)
      : `The proposed next action "${verdict.nextAction}" is not actionable yet: ${result.findings
          .map((finding) => finding.detail)
          .join("; ")}. What should it say instead?`
  };

  return { verdict: downgraded, findings: result.findings };
}
