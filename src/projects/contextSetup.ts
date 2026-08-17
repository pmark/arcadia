import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import type { Project, ProjectMetadata } from "../domain/types.js";
import { getProject, getProjectMetadata, listProjects } from "../db/repositories.js";
import { nowIso } from "../utils/time.js";

export const ARCADIA_CONTEXT_DIR = ".arcadia";
export const AGENT_CONTEXT_POLICY_FILE = "AGENT_CONTEXT_POLICY.md";
export const REPO_CONTEXT_FILE = "repo-context.md";
export const CONTEXT_POLICY_FILE = "context-policy.json";
export const CONTINUATION_PROTOCOL_FILE = "docs/agent-continuation-protocol.md";
export const AGENTS_CONTEXT_FILE = "docs/agents-context.md";

export const AGENTS_SECTION_START = "<!-- ARCADIA_CONTEXT_START -->";
export const AGENTS_SECTION_END = "<!-- ARCADIA_CONTEXT_END -->";

const DEFAULT_DENIED_CONTEXT_PATHS = [
  ".git/",
  ".next/",
  ".turbo/",
  ".venv/",
  ".vscode/",
  "build/",
  "coverage/",
  "dist/",
  "node_modules/",
  "out/",
  "target/",
  "tmp/",
  "*.db",
  "*.sqlite",
  "*.sqlite3",
  "*.log",
  ".env",
  ".env.*"
];

const DOC_NAMES = [
  "AGENTS.md",
  "README.md",
  "PROJECT.md",
  "CONTRIBUTING.md",
  "ARCHITECTURE.md",
  "docs/README.md",
  "docs/architecture.md",
  "docs/ARCHITECTURE.md"
];

const SOURCE_ROOT_NAMES = ["src", "app", "apps", "packages", "lib", "server", "client", "components"];
const TEST_ROOT_NAMES = ["test", "tests", "__tests__", "spec", "specs", "e2e"];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "C",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".go": "Go",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".md": "Markdown",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".swift": "Swift",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
  ".yml": "YAML",
  ".yaml": "YAML"
};

export interface RepoContextPolicy {
  allowed_context_roots: string[];
  denied_context_paths: string[];
  important_docs: string[];
  source_roots: string[];
  test_roots: string[];
  safe_commands: string[];
  max_discovery_commands: number;
  broad_scan_allowed: boolean;
}

export interface RepoContextSummary extends RepoContextPolicy {
  repo_path: string;
  detected_languages: string[];
  detected_frameworks: string[];
  package_managers: string[];
  generated_at: string;
}

export interface SetupProjectContextResult {
  repoPath: string;
  project: Pick<Project, "id" | "name"> | null;
  files: {
    agentPolicy: string;
    repoContext: string;
    contextPolicy: string;
    agents: string;
    /** The adopted `CONSTITUTION.md`, or null when the source copy is unreadable. */
    constitution: string | null;
    /**
     * The thin `CLAUDE.md` wrapper, or null when an existing `CLAUDE.md` holds
     * project-authored content that must not be overwritten.
     */
    claude: string | null;
    /** The adopted continuation protocol, or null when the source is unreadable. */
    continuationProtocol: string | null;
  };
  context: RepoContextSummary;
}

