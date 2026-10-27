import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { SESSION_AGENTS } from "../sessions/index.js";

const MANAGED_SKILL_MARKER = "<!-- ARCADIA_MANAGED_SKILL -->";
const MANAGED_AGENT_ASK_SKILL_MARKER = "<!-- ARCADIA_MANAGED_AGENT_ASK_SKILL -->";
const CODEX_PROFILE_SUFFIX = ".config.toml";
const CODEX_MANAGED_PROFILE_COMMENT =
  "# Managed by `arcadia go-broker install`. Select this named profile in Codex Desktop for an Arcadia-governed task.";

export interface ProviderExecutables {
  codex: string;
  claude: string;
  opencode: string;
}

export interface BrokerExecutables {
  go: ProviderExecutables;
  enroll: ProviderExecutables;
  preserve: ProviderExecutables;
  advance: ProviderExecutables;
  workMonitor: ProviderExecutables;
  brief: ProviderExecutables;
}

/** The providers the protected broker installs launchers for, in registry order. */
function brokerAgents(): Array<keyof ProviderExecutables> {
  return [...SESSION_AGENTS] as Array<keyof ProviderExecutables>;
}

export interface AgentSetupPaths {
  codexConfig: string;
  codexUnattendedProfile: string;
  codexProfileConfigs: string[];
  codexManagedRules: string;
  codexRulesDirectory: string;
  codexSkillDirectory: string;
  codexSkill: string;
  codexAgentAskSkillDirectory: string;
  codexAgentAskSkill: string;
  claudeSettings: string;
  /** Claude Code's per-user state file, where each folder's trust answer lives. */
  claudeState: string;
  claudeSkill: string;
  claudeAgentAskSkill: string;
}

export interface AgentSetupStatus {
  ready: boolean;
  issues: string[];
  paths: AgentSetupPaths;
  checks: {
    preservationLauncher: boolean;
    brokerExecutables: boolean;
    codexGuardrails: boolean;
    codexWorktreeDirectories: boolean;
    codexNativeProfile: boolean;
    noLegacyCodexSandbox: boolean;
    codexDefaultPermissions: boolean;
    codexProfileGuardrails: boolean;
    codexRule: boolean;
    noLegacyCodexRules: boolean;
    managedSkill: boolean;
    sharedClaudeSkill: boolean;
    managedAgentAskSkill: boolean;
    sharedClaudeAgentAskSkill: boolean;
    claudePermission: boolean;
    noLegacyClaudePermissions: boolean;
    claudeSandbox: boolean;
    claudeBypassDisabled: boolean;
    claudeWorktreeDirectories: boolean;
    claudeWorkspaceTrust: boolean;
    codexWorkspaceTrust: boolean;
  };
  workspaceTrust: WorkspaceTrustStatus;
}

/**
 * Codex asks "do you trust this folder?" the first time it opens a repository,
 * and resolves a linked worktree to its main checkout before looking the answer
 * up. Recording trust at each configured Project's repository root therefore
 * covers every prepared worktree of that Project without trusting the shared
 * worktree roots themselves.
 */
export interface WorkspaceTrustStatus {
  /** Project repositories that must carry a trusted entry. */
  required: string[];
  /** Required repositories whose trusted entry is absent. */
  missing: string[];
  /** Configured repository paths Arcadia will never trust, with the reason. */
  refused: Array<{ repository: string; reason: string }>;
}

export interface ConfigureAgentSetupOptions {
  home: string;
  executables: BrokerExecutables;
  skillTemplate: string;
  agentAskSkillTemplate: string;
  /** Repository roots of the configured Arcadia Projects; the only paths trust may name. */
  projectRepositories?: string[];
  now?: Date;
}

export interface ConfigureAgentSetupResult {
  changed: string[];
  backups: string[];
  status: AgentSetupStatus;
}

export function resolveAgentSetupPaths(home: string): AgentSetupPaths {
  const resolvedHome = path.resolve(home);
  const codexDirectory = path.join(resolvedHome, ".codex");
  const codexSkillDirectory = path.join(resolvedHome, ".codex", "skills", "arcadia-go");
  const codexAgentAskSkillDirectory = path.join(resolvedHome, ".codex", "skills", "arcadia-agent-ask");
  const codexUnattendedProfile = path.join(codexDirectory, "arcadia-unattended.config.toml");
  return {
    codexConfig: path.join(resolvedHome, ".codex", "config.toml"),
    codexUnattendedProfile,
    codexProfileConfigs: [...new Set([...listCodexProfileConfigs(codexDirectory), codexUnattendedProfile])],
    codexManagedRules: path.join(resolvedHome, ".codex", "rules", "arcadia.rules"),
    codexRulesDirectory: path.join(resolvedHome, ".codex", "rules"),
    codexSkillDirectory,
    codexSkill: path.join(codexSkillDirectory, "SKILL.md"),
    codexAgentAskSkillDirectory,
    codexAgentAskSkill: path.join(codexAgentAskSkillDirectory, "SKILL.md"),
    claudeSettings: path.join(resolvedHome, ".claude", "settings.json"),
    claudeState: path.join(resolvedHome, ".claude.json"),
    claudeSkill: path.join(resolvedHome, ".claude", "skills", "arcadia-go"),
    claudeAgentAskSkill: path.join(resolvedHome, ".claude", "skills", "arcadia-agent-ask")
  };
}

