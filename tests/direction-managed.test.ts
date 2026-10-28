import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureDirection } from "../src/ask/directions.js";
import { directionEffects, observeDirectionQa } from "../src/ask/directionVerification.js";
import { projectDirection } from "../src/ask/directionState.js";
import { runAgentAskDraftCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { acknowledgeMailMessage, consumeDirectionCheckpoint, listMailInbox, sendMailMessage } from "../src/nativeMail/store.js";
import { runQaPrReviewCommand } from "../src/qa/prReview.js";
import { completionEvidenceForReview } from "../src/sessions/reconciliation.js";
import { completionExecutionPassed } from "../src/sessions/completionValidationEvidence.js";
import { git, hostReviewHost, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

const fixtures: Rehearsal[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); });

describe("managed direction acceptance through canonical producers", () => {
  it("binds the real complete writer, terminal managed QA and independent direction reader to one Session/packet/tree", () => {
    // Existing hermetic harness: real launch/admission, packet, Git, completion
    // validation, settlement and QA producer. Only tmux/provider/external model
    // execution are simulated; no Session or acceptance receipt is seeded.
    const criteria = [
      `MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`,
      "tests/marker-proof.test.mjs passes with node --test."
    ];
    const actionsYaml = ["write-marker-a", "write-marker-b"].map((id, index) => `  - id: ${id}
    title: Implement marker ${index}
    status: open
    responsibility: agent
    effort: session
    next_action: Implement marker ${index}
    expected_artifact: MARKER.md
    clarification: clarified
    confidence: high
    acceptance_criteria:
${(index === 0 ? criteria : ["MARKER.md exists."]).map(criterion => `      - ${JSON.stringify(criterion)}`).join("\n")}
    depends_on: ${index ? "[write-marker-a]" : "[]"}
    decisions: []
`).join("");
    const f = new Rehearsal({ independentReviewers: false, fixturePlan: { firstAction: "write-marker-a", actionsYaml,
      genesisFiles: { "tests/marker-proof.test.mjs": `import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
test("marker A matches the accepted direction", () => { assert.equal(readFileSync("MARKER.md", "utf8"), ${JSON.stringify(`${LINE_A}\n`)}); });\n` } } }); fixtures.push(f);
    f.createFixtureRepository(); f.approve(f.registerProject()); f.activate();
    expect(f.tick().launch?.outcome).toBe("launched");
    const session = f.lease()!;
    const chain = withDatabase(f.workspace, db => {
      const direction = captureDirection(db, { requestId: "managed-direction", content: "Write marker A and prove it", target: { projectId: f.projectId, plan: f.planSlug, action: session.action_id } });
      const offer = sendMailMessage(db, { requestId: "managed-offer", kind: "request",
        sender: { repository: f.repo, projectSlug: f.projectSlug, planSlug: f.planSlug, sessionIncarnation: "fixture-coordinator", generation: "1" },
        recipient: { sessionIncarnation: "fixture-recipient", generation: "1" }, canonicalSessionRef: session.id,
        assignmentEvidence: `action/${session.action_id}`, receiverCheckpointCapability: "explicit-checkpoint", body: {}, actor: "fixture-coordinator",
        direction: { requestId: direction.requestId, fingerprint: direction.fingerprint } });
      const scope = { projectSlug: f.projectSlug, planSlug: f.planSlug, recipientSessionIncarnation: "fixture-recipient", recipientGeneration: "1", actor: "fixture-recipient" };
      listMailInbox(db, scope);
      const consumed = consumeDirectionCheckpoint(db, { ...scope, messageId: offer.message.id, requestId: "managed-consume", fingerprint: direction.fingerprint });
      const ack = acknowledgeMailMessage(db, { ...scope, messageId: offer.message.id, compactAcknowledgment: "Read marker A; I will implement and check it." });
      return { direction, scope, messageId: offer.message.id, correlation: { requestId: direction.requestId, fingerprint: direction.fingerprint,
        messageId: offer.message.id, consumptionReceiptId: consumed.id, acknowledgmentReceiptId: ack.id } };
    });
    f.agentEdit(session, "MARKER.md", `${LINE_A}\n`);
    git(session.worktree_path, ["add", "-A"]); git(session.worktree_path, ["commit", "-qm", "Write marker A"]);
    const head = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
    const request = JSON.stringify({ agent_ask: "v1", request_id: "managed-complete", project: f.projectSlug, intent: "complete", target_ref: `action/${session.action_id}`,
      desired_result: "Record marker A complete", candidate_revision: head, evidence: criteria.map(criterion => ({ criterion, status: "met", note: "Actual fixture MARKER.md and bound check" })), direction: chain.correlation });
    const draft = runAgentAskDraftCommand({ workspace: f.workspace, request, dir: session.worktree_path });
    const originalBytes = readFileSync(draft.data.path, "utf8");
    const options = { workspace: f.workspace, proposal: draft.data.preview!.proposal.id, requestId: "managed-settle", disposition: "accepted" as const, cwd: session.worktree_path };
    const preview = runAgentAskSettleCommand(options);
    const applied = runAgentAskSettleCommand({ ...options, apply: true, preview: preview.data.receipt.previewFingerprint });
    expect(applied.data.receipt.recovery).toBeUndefined();
    const revision = applied.data.receipt.documentsCommit!;
    expect(readFileSync(path.join(session.worktree_path, ".arcadia/asks/archive/agent-ask-managed-complete.yaml"), "utf8")).toBe(originalBytes);
    f.tmux.exit(session.tmux_session_name);
    const reconciled = f.tick();
    expect(reconciled.reconciled).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: "accepted_completion" })]));
    const { dependencies } = hostReviewHost(session, revision);
    dependencies.now = () => new Date();
    const qa = runQaPrReviewCommand({ workspace: f.workspace, pullRequest: "https://github.com/pmark/rehearsal/pull/7" }, dependencies);
    expect(qa.data.verdict).toBe("pass");
    withDatabase(f.workspace, db => {
      const completion = completionEvidenceForReview(db, f.workspace, session, revision);
      expect(completion.status).toBe("verified");
      if (completion.status === "verified") {
        expect(completion.record.binding).toMatchObject({ sessionId: session.id, packetSha256: session.packet_sha256, actionId: session.action_id });
        expect(completionExecutionPassed(completion, completion.record.commands, completion.record.namedTests)).toBe(true);
      }
      expect(directionEffects(db, chain.direction)).toMatchObject([{ revision, action: session.action_id, id: applied.data.receipt.id }]);
      const verified = observeDirectionQa(db, f.workspace, { ...chain.scope, messageId: chain.messageId, requestId: "managed-verify", decisionId: qa.data.decision.id });
      expect(verified.effectEvidence).toMatchObject({ schema: "arcadia-direction-verification-v1", revision, result: "passed", provenance: "canonical-independent-qa" });
      expect(projectDirection(db, f.workspace, chain.direction.requestId)).toMatchObject({ state: "verified" });
    });
    expect(f.attempts(session.action_id).filter(attempt => attempt.role === "qa")).toMatchObject([{ status: "passed", target_head: revision }]);
  }, 60_000);
});
