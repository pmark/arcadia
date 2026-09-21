import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodingAgentProfile } from "../intent/registries.js";

export interface CodingAgentInvocationCommand {
  args: string[];
  displayCommand: string;
}

/** The single provider-id-to-label map, shared by profiles and Sessions. */
export const PROVIDER_LABELS: Record<string, string> = {
  "codex-cli": "Codex",
  "claude-code-cli": "Claude Code",
  "opencode-cli": "opencode"
};

/** Human label for a provider id, falling back to the id itself. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function codingAgentLabel(profile: CodingAgentProfile): string {
  return PROVIDER_LABELS[profile.provider] ?? profile.name;
}

export function buildCodingAgentCommand(
  profile: CodingAgentProfile,
  workspace: string,
  finalMessagePath: string,
  configurationArgs: string[] = []
): CodingAgentInvocationCommand {
  const args = profile.provider === "codex-cli"
    ? [...profile.args, ...configurationArgs, "--cd", workspace, "--output-last-message", finalMessagePath, "-"]
    : [...profile.args, ...configurationArgs];

  return {
    args,
    displayCommand: [profile.command, ...args].map(renderCommandArgument).join(" ")
  };
}

export function finalMessageFromExecution(input: {
  profile: CodingAgentProfile;
  finalMessagePath: string;
  stdout: string;
  stderr: string;
  /** Where Claude Code plan mode writes plans. Overridable for tests. */
  claudePlansDir?: string;
}): string {
  if (input.profile.provider === "codex-cli" && hasAgentProducedFinalMessage(input.finalMessagePath)) {
    return readFileSync(input.finalMessagePath, "utf8");
  }

  if (input.profile.provider === "claude-code-cli") {
    const result = extractClaudeResult(input.stdout);
    if (result) {
      const withPlan = appendClaudePlanFile(result, input.claudePlansDir);
      return withPlan.endsWith("\n") ? withPlan : `${withPlan}\n`;
    }
  }

  if (input.profile.provider === "opencode-cli") {
    const text = extractOpencodeText(input.stdout);
    if (text) return text.endsWith("\n") ? text : `${text}\n`;
  }

  const fallback = input.stdout || input.stderr || `${codingAgentLabel(input.profile)} execution produced no output.\n`;
  return fallback.endsWith("\n") ? fallback : `${fallback}\n`;
}

export function isUninvokedFinalMessage(filePath: string): boolean {
  if (!existsSync(filePath) || statSync(filePath).size === 0) {
    return true;
  }

  return /has not been invoked yet\.$/.test(readFileSync(filePath, "utf8").trim());
}

function hasAgentProducedFinalMessage(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).size > 0 && !isUninvokedFinalMessage(filePath);
}

const MAX_PLAN_FILE_BYTES = 1_000_000;

/**
 * `claude --print --permission-mode plan` writes the actual plan to
 * `~/.claude/plans/<name>.md` and replies with only a summary that names that
 * file, so the captured final message never holds the plan and planning-artifact
 * validation fails. When the result names a plan file, append its contents. The
 * path comes from agent output, so only a regular file that really resolves
 * inside the plans directory, under a size cap, is ever read.
 */
function appendClaudePlanFile(result: string, plansDir = path.join(os.homedir(), ".claude", "plans")): string {
  let root: string;
  try {
    root = realpathSync(plansDir);
  } catch {
    return result;
  }
  // Backtick spans may hold spaces; bare paths cannot.
  const candidates = [
    ...[...result.matchAll(/`(\/[^`\n]+\.md)`/g)].map((match) => match[1]),
    ...[...result.matchAll(/(\/[^\s`'"*()<>]+\.md)\b/g)].map((match) => match[1])
  ];
  for (const candidate of candidates) {
    try {
      const real = realpathSync(candidate);
      if (!real.startsWith(`${root}${path.sep}`)) continue;
      const stat = statSync(real);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PLAN_FILE_BYTES) continue;
      return `${result.trimEnd()}\n\n---\n\n## Plan file written by the agent (${path.basename(real)})\n\n${readFileSync(real, "utf8")}`;
    } catch {
      continue;
    }
  }
  return result;
}

function extractClaudeResult(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as { result?: unknown };
    return typeof parsed.result === "string" && parsed.result.trim() ? parsed.result : null;
  } catch {
    return null;
  }
}

/**
 * `opencode run --format json` prints one JSON event per line: tool calls,
 * step markers and `text` parts. The agent's answer is the `text` parts; the
 * rest is transcript. Falling back to raw stdout left planning validation
 * reading tool output and finding no section headings (zero-prompt rehearsal
 * Action B). Lines that are not JSON, or not text events, are ignored.
 */
function extractOpencodeText(stdout: string): string | null {
  const parts: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as { type?: unknown; part?: { text?: unknown } };
      if (event.type === "text" && typeof event.part?.text === "string" && event.part.text.trim()) {
        parts.push(event.part.text.trim());
      }
    } catch {
      // Not an event line.
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function renderCommandArgument(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}
