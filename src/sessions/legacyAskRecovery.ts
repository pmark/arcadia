import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, ftruncateSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { askGit as git, tryAskGit as tryGit, reserveAskGitIndex } from "../git/askIsolation.js";
import { validationError } from "../cli/errors.js";

/**
 * The shape an agent used to be told to author Agent Asks at — directly in the
 * repository root of the shared base checkout. Editing one there dirties the
 * base and blocks Arcadia Go's fail-closed clean check, which has no way to
 * know the change is a safe, disposable Ask draft rather than in-progress
 * operator work. Authoring now belongs under `ASK_ISOLATION_DIR`; this pattern
 * only identifies drift left behind by the old convention (or a docs
 * regression) so it can be recovered instead of blocking the handoff.
 *
 * It matches a suffixed name (`agent-ask-triage.yaml`) as well as the bare
 * `agent-ask.yaml`, because the old convention produced both: this repository
 * root still carried `agent-ask-go-authority.yaml` and `agent-ask-triage.yaml`
 * from it. Matching only the bare name left the exact 2026-09-12 handoff
 * failure unfixed for the filenames the convention actually produced most
 * often — an agent re-authoring one of those would still fail Go closed.
 */
export const LEGACY_AGENT_ASK_PATTERN = /^agent-ask(?:-[^/]*)?\.ya?ml$/;

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
 * If the only dirty path in `worktreePath` is an Agent Ask draft — a legacy
 * root `agent-ask*.yaml`, or any file already under `ASK_ISOLATION_DIR` that
 * was nonetheless authored or edited directly in the shared base checkout —
 * move its exact content onto a uniquely named isolated Ask branch and
 * restore the working tree to clean. Returns `{ recovered: false }` untouched
 * when the drift is not present or dirty state is not this exact single-file
 * case — Arcadia Go's existing fail-closed refusal still applies to anything
 * this does not recognize.
 */
