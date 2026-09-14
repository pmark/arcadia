import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentAskDraftCommand, runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function scratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-discovery-"));
  roots.push(dir);
  return dir;
}

function scratchWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-discovery-ws-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function strictAsk(requestId: string): string {
  return `agent_ask: v1\nrequest_id: ${requestId}\nproject: unknown\nintent: log\ndesired_result: Record something worth keeping\n`;
}

/** Places a file directly under `<dir>/.arcadia/asks/`, as if it had been committed there — without going through `draft`, since the point is proving discovery finds files no command in this process ever touched. */
function planted(dir: string, filename: string, content: string): void {
  const asksDir = path.join(dir, ".arcadia", "asks");
  mkdirSync(asksDir, { recursive: true });
  writeFileSync(path.join(asksDir, filename), content, "utf8");
}

describe("Agent Ask automatic discovery", () => {
  it("previews an unprocessed .arcadia/asks/ file nobody explicitly asked about, the next time preview resolves a real workspace in that repository", () => {
    const dir = scratchRepo();
    const workspace = scratchWorkspace();
    planted(dir, "agent-ask-untouched.yaml", strictAsk("untouched-1"));

    // Preview something unrelated; discovery should pick up the planted file too.
    const result = runAgentAskPreviewCommand({ workspace, request: strictAsk("explicit-request"), dir });

    expect(result.data.discovery.discovered).toEqual([
      { path: path.join(dir, ".arcadia", "asks", "agent-ask-untouched.yaml"), requestId: "untouched-1" }
    ]);
    expect(result.data.discovery.failed).toEqual([]);
    withDatabase(workspace, (db) => {
      const row = db.prepare("SELECT request_id FROM agent_ask_proposals WHERE request_id = ?").get("untouched-1");
      expect(row).toBeTruthy();
    });
  });

  it("fires from the draft entry point too, not only from a single hardcoded command", () => {
    const dir = scratchRepo();
    const workspace = scratchWorkspace();
    planted(dir, "agent-ask-sibling.yaml", strictAsk("sibling-1"));

    const result = runAgentAskDraftCommand({ request: strictAsk("draft-request"), dir, workspace });

    expect(result.data.discovery.discovered).toEqual([
      { path: path.join(dir, ".arcadia", "asks", "agent-ask-sibling.yaml"), requestId: "sibling-1" }
    ]);
    withDatabase(workspace, (db) => {
      const row = db.prepare("SELECT request_id FROM agent_ask_proposals WHERE request_id = ?").get("sibling-1");
      expect(row).toBeTruthy();
    });
  });

  it("does not re-report a file already discovered with identical content on a later call", () => {
    const dir = scratchRepo();
    const workspace = scratchWorkspace();
    planted(dir, "agent-ask-once.yaml", strictAsk("once-1"));

    const first = runAgentAskPreviewCommand({ workspace, request: strictAsk("first-call"), dir });
    expect(first.data.discovery.discovered.map((f) => f.requestId)).toEqual(["once-1"]);

    const second = runAgentAskPreviewCommand({ workspace, request: strictAsk("second-call"), dir });
    expect(second.data.discovery.discovered).toEqual([]);
    expect(second.data.discovery.failed).toEqual([]);
  });

  it("reports a file that fails validation clearly instead of throwing or silently dropping it", () => {
    const dir = scratchRepo();
    const workspace = scratchWorkspace();
    planted(dir, "agent-ask-broken.yaml", "agent_ask: v1\nrequest_id: [broken\n");

    const result = runAgentAskPreviewCommand({ workspace, request: strictAsk("healthy-request"), dir });

    expect(result.data.proposal.normalized.requestId).toBe("healthy-request");
    expect(result.data.discovery.failed).toEqual([
      { path: path.join(dir, ".arcadia", "asks", "agent-ask-broken.yaml"), error: expect.stringContaining("invalid YAML") }
    ]);
  });

  it("reports a request id already used with different content as a discovery failure rather than throwing", () => {
    const dir = scratchRepo();
    const workspace = scratchWorkspace();
    // Record the request id first under one piece of content...
    runAgentAskPreviewCommand({ workspace, request: strictAsk("drifted-1") });
    // ...then plant a file claiming the same id with different content.
    planted(dir, "agent-ask-drifted.yaml", strictAsk("drifted-1").replace("Record something worth keeping", "Record something else entirely"));

    const result = runAgentAskPreviewCommand({ workspace, request: strictAsk("healthy-request-2"), dir });

    expect(result.data.discovery.failed).toEqual([
      { path: path.join(dir, ".arcadia", "asks", "agent-ask-drifted.yaml"), error: expect.stringContaining("already used with different content") }
    ]);
  });

  it("does not scan a directory it was never told about, so existing callers that omit --dir are unaffected", () => {
    const dir = scratchRepo();
    const workspace = scratchWorkspace();
    planted(dir, "agent-ask-invisible.yaml", strictAsk("invisible-1"));

    const result = runAgentAskPreviewCommand({ workspace, request: strictAsk("no-dir-request") });

    expect(result.data.discovery.discovered).toEqual([]);
    expect(result.data.discovery.failed).toEqual([]);
    withDatabase(workspace, (db) => {
      const row = db.prepare("SELECT request_id FROM agent_ask_proposals WHERE request_id = ?").get("invisible-1");
      expect(row).toBeFalsy();
    });
  });

  it("no-ops cleanly when the repository has no .arcadia/asks/ directory at all", () => {
    const dir = scratchRepo();
    const workspace = scratchWorkspace();

    const result = runAgentAskPreviewCommand({ workspace, request: strictAsk("lonely-request"), dir });

    expect(result.data.discovery).toEqual({ discovered: [], failed: [] });
  });
});
