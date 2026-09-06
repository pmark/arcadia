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

export interface BrokerExecutables {
  codex: string;
  claude: string;
}

export interface AgentSetupPaths {
  codexConfig: string;
  codexManagedRules: string;
  codexRulesDirectory: string;
  codexSkillDirectory: string;
  codexSkill: string;
  claudeSettings: string;
  claudeSkill: string;
}

export interface AgentSetupStatus {
  ready: boolean;
  issues: string[];
  paths: AgentSetupPaths;
  checks: {
    brokerExecutables: boolean;
    codexGuardrails: boolean;
    codexRule: boolean;
    noLegacyCodexRules: boolean;
    managedSkill: boolean;
    sharedClaudeSkill: boolean;
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
  now?: Date;
}

export interface ConfigureAgentSetupResult {
  changed: string[];
  backups: string[];
  status: AgentSetupStatus;
}

export function resolveAgentSetupPaths(home: string): AgentSetupPaths {
  const resolvedHome = path.resolve(home);
  const codexSkillDirectory = path.join(resolvedHome, ".codex", "skills", "arcadia-go");
  return {
    codexConfig: path.join(resolvedHome, ".codex", "config.toml"),
    codexManagedRules: path.join(resolvedHome, ".codex", "rules", "arcadia.rules"),
    codexRulesDirectory: path.join(resolvedHome, ".codex", "rules"),
    codexSkillDirectory,
    codexSkill: path.join(codexSkillDirectory, "SKILL.md"),
    claudeSettings: path.join(resolvedHome, ".claude", "settings.json"),
    claudeSkill: path.join(resolvedHome, ".claude", "skills", "arcadia-go")
  };
}

export function renderManagedSkill(template: string, executables: BrokerExecutables): string {
  if (!template.includes("__ARCADIA_CODEX_BROKER__") || !template.includes("__ARCADIA_CLAUDE_BROKER__")) {
    throw validationError("The bundled arcadia-go skill template is missing broker placeholders.");
  }
  return template
    .replaceAll("__ARCADIA_CODEX_BROKER__", executables.codex)
    .replaceAll("__ARCADIA_CLAUDE_BROKER__", executables.claude);
}

export function configureGoBrokerAgents(options: ConfigureAgentSetupOptions): ConfigureAgentSetupResult {
  const paths = resolveAgentSetupPaths(options.home);
  const changed: string[] = [];
  const backups: string[] = [];
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[-:.]/g, "");
  const skill = renderManagedSkill(options.skillTemplate, options.executables);
  validateGoBrokerAgentSetupInputs(options);

  updateCodexConfig(paths.codexConfig, changed, backups, timestamp);
  updateCodexRules(paths, options.executables.codex, changed, backups, timestamp);
  updateManagedSkill(paths, skill, changed, backups, timestamp);
  updateClaudeSettings(paths.claudeSettings, options, changed, backups, timestamp);
  updateClaudeSkillLink(paths, changed, backups, timestamp);

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
  setTopLevelTomlValues(readOptional(paths.codexConfig), {
    approval_policy: "on-request",
    sandbox_mode: "workspace-write"
  });
  readClaudeSettings(paths.claudeSettings, true);
  assertManagedSkillDirectoryIsSafe(paths.codexSkillDirectory);
}