export function setupArcadiaProjectContext(input: {
  db?: Database.Database;
  projectIdentifier?: string;
  repoPath?: string;
}): SetupProjectContextResult {
  const resolved = resolveSetupTarget(input);
  const context = inspectRepository(resolved.repoPath, resolved.metadata);
  const arcadiaDir = path.join(resolved.repoPath, ARCADIA_CONTEXT_DIR);
  mkdirSync(arcadiaDir, { recursive: true });

  const agentPolicyPath = path.join(arcadiaDir, AGENT_CONTEXT_POLICY_FILE);
  const repoContextPath = path.join(arcadiaDir, REPO_CONTEXT_FILE);
  const contextPolicyPath = path.join(arcadiaDir, CONTEXT_POLICY_FILE);
  const agentsPath = path.join(resolved.repoPath, "AGENTS.md");
  const claudePath = path.join(resolved.repoPath, "CLAUDE.md");
  const constitutionPath = path.join(resolved.repoPath, "CONSTITUTION.md");

  writeFileSync(agentPolicyPath, renderAgentContextPolicy(), "utf8");
  writeFileSync(repoContextPath, renderRepoContext(context), "utf8");
  writeFileSync(contextPolicyPath, `${JSON.stringify(contextPolicyFromSummary(context), null, 2)}\n`, "utf8");
  writeFileSync(agentsPath, updateAgentsMarkdown(existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null), "utf8");

  // The adopted Constitution, so `arcadia next` has standing constraints to
  // print in this repository. Written verbatim from Arcadia's own copy: an
  // adopting project does not ratify its own constitution, it adopts this one.
  const constitution = readAdoptedConstitution();
  const constitutionWritten = constitution !== null;
  if (constitution) {
    writeFileSync(constitutionPath, constitution, "utf8");
  }

  // The continuation protocol: how an agent starts, and what it owes before it
  // stops. Its operative rules are also inlined into the AGENTS.md block above,
  // because a linked document is not a loaded one; this copy carries the
  // reasoning behind them.
  const protocolSource = readAdoptedFile(CONTINUATION_PROTOCOL_FILE);
  const protocolPath = path.join(resolved.repoPath, CONTINUATION_PROTOCOL_FILE);
  const protocolWritten = protocolSource !== null;
  if (protocolSource) {
    mkdirSync(path.dirname(protocolPath), { recursive: true });
    writeFileSync(
      protocolPath,
      adoptContinuationProtocol(
        protocolSource,
        existsSync(protocolPath) ? readFileSync(protocolPath, "utf8") : null,
        resolved.project?.slug ?? null
      ),
      "utf8"
    );
  }

  const wrapper = thinClaudeWrapper(existsSync(claudePath) ? readFileSync(claudePath, "utf8") : null);
  const claudeWritten = wrapper !== null;
  if (wrapper) {
    writeFileSync(claudePath, wrapper, "utf8");
  }

  return {
    repoPath: resolved.repoPath,
    project: resolved.project ? { id: resolved.project.id, name: resolved.project.name } : null,
    files: {
      agentPolicy: agentPolicyPath,
      repoContext: repoContextPath,
      contextPolicy: contextPolicyPath,
      agents: agentsPath,
      constitution: constitutionWritten ? constitutionPath : null,
      claude: claudeWritten ? claudePath : null,
      continuationProtocol: protocolWritten ? protocolPath : null
    },
    context
  };
}

export function hasArcadiaContext(repoPath: string): boolean {
  return [AGENT_CONTEXT_POLICY_FILE, REPO_CONTEXT_FILE, CONTEXT_POLICY_FILE].every((file) =>
    existsSync(path.join(repoPath, ARCADIA_CONTEXT_DIR, file))
  );
}

export function renderCodexContextGuidance(repoPath: string): string | null {
  if (!hasArcadiaContext(repoPath)) {
    return null;
  }

  const policy = readContextPolicy(repoPath);
  const deniedPaths = policy?.denied_context_paths.length
    ? policy.denied_context_paths.map((entry) => `  - ${entry}`).join("\n")
    : "  - Use .arcadia/context-policy.json.";

  return [
    "## Arcadia Repository Context",
    "- Read `.arcadia/AGENT_CONTEXT_POLICY.md`, `.arcadia/repo-context.md`, and `.arcadia/context-policy.json` before source files.",
    "- Trust the current target repository path above over stale references in older packet text.",
    "- Use targeted searches and focused file reads before broad repository scans.",
    "- Respect denied context paths from `.arcadia/context-policy.json`; generally avoid:",
    deniedPaths,
    "- Keep discovery bounded by `max_discovery_commands` unless the task clearly requires deeper inspection."
  ].join("\n");
}

function resolveSetupTarget(input: {
  db?: Database.Database;
  projectIdentifier?: string;
  repoPath?: string;
}): { repoPath: string; project: Project | null; metadata: ProjectMetadata | null } {
  if (input.repoPath?.trim()) {
    return { repoPath: validateRepoPath(input.repoPath), project: null, metadata: null };
  }

  if (!input.projectIdentifier?.trim()) {
    throw validationError("Project identifier or --repo is required.");
  }
  if (!input.db) {
    throw validationError("Workspace database is required when resolving a project.");
  }

  const project = resolveProject(input.db, input.projectIdentifier);
  if (!project) {
    throw validationError("Project not found.", { project: input.projectIdentifier });
  }

  const metadata = getProjectMetadata(input.db, project.id);
  if (!metadata?.repo_path) {
    throw validationError("Project repository path is not configured.", { projectId: project.id });
  }

  return { repoPath: validateRepoPath(metadata.repo_path), project, metadata };
}