export function renderManagedSkill(template: string, executables: BrokerExecutables): string {
  const agentPlaceholder = (agent: keyof ProviderExecutables): string => `__ARCADIA_${agent.toUpperCase()}_`;
  const operations: Array<[keyof BrokerExecutables, string]> = [
    ["go", "GO_BROKER"],
    ["enroll", "ENROLL_BROKER"],
    ["preserve", "PRESERVE_BROKER"],
    ["advance", "ADVANCE_BROKER"],
    ["workMonitor", "WORK_MONITOR_BROKER"],
    ["brief", "BRIEF_BROKER"]
  ];
  const placeholders = operations.flatMap(([, suffix]) =>
    brokerAgents().map((agent) => `${agentPlaceholder(agent)}${suffix}__`)
  );
  if (placeholders.some((placeholder) => !template.includes(placeholder))) {
    throw validationError("The bundled arcadia-go skill template is missing broker placeholders.");
  }
  let rendered = template;
  for (const [operation, suffix] of operations) {
    for (const agent of brokerAgents()) {
      rendered = rendered.replaceAll(`${agentPlaceholder(agent)}${suffix}__`, executables[operation][agent]);
    }
  }
  return rendered;
}

export function renderAgentAskManagedSkill(template: string): string {
  if (!template.includes(MANAGED_AGENT_ASK_SKILL_MARKER)) {
    throw validationError("The bundled arcadia-agent-ask skill template is missing its managed marker.");
  }
  return template;
}

export function configureGoBrokerAgents(options: ConfigureAgentSetupOptions): ConfigureAgentSetupResult {
  const paths = resolveAgentSetupPaths(options.home);
  const changed: string[] = [];
  const backups: string[] = [];
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[-:.]/g, "");
  const skill = renderManagedSkill(options.skillTemplate, options.executables);
  const agentAskSkill = renderAgentAskManagedSkill(options.agentAskSkillTemplate);
  validateGoBrokerAgentSetupInputs(options);

  updateCodexConfigs(paths, planWorkspaceTrust(options.projectRepositories ?? [], options.home).trusted, changed, backups, timestamp);
  updateCodexRules(paths, options.executables, changed, backups, timestamp);
  updateManagedSkill(paths.codexSkill, skill, MANAGED_SKILL_MARKER, changed, backups, timestamp);
  updateManagedSkill(paths.codexAgentAskSkill, agentAskSkill, MANAGED_AGENT_ASK_SKILL_MARKER, changed, backups, timestamp);
  updateClaudeSettings(paths.claudeSettings, options, changed, backups, timestamp);
  updateClaudeWorkspaceTrust(paths.claudeState, claudeWorktreeRoot(options.home), changed, backups, timestamp);
  updateClaudeSkillLink(paths.claudeSkill, paths.codexSkillDirectory, changed, backups, timestamp);
  updateClaudeSkillLink(paths.claudeAgentAskSkill, paths.codexAgentAskSkillDirectory, changed, backups, timestamp);

  const status = inspectGoBrokerAgentSetup(options);
  if (!status.ready) {
    throw validationError("Agent configuration did not pass its post-install verification.", {
      issues: status.issues,
      changed,
      backups
    });
  }
  return { changed, backups, status };
}

/** Validate every user-owned format before an installer creates or changes anything. */
export function validateGoBrokerAgentSetupInputs(options: ConfigureAgentSetupOptions): void {
  const paths = resolveAgentSetupPaths(options.home);
  renderManagedSkill(options.skillTemplate, options.executables);
  renderAgentAskManagedSkill(options.agentAskSkillTemplate);
  setCodexPermissionProfile(readOptional(paths.codexConfig), options.home);
  readClaudeSettings(paths.claudeSettings, true);
  readClaudeState(paths.claudeState, true);
  assertManagedSkillDirectoryIsSafe(paths.codexSkillDirectory);
  assertManagedSkillDirectoryIsSafe(paths.codexAgentAskSkillDirectory);
}

export function inspectGoBrokerAgentSetup(options: ConfigureAgentSetupOptions): AgentSetupStatus {
  const paths = resolveAgentSetupPaths(options.home);
  const expectedSkill = renderManagedSkill(options.skillTemplate, options.executables);
  const expectedAgentAskSkill = renderAgentAskManagedSkill(options.agentAskSkillTemplate);
  const codexConfig = readOptional(paths.codexConfig);
  const codexRule = readOptional(paths.codexManagedRules);
  const legacyCodexRules = findLegacyCodexRules(paths.codexRulesDirectory, paths.codexManagedRules);
  const claude = readClaudeSettings(paths.claudeSettings, false);
  const allow = claude?.permissions?.allow ?? [];
  const additionalDirectories = claude?.permissions?.additionalDirectories ?? [];
  const expectedDirectories = expectedCodexWorktreeRoots(options.home);
  const trustPlan = planWorkspaceTrust(options.projectRepositories ?? [], options.home);
  const workspaceTrust: WorkspaceTrustStatus = {
    required: trustPlan.trusted,
    missing: trustPlan.trusted.filter((repository) => codexTrustLevel(codexConfig, repository) !== "trusted"),
    refused: trustPlan.refused
  };
  const checks = {
    preservationLauncher: brokerAgents().every((agent) => existsSync(options.executables.preserve[agent])),
    brokerExecutables: Object.values(options.executables).every((providers) =>
      brokerAgents().every((agent) => existsSync(providers[agent]))
    ),
    codexGuardrails:
      topLevelTomlValue(codexConfig, "approval_policy") === "on-request",
    codexWorktreeDirectories: hasExpectedCodexWorktreeRoots(codexConfig, expectedCodexWorktreeRoots(options.home)),
    codexNativeProfile: hasNativeUnattendedProfile(codexConfig, expectedCodexWorktreeRoots(options.home)),
    noLegacyCodexSandbox: !hasLegacyCodexSandbox(codexConfig),
    // Codex refuses to load a config that defines [permissions.*] profiles without a default.
    codexDefaultPermissions: !hasCodexPermissionProfiles(codexConfig) || hasTopLevelTomlKey(codexConfig, "default_permissions"),
    codexProfileGuardrails: !paths.codexProfileConfigs.some((file) =>
      codexProfileName(file) === "arcadia-unattended" && hasLegacyCodexSandbox(readOptional(file))
    ),
    codexRule: codexRule === managedCodexRule(options.executables),
    noLegacyCodexRules: legacyCodexRules.length === 0,
    managedSkill: readOptional(paths.codexSkill) === expectedSkill,
    sharedClaudeSkill: symlinkResolvesTo(paths.claudeSkill, paths.codexSkillDirectory),
    managedAgentAskSkill: readOptional(paths.codexAgentAskSkill) === expectedAgentAskSkill,
    sharedClaudeAgentAskSkill: symlinkResolvesTo(paths.claudeAgentAskSkill, paths.codexAgentAskSkillDirectory),
    // Every provider launcher is request-only; the worker owns reconciliation.
    claudePermission: agentCallableExecutables(options.executables).every((providers) =>
      brokerAgents().every((agent) => allow.includes(`Bash(${providers[agent]})`))
    ),
    noLegacyClaudePermissions: allow.every((entry) =>
      !isLegacyClaudePermission(entry) &&
      (!/arcadia-(?:go|enroll|preserve|advance|work-monitor|brief)-broker-/.test(entry) ||
        agentCallableExecutables(options.executables).some((providers) =>
          brokerAgents().some((agent) => entry === `Bash(${providers[agent]})`)
        ))
    ),
    claudeSandbox: claude?.sandbox?.enabled === true && claude?.sandbox?.failIfUnavailable === true,
    claudeBypassDisabled: claude?.permissions?.disableBypassPermissionsMode === "disable",
    claudeWorktreeDirectories: expectedDirectories.every((directory) => additionalDirectories.includes(directory)),
    claudeWorkspaceTrust: isClaudeFolderTrusted(readClaudeState(paths.claudeState, false), claudeWorktreeRoot(options.home)),
    codexWorkspaceTrust: workspaceTrust.missing.length === 0
  };
  const issues = [
    ...Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
    ...workspaceTrust.missing.map((repository) => `codexWorkspaceTrust missing: ${repository}`)
  ];
  return { ready: issues.length === 0, issues, paths, checks, workspaceTrust };
}

