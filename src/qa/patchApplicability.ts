/**
 * The deterministic half of a code reviewer's `not-applicable` claim.
 *
 * A reviewer may say a criterion cannot be affected by a change (a one-line
 * marker file cannot exercise failure handling). That is a model claim, so it
 * is accepted only when the files the immutable patch touches agree: every
 * touched file must be an inert document or one of Arcadia's own governed
 * records, written by a commit that carries Arcadia's governed-command
 * attestation and touches nothing else. Anything else the patch touches
 * (code, scripts, workflows, configuration, manifests, authority-bearing
 * documents, binaries, symlinks, or a path this reader cannot parse) makes
 * every criterion applicable, and the claim is refused. The classification is
 * per FILE: a forged attestation on a commit that also edits code neither
 * excuses that code nor the managed files beside it.
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
  /** True only when every touched file is an inert document or an attested governed record. */
  inert: boolean;
  files: PatchFileClassification[];
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

/** Arcadia's governed-command attestations, as the commands write them. */
const GOVERNED_ATTESTATIONS: RegExp[] = [
  /^Arcadia-Preservation-Request: \S+$/m,
  /^Arcadia-Candidate-Fingerprint: [0-9a-f]{7,64}$/m,
  /^Written by `arcadia agent-ask settle --apply` \(asksettle_[A-Za-z0-9]+\)\.?$/m
];

const FORMAT_PATCH_BOUNDARY = /^From ([0-9a-f]{40}) Mon Sep 17 00:00:00 2001$/;
const SIMPLE_DIFF_HEADER = /^diff --git a\/(\S+) b\/(\S+)$/;

/** Minimum substance of a not-applicable claim's evidence. */
export const NOT_APPLICABLE_MIN_EVIDENCE_CHARS = 40;
export const NOT_APPLICABLE_MIN_EVIDENCE_WORDS = 6;

/** Criteria a reviewer may never mark not-applicable: every change claims a behavior. */
export const NEVER_NOT_APPLICABLE_CRITERIA: ReadonlySet<string> = new Set(["correctness"]);

interface ParsedFile {
  paths: string[];
  commit: number;
  executableMode: boolean;
  special: string | null;
}

interface ParsedCommit {
  message: string;
  attested: boolean;
}

