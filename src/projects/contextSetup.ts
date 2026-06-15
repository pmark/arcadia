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
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import type { Project, ProjectMetadata } from "../domain/types.js";
import { getProject, getProjectMetadata, listProjects } from "../db/repositories.js";
import { nowIso } from "../utils/time.js";

export const ARCADIA_CONTEXT_DIR = ".arcadia";
export const AGENT_CONTEXT_POLICY_FILE = "AGENT_CONTEXT_POLICY.md";
export const REPO_CONTEXT_FILE = "repo-context.md";
export const CONTEXT_POLICY_FILE = "context-policy.json";

const AGENTS_SECTION_START = "<!-- ARCADIA_CONTEXT_START -->";
const AGENTS_SECTION_END = "<!-- ARCADIA_CONTEXT_END -->";

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

  writeFileSync(agentPolicyPath, renderAgentContextPolicy(), "utf8");
  writeFileSync(repoContextPath, renderRepoContext(context), "utf8");
  writeFileSync(contextPolicyPath, `${JSON.stringify(contextPolicyFromSummary(context), null, 2)}\n`, "utf8");
  writeFileSync(agentsPath, updateAgentsMarkdown(existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null), "utf8");

  return {
    repoPath: resolved.repoPath,
    project: resolved.project ? { id: resolved.project.id, name: resolved.project.name } : null,
    files: {
      agentPolicy: agentPolicyPath,
      repoContext: repoContextPath,
      contextPolicy: contextPolicyPath,
      agents: agentsPath
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

function updateAgentsMarkdown(existing: string | null): string {
  const managedSection = [
    AGENTS_SECTION_START,
    "## Arcadia Context",
    "",
    "Before broad repository exploration, read:",
    "",
    "- `.arcadia/AGENT_CONTEXT_POLICY.md`",
    "- `.arcadia/repo-context.md`",
    "- `.arcadia/context-policy.json`",
    "",
    "Use targeted searches, respect denied paths, and keep discovery bounded by the Arcadia context policy.",
    AGENTS_SECTION_END
  ].join("\n");

  if (!existing?.trim()) {
    return ["# AGENTS", "", managedSection, ""].join("\n");
  }

  const pattern = new RegExp(`${escapeRegExp(AGENTS_SECTION_START)}[\\s\\S]*?${escapeRegExp(AGENTS_SECTION_END)}`);
  const body = pattern.test(existing)
    ? existing.replace(pattern, managedSection)
    : `${existing.trimEnd()}\n\n${managedSection}`;
  return `${body.trimEnd()}\n`;
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
