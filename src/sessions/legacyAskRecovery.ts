import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, tryGit } from "../git/worktrees.js";

/**
 * The path an agent used to be told to author Agent Asks at — directly in the
 * shared base checkout. Editing it there dirties the base and blocks Arcadia
 * Go's fail-closed clean check, which has no way to know the change is a safe,
 * disposable Ask draft rather than in-progress operator work. Authoring now
 * belongs under `ASK_ISOLATION_DIR`; this constant only identifies drift left
 * behind by the old convention (or a docs regression) so it can be recovered
 * instead of blocking the handoff.
 */
export const LEGACY_AGENT_ASK_FILE = "agent-ask.yaml";

/** Where isolated Agent Ask drafts live, uniquely named per request. */
export const ASK_ISOLATION_DIR = ".arcadia/asks";

export interface LegacyAskRecovery {
  recovered: boolean;
  /** Repo-relative path of the recovered file, e.g. `.arcadia/asks/agent-ask-<stub>.yaml`. */
  askFile: string | null;
  /** The isolated branch the recovery was committed to. */
  branch: string | null;
  requestId: string | null;
}

const NOT_RECOVERED: LegacyAskRecovery = { recovered: false, askFile: null, branch: null, requestId: null };

/**
 * If the only dirty path in `worktreePath` is the legacy root
 * `agent-ask.yaml`, move its exact content onto a uniquely named isolated Ask
 * branch under `ASK_ISOLATION_DIR` and restore the working tree to clean.
 * Returns `{ recovered: false }` untouched when the drift is not present or
 * dirty state is not this exact single-file case — Arcadia Go's existing
 * fail-closed refusal still applies to anything this does not recognize.
 */
export function recoverLegacyAgentAskDrift(repo: string, worktreePath: string): LegacyAskRecovery {
  const status = git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean);
  if (status.length !== 1) return NOT_RECOVERED;

  const line = status[0]!;
  const filePath = line.slice(3).trim();
  if (filePath !== LEGACY_AGENT_ASK_FILE) return NOT_RECOVERED;

  const content = readFileSync(path.join(worktreePath, LEGACY_AGENT_ASK_FILE), "utf8");
  const requestId = extractRequestId(content);
  const stub = `${requestId ?? "recovered"}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const askRelativePath = `${ASK_ISOLATION_DIR}/agent-ask-${stub}.yaml`;
  const branch = `ask/recover-${stub}`;
  const recoveryWorktree = path.join(path.dirname(worktreePath), `.arcadia-ask-recovery-${stub}`);

  git(repo, ["worktree", "add", "-b", branch, recoveryWorktree, "HEAD"]);
  try {
    mkdirSync(path.join(recoveryWorktree, ASK_ISOLATION_DIR), { recursive: true });
    writeFileSync(path.join(recoveryWorktree, askRelativePath), content);
    git(recoveryWorktree, ["add", askRelativePath]);
    git(recoveryWorktree, ["commit", "-m", `Recover drifted Agent Ask into ${askRelativePath}`]);
  } finally {
    git(repo, ["worktree", "remove", recoveryWorktree, "--force"]);
  }

  const isTracked = tryGit(worktreePath, ["ls-files", "--error-unmatch", LEGACY_AGENT_ASK_FILE]) !== null;
  if (isTracked) {
    git(worktreePath, ["checkout", "--", LEGACY_AGENT_ASK_FILE]);
  } else {
    rmSync(path.join(worktreePath, LEGACY_AGENT_ASK_FILE));
  }

  return { recovered: true, askFile: askRelativePath, branch, requestId };
}

function extractRequestId(content: string): string | null {
  const match = content.match(/^request_id:\s*(.+)$/m);
  return match ? match[1]!.trim().replace(/^["']|["']$/g, "") : null;
}
