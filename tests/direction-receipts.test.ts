import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { captureDirection } from "../src/ask/directions.js";
import { directionEffects, observeDirectionQa } from "../src/ask/directionVerification.js";
import { runAgentAskDraftCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { agentAskFingerprint, normalizeAgentAsk } from "../src/ask/agentAsk.js";
import { projectDirection, unknownDirection } from "../src/ask/directionState.js";
import { withDatabase } from "../src/db/connection.js";
import { acknowledgeMailMessage, consumeDirectionCheckpoint, listMailInbox, mailStatus, sendMailMessage, ensureNativeMailTables, directionForMail, recordDirectionRecipientState } from "../src/nativeMail/store.js";
import { runQaPrReviewCommand } from "../src/qa/prReview.js";
import { allocateSessionRoleAttempt } from "../src/sessions/enrollment.js";
import { createWorkItemRecord, createCodexInvocation } from "../src/db/repositories.js";

import { createDirectionFixture as fixture, directionQaDependencies as qaDependencies } from "./helpers/directionFixture.js";

describe("canonical direction receipt producers", () => {
  it("retains the exact pre-direction normalized shape and fingerprint golden", () => {
    const normalized = normalizeAgentAsk({ request: JSON.stringify({ agent_ask: "v1", request_id: "legacy-golden", project: "demo", intent: "log",
      desired_result: "Retain the observed fixture proof.", requested_authority: "propose", references: ["fixture:proof"] }) });
    expect(normalized).not.toHaveProperty("direction");
    expect(agentAskFingerprint(normalized)).toBe("ad269d0f6c69fe28a7b491a30c9e0203c5211b6830bed6a1480ef58a1459d2fb");
  });
  it("retains accepted/refused target receipts and never changes an identity on replay", () => {
    const f = fixture();
    withDatabase(f.workspace, db => {
      const input = { requestId: "direction", content: "Complete the proof", target: { projectId: f.project.id, plan: "work", action: "first" } };
      const first = captureDirection(db, input);
      expect(first.disposition).toBe("accepted"); expect(captureDirection(db, input)).toEqual(first);
      expect(() => captureDirection(db, { ...input, content: "Different" })).toThrow("different content");
      expect(() => captureDirection(db, { ...input, target: { ...input.target, action: "second" } })).toThrow("different routing");
      const refused = captureDirection(db, { ...input, requestId: "refused", target: { projectId: f.project.id, plan: "BAD SLUG" } });
      expect(refused.disposition).toBe("refused"); expect(refused.reason).toContain("Direction target");
      expect(captureDirection(db, { ...input, requestId: "refused", target: { projectId: f.project.id, plan: "BAD SLUG" } })).toEqual(refused);
      expect(() => captureDirection(db, { ...input, requestId: "refused" })).toThrow("different routing");
    });
  });

  it.each(["project", "plan", "action", "malformed"])("durably refuses an ambiguous or malformed %s control target", kind => {
    const f = fixture();
    if (kind === "project") writeFileSync(path.join(f.repo, "other.md"), readFileSync(path.join(f.repo, "PROJECT.md"), "utf8"));
    if (kind === "plan") writeFileSync(path.join(f.repo, "docs/plans/duplicate.md"), readFileSync(path.join(f.repo, "docs/plans/work.md"), "utf8"));
    if (kind === "action") { const file = path.join(f.repo, "docs/plans/work.md"); writeFileSync(file, readFileSync(file, "utf8").replace("id: second", "id: first")); }
    if (kind === "malformed") writeFileSync(path.join(f.repo, "docs/plans/work.md"), "---\narcadia: v1\ntype: plan\nslug: work\nproject: demo\n---\n");
    withDatabase(f.workspace, db => {
      const receipt = captureDirection(db, { requestId: `bad-${kind}`, content: "Keep the exact target", target: { projectId: f.project.id, plan: "work", action: "first" } });
      expect(receipt.disposition).toBe("refused"); expect(receipt.reason).toBeTruthy();
    });
  });

  it("migrates old receipts atomically, preserving bytes, indexes, FKs and generic body replay", () => {
    const db = new Database(":memory:"); db.pragma("foreign_keys=ON"); ensureNativeMailTables(db);
    const input = { requestId: "legacy", kind: "request" as const,
      sender: { repository: "/fixture", projectSlug: "demo", planSlug: "work", sessionIncarnation: "old-sender", generation: "1" },
      recipient: { sessionIncarnation: "old-recipient", generation: "1" }, assignmentEvidence: "legacy", receiverCheckpointCapability: "checkpoint",
      actor: "legacy", body: { arcadiaDirection: { requestId: "spoof", fingerprint: "0".repeat(64) } } };
    const offered = sendMailMessage(db, input);
    const before = db.prepare("SELECT * FROM native_mail_receipts").all();
    db.exec(`DROP INDEX idx_native_mail_direction; ALTER TABLE native_mail_messages DROP COLUMN direction_json;
      ALTER TABLE native_mail_receipts RENAME TO native_mail_receipts_new_fixture;
      CREATE TABLE native_mail_receipts (
        id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES native_mail_messages(id) ON DELETE CASCADE,request_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('offer','exposure','acknowledgment','self_report','effect_receipt','disposal')),
        actor TEXT NOT NULL,self_reported_result_json TEXT,effect_evidence_json TEXT,created_at TEXT NOT NULL);
      INSERT INTO native_mail_receipts SELECT * FROM native_mail_receipts_new_fixture; DROP TABLE native_mail_receipts_new_fixture;
      CREATE INDEX idx_native_mail_receipts_message ON native_mail_receipts(message_id,created_at);`);
    const exec = db.exec.bind(db);
    const failure = vi.spyOn(db, "exec").mockImplementation(sql => { if (sql.includes("CREATE TABLE native_mail_receipts_direction")) throw new Error("fixture migration failure"); return exec(sql); });
    expect(() => ensureNativeMailTables(db)).toThrow("fixture migration failure"); failure.mockRestore();
    expect((db.prepare("PRAGMA table_info(native_mail_messages)").all() as Array<{ name: string }>).some(column => column.name === "direction_json")).toBe(false);
    expect(db.prepare("SELECT * FROM native_mail_receipts").all()).toEqual(before);
    ensureNativeMailTables(db);
    expect(db.prepare("SELECT * FROM native_mail_receipts").all()).toEqual(before);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_native_mail_receipts_message'").get()).toBeTruthy();
    expect(sendMailMessage(db, input)).toEqual(offered);
    expect(directionForMail(offered.message)).toBeNull();
    db.prepare("DELETE FROM native_mail_messages WHERE id=?").run(offered.message.id);
    expect(db.prepare("SELECT * FROM native_mail_receipts").all()).toEqual([]); db.close();
  });

  it("traverses accepted capture, explicit receiver receipts, actual complete writer and independent QA producer/reader", () => {
    const f = fixture();
    const candidate = path.join(f.root, "candidate");
    f.git("worktree", "add", "-q", "-b", "codex/direction-fixture", candidate);
    const transitions: ReturnType<typeof projectDirection>[] = [];
    const chain = withDatabase(f.workspace, db => {
      const direction = captureDirection(db, { requestId: "prove-first", content: "Complete first with proof", target: { projectId: f.project.id, plan: "work", action: "first" } });
      const offer = sendMailMessage(db, { requestId: "offer-first", kind: "request",
        sender: { repository: f.repo, projectSlug: "demo", planSlug: "work", sessionIncarnation: "coordinator-lifetime", generation: "1" },
        recipient: { sessionIncarnation: "recipient-lifetime", generation: "2" }, assignmentEvidence: "action/first",
        receiverCheckpointCapability: "explicit-checkpoint", body: { text: "Untrusted direction" }, actor: "coordinator",
        direction: { requestId: direction.requestId, fingerprint: direction.fingerprint } });
      transitions.push(projectDirection(db, f.workspace, direction.requestId));
      const scope = { projectSlug: "demo", planSlug: "work", recipientSessionIncarnation: "recipient-lifetime", recipientGeneration: "2" };
      expect(() => consumeDirectionCheckpoint(db, { ...scope, messageId: offer.message.id, requestId: "consume-first", fingerprint: direction.fingerprint, actor: "recipient" })).toThrow("preceding");
      listMailInbox(db, { ...scope, actor: "recipient" });
      expect(mailStatus(db, offer.message.id).explicitlyAcknowledged).toBe(false);
      const consumed = consumeDirectionCheckpoint(db, { ...scope, messageId: offer.message.id, requestId: "consume-first", fingerprint: direction.fingerprint, actor: "recipient" });
      transitions.push(projectDirection(db, f.workspace, direction.requestId));
      const ack = acknowledgeMailMessage(db, { ...scope, messageId: offer.message.id, actor: "recipient", compactAcknowledgment: "Read first; I will write and check its proof." });
      transitions.push(projectDirection(db, f.workspace, direction.requestId));
      expect(consumed.effectEvidence?.provenance).toBe("recipient-attestation");
      expect(ack.effectEvidence?.text).toContain("Read first");
      return { direction, scope, messageId: offer.message.id, correlation: { requestId: direction.requestId, fingerprint: direction.fingerprint,
        messageId: offer.message.id, consumptionReceiptId: consumed.id, acknowledgmentReceiptId: ack.id } };
    });
    const ask = JSON.stringify({ agent_ask: "v1", request_id: "complete-first", project: "demo", intent: "complete", target_ref: "action/first",
      desired_result: "Complete first", candidate_revision: f.head, evidence: [{ criterion: "Proof exists.", status: "met", note: "Fixture proof" }], direction: chain.correlation });
    const drafted = runAgentAskDraftCommand({ workspace: f.workspace, dir: candidate, request: ask });
    const originalBytes = readFileSync(drafted.data.path, "utf8");
    const options = { workspace: f.workspace, proposal: drafted.data.preview!.proposal.id, requestId: "settle-first", disposition: "accepted" as const, cwd: candidate };
    const preview = runAgentAskSettleCommand(options);
    expect(preview.data.receipt.directionEffect?.correlation).toEqual(chain.correlation);
    const applied = runAgentAskSettleCommand({ ...options, apply: true, preview: preview.data.receipt.previewFingerprint });
    expect(applied.data.receipt.recovery).toBeUndefined();
    const revision = applied.data.receipt.documentsCommit!;
    expect(revision).toBe(f.git("-C", candidate, "rev-parse", "HEAD"));
    expect(readFileSync(path.join(candidate, ".arcadia/asks/archive/agent-ask-complete-first.yaml"), "utf8")).toBe(originalBytes);
    withDatabase(f.workspace, db => transitions.push(projectDirection(db, f.workspace, chain.direction.requestId)));
    const qa = runQaPrReviewCommand({ workspace: f.workspace, pullRequest: "https://github.com/pmark/arcadia/pull/54" }, qaDependencies(revision, f.head));
    expect(qa.data.verdict).toBe("pass");
    withDatabase(f.workspace, db => {
      expect(directionEffects(db, chain.direction)).toMatchObject([{ id: applied.data.receipt.id, revision, action: "first" }]);
      const verified = observeDirectionQa(db, f.workspace, { ...chain.scope, messageId: chain.messageId, requestId: "verify-first", decisionId: qa.data.decision.id, actor: "observer" });
      expect(verified.effectEvidence).toMatchObject({ schema: "arcadia-direction-verification-v1", revision, result: "passed", provenance: "canonical-independent-qa" });
      expect(mailStatus(db, chain.messageId).independentlyCheckedEffect).toBeNull(); // legacy generic view never promotes arbitrary rows
      // A genuine positive QA at the same head is insufficient when its branch
      // belongs to another managed Action/packet. The QA producer above is real.
      const at = new Date().toISOString();
      const otherWork = createWorkItemRecord(db, { projectId: f.project.id, title: "Other Action", rawInput: "Other Action", queue: "work_queue", workClassification: "agent", nextAction: "Write other proof" });
      const otherPacket = createCodexInvocation(db, { purpose: "build", agentProfile: "fixture", workspaceScope: f.workspace, command: "fixture", promptPath: "other.json", jsonlOutputPath: "other.jsonl", finalMessagePath: "other.txt", workItemId: otherWork.id });
      db.prepare(`INSERT INTO agent_sessions (id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id,
        packet_id, packet_path, packet_sha256, authorizing_decisions_json, provider_profile, provider, model, base_revision, branch,
        worktree_path, provider_session_id, display_name, terminal_transport, tmux_session_name, status, prepared_at, created_at, updated_at)
        VALUES ('wrong-managed', ?, 'demo', ?, 'docs/plans/work.md', 'work', 'second', ?, ?, 'other.json', 'other-hash', '[]',
          'fixture', 'codex-cli', 'fixture', ?, 'candidate', ?, 'fixture-session', 'fixture', 'tmux', 'fixture', 'completed', ?, ?, ?)`)
        .run(f.project.id, f.repo, otherWork.id, otherPacket.id, f.head, candidate, at, at, at);
      const otherAttempt = allocateSessionRoleAttempt(db, { requirementId: "demo/work/second", inputRevision: "other-input", role: "development",
        requestId: "wrong-managed-development", actorId: "other-developer", mutationOwner: true, authorityCurrent: true });
      expect(() => observeDirectionQa(db, f.workspace, { ...chain.scope, messageId: chain.messageId, requestId: "wrong-managed-verify", decisionId: qa.data.decision.id, actor: "observer" })).toThrow("Managed QA");
      expect(projectDirection(db, f.workspace, chain.direction.requestId)).toMatchObject({ state: "continued", reason: expect.stringContaining("Managed QA") });
      db.prepare("DELETE FROM session_role_attempts WHERE request_id=?").run(otherAttempt.request_id);
      db.prepare("DELETE FROM agent_sessions WHERE id='wrong-managed'").run();
      transitions.push(projectDirection(db, f.workspace, chain.direction.requestId));
      expect(transitions.map(view => view!.state)).toEqual(["submitted", "delivered", "acknowledged", "continued", "verified"]);
      for (const view of transitions) for (const evidence of view!.evidence) {
        expect(evidence.artifact).toBeTruthy(); expect(evidence.source).toBeTruthy(); expect(Number.isFinite(Date.parse(evidence.observedAt))).toBe(true);
      }
      for (const state of ["paused", "stopped"] as const) {
        recordDirectionRecipientState(db, { ...chain.scope, messageId: chain.messageId, requestId: `observe-${state}`, state, evidenceReference: `native-observation:${state}`, actor: "coordinator" });
        expect(projectDirection(db, f.workspace, chain.direction.requestId)).toMatchObject({ state: "held", lastSupportedState: "verified", reason: expect.stringContaining(state), evidence: expect.arrayContaining([expect.objectContaining({ state: "held", source: "native-mail.record-recipient-state", artifact: expect.any(String), observedAt: expect.any(String) })]) });
      }
      recordDirectionRecipientState(db, { ...chain.scope, messageId: chain.messageId, requestId: "observe-running", state: "running", evidenceReference: "native-observation:running", actor: "coordinator" });
      const unknown = unknownDirection(chain.direction.requestId, new Date().toISOString(), "Lost response; lookup only.");
      expect(unknown).toMatchObject({ state: "unknown", evidence: [expect.objectContaining({ artifact: `${chain.direction.requestId}:submission-attempt`, source: "workspace.submission", observedAt: expect.any(String) })] });
      const row = db.prepare("SELECT context_json FROM review_items WHERE id=?").get(qa.data.decision.id) as { context_json: string };
      const contradicted = JSON.parse(row.context_json); contradicted.checks[0].status = "fail";
      db.prepare("UPDATE review_items SET context_json=? WHERE id=?").run(JSON.stringify(contradicted), qa.data.decision.id);
      expect(() => observeDirectionQa(db, f.workspace, { ...chain.scope, messageId: chain.messageId, requestId: "negative-qa", decisionId: qa.data.decision.id, actor: "observer" })).toThrow("negative");
      expect(projectDirection(db, f.workspace, chain.direction.requestId)).toMatchObject({ state: "continued", lastSupportedState: "continued", reason: expect.stringContaining("negative") });
      db.prepare("UPDATE review_items SET context_json=? WHERE id=?").run(row.context_json, qa.data.decision.id);
      const report = path.join(f.workspace, qa.data.reportPath); const reportBytes = readFileSync(report, "utf8"); writeFileSync(report, reportBytes + "altered");
      expect(projectDirection(db, f.workspace, chain.direction.requestId)).toMatchObject({ state: "continued", reason: expect.stringContaining("altered") });
      writeFileSync(report, reportBytes);
      expect(projectDirection(db, f.workspace, chain.direction.requestId)?.state).toBe("verified");
      f.git("commit", "--allow-empty", "-qm", "Unrelated later progress");
      expect(projectDirection(db, f.workspace, chain.direction.requestId)?.state).toBe("verified");
    });
  });
});
