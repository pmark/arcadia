import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { runProjectUpdateCommand } from "../src/commands/project.js";
import { runReviewRejectCommand } from "../src/commands/review.js";
import { resolveReadyWorkspace } from "../src/cli/workspace.js";
import { withReadOnlyDatabase } from "../src/db/connection.js";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import {
  buildDispositionPlan, decideAsk, decideProject, decideReview, DispositionRefusal, previewTouchesOtherCheckout,
  TODO_BULK_DISPOSITION_20261010 as PINS, type ExistingSettlement, type ProjectRow
} from "../src/operatorActions/todoBulkDisposition.js";

// Entry point for the operator action apply-todo-bulk-disposition-20261010.
// usage: apply-todo-bulk-disposition.ts <descriptor.json> <run-directory> (--dry-run | --apply)
// Applies the accepted /todo bulk disposition only through the canonical writers (Agent Ask
// settlement with disposition rejected, review reject, project update --status completed).
// Settlement archive commits land on a fresh worktree branch, never on the main checkout.
// Exit 0: every item applied or skipped with a recorded reason. 1: an item failed or a stage
// refused (receipt says which). 2: usage.
const usage = "usage: apply-todo-bulk-disposition.ts <descriptor.json> <run-directory> (--dry-run | --apply)\n";
const [descriptorArg, runDirectory, modeArg] = process.argv.slice(2);
if (!descriptorArg || !runDirectory || (modeArg !== "--dry-run" && modeArg !== "--apply")) { process.stderr.write(usage); process.exit(2); }
const dryRun = modeArg === "--dry-run";
const descriptorPath = path.resolve(descriptorArg);
const repo = realpathSync(path.resolve(path.dirname(descriptorPath), "../../.."));
const scriptId = path.basename(descriptorPath, ".json");
const ARCHIVE_BRANCH = "operator/todo-bulk-disposition-archives-20261010";
const ARCHIVE_WORKTREE = path.join(os.homedir(), "tmp", "arcadia-todo-bulk-disposition-20261010");
const TRACKED = [
  `artifacts/generated/operator-scripts/${scriptId}.json`, `artifacts/generated/operator-scripts/${scriptId}.sh`,
  PINS.manifestPath, "scripts/apply-todo-bulk-disposition.ts", "src/operatorActions/todoBulkDisposition.ts",
  "src/operatorActions/libraryContract.ts", "src/operatorActions/operatorExecution.ts"
];

interface ItemResult { kind: "agent_ask" | "review_item" | "project"; id: string; key?: string; project?: string; outcome: string; note: string; receipt?: string; documents?: string[]; documentsCommit?: string | null }
const results: ItemResult[] = [];
const receipt: Record<string, unknown> = {
  schema: "arcadia-todo-bulk-disposition-run-v1", id: scriptId, mode: dryRun ? "dry-run" : "apply",
  startedAt: new Date().toISOString(), manifest: PINS.manifestPath, manifestSha256: PINS.sha256
};
let stage = "preconditions";

