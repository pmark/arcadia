import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
import { runWorkRunCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import {
  countRows,
  createAskRequest,
  createApprovalGate,
  createCodexInvocation,
  listApprovalGatesForWorkItem,
  listCodexInvocationsForWorkItem
} from "../src/db/repositories.js";
import { loadPhase3Registries, validatePhase3Registries } from "../src/intent/registries.js";
import { resolveIntent } from "../src/intent/resolver.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Phase 3 registries", () => {
  it("copies default registries into initialized workspaces", () => {
    const workspace = initializedWorkspace();
    const paths = getWorkspacePaths(workspace);

    expect(existsSync(paths.intentRegistry)).toBe(true);
    expect(existsSync(paths.templateRegistry)).toBe(true);
    expect(existsSync(paths.codingAgentProfiles)).toBe(true);
  });

  it("loads and resolves known natural-language intents deterministically", () => {
    const workspace = initializedWorkspace();
    const registries = loadPhase3Registries(workspace);

    validatePhase3Registries(registries);
    const resolved = resolveIntent("Create a new blog site named MartianRover Field Notes.", registries);

    expect(resolved.intentId).toBe("create_astro_blog");
    expect(resolved.matched).toBe(true);
    expect(resolved.slots.projectName).toBe("MartianRover Field Notes");
    expect(resolved.templates[0].id).toBe("astro_field_notes_cloudflare");
    expect(resolved.codexPurpose).toBe("build");
    expect(resolved.approvalGates.map((gate) => gate.gateType)).toContain("external_deployment");
  });
});

describe("Phase 3 audit records", () => {
  it("stores ask requests, approval gates, and codex invocation records", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const ask = createAskRequest(db, {
        rawRequest: "Plan something",
        resolvedIntent: "codex_plan",
        registryVersion: 1,
        outputKind: "codex_planning_packet",
        status: "planned"
      });
      expect(ask.id).toMatch(/^ask_/);

      const gate = createApprovalGate(db, {
        gateType: "publication",
        reason: "Publication requires approval."
      });
      expect(gate.id).toMatch(/^gate_/);

      const invocation = createCodexInvocation(db, {
        purpose: "planning",
        agentProfile: "codex_planning",
        workspaceScope: workspace,
        command: "codex exec --json --sandbox read-only -",
        promptPath: "prompts/codex/example/prompt.md",
        jsonlOutputPath: "prompts/codex/example/output.jsonl",
        finalMessagePath: "prompts/codex/example/final.md"
      });
      expect(invocation.id).toMatch(/^codex_/);
      expect(countRows(db, "ask_requests")).toBe(1);
      expect(countRows(db, "approval_gates")).toBe(1);
      expect(countRows(db, "codex_invocations")).toBe(1);
    });
  });
});

describe("arcadia ask command", () => {
  it("creates a structured work item, execution plan, approval gates, and Codex build packet", () => {
    const workspace = initializedWorkspace();

    const result = runAskCommand({
      workspace,
      request: "Create a new blog site named MartianRover Field Notes."
    });

    expect(result.command).toBe("ask");
    expect(result.data.resolvedIntent.intentId).toBe("create_astro_blog");
    expect(result.data.workItem.work_classification).toBe("codex");
    expect(result.data.plan.steps[0].skill_name).toBe("codex_build");
    expect(result.data.approvalGates.map((gate) => gate.gate_type)).toContain("external_deployment");
    expect(result.data.codexInvocations).toHaveLength(1);

    const promptPath = path.join(workspace, result.data.codexInvocations[0].prompt_path);
    expect(existsSync(promptPath)).toBe(true);
    expect(readFileSync(promptPath, "utf8")).toContain("MartianRover Field Notes");

    withDatabase(workspace, (db) => {
      expect(countRows(db, "ask_requests")).toBe(1);
      expect(countRows(db, "approval_gates")).toBeGreaterThan(0);
      expect(countRows(db, "codex_invocations")).toBe(1);
      expect(listCodexInvocationsForWorkItem(db, result.data.workItem.id)).toHaveLength(1);
      expect(listApprovalGatesForWorkItem(db, result.data.workItem.id).length).toBeGreaterThan(0);
    });
  });

  it("falls back to a Codex planning packet for unknown intent", () => {
    const workspace = initializedWorkspace();

    const result = runAskCommand({
      workspace,
      request: "Improve the Rebuster candidate review flow."
    });

    expect(result.data.resolvedIntent.matched).toBe(false);
    expect(result.data.resolvedIntent.intentId).toBe("codex_plan");
    expect(result.data.plan.steps[0].skill_name).toBe("codex_planning");
    expect(result.data.codexInvocations[0].purpose).toBe("planning");
  });

  it("can run deterministic safe ask work through the existing runner", () => {
    const workspace = initializedWorkspace();

    const result = runAskCommand({
      workspace,
      request: "Prepare a weekly Martian Rover Labs update from recent mission logs.",
      runSafe: true
    });

    expect(result.data.resolvedIntent.intentId).toBe("prepare_blog_update");
    expect(result.data.run?.status).toBe("completed");
    expect(result.data.run?.artifacts[0].artifact_type).toBe("weekly_update_draft");
    expect(result.data.approvalGates.map((gate) => gate.gate_type)).toContain("publication");
    expect(existsSync(path.join(workspace, result.data.run?.artifacts[0].path ?? ""))).toBe(true);
  });

  it("runs an explicitly approved Codex planning step through a configured fake agent", () => {
    const workspace = initializedWorkspace();
    const paths = getWorkspacePaths(workspace);
    const fakeAgent = path.join(workspace, "fake-codex-agent.cjs");
    writeFileSync(
      fakeAgent,
      "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fake codex final'}})));",
      "utf8"
    );
    writeFileSync(
      paths.codingAgentProfiles,
      `${JSON.stringify(
        {
          version: 1,
          profiles: [
            {
              name: "fake_planning",
              provider: "fake-agent",
              package: "local",
              command: process.execPath,
              purpose: "planning",
              sandbox: "read-only",
              args: [fakeAgent]
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const asked = runAskCommand({
      workspace,
      request: "Improve the Rebuster candidate review flow."
    });
    const run = runWorkRunCommand({
      workspace,
      workId: asked.data.workItem.id,
      plan: asked.data.plan.id,
      allowCodexPlanning: true,
      agentProfile: "fake_planning"
    });

    expect(run.data.run.status).toBe("completed");
    const invocation = withDatabase(workspace, (db) =>
      listCodexInvocationsForWorkItem(db, asked.data.workItem.id)[0]
    );
    expect(invocation.status).toBe("completed");
    expect(invocation.run_id).toBe(run.data.run.id);
    expect(readFileSync(path.join(workspace, invocation.jsonl_output_path), "utf8")).toContain("fake codex final");
    expect(readFileSync(path.join(workspace, invocation.final_message_path), "utf8")).toContain("fake codex final");
  });
});

function createTempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-phase3-test-"));
  workspaces.push(workspace);
  return workspace;
}

function initializedWorkspace(): string {
  const workspace = createTempWorkspace();
  initWorkspace(workspace);
  return workspace;
}
