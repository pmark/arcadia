/**
 * Read-only reconciliation of a preserved candidate for the G8 terminal-Off
 * action (restore-terminal-off-three-action-rehearsal-2026-10-04).
 *
 * A candidate is preserved when its tip is exactly the commit its canonical
 * preservation receipt binds. The production tick preserves first and then
 * settles the Action's completion on the same branch, so a valid candidate's
 * tip is often one commit past that receipt: the accepted-completion
 * settlement. That shape is reconciled only when every one of these holds,
 * and refused with a named reason otherwise:
 *
 * - the candidate worktree is clean and the receipt commit is an ancestor of
 *   the tip;
 * - exactly one commit lies between them, and it is not a merge (two
 *   settlements, or anything else stacked on the receipt, is refused);
 * - its message carries exactly one ``Written by `arcadia agent-ask settle
 *   --apply` (asksettle_...)`` receipt line, and that receipt id is an
 *   accepted, applied `complete` settlement recorded in the workspace for this
 *   Project and Action, bound to the receipt commit as its candidate revision
 *   and to this commit as its documents commit (a receipt line the workspace
 *   never wrote is forged);
 * - it touches only `.arcadia/asks/`, `MISSION_LOG.md`, `PROJECT.md`,
 *   `docs/plans/` and `docs/decisions/`, in the shapes Arcadia's governed
 *   commands write (the code reviewer's deterministic governed-record check),
 *   with no executable, symlink or submodule mode;
 * - it completes the claimed Action: the Plan marks exactly that Action done
 *   and changes no other Action's status, and any archived Ask it carries is a
 *   `complete` Ask targeting that Action at the receipt commit;
 * - the fixture repository's branch and the receipt's pull request are both
 *   remotely at that exact tip (same branch, same repository, open).
 *
 * Every Git call is a read with optional locks off, so classifying never
 * refreshes an index; the workspace database is opened read-only; GitHub is
 * only read.
 */
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { withReadOnlyDatabase } from "../db/connection.js";
import { classifyPatchApplicability } from "../qa/patchApplicability.js";

export const SETTLEMENT_RECEIPT_LINE = /^Written by `arcadia agent-ask settle --apply` \((asksettle_[A-Za-z0-9]+)\)\.$/;

export type ReconciliationRefusalReason =
  | "invalid_input"
  | "tip_missing"
  | "receipt_commit_missing"
  | "dirty_tip"
  | "not_a_descendant"
  | "merge_commit"
  | "not_exactly_one_settlement"
  | "settlement_receipt_missing"
  | "settlement_receipt_forged"
  | "settlement_unverifiable"
  | "settlement_mismatch"
  | "code_changing_descendant"
  | "settlement_shape_invalid"
  | "not_a_completion"
  | "remote_unobservable"
  | "local_only_tip"
  | "remote_branch_mismatch"
  | "pull_request_mismatch";

export interface PreservedCandidateInput {
  /** The workspace whose settlement records are read (read-only). */
  workspace: string;
  /** The fixture Project slug. */
  project: string;
  /** The Session's Action id, with or without a `project/` prefix. */
  actionId: string;
  /** A Git directory holding the candidate's objects (its worktree, or the fixture checkout). */
  repository: string;
  /** The candidate worktree, checked clean when it exists; null when it is gone. */
  worktree: string | null;
  /** The preservation receipt's commit. */
  receiptCommit: string;
  /** The candidate's current tip. */
  tip: string;
  /** The Session's branch. */
  branch: string;
  /** The preservation receipt's pull request URL. */
  pullRequestUrl: string;
  /** The fixture's GitHub repository, `owner/name`. */
  githubRepository: string;
}

export interface SettlementEvidence {
  commit: string;
  receiptId: string;
  paths: string[];
  plan: string;
  archivedAsks: string[];
}

