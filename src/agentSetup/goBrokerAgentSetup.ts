import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";

const MANAGED_SKILL_MARKER = "<!-- ARCADIA_MANAGED_SKILL -->";
const MANAGED_AGENT_ASK_SKILL_MARKER = "<!-- ARCADIA_MANAGED_AGENT_ASK_SKILL -->";
const CODEX_PROFILE_SUFFIX = ".config.toml";

export interface ProviderExecutables {
  codex: string;
  claude: string;
}

export interface BrokerExecutables {
  go: ProviderExecutables;
  preserve: ProviderExecutables;
  advance: ProviderExecutables;
  workMonitor: ProviderExecutables;
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
  };
}

export interface ConfigureAgentSetupOptions {
  home: string;
  executables: BrokerExecutables;
  skillTemplate: string;
  agentAskSkillTemplate: string;
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
    claudeSkill: path.join(resolvedHome, ".claude", "skills", "arcadia-go"),
    claudeAgentAskSkill: path.join(resolvedHome, ".claude", "skills", "arcadia-agent-ask")
  };
}

export function renderManagedSkill(template: string, executables: BrokerExecutables): string {
  const placeholders = [
    "__ARCADIA_CODEX_PRESERVE_BROKER__",
    "__ARCADIA_CLAUDE_PRESERVE_BROKER__",
    "__ARCADIA_CODEX_ADVANCE_BROKER__",
    "__ARCADIA_CLAUDE_ADVANCE_BROKER__",
    "__ARCADIA_CODEX_WORK_MONITOR_BROKER__",
    "__ARCADIA_CLAUDE_WORK_MONITOR_BROKER__"
  ];
  if (placeholders.some((placeholder) => !template.includes(placeholder))) {
    throw validationError("The bundled arcadia-go skill template is missing broker placeholders.");
  }
  return template
    .replaceAll("__ARCADIA_CODEX_PRESERVE_BROKER__", executables.preserve.codex)
    .replaceAll("__ARCADIA_CLAUDE_PRESERVE_BROKER__", executables.preserve.claude)
    .replaceAll("__ARCADIA_CODEX_ADVANCE_BROKER__", executables.advance.codex)
    .replaceAll("__ARCADIA_CLAUDE_ADVANCE_BROKER__", executables.advance.claude)
    .replaceAll("__ARCADIA_CODEX_WORK_MONITOR_BROKER__", executables.workMonitor.codex)
    .replaceAll("__ARCADIA_CLAUDE_WORK_MONITOR_BROKER__", executables.workMonitor.claude);
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

  updateCodexConfigs(paths, changed, backups, timestamp);
  updateCodexRules(paths, options.executables, changed, backups, timestamp);
  updateManagedSkill(paths.codexSkill, skill, MANAGED_SKILL_MARKER, changed, backups, timestamp);
  updateManagedSkill(paths.codexAgentAskSkill, agentAskSkill, MANAGED_AGENT_ASK_SKILL_MARKER, changed, backups, timestamp);
  updateClaudeSettings(paths.claudeSettings, options, changed, backups, timestamp);
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
  const checks = {
    preservationLauncher: existsSync(options.executables.preserve.codex) && existsSync(options.executables.preserve.claude),
    brokerExecutables: Object.values(options.executables).every((providers) =>
      existsSync(providers.codex) && existsSync(providers.claude)
    ),
    codexGuardrails:
      topLevelTomlValue(codexConfig, "approval_policy") === "on-request",
    codexWorktreeDirectories: hasExpectedCodexWorktreeRoots(codexConfig, expectedCodexWorktreeRoots(options.home)),
    codexNativeProfile: hasNativeUnattendedProfile(codexConfig, expectedCodexWorktreeRoots(options.home)),
    noLegacyCodexSandbox: !hasLegacyCodexSandbox(codexConfig),
    codexProfileGuardrails: !paths.codexProfileConfigs.some((file) =>
      codexProfileName(file) === "arcadia-unattended" && hasLegacyCodexSandbox(readOptional(file))
    ),
    codexRule: codexRule === managedCodexRule(options.executables),
    noLegacyCodexRules: legacyCodexRules.length === 0,
    managedSkill: readOptional(paths.codexSkill) === expectedSkill,
    sharedClaudeSkill: symlinkResolvesTo(paths.claudeSkill, paths.codexSkillDirectory),
    managedAgentAskSkill: readOptional(paths.codexAgentAskSkill) === expectedAgentAskSkill,
    sharedClaudeAgentAskSkill: symlinkResolvesTo(paths.claudeAgentAskSkill, paths.codexAgentAskSkillDirectory),
    // Reconciliation (`go`) mutates the shared Git common directory. It is a
    // host-controller operation, not a sandboxed coding-agent capability.
    claudePermission: agentCallableExecutables(options.executables).every((providers) => allow.includes(`Bash(${providers.claude})`)),
    noLegacyClaudePermissions: allow.every((entry) =>
      !isLegacyClaudePermission(entry) &&
      (!/arcadia-(?:go|preserve|advance|work-monitor)-broker-/.test(entry) ||
        agentCallableExecutables(options.executables).some((providers) => entry === `Bash(${providers.claude})`))
    ),
    claudeSandbox: claude?.sandbox?.enabled === true && claude?.sandbox?.failIfUnavailable === true,
    claudeBypassDisabled: claude?.permissions?.disableBypassPermissionsMode === "disable",
    claudeWorktreeDirectories: expectedDirectories.every((directory) => additionalDirectories.includes(directory))
  };
  const issues = [
    ...Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
  ];
  return { ready: issues.length === 0, issues, paths, checks };
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

function updateCodexConfigs(
  paths: AgentSetupPaths,
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  const updated = setCodexPermissionProfile(readOptional(paths.codexConfig), path.dirname(path.dirname(paths.codexConfig)));
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
    (entry) => !isLegacyClaudePermission(entry) && !/arcadia-(?:go|preserve|advance|work-monitor)-broker-/.test(entry)
  );
  for (const providers of agentCallableExecutables(options.executables)) {
    allow.push(`Bash(${providers.claude})`);
  }
  const additionalDirectories = [...(permissions.additionalDirectories ?? [])];
  for (const directory of [
    path.join(path.resolve(options.home), ".codex", "worktrees"),
    path.join(path.resolve(options.home), ".claude", "worktrees")
  ]) {
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
    "# Managed by `arcadia go-broker install`. Git-mutating `go` stays host-only.",
    ...agentCallableExecutables(executables).flatMap((providers) => [
      "prefix_rule(",
      `    pattern = [${JSON.stringify(providers.codex)}],`,
      "    decision = \"allow\",",
      ")"
    ]),
    ""
  ].join("\n");
}