function validateRepoPath(repoPath: string): string {
  const resolved = path.resolve(repoPath.trim());
  if (!existsSync(resolved)) {
    throw validationError("Repository path does not exist.", { repoPath: resolved });
  }
  if (!statSync(resolved).isDirectory()) {
    throw validationError("Repository path must be a directory.", { repoPath: resolved });
  }

  return realpathSync(resolved);
}

function resolveProject(db: Database.Database, identifier: string): Project | null {
  const normalized = normalizeReference(identifier);
  const direct = getProject(db, identifier);
  if (direct) {
    return direct;
  }

  const matches = listProjects(db).filter((project) => {
    const metadata = getProjectMetadata(db, project.id);
    const aliases = decodeStringArray(metadata?.aliases);
    return [project.id, project.name, project.slug, ...aliases].some((candidate) => normalizeReference(candidate) === normalized);
  });

  if (matches.length > 1) {
    throw validationError("Project reference is ambiguous.", {
      project: identifier,
      matches: matches.map((match) => match.id)
    });
  }

  return matches[0] ?? null;
}

function inspectRepository(repoPath: string, metadata: ProjectMetadata | null): RepoContextSummary {
  const rootEntries = safeReadDir(repoPath);
  const packageJson = readPackageJson(repoPath);
  const discovered = discoverFiles(repoPath);
  const sourceRoots = existingRoots(repoPath, SOURCE_ROOT_NAMES);
  const testRoots = existingRoots(repoPath, TEST_ROOT_NAMES);
  const importantDocs = DOC_NAMES.filter((doc) => existsSync(path.join(repoPath, doc)));
  const safeCommands = detectSafeCommands(packageJson, metadata);
  const allowedRoots = uniqueSorted([".", ...importantDocs.map((doc) => path.dirname(doc)).filter((doc) => doc !== "."), ...sourceRoots, ...testRoots]);

  return {
    repo_path: repoPath,
    detected_languages: detectLanguages(discovered),
    detected_frameworks: detectFrameworks(packageJson),
    package_managers: detectPackageManagers(rootEntries),
    important_docs: importantDocs,
    source_roots: sourceRoots,
    test_roots: testRoots,
    safe_commands: safeCommands,
    allowed_context_roots: allowedRoots,
    denied_context_paths: DEFAULT_DENIED_CONTEXT_PATHS,
    max_discovery_commands: 6,
    broad_scan_allowed: false,
    generated_at: nowIso()
  };
}

function renderAgentContextPolicy(): string {
  return [
    "# Arcadia Agent Context Policy",
    "",
    "Durable AI guidelines for this repository:",
    "",
    "- Prefer targeted search before broad scans.",
    "- Avoid generated assets, binaries, secrets, build output, dependency folders, and runtime artifacts unless explicitly required.",
    "- Favor clear module boundaries and domain-oriented organization.",
    "- Prefer focused files over excessively large ones.",
    "- Require approval for deployment, publishing, spending money, credential use, and destructive actions.",
    "- Read project documentation before source files when appropriate.",
    ""
  ].join("\n");
}

function renderRepoContext(context: RepoContextSummary): string {
  return [
    "# Arcadia Repo Context",
    "",
    `Generated: ${context.generated_at}`,
    `Repo path: ${context.repo_path}`,
    "",
    "## Detected Languages",
    renderList(context.detected_languages),
    "",
    "## Detected Frameworks",
    renderList(context.detected_frameworks),
    "",
    "## Package Managers",
    renderList(context.package_managers),
    "",
    "## Important Docs",
    renderList(context.important_docs),
    "",
    "## Source Roots",
    renderList(context.source_roots),
    "",
    "## Test Roots",
    renderList(context.test_roots),
    "",
    "## Safe Commands And Scripts",
    renderList(context.safe_commands),
    "",
    "## Generally Avoid",
    renderList(context.denied_context_paths),
    ""
  ].join("\n");
}

function contextPolicyFromSummary(context: RepoContextSummary): RepoContextPolicy {
  return {
    allowed_context_roots: context.allowed_context_roots,
    denied_context_paths: context.denied_context_paths,
    important_docs: context.important_docs,
    source_roots: context.source_roots,
    test_roots: context.test_roots,
    safe_commands: context.safe_commands,
    max_discovery_commands: context.max_discovery_commands,
    broad_scan_allowed: context.broad_scan_allowed
  };
}

