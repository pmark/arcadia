import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { withDatabase } from "../src/db/connection.js";
import { createCodexInvocation, createReviewItem, getWorkItemByDocRef, updateReviewItemStatus, upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import { prepareSession, reserveAgentWorktree } from "../src/sessions/index.js";
import { activateProduction, fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";

export const fixtureGit = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Synthetic, explicitly bounded fixture authority. No real Project or provider
 * Session is activated. Used both by deterministic tests and the OS-boundary proof. */
export function preservationFixture(root?: string, command = "node check.mjs") {
  root = realpathSync(root ?? mkdtempSync(path.join(tmpdir(), "arcadia-preservation-fixture-")));
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  const candidate = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-preservation-candidate-")));
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  const doc = (file: string, frontmatter: object) => writeFileSync(path.join(repo, file), `---\n${YAML.stringify(frontmatter)}---\n`);
  doc("PROJECT.md", { arcadia: "v1", type: "project", slug: "preservation-fixture", name: "Preservation Fixture", status: "active", goal: "Prove protected preservation.", active_plan: "proof", current_action: "write-marker", updated: "2026-09-12" });
  doc("docs/plans/proof.md", { arcadia: "v1", type: "plan", slug: "proof", project: "preservation-fixture", status: "active", milestone: "Prove preservation", current_action: "write-marker", token_impact: "none", token_budget: "Deterministic fixture only.", recommended_model: "fixture", updated: "2026-09-12", actions: [{ id: "write-marker", title: "Write marker", status: "open", responsibility: "agent", effort: "session", clarification: "clarified", next_action: "Write the marker.", expected_artifact: "marker.txt", acceptance_criteria: ["Marker is ready."], depends_on: [], decisions: [], references: [] }] });
  writeFileSync(path.join(repo, "check.mjs"), "import {readFileSync} from 'node:fs'; if(readFileSync('marker.txt','utf8')!=='ready\\n') process.exit(1);\n");
  fixtureGit(repo, ["init", "-q", "-b", "main"]);
  fixtureGit(repo, ["config", "user.name", "Arcadia Fixture"]); fixtureGit(repo, ["config", "user.email", "fixture@arcadia.local"]);
  fixtureGit(repo, ["add", "."]); fixtureGit(repo, ["commit", "-qm", "Fixture baseline"]);
  const base = fixtureGit(repo, ["rev-parse", "HEAD"]);
  fixtureGit(repo, ["worktree", "add", "-b", "codex/preservation-fixture", candidate, "HEAD"]);
  writeFileSync(path.join(candidate, "marker.txt"), "ready\n");
  initWorkspace(workspace);
  const lease = withDatabase(workspace, db => {
    const project = upsertProject(db, { name: "Preservation Fixture", mission: "Prove preservation", goal: "Prove preservation", status: "active", currentMilestone: "Prove preservation", nextAction: "Write the marker.", workClassification: "agent" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo, validationCommands: [command] });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length) throw Error(JSON.stringify(sync.errors));
    const workItem = getWorkItemByDocRef(db, "plan/proof#write-marker")!;
    const promptPath = "prompts/codex/preservation-fixture/prompt.md";
    mkdirSync(path.dirname(path.join(workspace, promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), `# Authorized fixture packet\n- Run validation command: ${command}\n`);
    writeFileSync(path.join(workspace, "prompts/codex/preservation-fixture/metadata.json"), JSON.stringify({ invocationId: "fixture-packet", workItemId: workItem.id, promptPath, providerSelection: { provider: "codex-cli", model: "fixture", mappingId: "fixture-map", bindingId: "fixture-binding" } }));
    createCodexInvocation(db, { id: "fixture-packet", purpose: "build", agentProfile: "codex_build", workspaceScope: repo, command: "codex", promptPath, jsonlOutputPath: "output.jsonl", finalMessagePath: "final.md", status: "packet_created", workItemId: workItem.id, providerMappingId: "fixture-map", providerBindingId: "fixture-binding" });
    const approval = createReviewItem(db, { projectId: project.id, workItemId: workItem.id, codexInvocationId: "fixture-packet", decisionNeeded: "Authorize disposable fixture packet", sourceInput: "Synthetic fixture authority", proposedAction: "Validate and preserve fixture locally only", resolvedIntent: "CodexPlanningArtifactAcceptance", confidenceLabel: "high", confidence: 1, missingFields: [], context: { planningPromotion: { actionId: "write-marker", actionDocRef: "plan/proof#write-marker", repoPath: repo, buildProfile: "codex_build", buildInvocationId: "fixture-packet", buildPacketPath: promptPath, buildPacketSha256: packetSha256(path.join(workspace, promptPath)) } } });
    updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Fixture only; no integration or completion." });
    const scope = normalizeProductionScope({ intent: "Prove local fixture preservation only", projects: [project.slug], plans: [`${project.slug}/proof`], actions: [`${project.slug}/write-marker`], providers: ["codex-cli"], maxConcurrentSessions: 1, mechanicalTransitions: ["validation"], remotePreservation: false });
    activateProduction(db, { requestId: "fixture-authority", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "fixture-operator" });
    reserveAgentWorktree(db, { repositoryPath: repo, worktreePath: candidate, branch: "codex/preservation-fixture", now: new Date() });
    return prepareSession({ db, workspace, repoRoot: repo, dispatch: resolveDispatch(repo, project.slug), agent: "codex", model: "fixture", effort: null, baseRevision: base, branch: "codex/preservation-fixture", worktreePath: candidate, now: new Date(), tmux: { available: () => true, hasSession: () => false, launch: () => { throw Error("Fixture must not launch a coding agent"); } } });
  });
  return { root, repo, candidate, workspace, lease, base };
}
