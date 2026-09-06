import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import {
  createCodexInvocation,
  createReviewItem,
  getWorkItemByDocRef,
  upsertProject,
  upsertProjectMetadata,
  updateReviewItemStatus
} from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { prepareSession } from "../src/sessions/index.js";
import { buildLaunchPreview, LAUNCH_ADAPTER_SUPPORT } from "../src/sessions/launchPreview.js";
import { resolvePacketLifecycle } from "../src/sessions/packetLifecycle.js";
import { runWorkPlanCommand } from "../src/commands/work.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const profiles: CodingAgentProfile[] = [
  profile("codex_build", "codex-cli", "build", "workspace-write"),
  profile("claude_build", "claude-code-cli", "build", "workspace-write")
];

describe("buildLaunchPreview", () => {
  it("is ready, starts no process, and mutates nothing when the packet and its authority are current", () => {
    const fixture = preparedFixture();
    const before = withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM agent_sessions").get() as { n: number });

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-1",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );

    expect(preview.prerequisites).toEqual([]);
    expect(preview.ready).toBe(true);
    expect(preview.actionDocRef).toBe("plan/copy-proof#define-contract");
    expect(preview.queueRevision).toBeGreaterThanOrEqual(0);
    expect(preview.baseRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(preview.packet).toMatchObject({ invocationId: fixture.packetId, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(preview.authorizingDecisions).toContain("0001");
    expect(preview.selection).toMatchObject({ provider: "claude-code-cli", model: "sonnet", mappingId: "fixture-map", bindingId: "fixture-binding" });
    expect(preview.selectionRationale).toBeTruthy();
    expect(preview.documentRevisions.projectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.documentRevisions.planSha256).toMatch(/^[a-f0-9]{64}$/);

    const after = withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM agent_sessions").get() as { n: number });
    expect(after.n).toBe(before.n);

    const replay = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-1",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(replay.previewFingerprint).toBe(preview.previewFingerprint);
  });

  it("names a missing build packet as a prerequisite instead of throwing", () => {
    const fixture = preparedFixture({ skipInvocation: true });
    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-2",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(preview.ready).toBe(false);
    expect(preview.packet).toBeNull();
    expect(preview.packetLifecycle?.kind).toBe("planning_required");
    expect(preview.prerequisites.some((entry) => entry.startsWith("planning required"))).toBe(true);
    expect(preview.prerequisites[0]).toContain("arcadia work plan");
  });

  it("keeps a planning Decision distinct from build authority", () => {
    const fixture = preparedFixture({ skipInvocation: true });
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!);
    const prepared = runWorkPlanCommand({ workspace: fixture.workspace, workId: workItem.id });
    expect(prepared.data.planningDecision).toBeTruthy();

    const lifecycle = withReadOnlyDatabase(fixture.workspace, (db) =>
      resolvePacketLifecycle(db, getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!)
    );
    expect(lifecycle).toMatchObject({
      kind: "planning_approval_pending",
      decisionId: prepared.data.planningDecision!.id
    });
    expect(lifecycle.remedy).toContain("planning only, not implementation");
  });

  it("names a changed packet's stale authority as a prerequisite instead of throwing", () => {
    const fixture = preparedFixture();
    writeFileSync(path.join(fixture.workspace, "prompts", "codex", fixture.packetId, "prompt.md"), "changed after approval\n");
    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-3",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(preview.ready).toBe(false);
    expect(preview.packetLifecycle?.kind).toBe("stale_packet");
    expect(preview.prerequisites.some((entry) => entry.includes("stale") && entry.includes("authority"))).toBe(true);
  });

  it("names an already-leased repository as a conflicting-execution prerequisite", () => {
    const fixture = preparedFixture();
    const dispatch = resolveDispatch(fixture.repo, "test-project");
    withDatabase(fixture.workspace, (db) =>
      prepareSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        dispatch,
        agent: "claude",
        model: "sonnet",
        effort: "high",
        baseRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.repo, encoding: "utf8" }).trim(),
        branch: "claude/held",
        worktreePath: path.join(fixture.root, "held-worktree"),
        now: fixture.now
      })
    );

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-4",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(preview.ready).toBe(false);
    expect(preview.prerequisites.some((entry) => entry.startsWith("conflicting execution"))).toBe(true);
  });

  it("accepts a packet-selected Codex adapter without silently substituting another provider", () => {
    expect(LAUNCH_ADAPTER_SUPPORT["codex-cli"]).toBe(true);
    const fixture = preparedFixture({ provider: "codex-cli", model: "gpt-5.6-terra", mappingId: "bundled-2026-07-25.1", bindingId: "codex-terra" });
    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-5",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(preview.ready).toBe(true);
    expect(preview.prerequisites).toEqual([]);
    expect(preview.selection?.provider).toBe("codex-cli");
  });
});

