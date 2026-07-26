import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  createCodexInvocation,
  createWorkItemRecord,
  upsertProject
} from "../src/db/repositories.js";
import {
  ExecutionProfileEscalationRequiredError,
  recordExecutionProfileEvent,
  stopForExecutionProfileEscalation
} from "../src/execution/profileEvents.js";
import { parseExecutionRequirement } from "../src/execution/profiles.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("execution-profile provenance", () => {
  it("persists immutable mapping provenance on an invocation", () => {
    const workspace = createWorkspace();
    const invocation = withDatabase(workspace, (db) => createCodexInvocation(db, {
      purpose: "planning",
      agentProfile: "codex_planning",
      workspaceScope: "/repo",
      command: "codex exec",
      promptPath: "prompts/prompt.md",
      jsonlOutputPath: "prompts/output.jsonl",
      finalMessagePath: "prompts/final.md",
      executionProfileJson: JSON.stringify(resolved("systems_change").baseline),
      providerMappingId: "mapping-1",
      providerBindingId: "binding-1"
    }));

    expect(invocation).toMatchObject({
      provider_mapping_id: "mapping-1",
      provider_binding_id: "binding-1"
    });
    expect(JSON.parse(invocation.execution_profile_json as string)).toMatchObject({
      capability: "c3_systems",
      effort: "e3_deep"
    });
  });

  it("records a valid escalation as append-only evidence", () => {
    const workspace = createWorkspace();
    const event = withDatabase(workspace, (db) => {
      const project = upsertProject(db, {
        name: "Demo",
        mission: "Test profile events.",
        status: "active",
        currentMilestone: "Selection",
        nextAction: "Test",
        workClassification: "codex"
      });
      const action = createWorkItemRecord(db, {
        projectId: project.id,
        title: "Change a contract",
        rawInput: "Change a contract",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Inspect the contract."
      });
      const from = resolved("routine_implementation").baseline;
      const to = resolved("systems_change").baseline;
      const id = recordExecutionProfileEvent(db, {
        eventType: "coding_agent.profile_escalated",
        workItemId: action.id,
        phase: "implementation",
        reason: "A persisted public contract was discovered.",
        from,
        to,
        evidence: ["src/public-contract.ts"]
      });
      return db.prepare("SELECT * FROM events WHERE id = ?").get(id) as {
        event_type: string;
        payload_json: string;
      };
    });

    expect(event.event_type).toBe("coding_agent.profile_escalated");
    expect(JSON.parse(event.payload_json)).toMatchObject({
      phase: "implementation",
      reason: "A persisted public contract was discovered.",
      from: { capability: "c2_integrated" },
      to: { capability: "c3_systems" },
      evidence: ["src/public-contract.ts"]
    });
  });

  it("refuses to label a downgrade as escalation", () => {
    const workspace = createWorkspace();
    expect(() => withDatabase(workspace, (db) => {
      const project = upsertProject(db, {
        name: "Demo",
        mission: "Test profile events.",
        status: "active",
        currentMilestone: "Selection",
        nextAction: "Test",
        workClassification: "codex"
      });
      const action = createWorkItemRecord(db, {
        projectId: project.id,
        title: "Change a contract",
        rawInput: "Change a contract",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Inspect the contract."
      });
      recordExecutionProfileEvent(db, {
        eventType: "coding_agent.profile_escalated",
        workItemId: action.id,
        phase: "implementation",
        reason: "Quota pressure.",
        from: resolved("systems_change").baseline,
        to: resolved("routine_implementation").baseline
      });
    })).toThrow("cannot weaken");
  });

  it("records a safe stop while keeping model and authority escalation separate", () => {
    const workspace = createWorkspace();
    let caught: ExecutionProfileEscalationRequiredError | null = null;
    withDatabase(workspace, (db) => {
      const project = upsertProject(db, {
        name: "Demo",
        mission: "Test profile events.",
        status: "active",
        currentMilestone: "Selection",
        nextAction: "Test",
        workClassification: "codex"
      });
      const action = createWorkItemRecord(db, {
        projectId: project.id,
        title: "Change a contract",
        rawInput: "Change a contract",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Inspect the contract."
      });
      try {
        stopForExecutionProfileEscalation(db, {
          workItemId: action.id,
          phase: "implementation",
          from: resolved("routine_implementation").baseline,
          triggers: ["credentials_required"],
          evidence: ["src/integration.ts"]
        });
      } catch (error) {
        caught = error as ExecutionProfileEscalationRequiredError;
      }
    });

    expect(caught).toBeInstanceOf(ExecutionProfileEscalationRequiredError);
    expect(caught).toMatchObject({
      code: "EXECUTION_PROFILE_ESCALATION_REQUIRED",
      authorityRequired: true
    });
    expect(caught?.message).toContain("c4_critical/e4_rigorous");
    expect(caught?.message).toContain("Separate operator authority");
  });
});

function createWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-profile-provenance-"));
  roots.push(root);
  initWorkspace(root);
  return root;
}

function resolved(profile: string) {
  const parsed = parseExecutionRequirement({
    schema: "arcadia.execution/v1",
    profile
  }, "codex");
  if (!parsed.resolved) throw new Error(JSON.stringify(parsed.issues));
  return parsed.resolved;
}