export type PreservedCandidateClassification =
  | { reconciled: true; basis: "exact_tip"; tip: string }
  | { reconciled: true; basis: "settled_descendant"; tip: string; receiptCommit: string; settlement: SettlementEvidence; remote: { branch: string; pullRequest: string } }
  | { reconciled: false; reason: ReconciliationRefusalReason; detail: string; tip: string };

export interface SettlementRecord {
  id: string;
  disposition: string;
  projectSlug: string;
  receipt: Record<string, unknown>;
  proposal: Record<string, unknown>;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ReconciliationIo {
  git(cwd: string, args: string[]): CommandResult;
  gh(args: string[]): CommandResult;
  /** The recorded settlement, or null when the workspace has no such receipt id. Throws when unreadable. */
  settlement(workspace: string, receiptId: string): SettlementRecord | null;
}

const COMMAND_TIMEOUT_MS = 45_000;
const SHA = /^[0-9a-f]{40}$/;
const SETTLEMENT_PATHS = [".arcadia/asks/", "MISSION_LOG.md", "PROJECT.md", "docs/plans/", "docs/decisions/"];

function run(command: string, args: string[], cwd?: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" }
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? (result.error ? String(result.error) : "") };
}

export const defaultReconciliationIo: ReconciliationIo = {
  git: (cwd, args) => run("git", ["-C", cwd, ...args]),
  gh: (args) => run("gh", args),
  settlement: (workspace, receiptId) => withReadOnlyDatabase(workspace, (db) => {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
    if (!tables.has("agent_ask_settlements") || !tables.has("agent_ask_proposals")) return null;
    const row = db.prepare(`SELECT s.id, s.disposition, s.project_slug, s.receipt_json, p.proposal_json
      FROM agent_ask_settlements s JOIN agent_ask_proposals p ON p.id = s.proposal_id WHERE s.id = ?`).get(receiptId) as
      { id: string; disposition: string; project_slug: string; receipt_json: string; proposal_json: string } | undefined;
    if (!row) return null;
    return { id: row.id, disposition: row.disposition, projectSlug: row.project_slug, receipt: JSON.parse(row.receipt_json), proposal: JSON.parse(row.proposal_json) };
  })
};

class Refusal extends Error {
  constructor(readonly reason: ReconciliationRefusalReason, readonly detail: string) {
    super(detail);
  }
}
function refuse(reason: ReconciliationRefusalReason, detail: string): never {
  throw new Refusal(reason, detail);
}

export function classifyPreservedCandidate(input: PreservedCandidateInput, io: ReconciliationIo = defaultReconciliationIo): PreservedCandidateClassification {
  try {
    return classify(input, io);
  } catch (error) {
    if (error instanceof Refusal) return { reconciled: false, reason: error.reason, detail: error.detail, tip: input.tip ?? "" };
    throw error;
  }
}