const git = (cwd: string, args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (cwd: string, args: string[]): string | null => { try { return git(cwd, args); } catch { return null; } };
const commonDir = (cwd: string) => realpathSync(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const record = (result: ItemResult) => { results.push(result); process.stdout.write(`${result.kind} ${result.key ?? result.id} -> ${result.outcome}: ${result.note}\n`); };
function finish(outcome: "succeeded" | "dry_run" | "refused" | "failed", reason?: string): never {
  const counts: Record<string, number> = {};
  for (const r of results) counts[`${r.kind}:${r.outcome}`] = (counts[`${r.kind}:${r.outcome}`] ?? 0) + 1;
  Object.assign(receipt, { finishedAt: new Date().toISOString(), outcome, stage, reason: reason ?? null, counts, items: results });
  writeFileSync(path.join(runDirectory, "disposition-receipt.json"), JSON.stringify(receipt, null, 1) + "\n");
  process.stdout.write(`== ${outcome}${reason ? `: ${reason}` : ""}\n${JSON.stringify(counts, null, 1)}\n`);
  process.exit(outcome === "succeeded" || outcome === "dry_run" ? 0 : 1);
}

try {
  // --- Preconditions: reviewed code, pinned list, declared scope, workspace. ---
  if (process.env.ARCADIA_WORKSPACE) throw new DispositionRefusal("WORKSPACE_EXPORTED", "ARCADIA_WORKSPACE is exported; this action uses the CLI default workspace only.");
  const expectedId = process.env.ARCADIA_OPERATOR_SCRIPT_ID, expectedDescriptor = process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR;
  if (expectedId !== scriptId || !expectedDescriptor || path.resolve(expectedDescriptor) !== descriptorPath) {
    throw new DispositionRefusal("OPERATOR_CONTEXT", "The operator execution context must name this action's own descriptor, so settlement enforces its pinned scope.");
  }
  for (const file of TRACKED) {
    if (tryGit(repo, ["ls-files", "--error-unmatch", file]) === null) throw new DispositionRefusal("UNTRACKED", `${file} is not tracked in ${repo}.`);
  }
  if (tryGit(repo, ["diff", "--quiet", "HEAD", "--", ...TRACKED]) === null) throw new DispositionRefusal("MODIFIED", "This action's files have local modifications.");
  if (!dryRun && tryGit(repo, ["diff", "--quiet", "origin/main", "--", ...TRACKED]) === null) {
    throw new DispositionRefusal("NOT_ON_MAIN", "This action's files differ from origin/main: only the reviewed, merged version may run.");
  }
  const descriptor = validateOperatorScriptContract(JSON.parse(readFileSync(descriptorPath, "utf8")), scriptId,
    readFileSync(descriptorPath.replace(/\.json$/, ".sh"), "utf8"));
  if (!descriptor.agentAskRejections || descriptor.repeatable === true) throw new DispositionRefusal("DESCRIPTOR_SCOPE_MISMATCH", "The descriptor must declare a one-shot agentAskRejections scope.");
  const plan = buildDispositionPlan(readFileSync(path.join(repo, PINS.manifestPath), "utf8"), descriptor.agentAskRejections);
  const { workspacePath } = resolveReadyWorkspace();
  if (path.basename(workspacePath) !== "martianrover") throw new DispositionRefusal("WORKSPACE", `The default workspace is ${workspacePath}, not martianrover.`);
  const mainHeadBefore = git(repo, ["rev-parse", "HEAD"]);
  Object.assign(receipt, { workspace: workspacePath, repository: repo, mainCheckoutHead: mainHeadBefore,
    planned: { agentAsks: plan.asks.length, crossRepoSkipped: plan.crossRepoSkips.length, reviewItems: plan.reviews.length, projects: plan.projects.length } });

  // --- Archive worktree: any Ask-file archive commit lands here, never on the main checkout. ---
  stage = "archive-worktree";
  let worktree: string;
  let worktreeBase: string;
  if (dryRun) {
    worktree = path.join(mkdtempSync(path.join(os.tmpdir(), "todo-bulk-dry-")), "wt");
    git(repo, ["worktree", "add", "--detach", worktree, "origin/main"]);
    worktreeBase = git(worktree, ["rev-parse", "HEAD"]);
  } else if (existsSync(ARCHIVE_WORKTREE)) {
    worktree = realpathSync(ARCHIVE_WORKTREE);
    if (git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]) !== ARCHIVE_BRANCH || git(worktree, ["status", "--porcelain"]) !== "" ||
        commonDir(worktree) !== commonDir(repo)) {
      throw new DispositionRefusal("ARCHIVE_WORKTREE", `${ARCHIVE_WORKTREE} exists but is not a clean ${ARCHIVE_BRANCH} worktree of ${repo}.`);
    }
    worktreeBase = git(worktree, ["merge-base", "HEAD", "origin/main"]);
    process.stdout.write(`Resuming in existing archive worktree ${worktree}\n`);
  } else {
    git(repo, ["fetch", "origin", "main"]);
    if (tryGit(repo, ["rev-parse", "--verify", `refs/heads/${ARCHIVE_BRANCH}`]) !== null) {
      throw new DispositionRefusal("ARCHIVE_BRANCH", `Branch ${ARCHIVE_BRANCH} exists without its worktree; inspect it before rerunning.`);
    }
    git(repo, ["worktree", "add", "-b", ARCHIVE_BRANCH, ARCHIVE_WORKTREE, "origin/main"]);
    worktree = realpathSync(ARCHIVE_WORKTREE);
    worktreeBase = git(worktree, ["rev-parse", "HEAD"]);
  }
  Object.assign(receipt, { archiveWorktree: dryRun ? "(temporary, removed)" : worktree, archiveBranch: dryRun ? null : ARCHIVE_BRANCH, archiveBase: worktreeBase });

  try {
    // --- Read current state once, read-only. ---
    const state = withReadOnlyDatabase(workspacePath, (db) => ({
      proposals: new Set((db.prepare("SELECT id FROM agent_ask_proposals").all() as Array<{ id: string }>).map((r) => r.id)),
      settlements: new Map((db.prepare("SELECT proposal_id, request_id, receipt_json FROM agent_ask_settlements").all() as Array<{ proposal_id: string; request_id: string; receipt_json: string }>)
        .map((r) => [r.proposal_id, { requestId: r.request_id, disposition: (JSON.parse(r.receipt_json) as { disposition?: string }).disposition ?? "unknown" } satisfies ExistingSettlement])),
      reviews: new Map((db.prepare("SELECT id, status FROM review_items").all() as Array<{ id: string; status: string }>).map((r) => [r.id, r.status])),
      projects: new Map((db.prepare("SELECT p.id, p.slug, p.status, m.repo_path FROM projects p LEFT JOIN project_metadata m ON m.project_id = p.id").all() as ProjectRow[]).map((r) => [r.id, r]))
    }));

    // --- Agent Asks: reject through the canonical settlement (preview, then apply that fingerprint). ---
    stage = "agent-asks";
    for (const skip of plan.crossRepoSkips) record({ kind: "agent_ask", id: skip.proposalId, key: skip.key, project: skip.project, outcome: "skipped", note: "cross-repo item outside the declared scope; left for its own repository" });
    for (const ask of plan.asks) {
      const base = { kind: "agent_ask" as const, id: ask.proposalId, key: ask.key, project: ask.project };
      const decision = decideAsk(ask, state.proposals.has(ask.proposalId), state.settlements.get(ask.proposalId));
      if (!decision.act) { record({ ...base, outcome: "skipped", note: decision.note }); continue; }
      const settle = { workspace: workspacePath, proposal: ask.proposalId, requestId: ask.settlementRequestId, disposition: "rejected" as const, cwd: worktree };
      let preview;
      try { preview = runAgentAskSettleCommand(settle).data.receipt; }
      catch (error) { record({ ...base, outcome: "skipped", note: `settlement preview refused, nothing written: ${message(error)}` }); continue; }
      const documents = (preview.review?.documents ?? []).map((doc) => doc.path);
      if (previewTouchesOtherCheckout(ask.project, preview.review?.documents ?? [])) {
        record({ ...base, outcome: "skipped", documents, note: "rejecting would archive a file on that repository's own checkout; left for its own repository" }); continue;
      }
      if (dryRun) { record({ ...base, outcome: "would_reject", documents, note: documents.length ? `would archive ${documents.join(", ")} in the archive worktree` : "would record the rejection; no file changes" }); continue; }
      try {
        const applied = runAgentAskSettleCommand({ ...settle, preview: preview.previewFingerprint, apply: true }).data.receipt;
        const commit = applied.documentsCommit ?? null;
        if (commit && commit !== git(worktree, ["rev-parse", "HEAD"])) throw new Error(`settlement commit ${commit} is not the archive worktree's HEAD`);
        if (git(repo, ["rev-parse", "HEAD"]) !== mainHeadBefore) throw new Error("the main checkout's HEAD moved during the run");
        record({ ...base, outcome: "rejected", receipt: applied.id, documents, documentsCommit: commit, note: applied.recovery ? `recorded with recovery: ${JSON.stringify(applied.recovery)}` : "rejected" });
      } catch (error) {
        record({ ...base, outcome: "failed", note: message(error) });
        if (/HEAD/.test(message(error))) throw new DispositionRefusal("CHECKOUT_GUARD", message(error));
      }
    }

    // --- Review items: canonical review reject. ---
    stage = "review-items";
    for (const review of plan.reviews) {
      const base = { kind: "review_item" as const, id: review.reviewItemId, key: review.key, project: review.project };
      const decision = decideReview(state.reviews.get(review.reviewItemId));
      if (!decision.act) { record({ ...base, outcome: "skipped", note: decision.note }); continue; }
      if (dryRun) { record({ ...base, outcome: "would_reject", note: decision.note }); continue; }
      try { runReviewRejectCommand({ workspace: workspacePath, id: review.reviewItemId }); record({ ...base, outcome: "rejected", note: decision.note }); }
      catch (error) { record({ ...base, outcome: "failed", note: message(error) }); }
    }

    // --- Fixture Projects: canonical project update --status completed. ---
    stage = "fixture-projects";
    for (const pinned of plan.projects) {
      const base = { kind: "project" as const, id: pinned.id, key: pinned.slug };
      const decision = decideProject(pinned, state.projects.get(pinned.id), os.homedir());
      if (!decision.act) { record({ ...base, outcome: decision.failed ? "failed" : "skipped", note: decision.note }); continue; }
      if (dryRun) { record({ ...base, outcome: "would_complete", note: decision.note }); continue; }
      try { runProjectUpdateCommand({ workspace: workspacePath, projectId: pinned.id, status: "completed" }); record({ ...base, outcome: "completed", note: decision.note }); }
      catch (error) { record({ ...base, outcome: "failed", note: message(error) }); }
    }

    // --- Publish archive commits from the worktree branch: push and open or update one PR. ---
    stage = "publish-archives";
    if (!dryRun) {
      const ahead = Number(git(worktree, ["rev-list", "--count", `${worktreeBase}..HEAD`]));
      receipt.archiveCommits = ahead;
      if (ahead === 0) {
        git(repo, ["worktree", "remove", worktree]);
        if (git(repo, ["rev-parse", ARCHIVE_BRANCH]) === worktreeBase) git(repo, ["branch", "-D", ARCHIVE_BRANCH]);
        receipt.archivePullRequest = null;
        process.stdout.write("No Ask files needed archiving: removed the empty archive worktree.\n");
      } else {
        git(worktree, ["push", "origin", `HEAD:refs/heads/${ARCHIVE_BRANCH}`]);
        const gh = (args: string[]) => execFileSync("gh", args, { cwd: worktree, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        const existing = JSON.parse(gh(["pr", "list", "--head", ARCHIVE_BRANCH, "--state", "open", "--json", "url"])) as Array<{ url: string }>;
        receipt.archivePullRequest = existing[0]?.url ?? gh(["pr", "create", "--base", "main", "--head", ARCHIVE_BRANCH,
          "--title", "chore(asks): archive Ask files rejected by the /todo bulk disposition (2026-10-10)",
          "--body", `Written by the operator action \`${scriptId}\` (list ${PINS.manifestPath}, sha256 ${PINS.sha256}).\n\n` +
            `${ahead} commit(s) from \`arcadia agent-ask settle --disposition rejected --apply\`; each moves one settled Ask file to \`.arcadia/asks/archive/\`. ` +
            "No Project, Plan, Action, pointer or queue changes."]);
        process.stdout.write(`Archive pull request: ${String(receipt.archivePullRequest)}\n`);
      }
    }
  } finally {
    if (dryRun) tryGit(repo, ["worktree", "remove", "--force", worktree]);
  }
  stage = "done";
  const failed = results.filter((r) => r.outcome === "failed").length;
  finish(dryRun ? "dry_run" : failed ? "failed" : "succeeded", failed ? `${failed} item(s) failed; rerun resumes and skips everything already applied` : undefined);
} catch (error) {
  finish(error instanceof DispositionRefusal ? "refused" : "failed", error instanceof DispositionRefusal ? `${error.reason}: ${error.message}` : message(error));
}
