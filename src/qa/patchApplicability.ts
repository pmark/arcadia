/**
 * The deterministic half of a code reviewer's `not-applicable` claim.
 *
 * A reviewer may say a criterion cannot be affected by a change (a one-line
 * marker file cannot exercise failure handling). That is a model claim, so it
 * is accepted only when the immutable patch agrees, failing closed:
 *
 * - every touched file is on an explicit inert allowlist (plain documents
 *   outside code, agent and dot directories), or is one of Arcadia's governed
 *   records changed only within the exact shape Arcadia's governed commands
 *   write, by commits that carry their attestation and touch nothing else;
 * - the patch is a complete `git format-patch` series whose commit count
 *   equals the pull request's (GitHub's compare patch omits merge commits and
 *   their conflict resolutions), and every file the pull request declares is
 *   in it, below the GitHub CLI's 100-file and 100-commit caps.
 *
 * Anything else (code, scripts, workflows, configuration, manifests,
 * authority-bearing or agent-instruction documents, any dot directory, an
 * executable or symlink mode, binaries, an unparseable header or hunk, a
 * governed record changed beyond its shape) makes every criterion applicable,
 * and the claim is refused. Attestations are author-controlled text, so they
 * never excuse a file on their own: the shape limit is checked regardless.
 */

export type PatchFileClass =
  | "inert-document"
  | "governed-record"
  | "executable"
  | "configuration"
  | "authority"
  | "unknown";

export interface PatchFileClassification {
  path: string;
  class: PatchFileClass;
  reason: string;
}

export interface PatchApplicability {
  /** True only when every touched file is inert or a shape-limited governed record, and the patch is complete. */
  inert: boolean;
  files: PatchFileClassification[];
  /** Patch-level reasons nothing in it can be judged inert (incomplete or unverifiable evidence). */
  problems: string[];
}

export interface PatchEvidence {
  /** The paths the pull request declares (`gh pr view --json files`). */
  declaredFiles?: readonly string[];
  /**
   * The pull request's commit count (`gh pr view --json commits`); null when
   * it could not be read, which fails closed. Omitted only by callers that
   * classify a patch without pull-request evidence.
   */
  declaredCommitCount?: number | null;
}

export interface NotApplicableClaim {
  criterion: string;
  name: string;
  status: string;
  evidence: string;
}

export interface NotApplicableEvaluation {
  /** Criteria whose not-applicable claim the deterministic check accepted. */
  accepted: string[];
  refused: Array<{ criterion: string; name: string; reason: string }>;
}

/** The GitHub CLI reads at most this many files and commits of a pull request. */
export const GITHUB_CLI_LIST_CAP = 100;

/** Arcadia's governed-command attestations, as the commands write them. */
const GOVERNED_ATTESTATIONS: RegExp[] = [
  /^Arcadia-Preservation-Request: \S+$/m,
  /^Arcadia-Candidate-Fingerprint: [0-9a-f]{7,64}$/m,
  /^Written by `arcadia agent-ask settle --apply` \(asksettle_[A-Za-z0-9]+\)\.?$/m
];

