import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { getWorkItemByDocRef, upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import {
  ZERO_PROMPT_REHEARSAL_ACTION_IDS,
  ZERO_PROMPT_REHEARSAL_PLAN_SLUG,
  ZERO_PROMPT_REHEARSAL_PROJECT_SLUG,
  seedZeroPromptRehearsalBuildPackets
} from "../src/fixtures/zeroPromptRehearsal.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { buildLaunchPreview } from "../src/sessions/launchPreview.js";
import { resolvePacketLifecycle } from "../src/sessions/packetLifecycle.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const profiles: CodingAgentProfile[] = [
  profile("codex_build", "codex-cli", "build", "workspace-write"),
  profile("claude_build", "claude-code-cli", "build", "workspace-write")
];

describe("Zero Prompt Rehearsal fixture build packets", () => {
  it("gives both fixture Actions a real build packet instead of leaving them planning_required", () => {
    const fixture = preparedFixture();

    const before = withReadOnlyDatabase(fixture.workspace, (db) => {
      const actionA = getWorkItemByDocRef(db, `plan/${ZERO_PROMPT_REHEARSAL_PLAN_SLUG}#write-rehearsal-marker`)!;
      const actionB = getWorkItemByDocRef(db, `plan/${ZERO_PROMPT_REHEARSAL_PLAN_SLUG}#confirm-rehearsal-marker`)!;
      return {
        a: resolvePacketLifecycle(db, actionA),
        b: resolvePacketLifecycle(db, actionB)
      };
    });
    expect(before.a.kind).toBe("planning_required");
    expect(before.b.kind).toBe("planning_required");

    const results = withDatabase(fixture.workspace, (db) =>
      seedZeroPromptRehearsalBuildPackets(db, fixture.workspace)
    );
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.actionId)).toEqual([...ZERO_PROMPT_REHEARSAL_ACTION_IDS]);
    expect(results.every((result) => result.reused === false)).toBe(true);

    const after = withReadOnlyDatabase(fixture.workspace, (db) => {
      const actionA = getWorkItemByDocRef(db, `plan/${ZERO_PROMPT_REHEARSAL_PLAN_SLUG}#write-rehearsal-marker`)!;
      const actionB = getWorkItemByDocRef(db, `plan/${ZERO_PROMPT_REHEARSAL_PLAN_SLUG}#confirm-rehearsal-marker`)!;
      return {
        a: resolvePacketLifecycle(db, actionA),
        b: resolvePacketLifecycle(db, actionB)
      };
    });
    expect(after.a.kind).toBe("build_packet_ready");
    expect(after.b.kind).toBe("build_packet_ready");

    // Seeding again is a no-op: the immutable packets already exist, and no
    // second Decision or invocation is created for either Action.
    const replay = withDatabase(fixture.workspace, (db) =>
      seedZeroPromptRehearsalBuildPackets(db, fixture.workspace)
    );
    expect(replay.every((result) => result.reused === true)).toBe(true);
    expect(replay.map((result) => result.invocationId)).toEqual(results.map((result) => result.invocationId));
  });

  it("lets the guarded launch path resolve fixture Action B ready to launch with no manual packet step", () => {
    // Action A is already done, so the pointer sits on B, exactly as it would
    // mid-rehearsal after Action A's Session completed.
    const fixture = preparedFixture({ currentAction: "confirm-rehearsal-marker", actionADone: true });

    withDatabase(fixture.workspace, (db) => seedZeroPromptRehearsalBuildPackets(db, fixture.workspace));

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: ZERO_PROMPT_REHEARSAL_PROJECT_SLUG,
        requestId: "zero-prompt-rehearsal-action-b",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );

    expect(preview.actionDocRef).toBe(`plan/${ZERO_PROMPT_REHEARSAL_PLAN_SLUG}#confirm-rehearsal-marker`);
    expect(preview.packetLifecycle?.kind).not.toBe("planning_required");
    expect(preview.packetLifecycle?.kind).toBe("build_packet_ready");
    expect(preview.packet).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(preview.prerequisites).toEqual([]);
    expect(preview.ready).toBe(true);
  });
});

function preparedFixture(options?: { currentAction?: string; actionADone?: boolean }) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-zero-prompt-rehearsal-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument(options?.currentAction ?? "write-rehearsal-marker"));
  writeFileSync(
    path.join(repo, "docs", "plans", "zero-prompt-rehearsal-bootstrap.md"),
    planDocument(options?.currentAction ?? "write-rehearsal-marker", options?.actionADone ?? false)
  );
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Zero Prompt Rehearsal",
      mission: "Rehearse the managed-production loop end to end.",
      goal: "Prove the zero-prompt production loop.",
      status: "active"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) {
      throw new Error(`fixture docs did not sync: ${JSON.stringify(sync.errors)} ${JSON.stringify(sync.rejected)}`);
    }
  });
  return { root, repo, workspace };
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

function projectDocument(currentAction: string): string {
  return `---
arcadia: v1
type: project
slug: ${ZERO_PROMPT_REHEARSAL_PROJECT_SLUG}
name: Zero Prompt Rehearsal
status: active
goal: Prove the zero-prompt production loop.
active_plan: ${ZERO_PROMPT_REHEARSAL_PLAN_SLUG}
current_action: ${currentAction}
updated: 2026-09-21
---

# Zero Prompt Rehearsal
`;
}

function planDocument(currentAction: string, actionADone: boolean): string {
  return `---
arcadia: v1
type: plan
slug: ${ZERO_PROMPT_REHEARSAL_PLAN_SLUG}
project: ${ZERO_PROMPT_REHEARSAL_PROJECT_SLUG}
status: active
milestone: Rehearse the managed-production loop
current_action: ${currentAction}
token_impact: small
token_budget: Two bounded fixture Sessions; every check is deterministic.
recommended_model: sonnet
recommended_reasoning_effort: low
updated: 2026-09-21
actions:
  - id: write-rehearsal-marker
    title: Write the rehearsal marker
    status: ${actionADone ? "done" : "open"}
    responsibility: agent
    effort: quick
    clarification: clarified
    next_action: Create REHEARSAL.md containing one line, "Rehearsal marker written.".
    expected_artifact: REHEARSAL.md
    acceptance_criteria:
      - REHEARSAL.md exists and contains the marker line.
  - id: confirm-rehearsal-marker
    title: Confirm the rehearsal marker
    status: open
    responsibility: agent
    effort: quick
    clarification: clarified
    next_action: Append a second line to REHEARSAL.md, "Rehearsal marker confirmed.".
    expected_artifact: REHEARSAL.md
    acceptance_criteria:
      - REHEARSAL.md contains both the marker line and the confirmation line, in order.
    depends_on: ["write-rehearsal-marker"]
---

# Zero Prompt Rehearsal Bootstrap
`;
}
