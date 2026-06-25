import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
import { runFeedbackListCommand, runFeedbackRecordCommand } from "../src/commands/feedback.js";
import { withDatabase } from "../src/db/connection.js";
import { createAskFeedback, listRecentAskFeedback } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createTempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-ask-feedback-test-"));
  workspaces.push(workspace);
  return workspace;
}

function initializedWorkspace(): string {
  const workspace = createTempWorkspace();
  initWorkspace(workspace);
  return workspace;
}

function realAskRequestId(workspace: string): string {
  const ask = runAskCommand({
    workspace,
    request: "Test ask request for feedback coverage."
  });
  const askRequestId = ask.data.ask?.id;
  if (!askRequestId) {
    throw new Error("Expected runAskCommand to produce an ask request id.");
  }
  return askRequestId;
}

describe("ask feedback", () => {
  it("creates and lists feedback against a real ask request", () => {
    const workspace = initializedWorkspace();
    const askRequestId = realAskRequestId(workspace);

    const feedback = withDatabase(workspace, (db) =>
      createAskFeedback(db, { askRequestId, decision: "up", note: "Nice routing." })
    );

    expect(feedback.id.startsWith("afb_")).toBe(true);
    expect(feedback.ask_request_id).toBe(askRequestId);
    expect(feedback.decision).toBe("up");
    expect(feedback.note).toBe("Nice routing.");
    expect(feedback.created_at).toBeTruthy();

    const listed = withDatabase(workspace, (db) => listRecentAskFeedback(db));
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(feedback.id);
  });

  it("orders recent feedback newest first", () => {
    const workspace = initializedWorkspace();
    const askRequestId = realAskRequestId(workspace);

    const first = withDatabase(workspace, (db) =>
      createAskFeedback(db, { askRequestId, decision: "up" })
    );
    const second = withDatabase(workspace, (db) =>
      createAskFeedback(db, { askRequestId, decision: "down" })
    );

    const listed = withDatabase(workspace, (db) => listRecentAskFeedback(db));
    expect(listed.map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it("rejects feedback against a nonexistent ask request", () => {
    const workspace = initializedWorkspace();

    expect(() =>
      withDatabase(workspace, (db) =>
        createAskFeedback(db, { askRequestId: "ask_does_not_exist", decision: "up" })
      )
    ).toThrow();
  });

  it("rejects an invalid decision value", () => {
    const workspace = initializedWorkspace();
    const askRequestId = realAskRequestId(workspace);

    expect(() =>
      withDatabase(workspace, (db) =>
        createAskFeedback(db, {
          askRequestId,
          decision: "sideways" as unknown as "up"
        })
      )
    ).toThrow(/Ask feedback decision must be one of/);
  });

  it("records feedback end-to-end through the command layer", () => {
    const workspace = initializedWorkspace();
    const askRequestId = realAskRequestId(workspace);

    const response = runFeedbackRecordCommand({
      workspace,
      askRequestId,
      decision: "down",
      note: "Missed the intent."
    });

    expect(response.data.result.status).toBe("recorded");
    expect(response.data.feedback.decision).toBe("down");
    expect(response.data.feedback.note).toBe("Missed the intent.");
  });

  it("fails cleanly when recording feedback against an unknown ask request", () => {
    const workspace = initializedWorkspace();

    expect(() =>
      runFeedbackRecordCommand({
        workspace,
        askRequestId: "ask_does_not_exist",
        decision: "up"
      })
    ).toThrow(/not found/i);
  });

  it("lists feedback with up/down counts", () => {
    const workspace = initializedWorkspace();
    const first = realAskRequestId(workspace);
    const second = realAskRequestId(workspace);

    runFeedbackRecordCommand({ workspace, askRequestId: first, decision: "up" });
    runFeedbackRecordCommand({ workspace, askRequestId: second, decision: "up" });
    runFeedbackRecordCommand({ workspace, askRequestId: second, decision: "down" });

    const listResponse = runFeedbackListCommand({ workspace });
    expect(listResponse.data.counts).toEqual({ up: 2, down: 1 });
    expect(listResponse.data.items).toHaveLength(3);
  });
});