const FORMAT_PATCH_BOUNDARY = /^From ([0-9a-f]{40}) Mon Sep 17 00:00:00 2001$/;
const SIMPLE_DIFF_HEADER = /^diff --git a\/(\S+) b\/(\S+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Minimum substance of a not-applicable claim's evidence. */
export const NOT_APPLICABLE_MIN_EVIDENCE_CHARS = 40;
export const NOT_APPLICABLE_MIN_EVIDENCE_WORDS = 6;

/** Criteria a reviewer may never mark not-applicable: every change claims a behavior. */
export const NEVER_NOT_APPLICABLE_CRITERIA: ReadonlySet<string> = new Set(["correctness"]);

interface ParsedFile {
  paths: string[];
  oldPath: string | null;
  newPath: string | null;
  commit: number;
  executableMode: boolean;
  special: string | null;
  created: boolean;
  deleted: boolean;
  renamed: boolean;
  copied: boolean;
  /** Each hunk's body lines, prefix included (` `, `+`, `-`, `\`). */
  hunks: string[][];
}

interface ParsedCommit {
  attested: boolean;
}

export function classifyPatchApplicability(patch: string, evidence: PatchEvidence = {}): PatchApplicability {
  const { commits, files, formatPatch } = parsePatch(patch);
  const problems: string[] = [];
  if (!formatPatch) problems.push("the patch is not a git format-patch series, so its commits cannot be checked");
  const declaredFiles = evidence.declaredFiles ?? [];
  if (declaredFiles.length >= GITHUB_CLI_LIST_CAP) {
    problems.push(`the pull request declares ${declaredFiles.length} files, at the GitHub CLI's ${GITHUB_CLI_LIST_CAP}-file cap, so its file list may be truncated`);
  }
  if (evidence.declaredCommitCount === null) {
    problems.push("the pull request's commit count could not be read, so omitted merge commits cannot be ruled out");
  } else if (evidence.declaredCommitCount !== undefined) {
    if (evidence.declaredCommitCount >= GITHUB_CLI_LIST_CAP) {
      problems.push(`the pull request reports ${evidence.declaredCommitCount} commits, at the GitHub CLI's ${GITHUB_CLI_LIST_CAP}-commit cap`);
    } else if (evidence.declaredCommitCount !== commits.length) {
      problems.push(`the pull request has ${evidence.declaredCommitCount} commits but the compare patch shows ${commits.length}; GitHub omits merge commits and their conflict resolutions from it`);
    }
  }

  // A commit is a governed record only when its own message carries an
  // attestation and every path it touches is a governed-record path.
  const governedCommit = commits.map((commit, index) => commit.attested &&
    files.filter((file) => file.commit === index).every((file) => !file.special && !file.executableMode && file.paths.every(isGovernedRecordPath)));
  const shapeViolations = governedShapeViolations(files);
  const byPath = new Map<string, PathEntry>();
  for (const file of files) {
    for (const filePath of file.paths) {
      const entry = byPath.get(filePath) ?? { governedOnly: true, executableMode: false, special: null, shapeViolation: null };
      entry.governedOnly &&= governedCommit[file.commit] === true;
      entry.executableMode ||= file.executableMode;
      entry.special ??= file.special;
      entry.shapeViolation ??= shapeViolations.get(filePath) ?? null;
      byPath.set(filePath, entry);
    }
  }
  // A path the PR declares but the patch does not show is unverifiable.
  for (const declared of declaredFiles) {
    if (!byPath.has(declared)) {
      byPath.set(declared, { governedOnly: false, executableMode: false, special: "declared by the pull request but absent from the compare patch", shapeViolation: null });
    }
  }
  const classified = [...byPath.entries()].map(([filePath, entry]) => classifyPath(filePath, entry));
  return {
    inert: problems.length === 0 && classified.length > 0 &&
      classified.every((file) => file.class === "inert-document" || file.class === "governed-record"),
    files: classified,
    problems
  };
}

/**
 * Judges each not-applicable claim: never for correctness, only with
 * substantive evidence that names a file the patch touches, and only when the
 * patch is deterministically inert.
 */
export function evaluateNotApplicableClaims(
  checks: readonly NotApplicableClaim[],
  applicability: PatchApplicability
): NotApplicableEvaluation {
  const accepted: string[] = [];
  const refused: NotApplicableEvaluation["refused"] = [];
  const affecting = applicability.files.filter((file) => file.class !== "inert-document" && file.class !== "governed-record");
  for (const check of checks) {
    if (check.status !== "not-applicable") continue;
    const reason = refusalReason(check, applicability, affecting);
    if (reason) refused.push({ criterion: check.criterion, name: check.name, reason });
    else accepted.push(check.criterion);
  }
  return { accepted, refused };
}

function refusalReason(
  check: NotApplicableClaim,
  applicability: PatchApplicability,
  affecting: PatchFileClassification[]
): string | null {
  if (NEVER_NOT_APPLICABLE_CRITERIA.has(check.criterion)) return `${check.name} can never be not-applicable; judge it pass or fail.`;
  const evidence = check.evidence.trim();
  const words = evidence.split(/\s+/).filter(Boolean).length;
  if (evidence.length < NOT_APPLICABLE_MIN_EVIDENCE_CHARS || words < NOT_APPLICABLE_MIN_EVIDENCE_WORDS) {
    return `the evidence is too thin to show the change cannot affect ${check.name.toLowerCase()} (at least ${NOT_APPLICABLE_MIN_EVIDENCE_WORDS} words and ${NOT_APPLICABLE_MIN_EVIDENCE_CHARS} characters naming the touched files).`;
  }
  if (applicability.problems.length > 0) return `${applicability.problems.join("; ")}.`;
  if (affecting.length > 0) {
    const shown = affecting.slice(0, 5).map((file) => `${file.path} (${file.class}: ${file.reason})`).join("; ");
    return `the patch touches files that can affect it: ${shown}${affecting.length > 5 ? `; and ${affecting.length - 5} more` : ""}.`;
  }
  if (applicability.files.length === 0) return "the patch shows no touched file, so nothing establishes that the change cannot affect it.";
  const lowered = evidence.toLowerCase();
  const named = applicability.files.some((file) => lowered.includes(file.path.toLowerCase()) ||
    lowered.includes(basename(file.path).toLowerCase()));
  if (!named) return "the evidence names no file the patch touches.";
  return null;
}

function parsePatch(patch: string): { commits: ParsedCommit[]; files: ParsedFile[]; formatPatch: boolean } {
  const lines = patch.split(/\r?\n/);
  const commits: ParsedCommit[] = [];
  const files: ParsedFile[] = [];
  const formatPatch = lines.some((line) => FORMAT_PATCH_BOUNDARY.test(line));
  // A plain diff is one commit with no message: nothing in it is attested.
  if (!formatPatch) commits.push({ attested: false });
  let messageLines: string[] | null = null;
  let current: ParsedFile | null = null;
  let inExtendedHeader = false;
  let hunk: { lines: string[]; old: number; new: number } | null = null;
  const finishMessage = () => {
    if (messageLines === null) return;
    const message = messageLines.join("\n");
    commits[commits.length - 1] = { attested: GOVERNED_ATTESTATIONS.some((pattern) => pattern.test(message)) };
    messageLines = null;
  };
  const endHunk = () => {
    if (hunk && current && (hunk.old > 0 || hunk.new > 0)) current.special ??= "truncated or malformed hunk";
    hunk = null;
  };
  for (const line of lines) {
    if (FORMAT_PATCH_BOUNDARY.test(line)) {
      endHunk();
      finishMessage();
      commits.push({ attested: false });
      messageLines = [];
      current = null;
      inExtendedHeader = false;
      continue;
    }
    if (messageLines !== null) {
      // The message ends at the first `---` separator before the diffstat.
      if (line === "---") finishMessage();
      else if (line.startsWith("diff --git ")) finishMessage();
      else {
        messageLines.push(line);
        continue;
      }
    }
    if (hunk && current) {
      const prefix = line[0];
      if (prefix === "\\") {
        hunk.lines.push(line);
        continue;
      }
      if ((prefix === " " && hunk.old > 0 && hunk.new > 0) || (prefix === "-" && hunk.old > 0) || (prefix === "+" && hunk.new > 0)) {
        hunk.lines.push(line);
        if (prefix !== "+") hunk.old -= 1;
        if (prefix !== "-") hunk.new -= 1;
        if (hunk.old === 0 && hunk.new === 0) {
          current.hunks.push(hunk.lines);
          hunk = null;
        }
        continue;
      }
      endHunk();
    }
    if (line.startsWith("diff --git ")) {
      const match = SIMPLE_DIFF_HEADER.exec(line);
      current = {
        paths: match ? uniqueStrings([match[1], match[2]]) : [line.slice("diff --git ".length)],
        oldPath: match ? match[1] : null,
        newPath: match ? match[2] : null,
        commit: commits.length - 1,
        executableMode: false,
        special: match ? null : "path the reader cannot parse unambiguously",
        created: false,
        deleted: false,
        renamed: false,
        copied: false,
        hunks: []
      };
      files.push(current);
      inExtendedHeader = true;
      continue;
    }
    if (!current) continue;
    const hunkHeader = HUNK_HEADER.exec(line);
    if (hunkHeader) {
      inExtendedHeader = false;
      hunk = { lines: [], old: Number(hunkHeader[2] ?? "1"), new: Number(hunkHeader[4] ?? "1") };
      if (hunk.old === 0 && hunk.new === 0) hunk = null;
      continue;
    }
    if (line.startsWith("@@")) {
      current.special ??= "malformed hunk header";
      continue;
    }
    if (!inExtendedHeader) continue;
    const mode = /^(?:new file mode|new mode|old mode|deleted file mode) (\d{6})$/.exec(line) ??
      /^index [0-9a-f]+\.\.[0-9a-f]+ (\d{6})$/.exec(line);
    if (mode) {
      applyMode(current, mode[1]);
      if (line.startsWith("new file mode")) current.created = true;
      if (line.startsWith("deleted file mode")) current.deleted = true;
      continue;
    }
    const moved = /^(rename|copy) (?:from|to) (.+)$/.exec(line);
    if (moved) {
      if (moved[1] === "rename") current.renamed = true;
      else current.copied = true;
      if (!current.paths.includes(moved[2])) current.paths.push(moved[2]);
      continue;
    }
    if (line === "GIT binary patch" || line.startsWith("Binary files ")) {
      current.special ??= "binary content";
      inExtendedHeader = false;
    }
  }
  endHunk();
  finishMessage();
  return { commits, files, formatPatch };
}

function applyMode(file: ParsedFile, mode: string): void {
  if (mode === "120000") file.special ??= "symbolic link";
  else if (mode === "160000") file.special ??= "submodule";
  else if (mode !== "100644") file.executableMode = true;
}

/**
 * Arcadia's governed-record paths: exactly the managed-document set the
 * pull-request procedure exempts for commits Arcadia's own commands write,
 * less `docs/decisions/` (a Decision answer is an authority change that waits
 * for the operator, so it is never inert). Asks are data files only.
 */
function isGovernedRecordPath(filePath: string): boolean {
  return /^\.arcadia\/asks\/(?:archive\/)?[^/]+\.(?:ya?ml|json)$/.test(filePath) ||
    filePath === "MISSION_LOG.md" ||
    filePath === "PROJECT.md" ||
    /^docs\/plans\/[^/]+\.md$/.test(filePath);
}

const PLAN_POINTER = /^current_action: (\S+)$/;
const UPDATED = /^updated: \d{4}-\d{2}-\d{2}$/;
const ACTION_STATUS = /^ {4}status: (\S+)$/;
const ACTION_ID = /^ {2}- id: (\S+)$/;

/**
 * The exact shapes Arcadia's preservation and `agent-ask settle --apply`
 * (complete) write, checked on the diff itself whatever a commit message
 * claims. A path is mapped to its first violation; consistency across files
 * (the pointer leaves only the Action marked done) is checked here too.
 */
function governedShapeViolations(files: ParsedFile[]): Map<string, string> {
  const violations = new Map<string, string>();
  const violate = (filePath: string, reason: string) => { if (!violations.has(filePath)) violations.set(filePath, reason); };
  const done = new Map<string, string[]>();
  const planMoves = new Map<string, string[]>();
  const projectMoves: string[] = [];
  for (const file of files) {
    if (!file.paths.every(isGovernedRecordPath) || file.special || file.executableMode || !file.newPath || !file.oldPath) continue;
    const target = file.newPath;
    const violateFile = (reason: string) => { for (const filePath of file.paths) violate(filePath, reason); };
    const removed = file.hunks.flatMap((lines) => lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1)));
    const added = file.hunks.flatMap((lines) => lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1)));
    if (file.copied || file.deleted) {
      violateFile("a governed record may not be copied or deleted");
      continue;
    }
    if (target.startsWith(".arcadia/asks/")) {
      const archiveMove = file.renamed && /^\.arcadia\/asks\/[^/]+$/.test(file.oldPath) &&
        target === `.arcadia/asks/archive/${basename(file.oldPath)}`;
      if (!file.created && !archiveMove) violateFile("an Agent Ask may only be added, or moved into .arcadia/asks/archive/ under its own name");
      else if (file.created && removed.length > 0) violateFile("a new Agent Ask cannot remove lines");
      continue;
    }
    if (file.renamed || file.oldPath !== target) {
      violateFile("a managed document may not be renamed");
      continue;
    }
    if (target === "MISSION_LOG.md") {
      if (removed.length > 0) violateFile("the Mission Log may only be appended to");
      continue;
    }
    const keyOf = (line: string): string | null => PLAN_POINTER.test(line) ? "current_action" : UPDATED.test(line) ? "updated"
      : target !== "PROJECT.md" && ACTION_STATUS.test(line) ? "status" : null;
    const bad = [...removed, ...added].find((line) => keyOf(line) === null);
    if (bad !== undefined) {
      violateFile(`only ${target === "PROJECT.md" ? "current_action and updated" : "an Action's status, current_action and updated"} may change here, not \`${bad.trim().slice(0, 80)}\``);
      continue;
    }
    for (const key of ["current_action", "updated", "status"]) {
      if (removed.filter((line) => keyOf(line) === key).length !== added.filter((line) => keyOf(line) === key).length) {
        violateFile(`${key} must be replaced line for line`);
      }
    }
    const moves = removed.flatMap((line) => PLAN_POINTER.exec(line)?.[1] ?? []);
    const destinations = added.flatMap((line) => PLAN_POINTER.exec(line)?.[1] ?? []);
    if (moves.some((from, index) => from === destinations[index])) violateFile("current_action must move to a different Action");
    if (target === "PROJECT.md") {
      projectMoves.push(...moves);
      continue;
    }
    planMoves.set(target, [...(planMoves.get(target) ?? []), ...moves]);
    for (const lines of file.hunks) {
      lines.forEach((line, index) => {
        if (!line.startsWith("-") || !ACTION_STATUS.test(line.slice(1))) return;
        const next = lines.slice(index + 1).find((candidate) => candidate.startsWith("+"));
        if (!next || ACTION_STATUS.exec(next.slice(1))?.[1] !== "done") violateFile("an Action's status may only become done");
        const owner = lines.slice(0, index).reverse().find((candidate) => ACTION_ID.test(candidate.slice(1)));
        const id = owner?.startsWith(" ") ? ACTION_ID.exec(owner.slice(1))?.[1] : undefined;
        if (!id) violateFile("the Action whose status changes is not shown in the hunk's context");
        else done.set(target, [...(done.get(target) ?? []), id]);
      });
    }
  }
  // The pointer may only leave an Action this patch marks done, and every
  // Action marked done must be the one the pointer left.
  for (const [plan, completed] of done) {
    const moves = planMoves.get(plan) ?? [];
    if (completed.length !== new Set(completed).size || !sameMembers(completed, moves)) {
      violate(plan, "the Action marked done must be exactly the one current_action moves away from");
    }
  }
  for (const [plan, moves] of planMoves) {
    if (!done.has(plan) && moves.length > 0) violate(plan, "current_action moved without marking its Action done");
  }
  const allDone = new Set([...done.values()].flat());
  if (projectMoves.some((from) => !allDone.has(from))) violate("PROJECT.md", "PROJECT.md's current_action moved without its Action being marked done");
  return violations;
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

