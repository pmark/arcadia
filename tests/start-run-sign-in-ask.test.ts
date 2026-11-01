import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeAgentAsk } from "../src/ask/agentAsk.js";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import {
  buildDiagnosticAsk, buildSignInGrant, diagnosticQuestion, governingDecisionReferences, validateDiagnosticAsk
} from "../src/production/startRunSignIn.js";
import { diagnosticGrantAnswer } from "../src/production/workerClaudeUsageDiagnostic.js";
import { slugify } from "../src/utils/slug.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * Issue #1958: the second live START press claimed the day and renewed, then the diagnostic Agent Ask was refused by
 * preview because it cited the run journal by absolute path. These cases run the REAL validator (and a real preview
 * against a disposable test workspace) on the Ask the sequence generates, never a fake.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

const NONCE = "cd9d99b3-1234-4234-8234-123456789abc";
const binding = { pid: 43934, instance: "i", release: "993881bff8a863325c06c5fade4cd3b33ba4eb99", handlerHash: "h".repeat(64), repository: repoRoot };
const context = { project: "arcadia", cardId: "start-run-unattended-20261101b", runId: "20261101T040024Z-38768", policyRevision: 83, policyEpoch: 46 };
function generated(references = governingDecisionReferences(repoRoot)) {
  const expiresAt = "2026-11-01T04:10:00.000Z";
  const grant = buildSignInGrant({
    nonce: NONCE, repository: repoRoot, workspace: "/w/martianrover", binding, decision: `0162-${slugify(diagnosticQuestion("2026-10-31", NONCE))}`,
    policyRevision: 83, policyEpoch: 46, expiresAt
  });
  const answer = diagnosticGrantAnswer(grant);
  return buildDiagnosticAsk({ context, date: "2026-10-31", nonce: NONCE, binding, answer, digest: answer.split(" ").at(-1)!, expiresAt, references });
}

describe("the START sign-in diagnostic Agent Ask (Issue #1958)", () => {
  it("cites the governing Decisions repository-relative and passes the real validator", () => {
    const references = governingDecisionReferences(repoRoot);
    expect(references).toHaveLength(3);
    for (const reference of references) {
      expect(path.isAbsolute(reference)).toBe(false);
      expect(reference).toMatch(/^docs\/decisions\/01(41|43|61)-.+\.md$/);
    }
    const diagnostic = generated(references);
    const normalized = validateDiagnosticAsk(diagnostic);
    expect(normalized).toMatchObject({ intent: "decision", requestId: "start-run-signin-2026-10-31-cd9d99b3", references });
    expect(String(diagnostic.ask.rationale)).toContain(context.runId);
    expect(diagnostic.settlementRequestId).toBe("settle-start-run-signin-2026-10-31-cd9d99b3");
  });

  it("regression: the live failing shape (the run journal cited by absolute path) is refused by the real validator", () => {
    const journal = "/Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts/runs/start-run-unattended-20261101b/20261101T040024Z-38768/sign-in.json";
    const failing = generated([journal]);
    expect(() => normalizeAgentAsk({ request: JSON.stringify(failing.ask) })).toThrow(/must not contain absolute filesystem paths/);
    expect(() => validateDiagnosticAsk(failing)).toThrow(/absolute filesystem paths/);
  });

  it("is accepted by a real agent-ask preview in a disposable test workspace", () => {
    const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-signin-ask-preview-")));
    directories.push(workspace);
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      const project = upsertProject(db, { name: "Arcadia", mission: "Fixture.", goal: "Fixture.", status: "active", currentMilestone: "Fixture", nextAction: "Fixture.", workClassification: "agent" });
      upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
    });
    const diagnostic = generated();
    const preview = runAgentAskPreviewCommand({ workspace, request: JSON.stringify(diagnostic.ask) });
    expect(preview.ok).toBe(true);
    expect(preview.data.proposal.normalized).toMatchObject({ requestId: diagnostic.requestId, intent: "decision", references: diagnostic.ask.references });
    expect(preview.data.projectWritesPerformed).toBe(0);
    // The failing shape is refused by the same real preview.
    const failing = generated(["/abs/sign-in.json"]);
    expect(() => runAgentAskPreviewCommand({ workspace, request: JSON.stringify(failing.ask) })).toThrow(/absolute filesystem paths/);
  });
});
