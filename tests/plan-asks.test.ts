import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { previewAgentAskRequest } from "../src/ask/preview.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject } from "../src/db/repositories.js";
import { composePlanAsk, listPlanAsks, targetsPlan } from "../src/plans/planAsks.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(projects: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-plan-asks-"));
  roots.push(root);
  initWorkspace(root);
  withDatabase(root, (db) => {
    for (const name of projects) upsertProject(db, { name, mission: "Plan asks.", goal: "List them.", status: "active", currentMilestone: "M", nextAction: "Go.", workClassification: "agent" });
  });
  return root;
}

const tables = (db: Database.Database) => (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name").all() as Array<{ name: string }>).map(r => r.name);

function record(db: Database.Database, input: Parameters<typeof composePlanAsk>[0]): string {
  const { ask } = composePlanAsk(input);
  return previewAgentAskRequest(db, { request: JSON.stringify(ask) }).proposal.id;
}

describe("Plan Asks (workspace-plan-picker-actions)", () => {
  it("an annotation appears on its Plan through the existing Ask receipts, with no new store", () => {
    const ws = workspace(["Alpha"]);
    withDatabase(ws, (db) => {
      const before = tables(db);
      expect(listPlanAsks(db, "alpha", "shared-plan")).toEqual([]);
      const id = record(db, { kind: "annotate", project: "alpha", plan: "shared-plan", text: "Revisit after Plan F.", requestId: "workspace-annotate-shared-plan-1" });
      const asks = listPlanAsks(db, "alpha", "shared-plan");
      expect(asks).toEqual([expect.objectContaining({ proposalId: id, intent: "proposal", targetRef: "plan/shared-plan", desiredResult: "Revisit after Plan F.", state: "previewed", disposition: null })]);
      // The annotation lives in agent_ask_proposals; no table or index was added for it.
      expect(tables(db)).toEqual(before);
    });
  });

  it("two Projects sharing a Plan slug each list only their own Project's Asks", () => {
    const ws = workspace(["Alpha", "Beta"]);
    withDatabase(ws, (db) => {
      record(db, { kind: "annotate", project: "alpha", plan: "shared-plan", text: "Alpha's note.", requestId: "workspace-annotate-shared-plan-a" });
      record(db, { kind: "annotate", project: "beta", plan: "shared-plan", text: "Beta's note.", requestId: "workspace-annotate-shared-plan-b" });
      expect(listPlanAsks(db, "alpha", "shared-plan").map(a => a.desiredResult)).toEqual(["Alpha's note."]);
      expect(listPlanAsks(db, "beta", "shared-plan").map(a => a.desiredResult)).toEqual(["Beta's note."]);
    });
  });

  it("lists newest first with each state: previewed picker Asks, a pending Plan amendment from elsewhere, a settled Ask", () => {
    const ws = workspace(["Alpha"]);
    withDatabase(ws, (db) => {
      const note = record(db, { kind: "annotate", project: "alpha", plan: "p", text: "A note.", requestId: "workspace-annotate-p-1" });
      const change = record(db, { kind: "request-change", project: "alpha", plan: "p", text: "Split the second Action.", requestId: "workspace-request-change-p-2" });
      // A governed Plan amendment drafted outside the picker (by the Lead) still lists here, as pending.
      const amendment = previewAgentAskRequest(db, { request: JSON.stringify({ agent_ask: "v1", request_id: "lead-amend-p-3", project: "alpha", intent: "plan", target_ref: "plan/p", requested_authority: "propose", desired_result: "Ship the split Plan.", rationale: "Lead amendment." }) }).proposal.id;
      const other = record(db, { kind: "annotate", project: "alpha", plan: "other", text: "Not this Plan.", requestId: "workspace-annotate-other-4" });
      // Pin creation order, then record a terminal settlement for the note as settle --apply would.
      db.prepare("UPDATE agent_ask_proposals SET created_at = ? WHERE id = ?").run("2026-11-24T01:00:00.000Z", note);
      db.prepare("UPDATE agent_ask_proposals SET created_at = ? WHERE id = ?").run("2026-11-24T02:00:00.000Z", change);
      db.prepare("UPDATE agent_ask_proposals SET created_at = ? WHERE id = ?").run("2026-11-24T03:00:00.000Z", amendment);
      db.prepare(`INSERT INTO agent_ask_settlements (id, proposal_id, request_id, operation_json, fingerprint, disposition, project_slug, effects_json, receipt_json, created_at)
        VALUES ('s1', ?, 'settle-note', '{}', 'f', 'accepted', 'alpha', '[]', '{}', '2026-11-24T04:00:00.000Z')`).run(note);
      const asks = listPlanAsks(db, "alpha", "p");
      expect(asks.map(a => [a.proposalId, a.state, a.disposition])).toEqual([[amendment, "pending", null], [change, "previewed", null], [note, "settled", "accepted"]]);
      expect(asks.some(a => a.proposalId === other)).toBe(false);
    });
  });

  it("composes Request change and Annotate as evidence-only proposals targeting the Plan, both propose-only", () => {
    const change = composePlanAsk({ kind: "request-change", project: "alpha", plan: "p", text: "Split it.", requestId: "workspace-request-change-p-1" });
    expect(change.ask).toMatchObject({ intent: "proposal", target_ref: "plan/p", project: "alpha", requested_authority: "propose", desired_result: "Split it." });
    expect(change.effects).toEqual([expect.objectContaining({ operation: "update", targetKind: "proposal", targetRef: "plan/p" })]);
    const note = composePlanAsk({ kind: "annotate", project: "alpha", plan: "p", text: "Note.", requestId: "workspace-annotate-p-1" });
    expect(note.ask).toMatchObject({ intent: "proposal", target_ref: "plan/p", requested_authority: "propose" });
    expect(() => composePlanAsk({ kind: "annotate", project: "alpha", plan: "p", text: "  ", requestId: "workspace-annotate-p-2" })).toThrow(/note/);
  });

  it("never composes intent: plan, so accepting a picker Ask cannot overwrite a Plan's Milestone (review 3039 B1)", () => {
    for (const kind of ["annotate", "request-change"] as const) {
      const composed = composePlanAsk({ kind, project: "alpha", plan: "p", text: "Split the second Action.", requestId: `workspace-${kind}-p-1` });
      expect(composed.ask.intent).toBe("proposal");
      expect(composed.effects.every(effect => effect.targetKind !== "plan")).toBe(true);
    }
  });

  it("matches the Plan and its Actions, never a Plan whose slug only starts the same", () => {
    expect(targetsPlan("plan/p", "p")).toBe(true);
    expect(targetsPlan("plan/p#first", "p")).toBe(true);
    expect(targetsPlan("plan/p-two", "p")).toBe(false);
    expect(targetsPlan(null, "p")).toBe(false);
  });
});