function agentCallableExecutables(executables: BrokerExecutables): ProviderExecutables[] {
  return [executables.advance, executables.preserve, executables.workMonitor];
}

function setTopLevelTomlValues(content: string, values: Record<string, string>): string {
  const lines = content ? content.replace(/\r\n/g, "\n").split("\n") : [];
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const boundary = firstTable < 0 ? lines.length : firstTable;
  const additions: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const matches: number[] = [];
    for (let index = 0; index < boundary; index += 1) {
      if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) matches.push(index);
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

function setCodexPermissionProfile(content: string, home: string): string {
  let withoutManagedProfile = removeTomlTable(removeTopLevelTomlKeys(content, ["sandbox_mode"]), "sandbox_workspace_write")
    .split("\n")
    .filter((line) => line !== "# Managed by `arcadia go-broker install`. Select this named profile in Codex Desktop for an Arcadia-governed task.")
    .join("\n");
  for (const table of [
    "permissions.arcadia-unattended.workspace_roots",
    'permissions.arcadia-unattended.filesystem.":workspace_roots"',
    "permissions.arcadia-unattended.network",
    "permissions.arcadia-unattended"
  ]) withoutManagedProfile = removeTomlTable(withoutManagedProfile, table);
  const withTopLevel = setTopLevelTomlValues(withoutManagedProfile, {
    approval_policy: "on-request",
    default_permissions: "arcadia-unattended"
  });
  const roots = expectedCodexWorktreeRoots(home);
  return `${withTopLevel.replace(/\n+$/, "")}\n\n${[
    "# Managed by `arcadia go-broker install`. Select this named profile in Codex Desktop for an Arcadia-governed task.",
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

function removeTopLevelTomlKeys(content: string, keys: string[]): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const boundary = firstTable < 0 ? lines.length : firstTable;
  return lines.filter((line, index) => index >= boundary || !keys.some((key) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line))).join("\n");
}

function removeTomlTable(content: string, tableName: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const pattern = new RegExp(`^\\s*\\[${escapeRegExp(tableName)}\\]\\s*(?:#.*)?$`);
  for (let start = lines.findIndex((line) => pattern.test(line)); start >= 0; start = lines.findIndex((line) => pattern.test(line))) {
    const end = lines.findIndex((line, index) => index > start && /^\s*\[{1,2}[^\]]+\]{1,2}/.test(line));
    lines.splice(start, (end < 0 ? lines.length : end) - start);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function setTomlTableArray(content: string, file: string, tableName: string, key: string, values: string[]): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const tablePattern = new RegExp(`^\\s*\\[${escapeRegExp(tableName)}\\]\\s*(?:#.*)?$`);
  const tableIndexes = lines.flatMap((line, index) => tablePattern.test(line) ? [index] : []);
  if (tableIndexes.length > 1) {
    throw validationError(`Codex config contains duplicate [${tableName}] tables.`, { file, table: tableName });
  }
  if (tableIndexes.length === 0) {
    const rendered = `${key} = [${values.map((value) => JSON.stringify(value)).join(", ")}]`;
    const trimmed = lines.join("\n").replace(/\n+$/g, "");
    return `${trimmed}${trimmed ? "\n\n" : ""}[${tableName}]\n${rendered}\n`;
  }

  const tableStart = tableIndexes[0];
  const tableEnd = lines.findIndex((line, index) => index > tableStart && /^\s*\[{1,2}[^\]]+\]{1,2}/.test(line));
  const end = tableEnd < 0 ? lines.length : tableEnd;
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const keyIndexes = lines.flatMap((line, index) => index > tableStart && index < end && keyPattern.test(line) ? [index] : []);
  if (keyIndexes.length > 1) {
    throw validationError(`Codex config contains duplicate ${tableName}.${key} entries.`, { file, table: tableName, key });
  }
  const keyEnd = keyIndexes.length === 1 ? tomlArrayEnd(lines, keyIndexes[0], end, file) : null;
  const existing = keyIndexes.length === 1 ? tomlArrayValues(lines.slice(keyIndexes[0], keyEnd! + 1).join(" ")) : [];
  const merged = [...existing, ...values.filter((value) => !existing.includes(value))];
  const rendered = `${key} = [${merged.map((value) => JSON.stringify(value)).join(", ")}]`;
  if (keyIndexes.length === 1) {
    lines.splice(keyIndexes[0], keyEnd! - keyIndexes[0] + 1, rendered);
  } else {
    lines.splice(end, 0, rendered);
  }
  return `${lines.join("\n").replace(/^\n+|\n+$/g, "")}\n`;
}

function topLevelTomlValue(content: string, key: string): string | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const boundary = firstTable < 0 ? lines.length : firstTable;
  for (let index = 0; index < boundary; index += 1) {
    const match = lines[index].match(new RegExp(`^\\s*${key}\\s*=\\s*\"([^\"]+)\"`));
    if (match) return match[1];
  }
  return null;
}