export function classifyPatchApplicability(patch: string, declaredFiles: readonly string[] = []): PatchApplicability {
  const { commits, files } = parsePatch(patch);
  // A commit is a governed record only when its own message carries an
  // attestation and every path it touches is a governed-record path.
  const governedCommit = commits.map((commit, index) => commit.attested &&
    files.filter((file) => file.commit === index).every((file) => !file.special && !file.executableMode && file.paths.every(isGovernedRecordPath)));
  const byPath = new Map<string, { governedOnly: boolean; executableMode: boolean; special: string | null }>();
  for (const file of files) {
    for (const filePath of file.paths) {
      const entry = byPath.get(filePath) ?? { governedOnly: true, executableMode: false, special: null };
      entry.governedOnly &&= governedCommit[file.commit] === true;
      entry.executableMode ||= file.executableMode;
      entry.special ??= file.special;
      byPath.set(filePath, entry);
    }
  }
  // A path the PR declares but the patch does not show carries no attestation.
  for (const declared of declaredFiles) {
    if (!byPath.has(declared)) byPath.set(declared, { governedOnly: false, executableMode: false, special: null });
  }
  const classified = [...byPath.entries()].map(([filePath, entry]) => classifyPath(filePath, entry));
  return {
    inert: classified.length > 0 && classified.every((file) => file.class === "inert-document" || file.class === "governed-record"),
    files: classified
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

function parsePatch(patch: string): { commits: ParsedCommit[]; files: ParsedFile[] } {
  const lines = patch.split(/\r?\n/);
  const commits: ParsedCommit[] = [];
  const files: ParsedFile[] = [];
  const formatPatch = lines.some((line) => FORMAT_PATCH_BOUNDARY.test(line));
  // A plain diff is one commit with no message: nothing in it is attested.
  if (!formatPatch) commits.push({ message: "", attested: false });
  let messageLines: string[] | null = null;
  let current: ParsedFile | null = null;
  let inExtendedHeader = false;
  const finishMessage = () => {
    if (messageLines === null) return;
    const message = messageLines.join("\n");
    commits[commits.length - 1] = { message, attested: GOVERNED_ATTESTATIONS.some((pattern) => pattern.test(message)) };
    messageLines = null;
  };
  for (const line of lines) {
    if (FORMAT_PATCH_BOUNDARY.test(line)) {
      finishMessage();
      commits.push({ message: "", attested: false });
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
    if (line.startsWith("diff --git ")) {
      const match = SIMPLE_DIFF_HEADER.exec(line);
      current = {
        paths: match ? uniqueStrings([match[1], match[2]]) : [line.slice("diff --git ".length)],
        commit: commits.length - 1,
        executableMode: false,
        special: match ? null : "path the reader cannot parse unambiguously"
      };
      files.push(current);
      inExtendedHeader = true;
      continue;
    }
    if (!current || !inExtendedHeader) continue;
    if (line.startsWith("@@")) {
      inExtendedHeader = false;
      continue;
    }
    const mode = /^(?:new file mode|new mode|old mode|deleted file mode) (\d{6})$/.exec(line);
    if (mode) {
      if (mode[1] === "120000") current.special ??= "symbolic link";
      else if (mode[1] === "160000") current.special ??= "submodule";
      else if (mode[1] !== "100644") current.executableMode = true;
      continue;
    }
    const moved = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
    if (moved) {
      if (!current.paths.includes(moved[1])) current.paths.push(moved[1]);
      continue;
    }
    if (line === "GIT binary patch" || line.startsWith("Binary files ")) {
      current.special ??= "binary content";
      inExtendedHeader = false;
    }
  }
  finishMessage();
  return { commits, files };
}

/**
 * Arcadia's governed-record paths: exactly the managed-document set the
 * pull-request procedure exempts for commits Arcadia's own commands write,
 * less `docs/decisions/` (a Decision answer is an authority change that waits
 * for the operator, so it is never inert).
 */
function isGovernedRecordPath(filePath: string): boolean {
  return filePath.startsWith(".arcadia/asks/") ||
    filePath === "MISSION_LOG.md" ||
    filePath === "PROJECT.md" ||
    /^docs\/plans\/[^/]+\.md$/.test(filePath);
}

const AUTHORITY_BASENAMES = new Set(["constitution.md", "agents.md", "claude.md", "skill.md", "project.md", "mission_log.md", "codeowners"]);
const AUTHORITY_PREFIXES = [
  ".arcadia/", ".github/", ".claude/", ".codex/", ".opencode/", ".agents/", ".cursor/", ".husky/",
  "docs/agent-guidance/", "docs/decisions/", "docs/plans/", "runs/"
];
const AUTHORITY_PATHS = new Set([
  "docs/agents-context.md", "docs/managed-documents.md", "docs/planning-process.md",
  "docs/working-copy-safety.md", "docs/managed-production-readiness.md"
]);
const CONFIGURATION_BASENAMES = new Set([
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb",
  "cargo.toml", "cargo.lock", "go.mod", "go.sum", "gemfile", "gemfile.lock", "requirements.txt", "constraints.txt",
  "pyproject.toml", "poetry.lock", "pipfile", "pipfile.lock", "mise.toml"
]);
const CONFIGURATION_EXTENSIONS = new Set([
  "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties", "xml", "plist", "lock", "gradle"
]);
const EXECUTABLE_BASENAMES = new Set(["makefile", "dockerfile", "justfile", "rakefile", "procfile", "vagrantfile", "containerfile"]);
const EXECUTABLE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "kts", "scala", "swift", "m", "mm",
  "c", "h", "cc", "cpp", "hpp", "cs", "fs", "php", "pl", "pm", "lua", "r", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd",
  "sql", "vue", "svelte", "astro", "html", "htm", "css", "scss", "sass", "less", "wasm", "ex", "exs", "erl", "hs", "clj", "dart",
  "groovy", "tf", "hcl", "nix", "zig", "sol", "graphql", "gql", "proto", "prisma", "mdx", "svg", "ipynb"
]);
const INERT_DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "txt", "text", "rst", "adoc", "asciidoc"]);
/** Directories whose documents code may load (prompts, templates, fixtures), so they are never inert. */
const CODE_DIRECTORIES = new Set(["src", "lib", "app", "apps", "packages", "scripts", "bin", "templates", "prompts", "test", "tests", "__tests__", "fixtures", "schemas"]);

function classifyPath(
  filePath: string,
  entry: { governedOnly: boolean; executableMode: boolean; special: string | null }
): PatchFileClassification {
  const as = (cls: PatchFileClass, reason: string): PatchFileClassification => ({ path: filePath, class: cls, reason });
  if (entry.special) return as("unknown", entry.special);
  if (entry.executableMode) return as("executable", "executable file mode");
  if (isGovernedRecordPath(filePath)) {
    return entry.governedOnly
      ? as("governed-record", "managed record written only by attested Arcadia governed commits")
      : as("authority", "managed record changed outside an attested Arcadia governed commit");
  }
  const lowered = filePath.toLowerCase();
  const name = basename(lowered);
  const segments = lowered.split("/");
  if (AUTHORITY_BASENAMES.has(name) || AUTHORITY_PATHS.has(lowered) || AUTHORITY_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return as("authority", "authority-bearing document or agent configuration");
  }
  if (CONFIGURATION_BASENAMES.has(name)) return as("configuration", "package manifest, lockfile or tool configuration");
  if (EXECUTABLE_BASENAMES.has(name)) return as("executable", "build or container script");
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (name.startsWith(".")) return as("configuration", "dotfile configuration");
  if (EXECUTABLE_EXTENSIONS.has(extension)) return as("executable", `.${extension} source`);
  if (CONFIGURATION_EXTENSIONS.has(extension)) return as("configuration", `.${extension} configuration or data`);
  if (!extension && segments.some((segment) => segment === "bin" || segment === "scripts")) return as("executable", "extensionless script");
  if (INERT_DOCUMENT_EXTENSIONS.has(extension)) {
    if (segments.slice(0, -1).some((segment) => CODE_DIRECTORIES.has(segment))) return as("unknown", "document inside a code directory, which code may load");
    return as("inert-document", `.${extension} document`);
  }
  return as("unknown", "unrecognized file type");
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
