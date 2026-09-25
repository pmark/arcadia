import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_ASK_INTENTS, resolveNaturalAgentAskTarget } from "../src/ask/agentAsk.js";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Agent Ask v1", () => {
  it("normalizes every supported Project-management contribution without Project writes", () => {
    const workspace = initializedWorkspace();
    for (const intent of AGENT_ASK_INTENTS) {
      const request = intent === "plan"
        ? `${strictAsk(`kind-${intent}`, intent)}actions:\n  - desired_result: Deliver the Plan Action\n    acceptance:\n      - Plan Action proof exists.\n    dependencies: []\n`
        : intent === "complete"
          ? `${strictAsk(`kind-${intent}`, intent)}target_ref: action/existing\ncandidate_revision: abadc0deabadc0deabadc0deabadc0deabadc0de\nevidence:\n  - criterion: "Observable proof exists"\n    status: met\n`
          : intent === "split"
            ? `${strictAsk(`kind-${intent}`, intent)}target_ref: action/existing\ncandidate_revision: abadc0deabadc0deabadc0deabadc0deabadc0de\nevidence:\n  - criterion: "Observable proof exists"\n    status: met\nactions:\n  - desired_result: Finish the remainder\n    acceptance:\n      - Remaining proof exists.\n    dependencies: []\n`
            // A project_update must name a field Arcadia can apply; an
            // unapplicable target is refused at preview (Issue #351).
            : intent === "project_update"
              ? `${strictAsk(`kind-${intent}`, intent)}target_ref: milestone\n`
              : strictAsk(`kind-${intent}`, intent);
      const result = runAgentAskPreviewCommand({ workspace, request });
      expect(result.data.proposal.normalized.intent).toBe(intent);
      expect(result.data.proposal.effects[0]?.targetKind).toBe(intent === "auto" ? "interpretation" : intent);
      expect(result.data.projectWritesPerformed).toBe(0);
      expect(result.data.proposal.queueConsequence).toBe("none_until_accepted");
    }
    withDatabase(workspace, (db) => {
      expect((db.prepare("SELECT COUNT(*) AS count FROM work_items").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM review_items").get() as { count: number }).count).toBe(0);
    });
  });

  it("forces agent-authored Decisions open and separately requests apply acceptance", () => {
    const workspace = initializedWorkspace();
    const result = runAgentAskPreviewCommand({ workspace, request: `${strictAsk("decision-one", "decision")}requested_authority: apply_if_approved\n` });
    expect(result.data.proposal.effects[0]?.fields.status).toBe("open");
    expect(result.data.proposal.requiredDecisions).toContain("Accept the exact preview before apply.");
    expect(result.data.proposal.nonActions).toContain("Agent input grants no approval or execution authority.");
  });

  it("accepts a decision Ask filed without options — this must never become a reason a finding cannot be reported", () => {
    const workspace = initializedWorkspace();
    const result = runAgentAskPreviewCommand({ workspace, request: strictAsk("decision-no-options", "decision") });
    expect(result.data.proposal.normalized.options).toEqual([]);
    expect(result.data.proposal.effects[0]?.fields.options).toEqual([]);
  });

  it("carries a decision Ask's options through to the proposed effect, with the recommendation flagged", () => {
    const workspace = initializedWorkspace();
    const request = `${strictAsk("decision-with-options", "decision")}options:\n  - label: Merge now\n    consequence: Ships immediately; no further review.\n    recommended: true\n  - label: Hold for review\n    consequence: Delays the fix by a day.\n`;
    const result = runAgentAskPreviewCommand({ workspace, request });
    expect(result.data.proposal.normalized.options).toEqual([
      { label: "Merge now", consequence: "Ships immediately; no further review.", recommended: true },
      { label: "Hold for review", consequence: "Delays the fix by a day.", recommended: false }
    ]);
    expect(result.data.proposal.effects[0]?.fields.options).toEqual(result.data.proposal.normalized.options);
  });

  it("refuses options on a non-decision intent, and more than one option marked recommended", () => {
    const workspace = initializedWorkspace();
    const withOptions = (intent: string) =>
      `${strictAsk(`kind-${intent}`, intent)}options:\n  - label: A\n    consequence: A happens.\n`;
    expect(() => runAgentAskPreviewCommand({ workspace, request: withOptions("action") })).toThrow(
      "Agent Ask options are only supported for decision intent."
    );
    const twoRecommended = `${strictAsk("decision-two-recommended", "decision")}options:\n  - label: A\n    consequence: A happens.\n    recommended: true\n  - label: B\n    consequence: B happens.\n    recommended: true\n`;
    expect(() => runAgentAskPreviewCommand({ workspace, request: twoRecommended })).toThrow(
      "At most one Agent Ask option may be marked recommended."
    );
  });

  it("previews a Plan amendment, dependencies, and checked-in transition without applying it", () => {
    const workspace = initializedWorkspace();
    const request = `${strictAsk("plan-amendment", "plan").replace("dependencies: []", "dependencies:\n  - work/first")}target_ref: plan/existing\n`;
    const result = runAgentAskPreviewCommand({ workspace, request });
    expect(result.data.proposal.effects[0]).toMatchObject({ operation: "update", targetKind: "plan", targetRef: "plan/existing" });
    expect(result.data.proposal.normalized.dependencies).toEqual(["work/first"]);
    expect(result.data.proposal.managedDocumentTransition).toEqual({ required: true, status: "withheld_until_acceptance", authority: "checked_in_documents" });
    expect(result.data.proposal).toMatchObject({ unchanged: [], conflicts: [], refused: [] });
  });

  it("normalizes only project_update target fields and rejects the legacy goal target", () => {
    const workspace = initializedWorkspace();
    const projectUpdate = runAgentAskPreviewCommand({
      workspace,
      request: `${strictAsk("project-update-case", "project_update")}target_ref: MILESTONE\n`
    });
    expect(projectUpdate.data.proposal.normalized.targetRef).toBe("milestone");
    expect(projectUpdate.data.proposal.effects[0]?.targetRef).toBe("milestone");

    expect(() => runAgentAskPreviewCommand({
      workspace,
      request: `${strictAsk("project-update-goal", "project_update")}target_ref: goal\n`
    })).toThrow(/no apply path/);

    const plan = runAgentAskPreviewCommand({
      workspace,
      request: `${strictAsk("plan-case", "plan")}target_ref: Plan/Existing\n`
    });
    expect(plan.data.proposal.normalized.targetRef).toBe("Plan/Existing");
  });

  it("supports natural fallback only with an explicit id and keeps intent unknown", () => {
    const workspace = initializedWorkspace();
    const result = runAgentAskPreviewCommand({ workspace, request: "Make the release safer.", requestId: "natural-1" });
    expect(result.data.proposal.normalized).toMatchObject({ format: "natural", intent: "auto", project: "unknown" });
    expect(result.data.proposal.requiredDecisions).toContain("Confirm the proposed Arcadia structure after interpretation.");
    expect(() => runAgentAskPreviewCommand({ workspace, request: "No id" })).toThrow("requires --request-id");
  });

  it("refuses an unknown explicit Project before capture", () => {
    const workspace = initializedWorkspace();
    const request = strictAsk("missing-project", "action").replace("project: unknown", "project: not-a-project");
    expect(() => runAgentAskPreviewCommand({ workspace, request })).toThrow("destination Project was not found");
    withDatabase(workspace, (db) => {
      expect((db.prepare("SELECT COUNT(*) AS count FROM ask_capture_envelopes").get() as { count: number }).count).toBe(0);
    });
  });

  it("returns a byte-stable replay and refuses changed content under the same id", () => {
    const workspace = initializedWorkspace();
    const request = strictAsk("replay-1", "action");
    const first = runAgentAskPreviewCommand({ workspace, request });
    const replay = runAgentAskPreviewCommand({ workspace, request });
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.proposal).toEqual(first.data.proposal);
    expect(() => runAgentAskPreviewCommand({ workspace, request: request.replace("Deliver the result", "Deliver a changed result") }))
      .toThrow("already used with different content");
  });

  it("rejects unknown fields and authority claims before capture writes", () => {
    const workspace = initializedWorkspace();
    expect(() => runAgentAskPreviewCommand({ workspace, request: `${strictAsk("unsafe-1", "action")}approved: true\n` })).toThrow("unknown fields");
    expect(() => runAgentAskPreviewCommand({ workspace, request: `${strictAsk("unsafe-2", "action")}requested_authority: execute\n` })).toThrow("cannot claim");
    withDatabase(workspace, (db) => {
      expect((db.prepare("SELECT COUNT(*) AS count FROM ask_capture_envelopes").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM agent_ask_proposals").get() as { count: number }).count).toBe(0);
    });
  });

  it("rejects malformed strict YAML rather than treating it as natural input", () => {
    const workspace = initializedWorkspace();
    expect(() => runAgentAskPreviewCommand({ workspace, request: "agent_ask: v1\nrequest_id: [broken\n" })).toThrow("invalid YAML");
  });

  it("previews each structured Action and rejects speculative nested fields", () => {
    const workspace = initializedWorkspace();
    const request = `${strictAsk("multi-action", "action")}actions:\n  - desired_result: Build proof\n    acceptance:\n      - Proof exists\n    dependencies: []\n  - desired_result: Publish guide\n    acceptance:\n      - Guide exists\n    dependencies:\n      - build-proof\n`;
    const result = runAgentAskPreviewCommand({ workspace, request });
    expect(result.data.proposal.effects).toHaveLength(2);
    expect(result.data.proposal.normalized.actions.map((action) => action.desiredResult)).toEqual(["Build proof", "Publish guide"]);
    expect(result.data.preview.filter((line) => line.startsWith("Proposed effect"))).toHaveLength(2);
    expect(() => runAgentAskPreviewCommand({
      workspace,
      request: request.replace("    dependencies: []", "    dependencies: []\n    approved: true")
    })).toThrow("action contains unknown fields");
  });

  it("accepts Plan-shaped Actions with shared references and per-Action amendment targets", () => {
    const workspace = initializedWorkspace();
    const request = [
      "agent_ask: v1", "request_id: plan-shaped", "project: unknown", "intent: plan",
      "desired_result: Deliver the release", "acceptance: []", "dependencies: []",
      "references:", "  - docs/release.md", "target_ref: plan/release",
      "actions:",
      "  - desired_result: Build the release", "    acceptance:", "      - Build passes.",
      "    dependencies: []", "    references:", "      - src/release.ts",
      "  - target_ref: action/publish", "    desired_result: Publish the release",
      "    acceptance:", "      - Release is published.", "    dependencies:", "      - build-the-release",
      "    references: []", "requested_authority: apply_if_approved", ""
    ].join("\n");
    const result = runAgentAskPreviewCommand({ workspace, request });
    expect(result.data.proposal.normalized).toMatchObject({ intent: "plan", targetRef: "plan/release", references: ["docs/release.md"] });
    expect(result.data.proposal.normalized.actions).toEqual([
      {
        id: null, desiredResult: "Build the release", acceptance: ["Build passes."], dependencies: [],
        references: ["src/release.ts"], targetRef: null
      },
      {
        id: null, desiredResult: "Publish the release", acceptance: ["Release is published."],
        dependencies: ["build-the-release"], references: [], targetRef: "action/publish"
      }
    ]);
    expect(result.data.proposal.effects.map((effect) => effect.operation)).toEqual(["update", "update"]);
  });

  it("refuses an untargeted Plan without governed Actions", () => {
    const workspace = initializedWorkspace();
    expect(() => runAgentAskPreviewCommand({ workspace, request: strictAsk("empty-plan", "plan") }))
      .toThrow("requires at least one governed Action");
  });
});

function strictAsk(requestId: string, intent: string): string {
  return `agent_ask: v1\nrequest_id: ${requestId}\nproject: unknown\nintent: ${intent}\ndesired_result: Deliver the result\nrationale: It advances the Project\nacceptance:\n  - Observable proof exists\ndependencies: []\n`;
}

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

describe("Natural Agent Ask target resolution", () => {
  it("resolves a plain-text request naming an existing Plan slug", () => {
    const { workspace, repo } = naturalTargetFixture();
    const result = runAgentAskPreviewCommand({
      workspace, dir: repo, requestId: "resolve-plan", project: "demo",
      request: "Please reactivate the demo-plan effort so it starts moving again."
    });
    expect(result.data.proposal.normalized.intent).toBe("auto");
    expect(result.data.proposal.effects[0]?.targetKind).toBe("plan");
    expect(result.data.proposal.effects[0]?.operation).toBe("update");
    expect(result.data.proposal.effects[0]?.targetRef).toBe("plan/demo-plan");
    expect(result.data.proposal.requiredDecisions[0]).toContain("Plan demo-plan");
  });

  it("resolves a plain-text request naming an existing Action id inside its Plan", () => {
    const { workspace, repo } = naturalTargetFixture();
    const result = runAgentAskPreviewCommand({
      workspace, dir: repo, requestId: "resolve-action", project: "demo",
      request: "The keep-existing-work Action in demo-plan needs another look before it ships."
    });
    expect(result.data.proposal.effects[0]?.targetKind).toBe("action");
    expect(result.data.proposal.effects[0]?.targetRef).toBe("plan/demo-plan#keep-existing-work");
    expect(result.data.proposal.effects[0]?.fields.resolvedLabel).toBe("Action keep-existing-work in Plan demo-plan");
  });

  it("resolves a plain-text request naming an existing Decision id", () => {
    const { workspace, repo } = naturalTargetFixture();
    const result = runAgentAskPreviewCommand({
      workspace, dir: repo, requestId: "resolve-decision", project: "demo",
      request: "Follow up on Decision 0001 once the operator has time."
    });
    expect(result.data.proposal.effects[0]?.targetKind).toBe("decision");
    expect(result.data.proposal.effects[0]?.targetRef).toBe("0001");
  });

  it("leaves an unresolvable request on the existing interpretation path, with no candidates considered", () => {
    const { workspace, repo } = naturalTargetFixture();
    const result = runAgentAskPreviewCommand({
      workspace, dir: repo, requestId: "resolve-none", project: "demo",
      request: "Something entirely unrelated to anything already in this repository."
    });
    expect(result.data.proposal.effects[0]?.targetKind).toBe("interpretation");
    expect(result.data.proposal.requiredDecisions[0]).toBe("Confirm the proposed Arcadia structure after interpretation.");
    expect(result.data.proposal.refused).toEqual([]);
  });

  it("does not resolve against an uncommitted Plan, or an uncommitted edit that adds an Action to a committed Plan", () => {
    const { workspace, repo } = naturalTargetFixture();
    // An untracked new Plan file.
    writeFileSync(path.join(repo, "docs/plans/uncommitted-plan.md"), planDoc().replaceAll("demo-plan", "uncommitted-plan"));
    // An uncommitted edit to the already-tracked demo-plan.md that adds a new Action.
    const withExtraAction = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")
      .replace("    references: []\nquestions: []", "    references: []\n  - id: uncommitted-new-action\n    title: Not yet committed\n    status: open\n    responsibility: codex\n    effort: session\n    next_action: Not yet committed.\n    expected_artifact: n/a\n    clarification: clarified\n    confidence: high\n    acceptance_criteria:\n      - n/a\n    depends_on: []\n    decisions: []\n    references: []\nquestions: []");
    writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), withExtraAction);

    const planResult = runAgentAskPreviewCommand({
      workspace, dir: repo, requestId: "resolve-uncommitted-plan", project: "demo",
      request: "Please reactivate the uncommitted-plan effort."
    });
    expect(planResult.data.proposal.effects[0]?.targetKind).toBe("interpretation");

    const actionResult = runAgentAskPreviewCommand({
      workspace, dir: repo, requestId: "resolve-uncommitted-action", project: "demo",
      request: "The uncommitted-new-action Action needs another look before it ships."
    });
    expect(actionResult.data.proposal.effects[0]?.targetKind).toBe("interpretation");
  });

  it("falls back to the interpretation path when the request names conflicting Plan and Action references, and names both in the receipt", () => {
    const { workspace, repo } = naturalTargetFixture();
    writeFileSync(path.join(repo, "docs/plans/other-plan.md"),
      planDoc().replaceAll("demo-plan", "other-plan").replaceAll("  - id: keep-existing-work", "  - id: other-action").replaceAll("current_action: keep-existing-work", "current_action: other-action"));
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Add conflicting Plan"], { cwd: repo });
    const result = runAgentAskPreviewCommand({
      workspace, dir: repo, requestId: "resolve-ambiguous", project: "demo",
      request: "The keep-existing-work Action does not belong to other-plan, but both are named here."
    });
    expect(result.data.proposal.effects[0]?.targetKind).toBe("interpretation");
    expect(result.data.proposal.refused).toEqual(expect.arrayContaining(["Action keep-existing-work in Plan demo-plan", "Plan other-plan"]));
  });

  it("replays byte-stably for a resolved plan, action, decision, unresolvable, and ambiguous request", () => {
    const { workspace, repo } = naturalTargetFixture();
    writeFileSync(path.join(repo, "docs/plans/other-plan.md"),
      planDoc().replaceAll("demo-plan", "other-plan").replaceAll("  - id: keep-existing-work", "  - id: other-action").replaceAll("current_action: keep-existing-work", "current_action: other-action"));
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Add conflicting Plan"], { cwd: repo });
    const cases: Array<{ requestId: string; request: string }> = [
      { requestId: "replay-plan", request: "Please reactivate the demo-plan effort." },
      { requestId: "replay-action", request: "The keep-existing-work Action in demo-plan needs another look." },
      { requestId: "replay-decision", request: "Follow up on Decision 0001." },
      { requestId: "replay-none", request: "Something entirely unrelated to this repository." },
      { requestId: "replay-ambiguous", request: "The keep-existing-work Action does not belong to other-plan, but both are named here." }
    ];
    for (const testCase of cases) {
      const first = runAgentAskPreviewCommand({ workspace, dir: repo, requestId: testCase.requestId, project: "demo", request: testCase.request });
      const second = runAgentAskPreviewCommand({ workspace, dir: repo, requestId: testCase.requestId, project: "demo", request: testCase.request });
      expect(second.data.replayed).toBe(true);
      expect(second.data.proposal).toEqual(first.data.proposal);
    }
  });
});

