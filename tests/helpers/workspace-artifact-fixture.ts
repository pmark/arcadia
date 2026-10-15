import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";
import { withDatabase } from "../../src/db/connection.js";
import { createProjectWithInitialWork, createWorkItemWithOptionalArtifact, createExecutionPlan, createExecutionRun, createArtifactRecord, createAskRequest, upsertProjectMetadata, attachArtifactToExecutionRun } from "../../src/db/repositories.js";
import { captureAskEnvelope } from "../../src/ask/captureEnvelope.js";

export const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="seagreen"/><text x="20" y="60" fill="white">Actual Artifact</text><script>parent.artifactScriptRan=true</script><image href="https://artifact-sentinel.invalid/image.png"/></svg>';
export function workspaceArtifactFixture(root: string) {
  const workspace = path.join(root, "workspace");
  const repo = path.join(workspace, "projects", "garden");
  mkdirSync(repo, { recursive: true });
  initWorkspace(workspace, { experiment: { enabled: true, allowedRepoRoot: "projects" } });
  writeFileSync(path.join(workspace, "artifacts", "output.svg"), svg);
  writeFileSync(path.join(repo, "output.md"), '<script>window.textExecuted=true</script>\nA readable text Artifact.');
  return withDatabase(workspace, db => {
    const project = createProjectWithInitialWork(db, { name: "Garden", mission: "Disposable Artifact proof", goal: "Open output", status: "active", currentMilestone: "Readable output", nextAction: "Read output", workClassification: "agent" }).project;
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const capture = captureAskEnvelope(db, { requestId: "artifact-receipt", originalText: "Show the output", ingressSource: "dashboard.ask" });
    const action = createWorkItemWithOptionalArtifact(db, { projectId: project.id, captureId: capture.id, title: "View output", rawInput: "View output", queue: "inbox", workClassification: "agent", nextAction: "View output" }).workItem;
    const plan = createExecutionPlan(db, { workItemId: action.id, summary: "Output plan", steps: [] })!;
    createAskRequest(db, { captureId: capture.id, rawRequest: "Show the output", resolvedIntent: "view", registryVersion: 1, outputKind: "plan", workItemId: action.id, status: "planned" });
    const run = createExecutionRun(db, { workItemId: action.id, planId: plan.id, status: "completed", summary: "Created output", steps: [] })!;
    function artifact(file: string | undefined, projectId: string | undefined = project.id, linked = true) {
      const result = createArtifactRecord(db, { projectId, title: "Output", artifactType: "file", path: file, status: "ready" });
      if (linked) attachArtifactToExecutionRun(db, run.id, result.id);
      return result.id;
    }
    return { root, workspace, repo, projectId: project.id, actionId: action.id, runId: run.id, receipt: capture.requestId, svgId: artifact("artifacts/output.svg"), textId: artifact(path.join(repo, "output.md")), pathlessId: artifact(undefined) };
  });
}