/**
 * The shared AGENTS.md region, read from Arcadia's own `docs/agents-context.md`.
 *
 * This was a string literal here until Arcadia became adopter zero. A literal
 * meant the canonical wording of the most-loaded governance file was reviewable
 * only as a code diff, and that Arcadia's own `AGENTS.md` was the one file the
 * generator never wrote -- which is how the naming rule came to exist in every
 * adopting repository and nowhere in Arcadia itself.
 */
export function readAgentsContextBlock(): string {
  const text = readAdoptedFile(AGENTS_CONTEXT_FILE);
  if (!text?.trim()) {
    throw validationError(
      `Missing ${AGENTS_CONTEXT_FILE}. The shared AGENTS.md region is read from Arcadia's own copy of it, never invented here.`
    );
  }
  return text.trim();
}

export function updateAgentsMarkdown(existing: string | null, canonical = readAgentsContextBlock()): string {
  const managedSection = [AGENTS_SECTION_START, canonical, AGENTS_SECTION_END].join("\n");
  if (!existing?.trim()) {
    return ["# AGENTS", "", managedSection, ""].join("\n");
  }

  const pattern = new RegExp(`${escapeRegExp(AGENTS_SECTION_START)}[\\s\\S]*?${escapeRegExp(AGENTS_SECTION_END)}`);
  const body = pattern.test(existing)
    ? existing.replace(pattern, managedSection)
    : `${existing.trimEnd()}\n\n${managedSection}`;
  return `${body.trimEnd()}\n`;
}

/**
 * Read Arcadia's own `CONSTITUTION.md` — the one an adopting repository adopts.
 *
 * Resolved from this module's location rather than the working directory, so
 * setup writes the same text no matter where the CLI was invoked from.
 */
export function readAdoptedConstitution(): string | null {
  return readAdoptedFile("CONSTITUTION.md");
}

/**
 * Read one of Arcadia's own governance files, resolved from this module's
 * location rather than the working directory, so setup writes the same text no
 * matter where the CLI was invoked from.
 */
export function readAdoptedFile(relativePath: string): string | null {
  const candidate = path.resolve(findArcadiaRepoRoot(), relativePath);
  try {
    return readFileSync(candidate, "utf8");
  } catch {
    return null;
  }
}

/**
 * Locate Arcadia's own repository root by walking up from this module's
 * location until a `package.json` is found.
 *
 * A fixed number of `..` segments broke the moment this module started
 * running from compiled output: `src/projects/contextSetup.ts` sits two
 * directories below the root, but `dist/src/projects/contextSetup.js` sits
 * three below, because `tsc` mirrors the `src/` layout under `dist/` rather
 * than flattening it. Walking up to the nearest `package.json` works from
 * either location.
 */
function findArcadiaRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw validationError("Could not locate Arcadia's own repository root from " + import.meta.url);
    }
    dir = parent;
  }
}

/**
 * Compose the adopted continuation protocol for a repository, preserving
 * anything that repository added below the managed region.
 *
 * The first version of this overwrote the file wholesale, which destroyed a
 * repository-specific section on the first real run. Adopting the shared
 * protocol must not cost a project the lens it wrote over it, so the managed
 * text lives between the same markers `AGENTS.md` uses and everything outside
 * them is the project's.
 *
 * Only the project slug is rewritten in the adopted text: the frontmatter would
 * otherwise claim the document belongs to Arcadia.
 */