export function inspectGoBrokerAgentSetup(options: ConfigureAgentSetupOptions): AgentSetupStatus {
  const paths = resolveAgentSetupPaths(options.home);
  const expectedSkill = renderManagedSkill(options.skillTemplate, options.executables);
  const codexConfig = readOptional(paths.codexConfig);
  const codexRule = readOptional(paths.codexManagedRules);
  const legacyCodexRules = findLegacyCodexRules(paths.codexRulesDirectory, paths.codexManagedRules);
  const claude = readClaudeSettings(paths.claudeSettings, false);
  const allow = claude?.permissions?.allow ?? [];
  const additionalDirectories = claude?.permissions?.additionalDirectories ?? [];
  const expectedDirectories = [
    path.join(path.resolve(options.home), ".codex", "worktrees"),
    path.join(path.resolve(options.home), ".claude", "worktrees")
  ];

  const checks = {
    brokerExecutables: existsSync(options.executables.codex) && existsSync(options.executables.claude),
    codexGuardrails:
      topLevelTomlValue(codexConfig, "approval_policy") === "on-request" &&
      topLevelTomlValue(codexConfig, "sandbox_mode") === "workspace-write",
    codexRule: codexRule === managedCodexRule(options.executables.codex),
    noLegacyCodexRules: legacyCodexRules.length === 0,
    managedSkill: readOptional(paths.codexSkill) === expectedSkill,
    sharedClaudeSkill: symlinkResolvesTo(paths.claudeSkill, paths.codexSkillDirectory),
    claudePermission: allow.includes(`Bash(${options.executables.claude})`),
    noLegacyClaudePermissions: allow.every((entry) => !isLegacyClaudePermission(entry)),
    claudeSandbox: claude?.sandbox?.enabled === true && claude?.sandbox?.failIfUnavailable === true,
    claudeBypassDisabled: claude?.permissions?.disableBypassPermissionsMode === "disable",
    claudeWorktreeDirectories: expectedDirectories.every((directory) => additionalDirectories.includes(directory))
  };
  const issues = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
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

function updateCodexConfig(file: string, changed: string[], backups: string[], timestamp: string): void {
  const current = readOptional(file);
  const updated = setTopLevelTomlValues(current, {
    approval_policy: "on-request",
    sandbox_mode: "workspace-write"
  });
  writeManagedFile(file, updated, changed, backups, timestamp, true);
}

function updateCodexRules(
  paths: AgentSetupPaths,
  executable: string,
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
  writeManagedFile(paths.codexManagedRules, managedCodexRule(executable), changed, backups, timestamp, false);
}

function updateManagedSkill(
  paths: AgentSetupPaths,
  skill: string,
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  if (existsSync(paths.codexSkill) && !readFileSync(paths.codexSkill, "utf8").includes(MANAGED_SKILL_MARKER)) {
    const backup = `${paths.codexSkill}.arcadia-backup-${timestamp}`;
    copyFileSync(paths.codexSkill, backup);
    backups.push(backup);
  }
  writeManagedFile(paths.codexSkill, skill, changed, backups, timestamp, false);
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
    (entry) => !isLegacyClaudePermission(entry) && !entry.includes("arcadia-go-broker-")
  );
  allow.push(`Bash(${options.executables.claude})`);
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
  paths: AgentSetupPaths,
  changed: string[],
  backups: string[],
  timestamp: string
): void {
  mkdirSync(path.dirname(paths.claudeSkill), { recursive: true });
  if (pathExistsIncludingDanglingLink(paths.claudeSkill)) {
    if (symlinkResolvesTo(paths.claudeSkill, paths.codexSkillDirectory)) return;
    const backup = `${paths.claudeSkill}.arcadia-backup-${timestamp}`;
    renameSync(paths.claudeSkill, backup);
    backups.push(backup);
  }
  const temporary = `${paths.claudeSkill}.arcadia-${process.pid}`;
  rmSync(temporary, { force: true, recursive: true });
  symlinkSync(paths.codexSkillDirectory, temporary);
  renameSync(temporary, paths.claudeSkill);
  changed.push(paths.claudeSkill);
}

function managedCodexRule(executable: string): string {
  return [
    "# Managed by `arcadia go-broker install`. Do not add broader Arcadia go allowances.",
    "prefix_rule(",
    `    pattern = [${JSON.stringify(executable)}],`,
    "    decision = \"allow\",",
    ")",
    ""
  ].join("\n");
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
    /arcadia-go-broker-(?:codex|claude)/.test(pattern) ||
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
  return entry.startsWith("Bash(") && /(?:^|[(\s/])arcadia\s+go(?:\s|\))/.test(entry);
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
