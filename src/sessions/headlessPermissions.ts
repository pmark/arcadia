import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { validationError } from "../cli/errors.js";
import { sessionRecordDirectory, sessionSettingsPath } from "./sessionRecording.js";

/**
 * The permission posture of a headless Claude Session, owned and checked in
 * here rather than in anyone's personal `~/.claude/settings.json`.
 *
 * A headless Session has nobody at its terminal, so a tool call outside the
 * allow rules is refused back to the agent rather than waiting on a prompt.
 * `acceptEdits` (on the command line) lets it edit the candidate; this list is
 * the only Bash it may run, and it is deliberately narrow:
 *
 *   - the Action's Project's declared validation commands, each exactly as
 *     declared (a compound command is split into its simple commands, since
 *     Claude matches each simple command of a compound separately); and
 *   - `arcadia agent-ask draft`, the completion protocol's fallback that
 *     leaves a drafted Ask for the host to preserve and settle.
 *
 * Nothing else is added: no commit, push, settle, broker or arbitrary shell.
 * The list is written to a per-Session settings file under the workspace and
 * passed with `--settings`, together with `--setting-sources ""`. Without that
 * second flag Claude UNIONS `permissions.allow` across every source it loads,
 * so the operator's `~/.claude/settings.json` (broker binaries and all) and the
 * worktree's own `.claude/settings.json` (which the agent can edit) would widen
 * this list; with it only this file and managed policy apply. The cost is that
 * a headless Session loads no user or project settings or hooks. Read-only
 * inspection (`git status`, `git diff`, file reads) stays on Claude's built-in
 * read-only allowance.
 *
 * Two honest limits. `acceptEdits` also auto-approves file-system commands
 * (mkdir, rm, mv, cp, sed) inside the working directory, and the allow list is
 * not a security boundary: validation commands run project code the agent can
 * edit, so it narrows what the agent is asked to do, not what it can reach.
 *
 * Codex's equivalent is the `workspace-write` sandbox with no approval
 * prompts (see `buildProviderLaunch`). opencode's permissions come from its
 * ambient configuration; Arcadia does not manage them, and `opencode run`
 * never waits on a prompt.
 */
export const HEADLESS_AGENT_ASK_DRAFT_RULES: readonly string[] = Object.freeze([
  "Bash(arcadia agent-ask draft:*)",
  "Bash(pnpm arcadia agent-ask draft:*)"
]);

/**
 * The Agent (formerly Task) tool, so a Session that started on the smallest
 * model can call in a bigger one for a hard sub-problem ("Calling in help" in
 * the Action brief). Claude Code's docs list Agent as needing no permission, so
 * this rule is belt and braces for headless runs; a subagent's own tool calls
 * stay under the same allow list and `acceptEdits` posture as its parent.
 */
export const HEADLESS_SUBAGENT_RULE = "Agent";

/** Split one declared validation command into the simple commands Claude matches individually. */
function simpleCommands(command: string): string[] {
  return command.split(/&&|\|\||;|\|/).map((part) => part.trim()).filter((part) => part.length > 0);
}

/** A Claude `Bash(...)` rule matching exactly one simple command. */
function exactBashRule(command: string): string {
  // `*` is Claude's wildcard (and `:*` its legacy prefix match), so a literal
  // star is escaped: a declared command ending in `:*` stays one exact command.
  return `Bash(${command.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("*", "\\*")})`;
}

/** The complete allow list for a Session whose Project declares `validationCommands`. */
export function headlessClaudeAllowList(validationCommands: readonly string[]): string[] {
  const rules = new Set<string>();
  for (const command of validationCommands) {
    for (const simple of simpleCommands(command)) rules.add(exactBashRule(simple));
  }
  for (const rule of HEADLESS_AGENT_ASK_DRAFT_RULES) rules.add(rule);
  rules.add(HEADLESS_SUBAGENT_RULE);
  return [...rules];
}

/**
 * Write this Session's settings file and return its path. Refuses with a named
 * `permission_posture_missing` error when the file cannot be written. (A
 * Project with no declared validation commands is refused earlier, by the launch
 * preview, so the list then holds only the `agent-ask draft` rules.)
 */
export function writeHeadlessClaudeSettings(input: {
  workspace: string;
  sessionId: string;
  validationCommands: readonly string[];
}): string {
  const file = sessionSettingsPath(input.workspace, input.sessionId);
  const settings = { permissions: { defaultMode: "acceptEdits", allow: headlessClaudeAllowList(input.validationCommands) } };
  try {
    mkdirSync(sessionRecordDirectory(input.workspace), { recursive: true });
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch (error) {
    throw validationError(
      `The headless permission posture is missing: its settings file ${file} could not be written.`,
      {
        code: "permission_posture_missing", provider: "claude-code-cli",
        cause: error instanceof Error ? error.message : String(error),
        remedy: "Make the workspace's .arcadia directory writable, then retry."
      }
    );
  }
  return file;
}