export function removeArcadiaGoRules(content: string): string {
  const ranges = prefixRuleRanges(content).filter(({ start, end }) =>
    isArcadiaGoPrefixRule(content.slice(start, end))
  );
  if (ranges.length === 0) return content;
  let output = content;
  for (const range of ranges.reverse()) {
    let end = range.end;
    if (output[end] === "\r" && output[end + 1] === "\n") end += 2;
    else if (output[end] === "\n") end += 1;
    output = output.slice(0, range.start) + output.slice(end);
  }
  return output.replace(/\n{3,}/g, "\n\n");
}

/**
 * Decide which configured Project repositories may be trusted. Only an existing
 * Git repository root qualifies, and never the home directory, a shared
 * worktree root, or any directory that contains one of those or another
 * configured Project — trusting such a parent would silently trust everything
 * beneath it.
 */
export function planWorkspaceTrust(
  repositories: string[],
  home: string
): { trusted: string[]; refused: Array<{ repository: string; reason: string }> } {
  const resolvedHome = canonicalPath(home);
  const worktreeRoots = expectedCodexWorktreeRoots(home).map(canonicalPath);
  const candidates = [...new Set(repositories.filter((repository) => path.isAbsolute(repository)).map(canonicalPath))];
  const trusted: string[] = [];
  const refused: Array<{ repository: string; reason: string }> = [];
  for (const repository of [...new Set(repositories.filter((repository) => !path.isAbsolute(repository)))]) {
    refused.push({ repository, reason: "not an absolute path" });
  }
  for (const repository of candidates) {
    const reason =
      isSameOrAncestor(repository, resolvedHome)
        ? "is the home directory or one of its parents"
        : worktreeRoots.some((root) => isSameOrAncestor(repository, root) || isSameOrAncestor(root, repository))
          ? "is, contains, or lies inside a shared agent worktree root"
          : candidates.some((other) => other !== repository && isSameOrAncestor(repository, other))
            ? "is a parent directory of another configured Project repository"
            : !isGitWorktreeRoot(repository)
              ? "is not a Git repository root"
              : null;
    if (reason) refused.push({ repository, reason });
    else trusted.push(repository);
  }
  return { trusted: trusted.sort(), refused };
}