function hasExpectedCodexWorktreeRoots(content: string, expectedRoots: string[]): boolean {
  return hasNativeUnattendedProfile(content, expectedRoots);
}

function hasNativeUnattendedProfile(content: string, expectedRoots: string[]): boolean {
  if (hasLegacyCodexSandbox(content)) return false;
  if (topLevelTomlValue(content, "default_permissions") !== "arcadia-unattended") return false;
  const roots = expectedRoots.every((root) => new RegExp(`^\\s*${escapeRegExp(JSON.stringify(root))}\\s*=\\s*true\\s*$`, "m").test(content));
  return roots &&
    /\[permissions\.arcadia-unattended\][\s\S]*?extends\s*=\s*":workspace"/.test(content) &&
    /\[permissions\.arcadia-unattended\.network\][\s\S]*?enabled\s*=\s*false/.test(content);
}

function hasLegacyCodexSandbox(content: string): boolean {
  return /^\s*sandbox_mode\s*=/m.test(content) || /^\s*\[sandbox_workspace_write\]\s*$/m.test(content);
}

function hasLegacyCodexWorktreeRoots(content: string, expectedRoots: string[]): boolean {
  const table = tomlTableBody(content, "sandbox_workspace_write");
  if (table === null) return false;
  const match = table.match(/^\s*writable_roots\s*=\s*\[([\s\S]*?)\]/m);
  if (!match) return false;
  const roots = tomlArrayValues(match[1]);
  return expectedRoots.every((root) => roots.includes(root));
}

function tomlArrayValues(line: string): string[] {
  return [...line.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'/g)].map((entry) =>
    entry[1] !== undefined ? (JSON.parse(`"${entry[1]}"`) as string) : entry[2]
  );
}

function tomlArrayEnd(lines: string[], start: number, limit: number, file: string): number {
  for (let index = start; index < limit; index += 1) {
    if (lines[index].includes("]")) return index;
  }
  throw validationError("Codex config contains an unterminated sandbox_workspace_write.writable_roots array.", {
    file,
    key: "sandbox_workspace_write.writable_roots"
  });
}

function tomlTableBody(content: string, tableName: string): string | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const tablePattern = new RegExp(`^\\s*\\[${escapeRegExp(tableName)}\\]\\s*(?:#.*)?$`);
  const tableIndexes = lines.flatMap((line, index) => tablePattern.test(line) ? [index] : []);
  if (tableIndexes.length !== 1) return null;
  const start = tableIndexes[0] + 1;
  const end = lines.findIndex((line, index) => index >= start && /^\s*\[{1,2}[^\]]+\]{1,2}/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
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

function expectedCodexApprovalPolicy(file: string, paths: AgentSetupPaths): string {
  return file === paths.codexConfig || codexProfileName(file) !== "arcadia-unattended" ? "on-request" : "never";
}

function expectedCodexWorktreeRoots(home: string): string[] {
  const resolvedHome = path.resolve(home);
  return [path.join(resolvedHome, ".codex", "worktrees"), path.join(resolvedHome, ".claude", "worktrees")];
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
    /arcadia-(?:go|preserve|advance|work-monitor)-broker-(?:codex|claude)/.test(pattern) ||
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