interface PathEntry {
  governedOnly: boolean;
  executableMode: boolean;
  special: string | null;
  shapeViolation: string | null;
}

const AUTHORITY_BASENAMES = new Set([
  "constitution.md", "agents.md", "agent.md", "claude.md", "gemini.md", "codex.md", "qwen.md", "warp.md", "crush.md",
  "opencode.md", "copilot-instructions.md", "conventions.md", "skill.md", "project.md", "mission_log.md", "codeowners"
]);
const AUTHORITY_PREFIXES = ["docs/agent-guidance/", "docs/decisions/", "docs/plans/", "runs/"];
const AUTHORITY_PATHS = new Set([
  "docs/agents-context.md", "docs/managed-documents.md", "docs/planning-process.md",
  "docs/working-copy-safety.md", "docs/managed-production-readiness.md"
]);
/** Directories whose documents are agent instructions (commands, skills, rules, hooks). */
const AGENT_DIRECTORIES = new Set(["commands", "agents", "skills", "rules", "hooks", "workflows", "instructions", "prompts", "modes", "chatmodes", "personas"]);
/** Directories whose documents code may load (templates, fixtures, schemas). */
const CODE_DIRECTORIES = new Set(["src", "lib", "app", "apps", "packages", "scripts", "bin", "templates", "test", "tests", "__tests__", "fixtures", "schemas"]);
const CONFIGURATION_BASENAMES = new Set([
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb",
  "cargo.toml", "cargo.lock", "go.mod", "go.sum", "gemfile", "gemfile.lock", "requirements.txt", "constraints.txt",
  "pyproject.toml", "poetry.lock", "pipfile", "pipfile.lock", "mise.toml"
]);
const CONFIGURATION_EXTENSIONS = new Set([
  "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties", "xml", "plist", "lock", "gradle"
]);
const EXECUTABLE_BASENAMES = new Set(["makefile", "dockerfile", "justfile", "rakefile", "procfile", "vagrantfile", "containerfile", "cmakelists.txt"]);
const EXECUTABLE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "kts", "scala", "swift", "m", "mm",
  "c", "h", "cc", "cpp", "hpp", "cs", "fs", "php", "pl", "pm", "lua", "r", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd",
  "sql", "vue", "svelte", "astro", "html", "htm", "css", "scss", "sass", "less", "wasm", "ex", "exs", "erl", "hs", "clj", "dart",
  "groovy", "tf", "hcl", "nix", "zig", "sol", "graphql", "gql", "proto", "prisma", "mdx", "svg", "ipynb", "cmake"
]);
/** The only inert document types: prose markup, plus plain text under a conventional prose name. */
const INERT_DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "rst", "adoc", "asciidoc"]);
const INERT_TEXT_STEMS = new Set([
  "readme", "license", "licence", "notice", "changelog", "changes", "history", "contributing", "authors", "contributors",
  "copying", "code_of_conduct", "security", "support", "maintainers", "credits"
]);