describe("resolveNaturalAgentAskTarget (unit)", () => {
  const context = {
    plans: [{ slug: "demo-plan" }],
    actions: [{ id: "keep-existing-work", planSlug: "demo-plan" }],
    decisions: [{ id: "0001", slug: "existing-decision" }]
  };

  it("does not match a substring of a longer identifier", () => {
    const result = resolveNaturalAgentAskTarget("The existing-decisions-followup effort is unrelated.", context);
    expect(result.resolved).toBeNull();
  });

  it("does not treat a longer numeric string as matching a shorter Decision id", () => {
    const result = resolveNaturalAgentAskTarget("See PR 10001 for details.", context);
    expect(result.resolved).toBeNull();
  });

  it("does not match a Decision id with a letter immediately adjacent", () => {
    const result = resolveNaturalAgentAskTarget("See file x0001 for the archived copy.", context);
    expect(result.resolved).toBeNull();
  });

  it("never resolves a single-word Action id, since it is indistinguishable from ordinary prose", () => {
    const wordLikeContext = { ...context, actions: [{ id: "existing", planSlug: "demo-plan" }] };
    const result = resolveNaturalAgentAskTarget("Review the existing process before shipping.", wordLikeContext);
    expect(result.resolved).toBeNull();
  });
});

function naturalTargetFixture(): { workspace: string; repo: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-natural-target-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), [
    "---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Resolve natural Agent Asks against existing documents.", "milestone: Resolution",
    "active_plan: demo-plan", "current_action: keep-existing-work", "updated: 2026-09-01", "---", "", "# Demo", ""
  ].join("\n"), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc(), "utf8");
  writeFileSync(path.join(repo, "docs/decisions/0001-existing-decision.md"), [
    "---", "arcadia: v1", "type: decision", 'id: "0001"', "slug: existing-decision", "project: demo",
    "status: open", "question: An existing open decision", "updated: 2026-09-01", "---", "",
    "# Decision 0001: An existing open decision", ""
  ].join("\n"), "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "ask-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Ask Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add natural target fixture"], { cwd: repo });
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Resolve natural Agent Asks against existing documents.", goal: "Resolve targets safely.",
      status: "active", currentMilestone: "Resolution", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
  });
  return { workspace, repo };
}

function planDoc(): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Resolution", "current_action: keep-existing-work", "token_impact: medium",
    "token_budget: Deterministic resolution with one implementation pass.", "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:", "  - id: keep-existing-work", "    title: Keep existing work", "    status: open",
    "    responsibility: codex", "    effort: session", "    next_action: Keep existing work moving.",
    "    expected_artifact: Existing proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Existing proof exists.", "    depends_on: []", "    decisions: []",
    "    references: []", "questions: []", "---", "", "# Demo plan", ""].join("\n");
}