function classify(input: PreservedCandidateInput, io: ReconciliationIo): PreservedCandidateClassification {
  for (const key of ["workspace", "project", "actionId", "repository", "receiptCommit", "tip", "branch", "pullRequestUrl", "githubRepository"] as const) {
    if (typeof input[key] !== "string" || input[key].length === 0) refuse("invalid_input", `${key} is required`);
  }
  if (!SHA.test(input.receiptCommit)) refuse("invalid_input", "the preservation receipt commit is not a full commit id");
  if (!SHA.test(input.tip)) refuse("tip_missing", "the candidate has no resolvable tip");
  const actionId = input.actionId.startsWith(`${input.project}/`) ? input.actionId.slice(input.project.length + 1) : input.actionId;
  const git = (args: string[]) => io.git(input.repository, args);
  const read = (args: string[], failure: () => never) => {
    const result = git(args);
    return result.status === 0 ? result.stdout : failure();
  };
  const isCommit = (sha: string) => git(["cat-file", "-e", `${sha}^{commit}`]).status === 0;

  if (input.worktree) {
    const status = io.git(input.worktree, ["status", "--porcelain", "--untracked-files=all"]);
    if (status.status !== 0) refuse("dirty_tip", "the candidate worktree's status could not be read, so it is not proven clean");
    if (status.stdout.trim() !== "") refuse("dirty_tip", "the candidate worktree has uncommitted changes");
  }
  if (!isCommit(input.tip)) refuse("tip_missing", `the tip ${input.tip} is not a commit in ${input.repository}`);
  if (!isCommit(input.receiptCommit)) refuse("receipt_commit_missing", `the preservation receipt commit ${input.receiptCommit} is not in ${input.repository}`);
  if (input.tip === input.receiptCommit) return { reconciled: true, basis: "exact_tip", tip: input.tip };
  if (git(["merge-base", "--is-ancestor", input.receiptCommit, input.tip]).status !== 0) {
    refuse("not_a_descendant", `the tip ${input.tip} does not descend from the preservation receipt commit ${input.receiptCommit}`);
  }

  // Exactly one commit, whose only parent is the receipt commit.
  const parents = read(["rev-list", "--parents", "-n", "1", input.tip], () => refuse("tip_missing", "the tip's parents could not be read")).trim().split(/\s+/).slice(1);
  if (parents.length > 1) refuse("merge_commit", `the tip ${input.tip} is a merge commit`);
  const between = read(["rev-list", `${input.receiptCommit}..${input.tip}`], () => refuse("not_a_descendant", "the commits after the receipt could not be listed")).trim().split("\n").filter(Boolean);
  if (between.length !== 1 || parents[0] !== input.receiptCommit) {
    refuse("not_exactly_one_settlement", `${between.length} commits lie between the preservation receipt commit and the tip; exactly one accepted-completion settlement is accepted`);
  }

  // The governed receipt line, exactly as `agent-ask settle --apply` writes it.
  const message = read(["log", "-1", "--format=%B", input.tip], () => refuse("tip_missing", "the tip's message could not be read"));
  const receiptIds = [...new Set(message.split("\n").flatMap((line) => SETTLEMENT_RECEIPT_LINE.exec(line)?.[1] ?? []))];
  if (receiptIds.length === 0) refuse("settlement_receipt_missing", "the commit after the receipt carries no `Written by `arcadia agent-ask settle --apply` (asksettle_...)` receipt line");
  if (receiptIds.length > 1) refuse("settlement_receipt_forged", `the commit claims ${receiptIds.length} different settlement receipts`);
  const receiptId = receiptIds[0];

  // Only governed-record paths, in plain file modes.
  const raw = read(["diff-tree", "-r", "-M", "--no-commit-id", "--raw", "-z", input.receiptCommit, input.tip], () => refuse("tip_missing", "the settlement's changes could not be read"));
  const changes = parseRawDiff(raw);
  if (changes.length === 0) refuse("not_a_completion", "the commit after the receipt changes nothing");
  for (const change of changes) {
    for (const filePath of change.paths) {
      if (!SETTLEMENT_PATHS.some((allowed) => allowed.endsWith("/") ? filePath.startsWith(allowed) : filePath === allowed)) {
        refuse("code_changing_descendant", `the commit after the receipt changes ${filePath}, outside .arcadia/asks/, MISSION_LOG.md, PROJECT.md, docs/plans/ and docs/decisions/`);
      }
    }
    if (change.modes.some((mode) => mode !== "000000" && mode !== "100644")) {
      refuse("code_changing_descendant", `the commit after the receipt gives ${change.paths.join(" -> ")} mode ${change.modes.join("/")}`);
    }
  }

  // The exact shapes Arcadia's governed commands write, judged on the diff itself.
  const patch = read(["format-patch", "-1", "-M", "--stdout", "--no-signature", "--src-prefix=a/", "--dst-prefix=b/", input.tip], () => refuse("tip_missing", "the settlement patch could not be read"));
  const shape = classifyPatchApplicability(patch, { declaredCommits: [input.tip] });
  if (shape.problems.length > 0) refuse("settlement_shape_invalid", shape.problems.join("; "));
  const offShape = shape.files.find((file) => file.class !== "governed-record" && !file.path.startsWith("docs/decisions/"));
  if (offShape) refuse("settlement_shape_invalid", `${offShape.path}: ${offShape.reason}`);

  // It completes the claimed Action.
  const plans = changes.flatMap((change) => change.paths).filter((filePath) => filePath.startsWith("docs/plans/"));
  const completedIn: string[] = [];
  for (const plan of [...new Set(plans)]) {
    const before = actionStatuses(git(["show", `${input.receiptCommit}:${plan}`]));
    const after = actionStatuses(git(["show", `${input.tip}:${plan}`]));
    if (!before || !after) refuse("not_a_completion", `${plan} has no readable Plan actions before and after the settlement`);
    for (const [id, status] of after) {
      if (before.get(id) === status) continue;
      if (id !== actionId || status !== "done" || before.get(id) === undefined) {
        refuse("not_a_completion", `${plan} changes Action ${id} to ${status}; only ${actionId} may become done`);
      }
      completedIn.push(plan);
    }
  }
  if (completedIn.length !== 1) refuse("not_a_completion", `the settlement does not mark Action ${actionId} done in exactly one Plan`);
  const archivedAsks = changes.map((change) => change.paths[change.paths.length - 1]).filter((filePath) => filePath.startsWith(".arcadia/asks/archive/"));
  for (const ask of archivedAsks) {
    const shown = git(["show", `${input.tip}:${ask}`]);
    let parsed: Record<string, unknown> | null;
    try {
      parsed = shown.status === 0 ? parseYaml(shown.stdout) as Record<string, unknown> : null;
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.intent !== "complete" || parsed.target_ref !== `action/${actionId}` || parsed.project !== input.project ||
      (parsed.candidate_revision !== undefined && parsed.candidate_revision !== input.receiptCommit)) {
      refuse("not_a_completion", `the archived Ask ${ask} is not a complete Ask for action/${actionId} at the receipt commit`);
    }
  }

  // The receipt id is a real accepted completion of this Action, bound to these commits.
  let record: SettlementRecord | null;
  try {
    record = io.settlement(input.workspace, receiptId);
  } catch (error) {
    return refuse("settlement_unverifiable", `the workspace settlement records could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!record) refuse("settlement_receipt_forged", `the workspace has no settlement receipt ${receiptId}; the receipt line was not written by agent-ask settle`);
  const normalized = (record.proposal.normalized ?? {}) as Record<string, unknown>;
  const mismatches = [
    record.disposition !== "accepted" && `disposition ${record.disposition}`,
    record.projectSlug !== input.project && `project ${record.projectSlug}`,
    record.receipt.applied !== true && "not applied",
    record.receipt.intent !== "complete" && `intent ${String(record.receipt.intent)}`,
    record.receipt.documentsCommit !== input.tip && `documents commit ${String(record.receipt.documentsCommit)}`,
    normalized.intent !== "complete" && `proposal intent ${String(normalized.intent)}`,
    normalized.project !== input.project && `proposal project ${String(normalized.project)}`,
    normalized.targetRef !== `action/${actionId}` && `target ${String(normalized.targetRef)}`,
    normalized.candidateRevision !== input.receiptCommit && `candidate revision ${String(normalized.candidateRevision)}`
  ].filter(Boolean);
  if (mismatches.length > 0) refuse("settlement_mismatch", `settlement ${receiptId} is not this candidate's accepted completion of ${actionId}: ${mismatches.join(", ")}`);

  // Remotely preserved at this exact tip: the same branch, and the same open pull request.
  const repository = input.githubRepository.toLowerCase();
  const pr = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(input.pullRequestUrl);
  if (!pr || pr[1].toLowerCase() !== repository) refuse("pull_request_mismatch", `the receipt's pull request ${input.pullRequestUrl} is not in ${input.githubRepository}`);
  const ref = io.gh(["api", `repos/${input.githubRepository}/git/ref/heads/${input.branch}`, "--jq", ".object.sha"]);
  if (ref.status !== 0) {
    if (/HTTP 404|Not Found/.test(ref.stderr + ref.stdout)) refuse("local_only_tip", `branch ${input.branch} does not exist in ${input.githubRepository}; the tip is local only`);
    refuse("remote_unobservable", `the remote branch ${input.branch} could not be read: ${ref.stderr.trim().slice(0, 200)}`);
  }
  const remoteTip = ref.stdout.trim();
  if (remoteTip !== input.tip) {
    if (SHA.test(remoteTip) && git(["merge-base", "--is-ancestor", remoteTip, input.tip]).status === 0) {
      refuse("local_only_tip", `the remote branch ${input.branch} is at ${remoteTip}, behind the tip; the settlement is local only`);
    }
    refuse("remote_branch_mismatch", `the remote branch ${input.branch} is at ${remoteTip || "nothing"}, not the tip ${input.tip}`);
  }
  const view = io.gh(["pr", "view", input.pullRequestUrl, "--json", "url,state,headRefName,headRefOid,isCrossRepository"]);
  if (view.status !== 0) refuse("remote_unobservable", `the pull request ${input.pullRequestUrl} could not be read: ${view.stderr.trim().slice(0, 200)}`);
  let observed: Record<string, unknown>;
  try {
    observed = JSON.parse(view.stdout) as Record<string, unknown>;
  } catch {
    return refuse("remote_unobservable", `the pull request ${input.pullRequestUrl} returned unreadable JSON`);
  }
  const prMismatches = [
    observed.state !== "OPEN" && `state ${String(observed.state)}`,
    observed.headRefName !== input.branch && `head branch ${String(observed.headRefName)}`,
    observed.headRefOid !== input.tip && `head ${String(observed.headRefOid)}`,
    observed.isCrossRepository !== false && "cross-repository head"
  ].filter(Boolean);
  if (prMismatches.length > 0) refuse("pull_request_mismatch", `pull request ${input.pullRequestUrl} is not open at ${input.branch} ${input.tip}: ${prMismatches.join(", ")}`);

  return {
    reconciled: true,
    basis: "settled_descendant",
    tip: input.tip,
    receiptCommit: input.receiptCommit,
    settlement: { commit: input.tip, receiptId, paths: [...new Set(changes.flatMap((change) => change.paths))], plan: completedIn[0], archivedAsks },
    remote: { branch: `${input.githubRepository}:${input.branch}@${remoteTip}`, pullRequest: input.pullRequestUrl }
  };
}

interface RawChange {
  status: string;
  modes: string[];
  paths: string[];
}

/** `git diff-tree --raw -z` records: `:old new oldSha newSha status\0path\0[path\0]`. */
function parseRawDiff(raw: string): RawChange[] {
  const fields = raw.split("\0");
  const changes: RawChange[] = [];
  for (let index = 0; index < fields.length; index++) {
    const header = fields[index];
    if (!header.startsWith(":")) continue;
    const [oldMode, newMode, , , status] = header.slice(1).split(" ");
    const pathCount = /^[RC]/.test(status) ? 2 : 1;
    changes.push({ status, modes: [oldMode, newMode], paths: fields.slice(index + 1, index + 1 + pathCount) });
    index += pathCount;
  }
  return changes;
}

/** A Plan's Action statuses from its frontmatter, or null when it has none. */
function actionStatuses(shown: CommandResult): Map<string, string> | null {
  if (shown.status !== 0) return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(shown.stdout);
  if (!match) return null;
  try {
    const frontmatter = parseYaml(match[1]) as { actions?: Array<{ id?: unknown; status?: unknown }> } | null;
    if (!frontmatter || !Array.isArray(frontmatter.actions)) return null;
    return new Map(frontmatter.actions.flatMap((action) => typeof action.id === "string" ? [[action.id, String(action.status)] as [string, string]] : []));
  } catch {
    return null;
  }
}