function classifyPath(filePath: string, entry: PathEntry): PatchFileClassification {
  const as = (cls: PatchFileClass, reason: string): PatchFileClassification => ({ path: filePath, class: cls, reason });
  if (entry.special) return as("unknown", entry.special);
  if (entry.executableMode) return as("executable", "executable file mode");
  if (isGovernedRecordPath(filePath)) {
    if (!entry.governedOnly) return as("authority", "managed record changed outside an attested Arcadia governed commit");
    if (entry.shapeViolation) return as("authority", `governed record changed beyond its allowed shape: ${entry.shapeViolation}`);
    return as("governed-record", "shape-limited managed record written only by attested Arcadia governed commits");
  }
  const lowered = filePath.toLowerCase();
  const name = basename(lowered);
  const directories = lowered.split("/").slice(0, -1);
  if (AUTHORITY_BASENAMES.has(name) || AUTHORITY_PATHS.has(lowered) || AUTHORITY_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return as("authority", "authority-bearing or agent-instruction document");
  }
  if (directories.some((segment) => segment.startsWith("."))) return as("authority", "inside a dot directory (tool, CI or agent configuration)");
  if (CONFIGURATION_BASENAMES.has(name)) return as("configuration", "package manifest, lockfile or tool configuration");
  if (EXECUTABLE_BASENAMES.has(name)) return as("executable", "build or container script");
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (name.startsWith(".")) return as("configuration", "dotfile configuration");
  if (EXECUTABLE_EXTENSIONS.has(extension)) return as("executable", `.${extension} source`);
  if (CONFIGURATION_EXTENSIONS.has(extension)) return as("configuration", `.${extension} configuration or data`);
  if (!extension && directories.some((segment) => segment === "bin" || segment === "scripts")) return as("executable", "extensionless script");
  const stem = extension ? name.slice(0, name.lastIndexOf(".")) : name;
  const inertType = INERT_DOCUMENT_EXTENSIONS.has(extension) || ((extension === "txt" || extension === "text") && INERT_TEXT_STEMS.has(stem));
  if (!inertType) return as("unknown", "not on the inert document allowlist");
  if (directories.some((segment) => AGENT_DIRECTORIES.has(segment))) return as("authority", "document inside an agent-instruction directory");
  if (directories.some((segment) => CODE_DIRECTORIES.has(segment))) return as("unknown", "document inside a code directory, which code may load");
  return as("inert-document", `.${extension} document`);
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
