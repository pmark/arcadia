import { createHash } from "node:crypto";
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

/**
 * A correctly named isolated draft (`.arcadia/asks/agent-ask-<stub>.yaml`)
 * still dirties the base if an agent or operator authors or edits it directly
 * in the shared base checkout instead of a dedicated isolated worktree — the
 * filename convention alone does not prevent that. This matches any such file
 * one level under `ASK_ISOLATION_DIR`, so drift there is recovered the same
 * way as the legacy single-file convention, just without renaming it: the
 * agent's own request-id-derived stub is already the correct, collision-safe
 * name and is preserved on the isolated branch.
 */
const ISOLATED_ASK_FILE_PATTERN = /^\.arcadia\/asks\/[^/]+\.ya?ml$/;

export interface LegacyAskRecovery {
  recovered: boolean;
  /** Repo-relative path of the recovered file, e.g. `.arcadia/asks/agent-ask-<stub>.yaml`. */
  askFile: string | null;
  /** The isolated branch the recovery was committed to. */
  branch: string | null;
  requestId: string | null;
}

const NOT_RECOVERED: LegacyAskRecovery = { recovered: false, askFile: null, branch: null, requestId: null };

/** Deterministic fault injection points for fault-tolerance tests only. */
export interface AskRecoveryTestHooks {
  /** Fires after the isolated recovery worktree exists but before the draft is written into it. */
  afterWorktreeCreatedBeforeWrite?: () => void;
  /** Fires after the recovery commit lands but before the drifted path is cleaned from the source worktree. */
  afterCommitBeforeCleanup?: () => void;
}

/**
 * If the only dirty path in `worktreePath` is an Agent Ask draft — the legacy
 * root `agent-ask.yaml`, or any file already under `ASK_ISOLATION_DIR` that
 * was nonetheless authored or edited directly in the shared base checkout —
 * move its exact content onto a uniquely named isolated Ask branch and
 * restore the working tree to clean. Returns `{ recovered: false }` untouched
 * when the drift is not present or dirty state is not this exact single-file
 * case — Arcadia Go's existing fail-closed refusal still applies to anything
 * this does not recognize.
 */
export function recoverLegacyAgentAskDrift(repo: string, worktreePath: string, testHooks?: AskRecoveryTestHooks): LegacyAskRecovery {
  const status = git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean);
  if (status.length !== 1) return NOT_RECOVERED;

  const line = status[0]!;
  const filePath = line.slice(3).trim();
  const isLegacy = filePath === LEGACY_AGENT_ASK_FILE;
  const isIsolatedDraftInBaseCheckout = ISOLATED_ASK_FILE_PATTERN.test(filePath);
  if (!isLegacy && !isIsolatedDraftInBaseCheckout) return NOT_RECOVERED;

  const content = readFileSync(path.join(worktreePath, filePath), "utf8");
  const requestId = extractRequestId(content);
  // Deriving the stub from the request id and the exact content, rather than
  // a timestamp and random bytes, makes recovery retry-safe: a call
  // interrupted after this point and repeated later — or run again because an
  // earlier attempt died between the commit and the cleanup below — recomputes
  // the identical stub, branch, and path instead of minting a second commit
  // or leaving an orphaned draft behind.
  const stub = `${sanitizeStubComponent(requestId ?? "recovered")}-${shortHash(content)}`;
  // A drift that already lives under ASK_ISOLATION_DIR carries its own
  // request-id-derived, collision-safe name; only the legacy single-file
  // convention needs a fresh name to move into that directory at all.
  const askRelativePath = isLegacy ? `${ASK_ISOLATION_DIR}/agent-ask-${stub}.yaml` : filePath;
  const branch = `ask/recover-${stub}`;
  const recoveryWorktree = path.join(path.dirname(worktreePath), `.arcadia-ask-recovery-${stub}`);

  const alreadyCommitted = tryGit(repo, ["cat-file", "-e", `${branch}:${askRelativePath}`]) !== null;
  if (!alreadyCommitted) {
    // A branch ref can exist without the file when a prior attempt was
    // interrupted between creating the worktree and committing into it;
    // `worktree add -b` refuses an existing branch name, so that stale,
    // contentless ref is cleared before retrying rather than left to block
    // every future retry under this same deterministic stub.
    if (tryGit(repo, ["show-ref", "--verify", `refs/heads/${branch}`]) !== null) {
      git(repo, ["branch", "-D", branch]);
    }
    git(repo, ["worktree", "add", "-b", branch, recoveryWorktree, "HEAD"]);
    try {
      testHooks?.afterWorktreeCreatedBeforeWrite?.();
      mkdirSync(path.join(recoveryWorktree, path.dirname(askRelativePath)), { recursive: true });
      writeFileSync(path.join(recoveryWorktree, askRelativePath), content);
      git(recoveryWorktree, ["add", askRelativePath]);
      git(recoveryWorktree, ["commit", "-m", `Recover drifted Agent Ask into ${askRelativePath}`]);
    } finally {
      git(repo, ["worktree", "remove", recoveryWorktree, "--force"]);
    }
  }

  testHooks?.afterCommitBeforeCleanup?.();

  const isTracked = tryGit(worktreePath, ["ls-files", "--error-unmatch", filePath]) !== null;
  if (isTracked) {
    git(worktreePath, ["checkout", "--", filePath]);
  } else {
    rmSync(path.join(worktreePath, filePath));
  }

  return { recovered: true, askFile: askRelativePath, branch, requestId };
}

function extractRequestId(content: string): string | null {
  const match = content.match(/^request_id:\s*(.+)$/m);
  return match ? match[1]!.trim().replace(/^["']|["']$/g, "") : null;
}

function shortHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function sanitizeStubComponent(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return cleaned || "recovered";
}
