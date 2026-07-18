import { existsSync, readFileSync, statSync } from "node:fs";
import type { CodingAgentProfile } from "../intent/registries.js";

export interface CodingAgentInvocationCommand {
  args: string[];
  displayCommand: string;
}

export function codingAgentLabel(profile: CodingAgentProfile): string {
  switch (profile.provider) {
    case "codex-cli":
      return "Codex";
    case "claude-code-cli":
      return "Claude Code";
    default:
      return profile.name;
  }
}

export function buildCodingAgentCommand(
  profile: CodingAgentProfile,
  workspace: string,
  finalMessagePath: string
): CodingAgentInvocationCommand {
  const args = profile.provider === "codex-cli"
    ? [...profile.args, "--cd", workspace, "--output-last-message", finalMessagePath, "-"]
    : [...profile.args];

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
}): string {
  if (input.profile.provider === "codex-cli" && hasAgentProducedFinalMessage(input.finalMessagePath)) {
    return readFileSync(input.finalMessagePath, "utf8");
  }

  if (input.profile.provider === "claude-code-cli") {
    const result = extractClaudeResult(input.stdout);
    if (result) {
      return result.endsWith("\n") ? result : `${result}\n`;
    }
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

function renderCommandArgument(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}