function preparedFixture(options?: { skipInvocation?: boolean; provider?: string; model?: string; mappingId?: string; bindingId?: string }) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-launch-preview-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), planDocument);
  writeFileSync(path.join(repo, "docs", "decisions", "0001-authorize.md"), decisionDocument);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  initWorkspace(workspace);
  const packetId = "codex_launch_preview_fixture";
  const provider = options?.provider ?? "claude-code-cli";
  const model = options?.model ?? "sonnet";
  const mappingId = options?.mappingId ?? "fixture-map";
  const bindingId = options?.bindingId ?? "fixture-binding";
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove launch previews.", goal: "Prove launch previews.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
    if (options?.skipInvocation) return;
    const promptPath = `prompts/codex/${packetId}/prompt.md`;
    const baseRevision = git(repo, ["rev-parse", "HEAD"]).trim();
    mkdirSync(path.join(workspace, path.dirname(promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), "immutable build packet\n");
    writeFileSync(
      path.join(workspace, path.dirname(promptPath), "metadata.json"),
      JSON.stringify({
        invocationId: packetId,
        workItemId: workItem.id,
        promptPath,
        baseRevision,
        providerSelection: { provider, model, mappingId, bindingId }
      })
    );
    createCodexInvocation(db, {
      id: packetId,
      purpose: "build",
      agentProfile: provider === "codex-cli" ? "codex_build" : "claude_build",
      workspaceScope: repo,
      command: provider === "codex-cli" ? "codex" : "claude",
      promptPath,
      jsonlOutputPath: `prompts/codex/${packetId}/output.jsonl`,
      finalMessagePath: `prompts/codex/${packetId}/final.md`,
      status: "packet_created",
      workItemId: workItem.id,
      executionProfileJson: JSON.stringify({ schema: "arcadia.execution/v1", profile: "routine_implementation" }),
      providerMappingId: mappingId,
      providerBindingId: bindingId
    });
    const approval = createReviewItem(db, {
      workItemId: workItem.id,
      projectId: project.id,
      codexInvocationId: packetId,
      decisionNeeded: "Approve the promoted build packet.",
      sourceInput: "fixture",
      proposedAction: "Launch the fixture Session.",
      resolvedIntent: "CodexPlanningArtifactAcceptance",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: [],
      context: {
        planningPromotion: {
          actionId: "define-contract",
          actionDocRef: "plan/copy-proof#define-contract",
          repoPath: repo,
          buildProfile: provider === "codex-cli" ? "codex_build" : "claude_build",
          buildInvocationId: packetId,
          buildPacketPath: promptPath,
          buildPacketSha256: packetSha256(path.join(workspace, promptPath))
        }
      }
    });
    updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Fixture authority approved." });
  });
  return { root, repo, workspace, packetId, now: new Date("2026-08-30T12:34:56.000Z") };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function profile(name: string, provider: string, purpose: "planning" | "build", sandbox: "read-only" | "workspace-write"): CodingAgentProfile {
  return {
    name,
    provider,
    package: provider === "codex-cli" ? "@openai/codex" : "@anthropic-ai/claude-code",
    command: provider === "codex-cli" ? "codex" : "claude",
    purpose,
    sandbox,
    args: []
  };
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove launch previews.
active_plan: copy-proof
current_action: define-contract
updated: 2026-08-30
---

# Test Project
`;

const planDocument = `---
arcadia: v1
type: plan
slug: copy-proof
project: test-project
status: active
milestone: Prove the Session contract
current_action: define-contract
token_impact: medium
token_budget: One bounded Session; all checks are deterministic.
recommended_model: sonnet
recommended_reasoning_effort: high
updated: 2026-08-30
actions:
  - id: define-contract
    title: Define the contract
    status: open
    responsibility: codex
    effort: session
    clarification: clarified
    next_action: Define the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
    decisions: ["0001"]
---

# Copy proof
`;

const decisionDocument = `---
arcadia: v1
type: decision
id: "0001"
slug: authorize
project: test-project
status: approved
question: Authorize this fixture?
answer: Yes.
decided: 2026-08-30
updated: 2026-08-30
---

# Decision
`;
