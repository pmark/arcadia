import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkPlanCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import { getWorkItemByDocRef, upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import {
  activateProduction,
  fingerprintProductionScope,
  normalizeProductionScope
} from "../src/production/policy.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * Every build-packet preparation path -- `work plan`, `ask`, and planning
 * promotion -- must prefer a provider the active standing production policy
 * actually permits over the registry's deterministic default (Issue #559):
 * once bound, a packet's provider is immutable, so getting this right at
 * preparation time is the only way to avoid a mismatch that `buildLaunchPreview`
 * (see tests/launch-preview.test.ts) or `issueAdmission` would otherwise only
 * discover much later, deep inside a launch attempt.
 *
 * This exercises `runWorkPlanCommand`'s "work plan" path directly. The
 * default registry configured in config/defaults/coding-agent-profiles.json
 * binds "build" to "codex_build" (provider codex-cli); an active policy that
 * permits only claude-code-cli must steer preparation to "claude_build"
 * instead, with no explicit --agent-profile given.
 */

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function fixture(options?: { validationCommands?: string[] }) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-policy-packet-prep-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  writeFileSync(
    path.join(repo, "PROJECT.md"),
    `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove policy-permitted packet preparation.
active_plan: policy-packet
current_action: implement-it
updated: 2026-08-30
---

# Test Project
`
  );
  writeFileSync(
    path.join(repo, "docs", "plans", "policy-packet.md"),
    `---
arcadia: v1
type: plan
slug: policy-packet
project: test-project
status: active
milestone: Prove policy-permitted packet preparation
current_action: implement-it
token_impact: medium
token_budget: One bounded Session; all checks are deterministic.
recommended_model: sonnet
recommended_reasoning_effort: high
updated: 2026-08-30
actions:
  - id: implement-it
    title: Implement the thing
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Implement the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
    decisions: []
---

# Policy packet
`
  );
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove policy-permitted packet preparation.", goal: "Prove policy-permitted packet preparation.", status: "active" });
    upsertProjectMetadata(db, {
      projectId: project.id,
      repoPath: repo,
      validationCommands: options?.validationCommands ?? ["node -e \"process.exit(0)\""]
    });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
  });
  return { root, repo, workspace };
}

describe("build-packet preparation under an active production policy", () => {
  it("binds `work plan` to the policy-permitted provider instead of the registry default, with no explicit --agent-profile", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const scope = normalizeProductionScope({
        intent: "Prove work-plan packet preparation prefers the permitted provider.",
        projects: ["test-project"],
        plans: ["test-project/policy-packet"],
        actions: [],
        providers: ["claude-code-cli"],
        maxConcurrentSessions: 1,
        mechanicalTransitions: []
      });
      activateProduction(db, {
        requestId: "policy-packet-1",
        scope,
        scopeFingerprint: fingerprintProductionScope(scope),
        grantedBy: "operator"
      });
    });

    const workItem = withDatabase(fx.workspace, (db) => getWorkItemByDocRef(db, "plan/policy-packet#implement-it")!);
    const prepared = runWorkPlanCommand({ workspace: fx.workspace, workId: workItem.id });

    expect(prepared.data.buildInvocation).toBeTruthy();
    expect(prepared.data.buildInvocation?.agent_profile).toBe("claude_build");
  });

  it("keeps the registry default when no policy is active", () => {
    const fx = fixture();
    const workItem = withDatabase(fx.workspace, (db) => getWorkItemByDocRef(db, "plan/policy-packet#implement-it")!);
    const prepared = runWorkPlanCommand({ workspace: fx.workspace, workId: workItem.id });

    expect(prepared.data.buildInvocation).toBeTruthy();
    expect(prepared.data.buildInvocation?.agent_profile).toBe("codex_build");
  });

  it("still honors an explicit --agent-profile over the policy-permitted provider", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const scope = normalizeProductionScope({
        intent: "Prove an explicit request always wins.",
        projects: ["test-project"],
        plans: ["test-project/policy-packet"],
        actions: [],
        providers: ["claude-code-cli"],
        maxConcurrentSessions: 1,
        mechanicalTransitions: []
      });
      activateProduction(db, {
        requestId: "policy-packet-explicit-1",
        scope,
        scopeFingerprint: fingerprintProductionScope(scope),
        grantedBy: "operator"
      });
    });

    const workItem = withDatabase(fx.workspace, (db) => getWorkItemByDocRef(db, "plan/policy-packet#implement-it")!);
    const prepared = runWorkPlanCommand({ workspace: fx.workspace, workId: workItem.id, agentProfile: "codex_build" });

    expect(prepared.data.buildInvocation?.agent_profile).toBe("codex_build");
  });
});

describe("build-packet preparation for a Project with no declared validation commands", () => {
  it("refuses to prepare a build packet, naming the arcadia project metadata remedy", () => {
    const fx = fixture({ validationCommands: [] });
    const workItem = withDatabase(fx.workspace, (db) => getWorkItemByDocRef(db, "plan/policy-packet#implement-it")!);
    const projectId = workItem.project_id as string;

    expect(() => runWorkPlanCommand({ workspace: fx.workspace, workId: workItem.id })).toThrow(
      new RegExp(`at least one validation command.*arcadia project metadata ${projectId} --validation-command`)
    );
  });

  it("prepares the build packet unchanged once the Project declares a validation command", () => {
    const fx = fixture({ validationCommands: ["node -e \"process.exit(0)\""] });
    const workItem = withDatabase(fx.workspace, (db) => getWorkItemByDocRef(db, "plan/policy-packet#implement-it")!);

    const prepared = runWorkPlanCommand({ workspace: fx.workspace, workId: workItem.id });

    expect(prepared.data.buildInvocation).toBeTruthy();
    expect(prepared.data.buildInvocation?.status).toBe("packet_created");
  });
});
