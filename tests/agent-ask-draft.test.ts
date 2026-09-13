import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentAskDraftCommand } from "../src/commands/agentAsk.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function scratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-draft-"));
  roots.push(dir);
  return dir;
}

const strictAsk = (requestId: string) =>
  `agent_ask: v1\nrequest_id: ${requestId}\nproject: unknown\nintent: log\ndesired_result: Record something worth keeping\n`;

describe("Agent Ask draft", () => {
  it("validates and writes the canonical .arcadia/asks/ file with no workspace present", () => {
    const dir = scratchRepo();
    const result = runAgentAskDraftCommand({ request: strictAsk("draft-no-workspace"), dir, workspace: path.join(dir, "does-not-exist") });
    expect(result.data.written).toBe("created");
    expect(result.data.workspaceStatus).toBe("not_available");
    expect(result.data.preview).toBeNull();
    const expectedPath = path.join(dir, ".arcadia", "asks", "agent-ask-draft-no-workspace.yaml");
    expect(result.data.path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, "utf8")).toContain("request_id: draft-no-workspace");
  });

  it("accepts plain JSON text, since JSON is valid YAML and is far more reliable for a model to emit", () => {
    const dir = scratchRepo();
    const json = JSON.stringify({ agent_ask: "v1", request_id: "draft-json", project: "unknown", intent: "log", desired_result: "Recorded via JSON" });
    const result = runAgentAskDraftCommand({ request: json, dir, workspace: path.join(dir, "does-not-exist") });
    expect(result.data.requestId).toBe("draft-json");
    expect(result.data.written).toBe("created");
  });

  it("also previews the Ask in one call when a ready workspace resolves", () => {
    const dir = scratchRepo();
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-draft-ws-"));
    roots.push(workspace);
    initWorkspace(workspace);
    const result = runAgentAskDraftCommand({ request: strictAsk("draft-with-workspace"), dir, workspace });
    expect(result.data.workspaceStatus).toBe("previewed");
    expect(result.data.preview?.proposal.normalized.intent).toBe("log");
    expect(result.data.preview?.fingerprint).toBeTruthy();
  });

  it("still succeeds and places the file when a resolvable workspace's database write is denied (the sandboxed-agent case)", () => {
    if (process.getuid && process.getuid() === 0) return; // root bypasses the permission bits this test relies on
    const dir = scratchRepo();
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-draft-denied-"));
    roots.push(workspace);
    initWorkspace(workspace);
    const databaseFile = path.join(workspace, "database", "arcadia.sqlite3");
    chmodSync(databaseFile, 0o444);
    try {
      const result = runAgentAskDraftCommand({ request: strictAsk("draft-write-denied"), dir, workspace });
      expect(result.data.written).toBe("created");
      expect(result.data.workspaceStatus).toBe("not_available");
      expect(result.data.preview).toBeNull();
      expect(existsSync(path.join(dir, ".arcadia", "asks", "agent-ask-draft-write-denied.yaml"))).toBe(true);
    } finally {
      chmodSync(databaseFile, 0o644);
    }
  });

  it("is idempotent when the identical content is drafted twice", () => {
    const dir = scratchRepo();
    const request = strictAsk("draft-idempotent");
    const first = runAgentAskDraftCommand({ request, dir, workspace: path.join(dir, "does-not-exist") });
    expect(first.data.written).toBe("created");
    const second = runAgentAskDraftCommand({ request, dir, workspace: path.join(dir, "does-not-exist") });
    expect(second.data.written).toBe("unchanged");
  });

  it("refuses to silently overwrite a request id with different content", () => {
    const dir = scratchRepo();
    runAgentAskDraftCommand({ request: strictAsk("draft-collision"), dir, workspace: path.join(dir, "does-not-exist") });
    expect(() =>
      runAgentAskDraftCommand({
        request: strictAsk("draft-collision").replace("Record something worth keeping", "A different desired result"),
        dir,
        workspace: path.join(dir, "does-not-exist")
      })
    ).toThrow("An Agent Ask file already exists for this request id with different content.");
  });

  it("still refuses structurally invalid Agent Asks without ever touching disk", () => {
    const dir = scratchRepo();
    expect(() =>
      runAgentAskDraftCommand({ request: "agent_ask: v1\nintent: log\ndesired_result: Missing the request id\n", dir })
    ).toThrow("Agent Ask request_id is required.");
    expect(existsSync(path.join(dir, ".arcadia", "asks"))).toBe(false);
  });
});