export function recoverLegacyAgentAskDrift(repo: string, worktreePath: string, testHooks?: AskRecoveryTestHooks): LegacyAskRecovery {
  const status = git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], undefined, false)
    .split("\n")
    .filter(Boolean);
  if (status.length !== 1) return NOT_RECOVERED;

  const line = status[0];
  // Staged content belongs to its Git operation; recovery never rewrites or unstages it.
  if (!line.startsWith("?? ") && !line.startsWith(" M ")) return NOT_RECOVERED;
  const filePath = line.slice(3).trim();
  const isLegacy = LEGACY_AGENT_ASK_PATTERN.test(filePath);
  const isIsolatedDraftInBaseCheckout = ISOLATED_ASK_FILE_PATTERN.test(filePath);
  if (!isLegacy && !isIsolatedDraftInBaseCheckout) return NOT_RECOVERED;
  const reservation = reserveAskGitIndex(worktreePath);
  try {
  const currentStatus = git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], undefined, false).split("\n").filter(Boolean);
  if (JSON.stringify(currentStatus) !== JSON.stringify(status)) throw validationError("Agent Ask recovery checkout changed before isolation; preserved it.");

  const source = path.join(worktreePath, filePath);
  const sourceStat = lstatSync(source);
  const sourceParent = realpathSync(path.dirname(source));
  if (!sourceStat.isFile() || sourceStat.nlink !== 1 || !realpathSync(source).startsWith(`${realpathSync(worktreePath)}${path.sep}`)) throw validationError("Drifted Ask must be a regular file inside its checkout.");
  const content = readFileSync(source, "utf8");
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

  // Never check out, delete, or force-remove a recovery branch/worktree owned by another session.
  const registered = git(repo, ["worktree", "list", "--porcelain"]);
  if (existsSync(recoveryWorktree) || registered.split("\n").includes(`branch refs/heads/${branch}`)) throw validationError("Agent Ask recovery branch/worktree is in use; preserve it and resolve ownership before retrying.", { branch, recoveryWorktree });
  const existing = tryGit(repo, ["show-ref", "--verify", `refs/heads/${branch}`]);
  if (existing) {
    let recovered: string | null = null;
    try { recovered = git(repo, ["show", `${branch}:${askRelativePath}`], undefined, false); } catch { /* Missing content refuses below. */ }
    if (recovered !== content) throw validationError("Existing Agent Ask recovery branch has different or missing content; it was preserved.", { branch });
  } else {
    const scratch = mkdtempSync(path.join(tmpdir(), "arcadia-ask-recovery-"));
    try {
      testHooks?.afterWorktreeCreatedBeforeWrite?.();
      const index = path.join(scratch, "index");
      const input = path.join(scratch, "ask");
      writeFileSync(input, content, { flag: "wx" });
      const head = git(worktreePath, ["rev-parse", "HEAD"]);
      git(repo, ["read-tree", head], index);
      const blob = git(repo, ["hash-object", "-w", "--no-filters", "--", input]);
      git(repo, ["update-index", "--add", "--cacheinfo", "100644", blob, askRelativePath], index);
      const tree = git(repo, ["write-tree"], index);
      const commit = git(repo, ["commit-tree", tree, "-p", head, "-m", `Recover drifted Agent Ask into ${askRelativePath}`]);
      git(repo, ["update-ref", `refs/heads/${branch}`, commit, "0".repeat(head.length)]);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }

  testHooks?.afterCommitBeforeCleanup?.();

  // Bind cleanup to the exact original file, never a replacement symlink or peer inode.
  if (realpathSync(path.dirname(source)) !== sourceParent) throw validationError("Drifted Agent Ask parent changed during recovery; preserved current content.");
  const isTracked = tryGit(worktreePath, ["ls-files", "--error-unmatch", filePath]) !== null;
  const fd = openSync(source, (isTracked ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd);
    if (!current.isFile() || current.nlink !== 1 || current.dev !== sourceStat.dev || current.ino !== sourceStat.ino || readFileSync(fd, "utf8") !== content) throw validationError("Drifted Agent Ask changed during recovery; preserved current content.");
    if (isTracked) {
      const original = Buffer.from(git(worktreePath, ["show", `HEAD:${filePath}`], undefined, false));
      writeSync(fd, original, 0, original.length, 0);
      ftruncateSync(fd, original.length);
    } else {
      const entry = lstatSync(source);
      if (entry.dev !== sourceStat.dev || entry.ino !== sourceStat.ino || !entry.isFile()) throw validationError("Drifted Agent Ask was replaced during recovery; preserved replacement.");
      rmSync(source);
    }
  } finally { closeSync(fd); }


  return { recovered: true, askFile: askRelativePath, branch, requestId };
  } finally { reservation.release(); }
}

/**
 * Resolve a request id straight to the isolated recovery branch and file
 * `recoverLegacyAgentAskDrift` moved it to, so a later `preview` or `settle`
 * can address a recovered Ask by the same request id it was originally
 * drafted under instead of an operator manually running `git show` into a
 * scratch file first. Returns `null` when no recovery branch exists for this
 * request id — the caller falls back to its normal `request`/`--file` path.
 *
 * The branch name carries a content-hash suffix (for retry-safety, see
 * `recoverLegacyAgentAskDrift`), so this looks it up by the request-id prefix
 * rather than reconstructing the exact name. Content-based dedup means a
 * given request id can only ever have one live recovered branch: a second
 * recovery under the same request id but different content is a distinct,
 * separately validated Ask (rejected elsewhere, at preview/settle time, as
 * "already used with different content"), never a second branch here.
 */
export function findRecoveredAsk(repo: string, requestId: string): { branch: string; askFile: string; content: string } | null {
  const sanitized = sanitizeStubComponent(requestId);
  const listed = tryGit(repo, ["branch", "--list", `ask/recover-${sanitized}-*`]) ?? "";
  const branches = listed.split("\n").map((line) => line.trim()).filter(Boolean);
  if (branches.length === 0) return null;
  const branch = branches[0];
  const files = (tryGit(repo, ["ls-tree", "-r", "--name-only", branch, ASK_ISOLATION_DIR]) ?? "")
    .split("\n").filter(Boolean);
  const askFile = files.find((file) => path.basename(file).includes(sanitized)) ?? files[0];
  if (!askFile) return null;
  return { branch, askFile, content: git(repo, ["show", `${branch}:${askFile}`]) };
}

function extractRequestId(content: string): string | null {
  const match = content.match(/^request_id:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

function shortHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function sanitizeStubComponent(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return cleaned || "recovered";
}