function isSameOrAncestor(ancestor: string, candidate: string): boolean {
  const relative = path.relative(ancestor, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Git itself, not a `.git` marker, decides whether a path is a worktree root. */
function isGitWorktreeRoot(candidate: string): boolean {
  try {
    const topLevel = execFileSync("git", ["-C", candidate, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return canonicalPath(topLevel) === candidate;
  } catch {
    return false;
  }
}

function canonicalPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function codexProjectHeader(repository: string): RegExp {
  return new RegExp(`^\\s*\\[\\s*projects\\s*\\.\\s*(?:${escapeRegExp(JSON.stringify(repository))}|${escapeRegExp(`'${repository}'`)})\\s*\\]\\s*(?:#.*)?$`);
}

function codexTrustLevel(content: string, repository: string): string | null {
  const lines = codexTomlSyntax(content);
  const starts = lines.flatMap((line, index) => codexProjectHeader(repository).test(line) ? [index] : []);
  if (starts.length > 1) throw validationError("Codex config contains duplicate project trust tables.", { repository });
  if (starts.length === 0) return null;
  let trust: string | null = null;
  let entries = 0;
  for (let index = starts[0] + 1; index < lines.length && !/^\s*\[/.test(lines[index]); index += 1) {
    if (/^\s*["']trust_level["']\s*=/.test(lines[index])) {
      throw validationError("Codex config has unsupported project trust syntax.", { repository });
    }
    if (!/^\s*trust_level\s*=/.test(lines[index])) continue;
    entries += 1;
    if (lines[index].includes("@multiline@")) {
      throw validationError("Codex project trust uses unsupported multiline syntax.", { repository });
    }
    const match = lines[index].match(/^\s*trust_level\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/);
    if (match) trust = match[1] ?? match[2];
  }
  if (entries > 1) throw validationError("Codex config contains duplicate trust_level entries.", { repository });
  return trust;
}

/**
 * Record `trust_level = "trusted"` for each repository, editing only the lines
 * that must change: an existing trusted entry is left alone, an existing table
 * gains or corrects its one trust line, and a missing table is inserted ahead
 * of the managed permission profile so a later install finds it in place.
 */
export function setCodexWorkspaceTrust(content: string, repositories: string[]): string {
  const lines = content.split("\n");
  for (const repository of repositories) {
    if (codexTrustLevel(lines.join("\n"), repository) === "trusted") continue;
    const header = codexProjectHeader(repository);
    const start = codexTomlSyntax(lines.join("\n")).findIndex((line) => header.test(line));
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && !/^\s*\[/.test(codexTomlSyntax(lines.join("\n"))[end])) end += 1;
      const existing = codexTomlSyntax(lines.join("\n")).slice(start + 1, end).findIndex((line) => /^\s*trust_level\s*=/.test(line));
      if (existing >= 0) lines[start + 1 + existing] = 'trust_level = "trusted"';
      else lines.splice(start + 1, 0, 'trust_level = "trusted"');
      continue;
    }
    const managed = lines.findIndex((line) => line === CODEX_MANAGED_PROFILE_COMMENT);
    const at = managed < 0 ? lines.length : managed;
    lines.splice(at, 0, `[projects.${JSON.stringify(repository)}]`, 'trust_level = "trusted"', "");
  }
  return lines.join("\n");
}

function updateCodexConfigs(
  paths: AgentSetupPaths,
  trustedRepositories: string[],
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  const updated = setCodexWorkspaceTrust(
    setCodexPermissionProfile(readOptional(paths.codexConfig), path.dirname(path.dirname(paths.codexConfig))),
    trustedRepositories
  );
  writeManagedFile(paths.codexConfig, updated, changed, backups, timestamp, true);
  if (existsSync(paths.codexUnattendedProfile)) {
    writeManagedFile(
      paths.codexUnattendedProfile,
      "# Retired by `arcadia go-broker install`: use the named permissions.arcadia-unattended profile in config.toml.\n",
      changed,
      backups,
      timestamp,
      true
    );
  }
}

function updateCodexRules(
  paths: AgentSetupPaths,
  executables: BrokerExecutables,
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  mkdirSync(paths.codexRulesDirectory, { recursive: true });
  for (const name of readdirSync(paths.codexRulesDirectory).filter((candidate) => candidate.endsWith(".rules"))) {
    const file = path.join(paths.codexRulesDirectory, name);
    if (file === paths.codexManagedRules) continue;
    const current = readFileSync(file, "utf8");
    const updated = removeArcadiaGoRules(current);
    writeManagedFile(file, updated, changed, backups, timestamp, true);
  }
  writeManagedFile(paths.codexManagedRules, managedCodexRule(executables), changed, backups, timestamp, false);
}

function updateManagedSkill(
  skillFile: string,
  skill: string,
  marker: string,
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  if (existsSync(skillFile) && !readFileSync(skillFile, "utf8").includes(marker)) {
    const backup = `${skillFile}.arcadia-backup-${timestamp}`;
    copyFileSync(skillFile, backup);
    backups.push(backup);
  }
  writeManagedFile(skillFile, skill, changed, backups, timestamp, false);
}

function updateClaudeSettings(
  file: string,
  options: ConfigureAgentSetupOptions,
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  const settings = readClaudeSettings(file, true) ?? {};
  const permissions = settings.permissions ?? {};
  const allow = (permissions.allow ?? []).filter(
    (entry) => !isLegacyClaudePermission(entry) && !/arcadia-(?:go|enroll|preserve|advance|work-monitor|brief)-broker-/.test(entry)
  );
  for (const providers of agentCallableExecutables(options.executables)) {
    for (const agent of brokerAgents()) allow.push(`Bash(${providers[agent]})`);
  }
  const additionalDirectories = [...(permissions.additionalDirectories ?? [])];
  for (const directory of expectedCodexWorktreeRoots(options.home)) {
    if (!additionalDirectories.includes(directory)) additionalDirectories.push(directory);
  }
  settings.permissions = {
    ...permissions,
    allow,
    additionalDirectories,
    disableBypassPermissionsMode: "disable"
  };
  settings.sandbox = { ...settings.sandbox, enabled: true, failIfUnavailable: true };
  writeManagedFile(file, `${JSON.stringify(settings, null, 2)}\n`, changed, backups, timestamp, true);
}

/**
 * Claude Code asks "do you trust this folder?" the first time it opens a path
 * it has no answer for, and honors an answer recorded on any ancestor. Sessions
 * for a Project outside the fixed home set are prepared under the shared
 * `~/.claude/worktrees/<action>-<stamp>/<repo>` root, which no install ever
 * answered (pmark/arcadia#698). Recording the answer once on that root covers
 * every fresh candidate beneath it. Only that Arcadia-owned root is trusted,
 * never a Project repository or the home directory.
 */
function updateClaudeWorkspaceTrust(
  file: string,
  root: string,
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  // A running Claude Code rewrites this file on its own schedule. Re-read it just
  // before replacing it and redo the merge if it moved, so the install cannot
  // overwrite a concurrent update with an older snapshot; a few attempts bound
  // the window to one that a live Session would have to hit every time.
  for (let attempt = 0; attempt < CLAUDE_STATE_MERGE_ATTEMPTS; attempt += 1) {
    const before = readOptional(file);
    const state = readClaudeState(file, true) ?? {};
    if (isClaudeFolderTrusted(state, root)) return;
    const projects = state.projects ?? {};
    state.projects = { ...projects, [root]: { ...(projects[root] ?? {}), hasTrustDialogAccepted: true } };
    if (readOptional(file) !== before && attempt < CLAUDE_STATE_MERGE_ATTEMPTS - 1) continue;
    writeManagedFile(file, `${JSON.stringify(state, null, 2)}\n`, changed, backups, timestamp, true);
    return;
  }
}

const CLAUDE_STATE_MERGE_ATTEMPTS = 3;

function claudeWorktreeRoot(home: string): string {
  return path.join(path.resolve(home), ".claude", "worktrees");
}

function isClaudeFolderTrusted(state: ClaudeState | null, folder: string): boolean {
  return state?.projects?.[folder]?.hasTrustDialogAccepted === true;
}

function updateClaudeSkillLink(
  claudeSkill: string,
  codexSkillDirectory: string,
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  mkdirSync(path.dirname(claudeSkill), { recursive: true });
  if (pathExistsIncludingDanglingLink(claudeSkill)) {
    if (symlinkResolvesTo(claudeSkill, codexSkillDirectory)) return;
    const backup = `${claudeSkill}.arcadia-backup-${timestamp}`;
    renameSync(claudeSkill, backup);
    backups.push(backup);
  }
  const temporary = `${claudeSkill}.arcadia-${process.pid}`;
  rmSync(temporary, { force: true, recursive: true });
  symlinkSync(codexSkillDirectory, temporary);
  renameSync(temporary, claudeSkill);
  changed.push(claudeSkill);
}

function managedCodexRule(executables: BrokerExecutables): string {
  return [
    "# Managed by `arcadia go-broker install`. Agent `go` submits a bounded host-worker request.",
    ...agentCallableExecutables(executables).flatMap((providers) =>
      brokerAgents().flatMap((agent) => [
        "prefix_rule(",
        `    pattern = [${JSON.stringify(providers[agent])}],`,
        "    decision = \"allow\",",
        ")"
      ])
    ),
    ""
  ].join("\n");
}

function agentCallableExecutables(executables: BrokerExecutables): ProviderExecutables[] {
  return [executables.go, executables.enroll, executables.advance, executables.preserve, executables.workMonitor, executables.brief];
}

function setTopLevelTomlValues(content: string, values: Record<string, string>): string {
  const lines = content ? content.replace(/\r\n/g, "\n").split("\n") : [];
  const syntax = codexTomlSyntax(content);
  const firstTable = syntax.findIndex((line) => /^\s*\[/.test(line));
  const boundary = firstTable < 0 ? lines.length : firstTable;
  const additions: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const matches: number[] = [];
    for (let index = 0; index < boundary; index += 1) {
      if (new RegExp(`^\\s*${key}\\s*=`).test(syntax[index])) matches.push(index);
    }
    if (matches.length > 1) {
      throw validationError(`Codex config contains duplicate top-level ${key} entries.`, { key });
    }
    const rendered = `${key} = ${JSON.stringify(value)}`;
    if (matches.length === 1) lines[matches[0]] = rendered;
    else additions.push(rendered);
  }
  if (additions.length > 0) lines.splice(boundary, 0, ...additions, boundary > 0 ? "" : "");
  return `${lines.join("\n").replace(/^\n+|\n+$/g, "")}\n`;
}

/** Built-in Codex permission profile equivalent to each retired `sandbox_mode`. */
const CODEX_SANDBOX_MODE_PERMISSIONS: Record<string, string> = {
  "workspace-write": ":workspace",
  "read-only": ":read-only",
  "danger-full-access": ":danger-full-access"
};

function setCodexPermissionProfile(content: string, home: string): string {
  assertSupportedCodexManagedSyntax(content);
  if (hasExactManagedCodexPermissions(content, expectedCodexWorktreeRoots(home))) return content;
  // Codex refuses a config with [permissions.*] profiles but no top-level default_permissions,
  // so carry the retired sandbox_mode forward as its built-in profile; never overwrite a choice.
  const defaultPermissions = hasTopLevelTomlKey(content, "default_permissions")
    ? null
    : CODEX_SANDBOX_MODE_PERMISSIONS[topLevelTomlValue(content, "sandbox_mode") ?? ""] ?? ":workspace";
  let withoutManagedProfile = removeTomlTable(removeTopLevelTomlKeys(content, ["sandbox_mode"]), "sandbox_workspace_write")
    .split("\n")
    .filter((line) => line !== CODEX_MANAGED_PROFILE_COMMENT)
    .join("\n");
  const managedTables = codexTomlSyntax(content).flatMap((line) => {
    const header = line.match(/^\s*\[(permissions\.arcadia-unattended(?:\.[^\]]+)?)\]\s*(?:#.*)?$/);
    return header ? [header[1]] : [];
  });
  for (const table of new Set(managedTables)) withoutManagedProfile = removeTomlTable(withoutManagedProfile, table);
  const withTopLevel = setTopLevelTomlValues(withoutManagedProfile, {
    approval_policy: "on-request",
    ...(defaultPermissions === null ? {} : { default_permissions: defaultPermissions })
  });
  const roots = expectedCodexWorktreeRoots(home);
  return `${withTopLevel.replace(/\n+$/, "")}\n\n${[
    CODEX_MANAGED_PROFILE_COMMENT,
    "[permissions.arcadia-unattended]",
    'description = "Arcadia local worktrees: edit and run locally; network and credential files remain denied."',
    'extends = ":workspace"',
    "",
    "[permissions.arcadia-unattended.workspace_roots]",
    ...roots.map((root) => `${JSON.stringify(root)} = true`),
    "",
    '[permissions.arcadia-unattended.filesystem.":workspace_roots"]',
    '".env" = "deny"',
    '".env.*" = "deny"',
    '"**/*.env" = "deny"',
    '"**/.env" = "deny"',
    "",
    "[permissions.arcadia-unattended.network]",
    "enabled = false",
    ""
  ].join("\n")}`;
}

/** Mask multiline string bodies for line-oriented edits, retaining all original bytes.
 * This is lexical scope tracking only; managed values still require exact scalar proof.
 */
function codexTomlSyntax(content: string): string[] {
  let multiline = "";
  const result = content.replace(/\r\n/g, "\n").split("\n").map((line) => {
    let syntax = "";
    let quote = "";
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (multiline) {
        let escapes = 0;
        for (let previous = index - 1; previous >= 0 && line[previous] === "\\"; previous -= 1) escapes += 1;
        if (line.startsWith(multiline, index) && (multiline[0] === "'" || escapes % 2 === 0)) {
          index += 2;
          multiline = "";
        }
        continue;
      }
      if (quote) {
        syntax += char;
        if (char === "\\" && quote === '"') syntax += line[++index] ?? "";
        else if (char === quote) quote = "";
      } else if (char === "#") {
        break;
      } else if ((char === '"' || char === "'") && line.startsWith(char.repeat(3), index)) {
        multiline = char.repeat(3);
        syntax += "@multiline@";
        index += 2;
      } else {
        syntax += char;
        if (char === '"' || char === "'") quote = char;
      }
    }
    // Whitespace around the owned bare table path does not change its meaning.
    if (/^\s*\[\s*permissions\s*\.\s*arcadia-unattended(?:\s*[.\]])/.test(syntax)) {
      return syntax.replace(/^\s*\[\s*/, "[").replace(/\s*\]\s*$/, "]").replace(/\s*\.\s*/g, ".");
    }
    return syntax;
  });
  if (multiline) throw validationError("Codex config contains an unterminated multiline string.");
  return result;
}

/** Classify one TOML key segment, including quoted Unicode-equivalent spellings.
 * This does not parse values; it prevents aliases from bypassing managed guards.
 */
function codexTomlLeadingKey(text: string): { key: string; rest: string; quoted: boolean } | null {
  const match = text.match(/^\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*(?=[.=\]])/);
  if (!match) return null;
  const token = match[1];
  let key = token;
  if (token.startsWith("'")) key = token.slice(1, -1);
  else if (token.startsWith('"')) {
    key = "";
    const escapes: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
    for (let index = 1; index < token.length - 1; index += 1) {
      if (token[index] !== "\\") { key += token[index]; continue; }
      const escape = token[++index];
      if (escape === "u" || escape === "U") {
        const count = escape === "u" ? 4 : 8;
        const digits = token.slice(index + 1, index + 1 + count);
        const codePoint = Number.parseInt(digits, 16);
        if (!new RegExp(`^[0-9a-fA-F]{${count}}$`).test(digits) || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          throw validationError("Codex config has unsupported quoted key syntax.");
        }
        key += String.fromCodePoint(codePoint);
        index += count;
      } else {
        if (!(escape in escapes)) throw validationError("Codex config has unsupported quoted key syntax.");
        key += escapes[escape];
      }
    }
  }
  return { key, rest: text.slice(match[0].length), quoted: token.startsWith('"') || token.startsWith("'") };
}

/** Refuse ambiguous structures before any file is written instead of guessing their scope. */
function assertSupportedCodexManagedSyntax(content: string): void {
  let root = true;
  let managed = false;
  let permissionsParent = false;
  let defaults = 0;
  for (const line of codexTomlSyntax(content)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (/^\s*\[/.test(line)) {
      root = false;
      const firstKey = codexTomlLeadingKey(line.replace(/^\s*\[\[?/, ""));
      permissionsParent = firstKey?.key === "permissions" && /^\]\s*$/.test(firstKey.rest);
      const secondKey = firstKey?.rest.startsWith(".") ? codexTomlLeadingKey(firstKey.rest.slice(1)) : null;
      managed = firstKey?.key === "permissions" && secondKey?.key === "arcadia-unattended";
      if (managed && !/^\s*\[permissions\.arcadia-unattended(?:\.[^\]]+)?\]\s*$/.test(line)) {
        throw validationError("Codex config has an unsupported managed permission table spelling.");
      }
    } else if (permissionsParent && codexTomlLeadingKey(line)?.key === "arcadia-unattended") {
      throw validationError("Codex config has an unsupported inline or dotted managed permission profile.");
    } else if (managed && line.includes("@multiline@")) {
      throw validationError("Codex managed permission values use unsupported multiline syntax.");
    } else if (root && /^\s*default_permissions\s*=/.test(line)) {
      defaults += 1;
      if (defaults > 1 || !/^\s*default_permissions\s*=\s*(?:"[^"\\]+"|'[^']+')\s*(?:#.*)?$/.test(line)) {
        throw validationError("Codex config has duplicate or unsupported default_permissions entries.");
      }
    } else if (root) {
      const firstKey = codexTomlLeadingKey(line);
      if (firstKey?.key === "permissions" || (firstKey?.quoted && ["approval_policy", "default_permissions", "sandbox_mode"].includes(firstKey.key))) {
        throw validationError("Codex config has unsupported managed root syntax.");
      }
    }
  }
}

/** Only the scalar-only syntax emitted for our managed profile supplies no-op proof.
 * Unknown keys, duplicate tables/entries and unsupported syntax require repair.
 */
function hasExactManagedCodexPermissions(content: string, expectedRoots: string[]): boolean {
  if (hasLegacyCodexSandbox(content)) return false;
  const expected = new Map<string, Map<string, string | boolean>>([
    ["permissions.arcadia-unattended", new Map([["description", "Arcadia local worktrees: edit and run locally; network and credential files remain denied."], ["extends", ":workspace"]])],
    ["permissions.arcadia-unattended.workspace_roots", new Map(expectedRoots.map((root) => [root, true]))],
    ['permissions.arcadia-unattended.filesystem.":workspace_roots"', new Map([".env", ".env.*", "**/*.env", "**/.env"].map((key) => [key, "deny"]))],
    ["permissions.arcadia-unattended.network", new Map([["enabled", false]])]
  ]);
  let table = "";
  let approval = false;
  let defaultPermissions = false;
  const seenTables = new Set<string>();
  for (const line of codexTomlSyntax(content)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (/^\s*\[/.test(line)) {
      const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
      // Unrelated array tables and quoted names may contain brackets. Their
      // entries cannot prove or invalidate our owned scalar tables.
      table = header ? header[1].trim() : "<unrelated>";
      if (/^permissions\.arcadia-unattended(?:\.|$)/.test(table) && !expected.has(table)) return false;
      if (expected.has(table)) {
        if (seenTables.has(table)) return false;
        seenTables.add(table);
      }
      continue;
    }
    if (table !== "" && !expected.has(table)) continue;
    // Unrelated root values may use other TOML types; only managed root keys matter.
    if (table === "" && !/^\s*(?:approval_policy|default_permissions|["'](?:approval_policy|default_permissions)["'])\s*=/.test(line)) continue;
    const entry = line.match(/^\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|true|false)\s*(?:#.*)?$/);
    if (!entry) return false;
    let key: string;
    let value: string | boolean;
    try {
      key = entry[1].startsWith('"') ? JSON.parse(entry[1]) as string : entry[1].replace(/^'|'$/g, "");
      value = entry[2].startsWith('"') ? JSON.parse(entry[2]) as string : entry[2].startsWith("'") ? entry[2].slice(1, -1) : entry[2] === "true";
    } catch { return false; }
    if (table === "") {
      if (key === "approval_policy") {
        if (approval || value !== "on-request") return false;
        approval = true;
      } else if (key === "default_permissions") {
        if (defaultPermissions || typeof value !== "string" || !value) return false;
        defaultPermissions = true;
      }
    } else {
      const entries = expected.get(table)!;
      if (!entries.has(key) || entries.get(key) !== value) return false;
      entries.delete(key);
    }
  }
  return approval && defaultPermissions && seenTables.size === expected.size && [...expected.values()].every((entries) => entries.size === 0);
}

function removeTopLevelTomlKeys(content: string, keys: string[]): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const syntax = codexTomlSyntax(content);
  const firstTable = syntax.findIndex((line) => /^\s*\[/.test(line));
  const boundary = firstTable < 0 ? lines.length : firstTable;
  return lines.filter((line, index) => index >= boundary || !keys.some((key) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(syntax[index]))).join("\n");
}

function removeTomlTable(content: string, tableName: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const pattern = new RegExp(`^\\s*\\[${escapeRegExp(tableName)}\\]\\s*(?:#.*)?$`);
  for (let start = codexTomlSyntax(lines.join("\n")).findIndex((line) => pattern.test(line)); start >= 0; start = codexTomlSyntax(lines.join("\n")).findIndex((line) => pattern.test(line))) {
    const end = codexTomlSyntax(lines.join("\n")).findIndex((line, index) => index > start && /^\s*\[{1,2}[^\]]+\]{1,2}/.test(line));
    const boundary = end < 0 ? lines.length : end;
    // Comments can describe the next user table. Keep their exact text on repair.
    const comments = lines.slice(start + 1, boundary).filter((line) => /^\s*#/.test(line));
    lines.splice(start, boundary - start, ...comments);
  }
  return lines.join("\n");
}

function topLevelTomlValue(content: string, key: string): string | null {
  const lines = codexTomlSyntax(content);
  const syntax = codexTomlSyntax(content);
  const firstTable = syntax.findIndex((line) => /^\s*\[/.test(line));
  const boundary = firstTable < 0 ? lines.length : firstTable;
  for (let index = 0; index < boundary; index += 1) {
    const match = lines[index].match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`));
    if (match) return match[1] ?? match[2];
  }
  return null;
}

function hasTopLevelTomlKey(content: string, key: string): boolean {
  const lines = codexTomlSyntax(content);
  const syntax = codexTomlSyntax(content);
  const firstTable = syntax.findIndex((line) => /^\s*\[/.test(line));
  const boundary = firstTable < 0 ? lines.length : firstTable;
  return lines.slice(0, boundary).some((line) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line));
}

function hasCodexPermissionProfiles(content: string): boolean {
  return /^\s*\[permissions\.[^\]]+\]/m.test(content);
}

function hasExpectedCodexWorktreeRoots(content: string, expectedRoots: string[]): boolean {
  return hasNativeUnattendedProfile(content, expectedRoots);
}

function hasNativeUnattendedProfile(content: string, expectedRoots: string[]): boolean {
  return hasExactManagedCodexPermissions(content, expectedRoots);
}

function hasLegacyCodexSandbox(content: string): boolean {
  return codexTomlSyntax(content).some((line) => /^\s*sandbox_mode\s*=/.test(line) || /^\s*\[sandbox_workspace_write\]\s*$/.test(line));
}

function listCodexProfileConfigs(codexDirectory: string): string[] {
  if (!existsSync(codexDirectory)) return [];
  return readdirSync(codexDirectory)
    .filter((name) => name.endsWith(CODEX_PROFILE_SUFFIX))
    .map((name) => path.join(codexDirectory, name))
    .filter((file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

function codexProfileName(file: string): string {
  return path.basename(file, CODEX_PROFILE_SUFFIX);
}

function expectedCodexWorktreeRoots(home: string): string[] {
  const resolvedHome = path.resolve(home);
  return [
    path.join(resolvedHome, ".codex", "worktrees"),
    path.join(resolvedHome, ".claude", "worktrees"),
    path.join(resolvedHome, ".opencode", "worktrees")
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLegacyCodexRules(directory: string, managedFile: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const name of readdirSync(directory).filter((candidate) => candidate.endsWith(".rules"))) {
    const file = path.join(directory, name);
    if (file === managedFile) continue;
    const content = readFileSync(file, "utf8");
    if (prefixRuleRanges(content).some(({ start, end }) => isArcadiaGoPrefixRule(content.slice(start, end)))) {
      found.push(file);
    }
  }
  return found;
}

function isArcadiaGoPrefixRule(rule: string): boolean {
  const pattern = rule.match(/pattern\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  return (
    new RegExp(`arcadia-(?:go|preserve|advance|work-monitor|brief)-broker-(?:${brokerAgents().join("|")})`).test(pattern) ||
    /"[^"]*arcadia"\s*,\s*"go"/.test(pattern)
  );
}

function prefixRuleRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const expression = /\bprefix_rule\s*\(/g;
  for (let match = expression.exec(content); match; match = expression.exec(content)) {
    const lineStart = content.lastIndexOf("\n", match.index - 1) + 1;
    if (content.slice(lineStart, match.index).includes("#")) continue;
    const open = content.indexOf("(", match.index);
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    let comment = false;
    for (let index = open; index < content.length; index += 1) {
      const char = content[index];
      if (comment) {
        if (char === "\n") comment = false;
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "#") comment = true;
      else if (char === '"' || char === "'") quote = char;
      else if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          ranges.push({ start: match.index, end: index + 1 });
          expression.lastIndex = index + 1;
          break;
        }
      }
    }
  }
  return ranges;
}

function isLegacyClaudePermission(entry: string): boolean {
  return entry.startsWith("Bash(") && /(?:^|[(\s/])arcadia\s+(?:go|advance|work\s+monitor)(?:\s|\))/.test(entry);
}

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    additionalDirectories?: string[];
    disableBypassPermissionsMode?: string;
    [key: string]: unknown;
  };
  sandbox?: { enabled?: boolean; failIfUnavailable?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

interface ClaudeState {
  projects?: Record<string, { hasTrustDialogAccepted?: boolean; [key: string]: unknown }>;
  [key: string]: unknown;
}

function readClaudeState(file: string, strict: boolean): ClaudeState | null {
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (!strict) return null;
    throw validationError("Claude Code state is not valid JSON; Arcadia will not overwrite it.", {
      file,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const isObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (!isObject(parsed) || (parsed.projects !== undefined && (!isObject(parsed.projects) ||
    Object.values(parsed.projects).some((project) => !isObject(project))))) {
    if (!strict) return null;
    throw validationError("Claude Code state must be a JSON object whose projects are objects.", { file });
  }
  return parsed;
}

function readClaudeSettings(file: string, strict: boolean): ClaudeSettings | null {
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (!strict) return null;
    throw validationError("Claude settings are not valid JSON; Arcadia will not overwrite them.", {
      file,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    if (!strict) return null;
    throw validationError("Claude settings must contain a JSON object.", { file });
  }
  const settings = parsed as ClaudeSettings;
  if (settings.permissions !== undefined && (!settings.permissions || typeof settings.permissions !== "object" || Array.isArray(settings.permissions))) {
    if (!strict) return null;
    throw validationError("Claude settings permissions must be an object.", { file });
  }
  if (settings.permissions?.allow !== undefined && !isStringArray(settings.permissions.allow)) {
    if (!strict) return null;
    throw validationError("Claude settings permissions.allow must be an array of strings.", { file });
  }
  if (settings.permissions?.additionalDirectories !== undefined && !isStringArray(settings.permissions.additionalDirectories)) {
    if (!strict) return null;
    throw validationError("Claude settings permissions.additionalDirectories must be an array of strings.", { file });
  }
  if (settings.sandbox !== undefined && (!settings.sandbox || typeof settings.sandbox !== "object" || Array.isArray(settings.sandbox))) {
    if (!strict) return null;
    throw validationError("Claude settings sandbox must be an object.", { file });
  }
  return settings;
}

function assertManagedSkillDirectoryIsSafe(directory: string): void {
  if (!pathExistsIncludingDanglingLink(directory)) return;
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw validationError("The Codex arcadia-go skill path must be a real directory owned by this installer.", {
      directory,
      remedy: "Move the existing path aside, then rerun the installer."
    });
  }
}

function writeManagedFile(
  file: string,
  content: string,
  changed: string[],
  backups: string[],
  timestamp: string,
  backupExisting: boolean
): void {
  const current = readOptional(file);
  if (current === content) return;
  mkdirSync(path.dirname(file), { recursive: true });
  if (backupExisting && existsSync(file)) {
    const backup = `${file}.arcadia-backup-${timestamp}`;
    copyFileSync(file, backup);
    backups.push(backup);
  }
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o644;
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.arcadia-${process.pid}`);
  writeFileSync(temporary, content, { mode });
  renameSync(temporary, file);
  changed.push(file);
}

function readOptional(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function pathExistsIncludingDanglingLink(candidate: string): boolean {
  try {
    lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function symlinkResolvesTo(candidate: string, expected: string): boolean {
  try {
    if (!lstatSync(candidate).isSymbolicLink()) return false;
    return path.resolve(path.dirname(candidate), readlinkSync(candidate)) === path.resolve(expected);
  } catch {
    return false;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