export function adoptContinuationProtocol(
  source: string,
  existing: string | null,
  projectSlug: string | null
): string {
  const adopted = projectSlug
    ? source.replace(/^project:\s*arcadia\s*$/m, `project: ${projectSlug}`)
    : source;

  const frontmatter = adopted.match(/^---\n[\s\S]*?\n---\n/)?.[0] ?? "";
  const body = unwrapManagedRegion(adopted.slice(frontmatter.length).trim());
  const managed = [AGENTS_SECTION_START, body, AGENTS_SECTION_END].join("\n");

  if (!existing?.trim()) {
    return `${frontmatter}${managed}\n`;
  }

  const pattern = new RegExp(`${escapeRegExp(AGENTS_SECTION_START)}[\\s\\S]*?${escapeRegExp(AGENTS_SECTION_END)}`);
  if (pattern.test(existing)) {
    return `${existing.replace(pattern, managed).trimEnd()}\n`;
  }

  // First adoption: the repository's own protocol becomes the section below the
  // managed region rather than being replaced by it -- unless that "own"
  // protocol already reads as the canonical text with no markers around it
  // yet (Arcadia's own copy predates the markers), in which case it already
  // is the managed region, and wrapping it a second time below would double
  // it rather than adopt it.
  const existingFrontmatter = existing.match(/^---\n[\s\S]*?\n---\n/)?.[0] ?? "";
  const existingBody = existing.slice(existingFrontmatter.length).trim();
  if (existingBody === body) {
    return `${frontmatter}${managed}\n`;
  }

  const preserved = existingBody.length > 0
    ? [
        "",
        "",
        "<!-- Everything below is this repository's own and is never regenerated. -->",
        "",
        "<!--",
        "  TRIAGE THIS SECTION. It is the protocol this repository had before it",
        "  adopted the shared one, preserved verbatim so nothing was lost. If any",
        "  of it restates the rules above, delete that part: two statements of one",
        "  contract in a single file is how they drift apart, and the stricter copy",
        "  wins arguments it should not. Keep only what is genuinely local.",
        "-->",
        "",
        existingBody
      ].join("\n")
    : "";

  return `${frontmatter}${managed}${preserved}\n`;
}

/**
 * Strips one layer of `ARCADIA_CONTEXT_*` markers when a body is already
 * exactly a single managed region, otherwise returns it unchanged.
 *
 * The canonical continuation-protocol source is read from Arcadia's own
 * repository root, which is also the adopting repository whenever
 * `setupArcadiaProjectContext` runs against Arcadia itself. After the first
 * such run, that "canonical" copy already carries the markers this function
 * is about to add, so without unwrapping first, every later run would nest
 * another pair of markers around the previous run's output.
 */
function unwrapManagedRegion(body: string): string {
  const pattern = new RegExp(`^${escapeRegExp(AGENTS_SECTION_START)}\\n([\\s\\S]*?)\\n${escapeRegExp(AGENTS_SECTION_END)}$`);
  return pattern.exec(body)?.[1] ?? body;
}

const CLAUDE_WRAPPER_PROSE = [
  "`AGENTS.md` is the vendor-neutral source of truth for this repository and is",
  "imported above. Codex reads it directly; this file exists only because Claude",
  "Code reads `CLAUDE.md` instead. Never put shared rules here — Codex would",
  "never see them."
].join("\n");

/**
 * The adopting repository's `CLAUDE.md`: a thin wrapper that imports
 * `AGENTS.md` and nothing more.
 *
 * Claude Code reads `CLAUDE.md` automatically and never reads `AGENTS.md`;
 * Codex does the reverse. Before Decision 0021 each agent therefore loaded only
 * half the contract, and the injected block had been copied into both files,
 * where the two copies were free to drift. One import fixes both problems.
 *
 * Returns `null` when an existing `CLAUDE.md` carries content that is not ours,
 * because overwriting a project's own instructions is exactly the silent
 * governance mutation the Constitution forbids. The caller reports it instead.
 */
