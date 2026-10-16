import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationError } from "../cli/errors.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { attachArtifactToExecutionRun, claimNextPendingRun, createArtifactRecord, getAskRequest, getExecutionRun, getProjectMetadata } from "../db/repositories.js";
import { assertApprovedReview } from "../execution/reviewExecutor.js";
import { executeClaimedReviewRun } from "../execution/claimedReviewRun.js";
import { readProductionPolicy } from "../production/policy.js";
import { readExperimentWorkspace } from "../workspace/config.js";
import { assertRepoPathAllowed, isInside } from "../workspace/experimentGuard.js";

export interface RunConsumeOptions {
  workspace: string;
  runId?: string;
  askId: string;
  sourceHead: string;
  fixtureScript?: string;
}

/** One explicit fixture Run only. Live admission stays closed until Action 2. */
export function runRunConsumeCommand(options: RunConsumeOptions) {
  if (!options.runId?.trim() || options.runId !== options.runId.trim()) {
    throw validationError("An exact named Run selector is required; no fallback is permitted.");
  }
  // Check fixture scope before opening its database: a normal workspace is never touched.
  const experiment = readExperimentWorkspace(options.workspace);
  if (!experiment) throw validationError("consume-one requires a disposable experiment workspace.");
  if (!options.fixtureScript) {
    throw validationError("Live execution is blocked: durable Decision 0128 reservation and independent restore detection are unavailable.");
  }
  const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(options.sourceHead) || head !== options.sourceHead) {
    throw validationError("Source pin is stale or invalid.");
  }
  const script = realpathSync(options.fixtureScript);
  if (!isInside(experiment.workspacePath, script) || !script.endsWith(".mjs") || !lstatSync(script).isFile()) {
    throw validationError("The scripted fixture executor must be an .mjs file inside the experiment workspace.");
  }
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return withDatabase(workspacePath, (db) => {
    // Approval, correlation and the compare-and-set claim share one immediate transaction.
    const admitted = db.transaction(() => {
      if (readProductionPolicy(db).desiredState !== "inactive") throw validationError("Production must be Off.");
      const run = getExecutionRun(db, options.runId!);
      if (!run || run.status !== "pending_execution" || !run.review_item_id || !run.work_item_id) {
        throw validationError("Named Run is absent, unrelated or already claimed.");
      }
      const { review, triggerReview } = assertApprovedReview(db, { workspace: workspacePath, reviewId: run.review_item_id, runId: run.id });
      const ask = getAskRequest(db, options.askId);
      const approvedAsk = review.resulting_ask_request_id ? getAskRequest(db, review.resulting_ask_request_id) : null;
      if (!ask || ask.id !== review.ask_request_id || approvedAsk?.work_item_id !== run.work_item_id || review.resolved_intent === "ProjectProposalApproval") {
        throw validationError("Named Run does not belong to the named approved Ask.");
      }
      const metadata = review.project_id ? getProjectMetadata(db, review.project_id) : null;
      if (!metadata?.repo_path) throw validationError("Fixture repository is missing.");
      assertRepoPathAllowed(workspacePath, metadata.repo_path);
      const repo = realpathSync(metadata.repo_path);
      if (!isInside(experiment.allowedRepoRoot, repo)) throw validationError("Non-fixture repository refused.");
      if (execFileSync("git", ["remote"], { cwd: repo, encoding: "utf8" }).trim()) throw validationError("Fixture repository must have no remotes.");
      if (execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim()) throw validationError("Fixture repository must start clean.");
      const claimed = claimNextPendingRun(db, process.pid, run.id);
      if (!claimed) throw validationError("Named Run was already claimed.");
      return { run: claimed, review, triggerReview, repo };
    }).immediate();
    const run = executeClaimedReviewRun(db, workspacePath, admitted.run, admitted.triggerReview, {
      fixtureAdapter: { name: "scripted-fixture", commandTemplate: process.execPath, args: [script], promptMode: "stdin", workingDirectory: "repo", timeoutMs: 5000, environmentAllowlist: [], outputCapture: "combined" },
      acceptProduct: (result) => {
        const output = path.join(admitted.repo, "HelloWorld.txt");
        if (!lstatSync(output).isFile() || !readFileSync(output).equals(Buffer.from("Hello World!\n")) || result.changedFiles.length !== 1 || result.changedFiles[0] !== "HelloWorld.txt") {
          throw validationError("Exact fixture product was not produced; completion is refused.");
        }
        const artifact = createArtifactRecord(db, { projectId: admitted.review.project_id, workItemId: admitted.run.work_item_id, title: "HelloWorld.txt", artifactType: "text", status: "ready", path: output });
        attachArtifactToExecutionRun(db, admitted.run.id, artifact.id);
      }
    });
    return createSuccess({ command: "run.consume-one", workspace: workspacePath, data: { run, executorMode: "scripted-fixture", liveProviderAdmission: "blocked", sourceHead: head } });
  });
}
