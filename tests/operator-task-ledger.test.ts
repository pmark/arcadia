import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderDocketSuccess, runDocketCommand } from "../src/commands/docket.js";
import {
  runOperatorTaskCloseCommand,
  runOperatorTaskDeclineCommand,
  runOperatorTaskEvidenceCommand,
  runOperatorTaskListCommand,
  runOperatorTaskRaiseCommand,
  runOperatorTaskShowCommand
} from "../src/commands/operatorTasks.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A repository and nothing else — the ledger must read and write with no workspace. */
function loneRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-operator-task-"));
  temporary.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  return root;
}

const PLAN = `---
arcadia: v1
type: plan
slug: only-plan
project: lone
status: active
milestone: Prove the ledger cites project control
token_impact: small
token_budget: "Deterministic."
recommended_model: gpt-5.6-terra
updated: 2026-08-16
current_action: do-the-thing
actions:
  - id: do-the-thing
    title: Do the thing
    status: open
    responsibility: codex
    next_action: Write the thing to the file.
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - The thing exists.
    depends_on: []
    references: []
---

# Only plan
`;

const DECISION = `---
arcadia: v1
type: decision
id: "0028"
slug: some-decision
project: lone
status: approved
question: Does this decision exist?
answer: Yes.
decided: 2026-08-14
updated: 2026-08-14
---

# ADR 0028
`;

describe("operator task ledger", () => {
  it("raises a task citing an Action id already in project control", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });

    const response = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });

    expect(response.data.task.status).toBe("waiting");
    expect(response.data.task.origin).toEqual({ kind: "action", id: "do-the-thing" });
    // Written to the checked-in ledger, not a database.
    const raw = readFileSync(path.join(root, ".arcadia/operator-tasks.jsonl"), "utf8");
    expect(JSON.parse(raw.trim())).toMatchObject({ event: "raised", id: response.data.task.id });
  });

  it("raises a task citing a Decision id already in project control", () => {
    const root = loneRepo({ "docs/decisions/0028-some-decision.md": DECISION });

    const response = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Approve the vendor contract",
      because: "Only the operator can sign",
      decision: "28"
    });

    expect(response.data.task.origin).toEqual({ kind: "decision", id: "0028" });
  });

  it("refuses to raise a task with no origin in project control", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });

    expect(() =>
      runOperatorTaskRaiseCommand({ repo: root, asks: "Do a thing", because: "Only you" })
    ).toThrow(/origin already in project control/);
  });

  it("refuses to raise a task citing an Action id that does not exist", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });

    expect(() =>
      runOperatorTaskRaiseCommand({ repo: root, asks: "Do a thing", because: "Only you", action: "nonexistent" })
    ).toThrow(/not a known Action id/);
  });

  it("lets an agent attach evidence without closing the task", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });
    const raised = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });

    const response = runOperatorTaskEvidenceCommand({
      repo: root,
      id: raised.data.task.id,
      note: "The account appears to exist now."
    });

    expect(response.data.task.status).toBe("waiting");
    expect(response.data.task.evidence).toHaveLength(1);
    expect(runOperatorTaskListCommand({ repo: root }).data.count).toBe(1);
  });

  it("refuses to close a task without the --operator confirmation", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });
    const raised = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });

    expect(() => runOperatorTaskCloseCommand({ repo: root, id: raised.data.task.id })).toThrow(/operator-only/);
    expect(runOperatorTaskShowCommand({ repo: root, id: raised.data.task.id }).data.task.status).toBe("waiting");
  });

  it("closes a task as done with --operator, and it stops appearing in the open list", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });
    const raised = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });

    const response = runOperatorTaskCloseCommand({ repo: root, id: raised.data.task.id, operator: true });

    expect(response.data.task.status).toBe("done");
    expect(runOperatorTaskListCommand({ repo: root }).data.count).toBe(0);
    expect(runOperatorTaskListCommand({ repo: root, status: "all" }).data.count).toBe(1);
  });

  it("refuses to decline a task without the --operator confirmation", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });
    const raised = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });

    expect(() =>
      runOperatorTaskDeclineCommand({ repo: root, id: raised.data.task.id, because: "Not doing this" })
    ).toThrow(/operator-only/);
  });

  it("declines a task with --operator and records why", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });
    const raised = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });

    const response = runOperatorTaskDeclineCommand({
      repo: root,
      id: raised.data.task.id,
      because: "Using a different provider instead",
      operator: true
    });

    expect(response.data.task.status).toBe("declined");
    expect(response.data.task.because).toBe("Using a different provider instead");
  });

  it("refuses to close or decline a task twice", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });
    const raised = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });
    runOperatorTaskCloseCommand({ repo: root, id: raised.data.task.id, operator: true });

    expect(() => runOperatorTaskCloseCommand({ repo: root, id: raised.data.task.id, operator: true })).toThrow(
      /already done/
    );
  });

  it("keeps working when an event names an id that was never raised", () => {
    const root = loneRepo({
      "docs/plans/only-plan.md": PLAN,
      ".arcadia/operator-tasks.jsonl": `${JSON.stringify({ event: "done", id: "never-raised", at: "2026-01-01T00:00:00.000Z", by: "operator" })}\n`
    });

    expect(() => runOperatorTaskListCommand({ repo: root })).not.toThrow();
    expect(runOperatorTaskListCommand({ repo: root }).data.count).toBe(0);
  });

  it("surfaces the open count in `arcadia docket` without a separate hunt", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });
    runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });

    const response = runDocketCommand({ repo: root });

    expect(response.data.openOperatorTasks).toBe(1);
    expect(renderDocketSuccess(response).join("\n")).toContain("1 operator task(s) waiting");
  });

  it("needs no workspace and no database to read or write", () => {
    const root = loneRepo({ "docs/plans/only-plan.md": PLAN });

    // The whole test suite runs with no workspace configured at all; reaching
    // this point without a workspace/database error is the proof.
    const raised = runOperatorTaskRaiseCommand({
      repo: root,
      asks: "Create a Cloudflare account",
      because: "Only the operator has payment credentials",
      action: "do-the-thing"
    });
    expect(raised.workspace).toBeUndefined();
  });
});