export function thinClaudeWrapper(existing: string | null): string | null {
  const wrapper = ["# CLAUDE.md", "", "@AGENTS.md", "", CLAUDE_WRAPPER_PROSE, ""].join("\n");

  if (!existing?.trim()) return wrapper;

  // Strip everything this generator has ever written into this file: the title,
  // the import, its own prose, and a managed block an older setup copied here.
  // Whatever survives is the project's, and overwriting it is the silent
  // governance mutation the Constitution forbids.
  //
  // The presence of `@AGENTS.md` used to be treated as proof the whole file was
  // ours, which was wrong in the one case that mattered: a `CLAUDE.md` that
  // imports `AGENTS.md` and then adds the project's own notes is the most
  // natural shape for the file, and it was silently replaced by the bare
  // wrapper. Arcadia's own `CLAUDE.md` was destroyed that way on its first run
  // as adopter zero.
  const managedBlock = new RegExp(`${escapeRegExp(AGENTS_SECTION_START)}[\\s\\S]*?${escapeRegExp(AGENTS_SECTION_END)}`);
  const remainder = existing
    .replace(managedBlock, "")
    .replace(/^#\s+CLAUDE\b.*$/m, "")
    .replace(/^@AGENTS\.md\s*$/m, "")
    .replace(CLAUDE_WRAPPER_PROSE, "")
    .trim();

  // Declining is fail-safe: should the wrapper prose ever be revised, an
  // adopter still holding the previous wording is reported rather than
  // overwritten, and `files.claude` comes back null.
  return remainder.length === 0 ? wrapper : null;
}

function readContextPolicy(repoPath: string): RepoContextPolicy | null {
  try {
    const raw = readFileSync(path.join(repoPath, ARCADIA_CONTEXT_DIR, CONTEXT_POLICY_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<RepoContextPolicy>;
    return {
      allowed_context_roots: arrayOfStrings(parsed.allowed_context_roots),
      denied_context_paths: arrayOfStrings(parsed.denied_context_paths),
      important_docs: arrayOfStrings(parsed.important_docs),
      source_roots: arrayOfStrings(parsed.source_roots),
      test_roots: arrayOfStrings(parsed.test_roots),
      safe_commands: arrayOfStrings(parsed.safe_commands),
      max_discovery_commands: typeof parsed.max_discovery_commands === "number" ? parsed.max_discovery_commands : 6,
      broad_scan_allowed: parsed.broad_scan_allowed === true
    };
  } catch {
    return null;
  }
}

function discoverFiles(repoPath: string): string[] {
  const files: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 4 || files.length >= 1000) {
      return;
    }
    for (const entry of safeReadDir(directory)) {
      if (files.length >= 1000 || shouldSkipDiscoveryEntry(entry.name)) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(repoPath, entryPath);
      if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };

  visit(repoPath, 0);
  return files.sort((left, right) => left.localeCompare(right));
}

function shouldSkipDiscoveryEntry(name: string): boolean {
  return [
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
    "tmp"
  ].includes(name);
}

function safeReadDir(directory: string): import("node:fs").Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function existingRoots(repoPath: string, roots: string[]): string[] {
  return roots.filter((root) => existsSync(path.join(repoPath, root)) && statSync(path.join(repoPath, root)).isDirectory());
}

function detectLanguages(files: string[]): string[] {
  return uniqueSorted(files.map((file) => LANGUAGE_BY_EXTENSION[path.extname(file)]).filter((value): value is string => Boolean(value)));
}

function detectPackageManagers(entries: import("node:fs").Dirent[]): string[] {
  const names = new Set(entries.map((entry) => entry.name));
  const managers: string[] = [];
  if (names.has("pnpm-lock.yaml")) managers.push("pnpm");
  if (names.has("yarn.lock")) managers.push("yarn");
  if (names.has("package-lock.json")) managers.push("npm");
  if (names.has("bun.lockb") || names.has("bun.lock")) managers.push("bun");
  if (names.has("Cargo.lock")) managers.push("cargo");
  if (names.has("poetry.lock")) managers.push("poetry");
  if (names.has("uv.lock")) managers.push("uv");
  return managers;
}

function detectFrameworks(packageJson: Record<string, unknown> | null): string[] {
  if (!packageJson) {
    return [];
  }

  const dependencies = {
    ...objectRecord(packageJson.dependencies),
    ...objectRecord(packageJson.devDependencies)
  };
  const known: Record<string, string> = {
    "@astrojs/astro": "Astro",
    "@sveltejs/kit": "SvelteKit",
    "astro": "Astro",
    "express": "Express",
    "next": "Next.js",
    "nuxt": "Nuxt",
    "react": "React",
    "svelte": "Svelte",
    "vite": "Vite",
    "vitest": "Vitest",
    "vue": "Vue"
  };
  return uniqueSorted(Object.keys(dependencies).map((name) => known[name]).filter((value): value is string => Boolean(value)));
}

function detectSafeCommands(packageJson: Record<string, unknown> | null, metadata: ProjectMetadata | null): string[] {
  const commands = decodeStringArray(metadata?.validation_commands);
  const scripts = objectRecord(packageJson?.scripts);
  for (const [name] of Object.entries(scripts)) {
    if (/^(test|lint|typecheck|check|format|build|smoke)(:|$)/.test(name) && !/(deploy|publish|release|clean|prune|reset|rm)/.test(name)) {
      commands.push(`pnpm ${name}`);
    }
  }
  return uniqueSorted(commands);
}

function readPackageJson(repoPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path.join(repoPath, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function renderList(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None detected";
}

function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeReference(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
