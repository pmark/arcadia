import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentAskSettlementMessage } from "../apps/discord-bot/src/notifications/poller.js";
import {
  runAgentAskNotificationSentCommand,
  runAgentAskNotificationsCommand,
  runAgentAskPreviewCommand,
  runAgentAskSettleCommand
} from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { arrangeActionOrder, loadActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Agent Ask settlement", () => {
  it("previews and atomically accepts a canonical Action at an explicit queue position", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: actionAsk("ask-action-1") });
    const preview = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-action-1",
      disposition: "accepted",
      responsibility: "codex",
      top: true,
      revision: 1
    });
    expect(preview.data.receipt).toMatchObject({
      applied: false,
      disposition: "accepted",
      queueActionKey: "demo/add-settlement-proof",
      queuePosition: 0,
      authority: {
        kind: "operator_acceptance",
        requestedAuthority: "apply_if_approved",
        boundedPolicyDecision: null
      },
      notificationStatus: "withheld_until_apply"
    });
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).not.toContain("add-settlement-proof");
    expect(() => runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-action-1",
      disposition: "accepted",
      responsibility: "codex",
      top: true,
      revision: 1,
      apply: true
    })).toThrow(/does not match the current preview/);

    const applied = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-action-1",
      disposition: "accepted",
      responsibility: "codex",
      top: true,
      revision: 1,
      preview: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(applied.data.receipt).toMatchObject({ applied: true, notificationStatus: "pending" });
    const settledPlan = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    expect(settledPlan).toContain("id: add-settlement-proof");
    expect(settledPlan.indexOf("id: add-settlement-proof")).toBeLessThan(settledPlan.indexOf("questions: []"));
    expect(settledPlan).toContain("questions: []");
    withDatabase(workspace, (db) => {
      expect([...loadActionOrder(db).positions]).toEqual([["demo/add-settlement-proof", 0], ["demo/existing", 1]]);
      expect(loadActionOrder(db).revision).toBe(2);
      expect((db.prepare("SELECT COUNT(*) AS count FROM work_items WHERE doc_ref = 'plan/demo-plan#add-settlement-proof'").get() as { count: number }).count).toBe(1);
    });
    const replay = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-action-1",
      disposition: "accepted",
      responsibility: "codex",
      top: true,
      revision: 1,
      preview: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(replay.data.receipt).toEqual(applied.data.receipt);

    const pending = runAgentAskNotificationsCommand({ workspace });
    expect(pending.data.notifications).toHaveLength(1);
    expect(agentAskSettlementMessage(pending.data.notifications[0]!)).toContain("Agent Ask settled: accepted");
    expect(agentAskSettlementMessage(pending.data.notifications[0]!)).toContain("Queue: demo/add-settlement-proof starting at position 1");
    runAgentAskNotificationSentCommand({ workspace, settlement: applied.data.receipt.id, messageId: "discord-ask-1" });
    expect(runAgentAskNotificationsCommand({ workspace }).data.notifications).toEqual([]);
  });

  it("settles rejection without Project or queue effects and queues a brief ping", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: actionAsk("ask-reject-1") });
    const before = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    const preview = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-reject-1",
      disposition: "rejected",
      revision: 1
    });
    const applied = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-reject-1",
      disposition: "rejected",
      revision: 1,
      preview: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(applied.data.receipt).toMatchObject({ disposition: "rejected", queueActionKey: null, notificationStatus: "pending" });
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toBe(before);
    expect(runAgentAskNotificationsCommand({ workspace }).data.notifications[0]).toMatchObject({
      disposition: "rejected",
      queueActionKey: null
    });
  });

  it("settles every non-Action intent into the smallest canonical Project effect", () => {
    const scenarios = [
      { intent: "outcome", desired: "Deliver a safer outcome", effect: "Updated Project demo Outcome." },
      { intent: "milestone", desired: "Reach the settlement milestone", effect: "Updated Project demo and active Plan demo-plan Milestone." },
      { intent: "plan", desired: "Plan safer delivery", effect: "Created draft Plan plan-safer-delivery" },
      { intent: "decision", desired: "Should this approach ship?", effect: "Created one open Decision" },
      { intent: "auto", desired: "Make the ambiguous thing happen", effect: "Created one open interpretation Decision" },
      { intent: "log", desired: "Recorded settlement learning", effect: "Appended one Project Log entry" },
      { intent: "artifact", desired: "Settlement design reference", targetRef: "docs/design.md", effect: "Created one planned Artifact reference" },
      { intent: "proposal", desired: "Consider a future queue experiment", effect: "Accepted the proposal as preserved evidence" },
      { intent: "project_update", desired: "Deliver a clearer Project outcome", targetRef: "outcome", effect: "Updated Project demo Outcome." }
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const { workspace, repo } = fixture();
      const requestId = `effect-${index}`;
      const proposal = runAgentAskPreviewCommand({
        workspace,
        request: askForIntent(requestId, scenario.intent, scenario.desired, scenario.targetRef)
      });
      const preview = runAgentAskSettleCommand({
        workspace,
        proposal: proposal.data.proposal.id,
        requestId: `settle-${requestId}`,
        disposition: "accepted",
        revision: 1
      });
      const applied = runAgentAskSettleCommand({
        workspace,
        proposal: proposal.data.proposal.id,
        requestId: `settle-${requestId}`,
        disposition: "accepted",
        revision: 1,
        preview: preview.data.receipt.previewFingerprint,
        apply: true
      });
      expect(applied.data.receipt.effects.join(" ")).toContain(scenario.effect);
      expect(applied.data.receipt.queueActionKey).toBeNull();
      expect(runAgentAskNotificationsCommand({ workspace }).data.notifications).toHaveLength(1);

      if (scenario.intent === "outcome" || scenario.intent === "project_update") {
        expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain(`goal: ${scenario.desired}`);
      } else if (scenario.intent === "milestone") {
        expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain(`milestone: ${scenario.desired}`);
        expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain(`milestone: ${scenario.desired}`);
      } else if (scenario.intent === "plan") {
        expect(readFileSync(path.join(repo, "docs/plans/plan-safer-delivery.md"), "utf8")).toContain("status: draft");
      } else if (scenario.intent === "decision" || scenario.intent === "auto") {
        expect(readFileSync(path.join(repo, "docs/decisions/0001-" + (scenario.intent === "decision" ? "should-this-approach-ship" : "how-should-arcadia-structure-this-request-make-the-ambiguous-thing-happen") + ".md"), "utf8"))
          .toContain("status: open");
      } else if (scenario.intent === "log") {
        expect(readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8")).toContain(`Agent Ask ${requestId}`);
      } else if (scenario.intent === "artifact") {
        withDatabase(workspace, (db) => {
          expect((db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE path = 'docs/design.md'").get() as { count: number }).count).toBe(1);
        });
      }
    }
  });

  it("amends an existing Action without changing its Responsibility or queue position", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({
      workspace,
      request: askForIntent("amend-action", "action", "Improve existing proof", "action/existing", ["Improved proof exists."])
    });
    const preview = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-amend-action",
      disposition: "accepted",
      revision: 1
    });
    const applied = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-amend-action",
      disposition: "accepted",
      revision: 1,
      preview: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(applied.data.receipt).toMatchObject({ queueActionKey: "demo/existing", queuePosition: 0 });
    const plan = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    expect(plan).toContain("next_action: Improve existing proof");
    expect(plan).toContain("- Improved proof exists.");
    expect(plan).toContain("responsibility: codex");
    withDatabase(workspace, (db) => expect(loadActionOrder(db).revision).toBe(1));
  });

  it("accepts a structured multi-Action Ask as one contiguous queue bundle", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: multiActionAsk("ask-bundle-1") });
    expect(proposal.data.proposal.effects).toHaveLength(2);
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-bundle-1",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1
    });
    expect(preview.data.receipt).toMatchObject({
      queueActionKey: "demo/build-release-proof",
      queueActionKeys: ["demo/build-release-proof", "demo/publish-release-guide"],
      queuePosition: 0
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-bundle-1",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1,
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
    expect(applied.data.receipt.queueActionKeys).toEqual(["demo/build-release-proof", "demo/publish-release-guide"]);
    const plan = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    expect(plan).toContain("id: build-release-proof");
    expect(plan).toContain("id: publish-release-guide");
    expect(plan).toContain("depends_on: [build-release-proof]");
    withDatabase(workspace, (db) => {
      expect([...loadActionOrder(db).positions]).toEqual([
        ["demo/build-release-proof", 0], ["demo/publish-release-guide", 1], ["demo/existing", 2]
      ]);
    });
    const message = agentAskSettlementMessage(runAgentAskNotificationsCommand({ workspace }).data.notifications[0]!);
    expect(message).toContain("demo/build-release-proof, demo/publish-release-guide starting at position 1");
  });

  it("honors an explicit child Action id and refuses one already used in the Plan", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({
      workspace,
      request: bundleAsk("ask-explicit-id", [
        { id: "queue-handle", desiredResult: "Make the queue handle short enough for an operator to type by hand" }
      ])
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-explicit-id",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1
    });
    expect(preview.data.receipt.queueActionKeys).toEqual(["demo/queue-handle"]);
    runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-explicit-id",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1,
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("id: queue-handle");

    const collision = runAgentAskPreviewCommand({
      workspace,
      request: bundleAsk("ask-explicit-collision", [{ id: "existing", desiredResult: "Redo the existing proof" }])
    });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: collision.data.proposal.id, requestId: "settle-explicit-collision",
      disposition: "accepted", responsibility: "codex", top: true, revision: 2
    })).toThrow(/already used in the active Plan/);
  });

  it("derives a short whole-word Action id from a long desired result", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({
      workspace,
      request: bundleAsk("ask-derived-id", [
        { desiredResult: "Reconcile open operator questions against answers the checked-in documents already contain." },
        { desiredResult: "Make a natural language Agent Ask propose the concrete canonical effect when the request arrives as plain prose." }
      ])
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-derived-id",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1
    });
    expect(preview.data.receipt.queueActionKeys).toEqual([
      "demo/reconcile-open-operator-questions-against",
      "demo/make-a-natural-language-agent-ask"
    ]);
    for (const key of preview.data.receipt.queueActionKeys) {
      const id = key.slice("demo/".length);
      expect(id.length).toBeLessThanOrEqual(48);
      // The old derivation cut the slug at a fixed character count, leaving
      // handles that ended mid-word such as "...-documents-alrea".
      expect("Reconcile open operator questions against answers the checked-in documents already contain. Make a natural language Agent Ask propose the concrete canonical effect when the request arrives as plain prose."
        .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
        .toEqual(expect.arrayContaining(id.split("-")));
    }
    runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-derived-id",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1,
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
    const plan = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    expect(plan).toContain("id: reconcile-open-operator-questions-against");
    expect(plan).not.toContain("documents-alrea");
  });

  it("breaks a derived id collision with a numeric suffix and replays byte-stably", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({
      workspace,
      request: bundleAsk("ask-derived-collision", [
        { desiredResult: "Existing" },
        { desiredResult: "Existing" }
      ])
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-derived-collision",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1
    });
    expect(preview.data.receipt.queueActionKeys).toEqual(["demo/existing-2", "demo/existing-3"]);
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-derived-collision",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1,
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
    const planPath = path.join(repo, "docs/plans/demo-plan.md");
    const settledPlan = readFileSync(planPath, "utf8");
    expect(settledPlan).toContain("id: existing-2");
    expect(settledPlan).toContain("id: existing-3");
    const replay = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-derived-collision",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1,
      preview: preview.data.receipt.previewFingerprint, apply: true
    });
    expect(replay.data.receipt).toEqual(applied.data.receipt);
    expect(readFileSync(planPath, "utf8")).toBe(settledPlan);
  });

  it("preserves rejected input and accepts a corrected Ask under a new request id", () => {
    const { workspace, repo } = fixture();
    const original = runAgentAskPreviewCommand({ workspace, request: actionAsk("ask-needs-correction") });
    const rejectionPreview = runAgentAskSettleCommand({
      workspace, proposal: original.data.proposal.id, requestId: "reject-needs-correction",
      disposition: "rejected", revision: 1
    });
    runAgentAskSettleCommand({
      workspace, proposal: original.data.proposal.id, requestId: "reject-needs-correction",
      disposition: "rejected", revision: 1, preview: rejectionPreview.data.receipt.previewFingerprint, apply: true
    });

    const corrected = runAgentAskPreviewCommand({
      workspace,
      request: actionAsk("ask-corrected").replace("Add settlement proof", "Add corrected settlement proof")
    });
    const acceptancePreview = runAgentAskSettleCommand({
      workspace, proposal: corrected.data.proposal.id, requestId: "accept-corrected",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1
    });
    runAgentAskSettleCommand({
      workspace, proposal: corrected.data.proposal.id, requestId: "accept-corrected",
      disposition: "accepted", responsibility: "codex", top: true, revision: 1,
      preview: acceptancePreview.data.receipt.previewFingerprint, apply: true
    });

    const plan = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    expect(plan).not.toContain("id: add-settlement-proof\n");
    expect(plan).toContain("id: add-corrected-settlement-proof");
    withDatabase(workspace, (db) => {
      const settlements = db.prepare("SELECT disposition, proposal_id FROM agent_ask_settlements ORDER BY created_at, id").all() as Array<{ disposition: string; proposal_id: string }>;
      expect(settlements).toEqual([
        { disposition: "rejected", proposal_id: original.data.proposal.id },
        { disposition: "accepted", proposal_id: corrected.data.proposal.id }
      ]);
    });
  });

  it("refuses a stale amendment preview without changing the managed Action", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({
      workspace,
      request: askForIntent("stale-amendment", "action", "Improve existing proof", "action/existing", ["Improved proof exists."])
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-stale-amendment",
      disposition: "accepted", revision: 1
    });
    const planPath = path.join(repo, "docs/plans/demo-plan.md");
    writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\n<!-- concurrent edit -->\n`, "utf8");
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-stale-amendment",
      disposition: "accepted", revision: 1, preview: preview.data.receipt.previewFingerprint, apply: true
    })).toThrow("does not match the current preview");
    expect(readFileSync(planPath, "utf8")).not.toContain("next_action: Improve existing proof");
    withDatabase(workspace, (db) => {
      expect((db.prepare("SELECT COUNT(*) AS count FROM agent_ask_settlements").get() as { count: number }).count).toBe(0);
    });
  });

  it("amends a named Plan once and refuses a cross-Project target", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({
      workspace,
      request: askForIntent("amend-plan", "plan", "A sharper delivery milestone", "plan/demo-plan")
    });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-amend-plan",
      disposition: "accepted", revision: 1
    });
    runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-amend-plan",
      disposition: "accepted", revision: 1, preview: preview.data.receipt.previewFingerprint, apply: true
    });
    const planPath = path.join(repo, "docs/plans/demo-plan.md");
    expect(readFileSync(planPath, "utf8")).toContain("milestone: A sharper delivery milestone");
    expect(readFileSync(planPath, "utf8").match(/milestone: A sharper delivery milestone/g)).toHaveLength(1);

    const crossProject = runAgentAskPreviewCommand({
      workspace,
      request: askForIntent("cross-project", "action", "Cross Project edit", "another-project/existing", ["Cross Project proof exists."])
    });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: crossProject.data.proposal.id, requestId: "settle-cross-project",
      disposition: "accepted", revision: 1
    })).toThrow("cannot mutate another Project");
    expect(readFileSync(planPath, "utf8")).not.toContain("Cross Project edit");
  });
});

function fixture(): { workspace: string; repo: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-settle-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc(), "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "ask-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Ask Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add Ask fixture"], { cwd: repo });
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Test Agent Ask settlement.", goal: "Settle work safely.",
      status: "active", currentMilestone: "Settlement", nextAction: "Keep going.", workClassification: "codex"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: ["demo/existing"], order: ["demo/existing"], requestId: "fixture-order", apply: true
    });
  });
  return { workspace, repo };
}

function actionAsk(requestId: string): string {
  return [
    "agent_ask: v1",
    `request_id: ${requestId}`,
    "project: demo",
    "intent: action",
    "desired_result: Add settlement proof",
    "rationale: It proves the loop",
    "acceptance:",
    "  - The settlement proof exists.",
    "dependencies: []",
    "requested_authority: apply_if_approved",
    ""
  ].join("\n");
}

function bundleAsk(requestId: string, actions: Array<{ id?: string; desiredResult: string }>): string {
  return [
    "agent_ask: v1",
    `request_id: ${requestId}`,
    "project: demo",
    "intent: action",
    "desired_result: Give every accepted Action a typeable handle",
    "acceptance: []",
    "dependencies: []",
    "actions:",
    ...actions.flatMap((action) => [
      ...(action.id ? [`  - id: ${action.id}`, `    desired_result: ${JSON.stringify(action.desiredResult)}`]
        : [`  - desired_result: ${JSON.stringify(action.desiredResult)}`]),
      "    acceptance:",
      "      - The handle is typeable.",
      "    dependencies: []"
    ]),
    "requested_authority: apply_if_approved",
    ""
  ].join("\n");
}

function multiActionAsk(requestId: string): string {
  return [
    "agent_ask: v1",
    `request_id: ${requestId}`,
    "project: demo",
    "intent: action",
    "desired_result: Deliver a queue-aware release",
    "rationale: It proves one Ask can establish ordered work",
    "acceptance: []",
    "dependencies: []",
    "actions:",
    "  - desired_result: Build release proof",
    "    acceptance:",
    "      - Release proof exists.",
    "    dependencies: []",
    "  - desired_result: Publish release guide",
    "    acceptance:",
    "      - Release guide exists.",
    "    dependencies:",
    "      - build-release-proof",
    "requested_authority: apply_if_approved",
    ""
  ].join("\n");
}

function askForIntent(requestId: string, intent: string, desired: string, targetRef?: string, acceptance: string[] = []): string {
  return [
    "agent_ask: v1", `request_id: ${requestId}`, "project: demo", `intent: ${intent}`,
    `desired_result: ${desired}`, "rationale: It advances the governed Project",
    "acceptance:", ...acceptance.map((criterion) => `  - ${criterion}`),
    "dependencies: []", ...(targetRef ? [`target_ref: ${targetRef}`] : []),
    "requested_authority: apply_if_approved", ""
  ].join("\n");
}

function projectDoc(): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Settle work safely.", "milestone: Settlement", "active_plan: demo-plan", "current_action: existing",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

function planDoc(): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Settlement", "current_action: existing", "token_impact: medium",
    "token_budget: Deterministic settlement with one implementation pass.", "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:", "  - id: existing", "    title: Keep existing work", "    status: open",
    "    responsibility: codex", "    effort: session", "    next_action: Keep existing work moving.",
    "    expected_artifact: Existing proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Existing proof exists.", "    depends_on: []", "    decisions: []",
    "    references: []", "questions: []", "---", "", "# Demo plan", ""].join("\n");
}
