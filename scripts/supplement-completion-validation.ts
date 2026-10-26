// Fixed host entry point. The descriptor selects one concrete operation; this
// runner accepts no candidate commands and never changes an old Session receipt.
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { refuseInExperimentWorkspace } from "../src/workspace/experimentGuard.js";
import { resolveReadyWorkspace } from "../src/cli/workspace.js";
import { withDatabase } from "../src/db/connection.js";
import { completionSupplementOperator, readSupplementJson, supplementDigest } from "../src/operatorActions/operatorExecution.js";
import { completionSupplementDirectory, writeSupplementFile } from "../src/sessions/completionValidationEvidence.js";
import { produceCompletionSupplement } from "../src/sessions/reconciliation.js";
import { runQaPrReviewCommand } from "../src/qa/prReview.js";

const [descriptor, mode] = process.argv.slice(2);
if (process.argv.length !== 4 || !descriptor || !["run", "--describe"].includes(mode ?? "")) {
  process.stderr.write("Usage: supplement-completion-validation.ts <descriptor.json> run|--describe\n");
  process.exit(64);
}
if (mode === "--describe") {
  process.stdout.write(readFileSync(descriptor));
} else {
  const operator = completionSupplementOperator(descriptor);
  const p = operator.contract;
  const { workspacePath } = resolveReadyWorkspace();
  refuseInExperimentWorkspace("operator-script.run", workspacePath);
  if (workspacePath !== p.workspace) throw new Error("The operator action does not name the configured workspace.");
  let result: unknown;
  if (p.phase === "produce") {
    result = withDatabase(workspacePath, db => produceCompletionSupplement(db, operator));
  } else {
    // A permanent intent before any reviewer call. A crash leaves an unknown
    // effect, never a request to infer again; exact terminal replay reads only.
    const directory = completionSupplementDirectory(workspacePath, p.sessionId, p.requestId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const intent = path.join(directory, "review-intent.json");
    const terminal = path.join(directory, "review-result.json");
    if (existsSync(intent)) {
      if (supplementDigest(readSupplementJson(intent, workspacePath).value) !== supplementDigest(p)) throw new Error("Review request replay changed its contract.");
      result = readSupplementJson(terminal, workspacePath).value;
    } else {
      writeSupplementFile(workspacePath, intent, p);
      result = runQaPrReviewCommand({ workspace: workspacePath, role: p.phase, pullRequest: p.pullRequest!,
        completionSupplement: { workspace: workspacePath, ...p.artifact! },
        expectedCandidate: { headSha: p.head, bodySha256: p.bodySha256!, inputRevision: p.inputRevision, maxOrdinal: p.phase === "code-review" ? 5 : 1 },
        rerun: true });
      writeSupplementFile(workspacePath, terminal, result);
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
