import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleArcadiaMessage } from "../apps/discord-bot/src/events/messageCreate.js";
import type { ArcadiaCli } from "../apps/discord-bot/src/arcadia/cli.js";
import { requiresReviewApproveCommand } from "../apps/discord-bot/src/commands/requiresReview.js";
import { runAskCommand } from "../src/commands/ask.js";
import { runReviewApproveCommand, runReviewResolveReplyCommand } from "../src/commands/review.js";
import { runAskCoverageCommand } from "../src/commands/askCoverage.js";
import { renderTodoSuccess, runTodoCommand, TODO_ASK_CAP, TODO_OTHER_CAP, type TodoCommandOptions } from "../src/commands/todo.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, createReviewItem, upsertProjectMetadata } from "../src/db/repositories.js";
import { intakeRoutingFlags, isImperativeRequest, resolveIntake, type IntakeWorkspaceContext } from "../src/intake/index.js";
import { ACKNOWLEDGEMENTS, isTrivialAcknowledgement } from "../src/ask/suppression.js";
import { formatOperatorTodoLines } from "../src/orientation/operatorTodoLines.js";
import { askRoutingV2Enabled, askRoutingV2Setting } from "../src/workspace/config.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const NOW = new Date();
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `arcadia-ask-v2-${prefix}-`));
  roots.push(root);
  return root;
}

function workspaceWithArcadia(): string {
  const workspace = temp("ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Turn intent into governed work.",
      goal: "Make Ask trustworthy.",
      status: "active",
      currentMilestone: "Visible Asks",
      nextAction: "Show every Ask.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, {
      projectId: created.project.id,
      aliases: ["Arcadia"],
      repoPath: workspace,
      validationCommands: ["node -e \"process.exit(0)\""]
    });
  });
  return workspace;
}

/** `ask.routing.v2` is the nested workspace config key `ask: { routing: { v2 } }`. */
function setRoutingV2(workspace: string, value: unknown): void {
  const configPath = path.join(workspace, "config", "arcadia.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.ask = { routing: { v2: value } };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function todo(workspace: string, options: Partial<TodoCommandOptions> = {}) {
  return runTodoCommand({ workspace, now: NOW, fixtureRoots: [], ...options });
}

function askRow(workspace: string, askId: string | undefined) {
  return withDatabase(workspace, (db) =>
    db.prepare("SELECT output_kind, suppressed_reason, recurrence_flag, planning_flag FROM ask_requests WHERE id = ?").get(askId)
  ) as { output_kind: string; suppressed_reason: string | null; recurrence_flag: number; planning_flag: number };
}

// One text per intake classification that is not an Idea and matches no execution pattern.
const NOT_AN_IDEA: Array<{ classification: string; text: string }> = [
  { classification: "IncubatingThought", text: "Sourdough starter notes for Sunday" },
  { classification: "BugReport", text: "The sidebar is broken on mobile" },
  { classification: "ArcadiaFeedback", text: "The review noise is annoying" },
  { classification: "Question", text: "Why is the sidebar so slow?" },
  { classification: "ClarificationResponse", text: "It is the staging database" },
  { classification: "ReviewResponse", text: "yes" }
];

describe("ask.routing.v2: an operator Ask is never shelved unseen", () => {
  it.each(NOT_AN_IDEA)("sends a $classification Ask to Clarify First, a review_item that arcadia todo lists with an ask-origin answer", ({ classification, text }) => {
    const workspace = workspaceWithArcadia();
    const asked = runAskCommand({ workspace, request: text });

    expect(asked.data.intake.classification).toBe(classification);
    expect(asked.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    expect(asked.data.backBurnerItemId).toBeNull();
    expect(asked.data.reviewItemId).toMatch(/^review_/);
    expect(askRow(workspace, asked.data.ask?.id).output_kind).toBe("requires_review");

    const listed = todo(workspace).data.items.find((item) => item.key.endsWith(`/${asked.data.reviewItemId}`));
    expect(listed).toMatchObject({
      kind: "review_item",
      askQuestion: true,
      origin: `ask:${asked.data.ask?.id} via:ask`,
      answer: `arcadia review approve ${asked.data.reviewItemId} --no-execute`
    });
    expect(listed?.answerVia).toContain(`reject if it is not wanted: arcadia review reject ${asked.data.reviewItemId}`);
    expect(listed?.title).toContain(text);
  });

  it("still shelves an Idea, and anything the operator passes --back-burner for", () => {
    const workspace = workspaceWithArcadia();
    const idea = runAskCommand({ workspace, request: "Maybe creator partnerships could help someday." });
    expect(idea.data.intake.classification).toBe("Idea");
    expect(idea.data.stewardship.recommendedExecutionPath).toBe("Back Burner");
    expect(idea.data.backBurnerItemId).toMatch(/^bb_/);

    const explicit = runAskCommand({ workspace, request: "Sourdough starter notes for Sunday", captureAsIdea: true });
    expect(explicit.data.stewardship.recommendedExecutionPath).toBe("Back Burner");
    expect(explicit.data.backBurnerItemId).toMatch(/^bb_/);
  });

  it("sends a Review Response with no resolvable reference to Clarify First instead of the Back Burner", () => {
    const workspace = workspaceWithArcadia();
    const reply = runAskCommand({ workspace, request: "approve" });
    expect(reply.data.stewardship.intentType).toBe("Review Response");
    expect(reply.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    expect(reply.data.stewardship.classificationReason).toContain("names no Decision");
    expect(reply.data.backBurnerItemId).toBeNull();
    expect(todo(workspace).data.counts.askQuestions).toBe(1);
  });

  it("keeps every other route unchanged for an imperative request", () => {
    const request = "Improve UX of the Arcadia Runs page";
    const on = workspaceWithArcadia();
    const off = workspaceWithArcadia();
    setRoutingV2(off, false);
    const routed = runAskCommand({ workspace: on, request });
    const earlier = runAskCommand({ workspace: off, request });
    expect(routed.data.stewardship.recommendedExecutionPath).toBe(earlier.data.stewardship.recommendedExecutionPath);
    expect(routed.data.stewardship.intentType).toBe(earlier.data.stewardship.intentType);
    expect(routed.data.workItem === null).toBe(earlier.data.workItem === null);
    expect(routed.data.backBurnerItemId).toBeNull();
  });

  it("restores today's routing when ask.routing.v2 is false (the rollback)", () => {
    const workspace = workspaceWithArcadia();
    setRoutingV2(workspace, false);
    expect(askRoutingV2Enabled(workspace)).toBe(false);

    for (const { text } of NOT_AN_IDEA) {
      const asked = runAskCommand({ workspace, request: text });
      expect(asked.data.stewardship.recommendedExecutionPath, text).toBe("Back Burner");
      expect(asked.data.backBurnerItemId, text).toMatch(/^bb_/);
    }
    // No acknowledgement or duplicate suppression either: every message is stored as it was.
    const thanks = runAskCommand({ workspace, request: "thanks" });
    expect(thanks.data.backBurnerItemId).toMatch(/^bb_/);
    expect(askRow(workspace, thanks.data.ask?.id).suppressed_reason).toBeNull();
    expect(todo(workspace).data.counts.askQuestions).toBe(0);
  });

  it("defaults to on, accepts an explicit true, and refuses a malformed flag instead of guessing", () => {
    const workspace = workspaceWithArcadia();
    expect(askRoutingV2Enabled(workspace)).toBe(true);
    setRoutingV2(workspace, true);
    expect(askRoutingV2Enabled(workspace)).toBe(true);
    setRoutingV2(workspace, "off");
    expect(() => askRoutingV2Enabled(workspace)).toThrow("ask.routing.v2 must be a boolean");
  });

  it("keeps today's routing for an agent-sourced Ask (agent.ask, codex.*), even with the flag on", () => {
    const workspace = workspaceWithArcadia();
    for (const sourceIngress of ["agent.ask", "codex.dogfood"]) {
      const asked = runAskCommand({ workspace, request: `Sourdough starter notes for Sunday via ${sourceIngress}`, sourceIngress });
      expect(asked.data.stewardship.recommendedExecutionPath, sourceIngress).toBe("Back Burner");
      expect(asked.data.backBurnerItemId, sourceIngress).toMatch(/^bb_/);
    }
    // Nor is an agent's "thanks" suppressed: agent envelopes are never operator input.
    const agentThanks = runAskCommand({ workspace, request: "thanks", sourceIngress: "agent.ask" });
    expect(agentThanks.data.backBurnerItemId).toMatch(/^bb_/);
  });

  it("gives the Discord surfaces and Ingress the same routing as the CLI", () => {
    const workspace = workspaceWithArcadia();
    for (const sourceIngress of ["discord.message", "discord.request", "ingress:icloud"]) {
      const asked = runAskCommand({ workspace, request: `Sourdough starter notes ${sourceIngress}`, sourceIngress });
      expect(asked.data.stewardship.recommendedExecutionPath, sourceIngress).toBe("Clarify First");
      expect(asked.data.reviewItemId, sourceIngress).toMatch(/^review_/);
    }
  });

  it("routes a Discord free-text message through the same code: the bot's cli.ask is the Arcadia ask command", async () => {
    const workspace = workspaceWithArcadia();
    let reply = "";
    const cli = {
      ask: async (request: string, options?: { sourceIngress?: string }) => ({
        ok: true,
        command: "ask",
        data: runAskCommand({ workspace, request, sourceIngress: options?.sourceIngress }).data
      })
    } as unknown as ArcadiaCli;
    const message = {
      content: "Sourdough starter notes for Sunday",
      guildId: "guild",
      channelId: "channel",
      author: { bot: false, id: "user_1" },
      react: async () => {},
      reference: null,
      reply: async (content: string) => {
        reply = content;
      }
    } as never;

    await handleArcadiaMessage(message, {
      arcadiaWorkspace: workspace,
      discordBotToken: "token",
      discordClientId: "client",
      discordGuildId: "guild",
      discordChannelId: "channel",
      arcadiaCliPath: null,
      pollIntervalSeconds: 60
    }, cli);

    expect(reply).toContain("Stewardship: Project Work -> Clarify First");
    expect(reply).toMatch(/Requires Review: `review_/);
    expect(reply).not.toContain("Back Burner:");
    const stored = withDatabase(workspace, (db) =>
      db.prepare("SELECT ce.ingress_source FROM ask_requests ar JOIN ask_capture_envelopes ce ON ce.id = ar.capture_id").get()
    ) as { ingress_source: string };
    expect(stored.ingress_source).toBe("discord.message");
  });
});

describe("intake: the operator's own phrasings are work, and two flags are recorded", () => {
  it.each([
    "I should be able to Ask Arcadia to schedule a recurring action",
    "I want to be able to pin a message",
    "I want to pin a message",
    "Let me rename an item",
    "It would be good if the sidebar remembered its width"
  ])("recognises %j as a request for work", (phrase) => {
    expect(isImperativeRequest(phrase, true)).toBe(true);
  });

  it("recognises the new phrasings only for an operator Ask under ask.routing.v2", () => {
    expect(isImperativeRequest("It would be good if Arcadia loaded the sidebar faster")).toBe(false);
    expect(isImperativeRequest("I want to pin a message")).toBe(false);
    expect(isImperativeRequest("Let me rename an item")).toBe(true);
  });

  it("does not take a statement that merely contains those words for a request", () => {
    expect(isImperativeRequest("Someone said I should be able to", true)).toBe(false);
    expect(isImperativeRequest("The outlet would be good if", true)).toBe(false);
  });

  it("captures the operator's example as work, not as a shelved thought", () => {
    const workspace = workspaceWithArcadia();
    const example = "I should be able to Ask Arcadia to schedule a recurring action";
    const asked = runAskCommand({ workspace, request: example });
    expect(asked.data.stewardship.recommendedExecutionPath).not.toBe("Back Burner");
    expect(asked.data.backBurnerItemId).toBeNull();
    expect(asked.data.workItem).not.toBeNull();
    expect(asked.data.intake.extractedFields.recurrence).toBe("true");

    // With no Project named it is one visible question rather than work for a Project it cannot name.
    const unnamed = runAskCommand({ workspace, request: "I should be able to schedule a recurring action" });
    expect(unnamed.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    expect(unnamed.data.backBurnerItemId).toBeNull();
  });

  it.each(["every", "daily", "weekly", "monthly", "recurring", "schedule"])("sets recurrence for %s", (word) => {
    expect(intakeRoutingFlags(`Please send the report ${word} to me`)).toMatchObject({ recurrence: "true" });
  });

  it("sets planning exactly when the planningRecommended pattern matches, and never recurrence for other words", () => {
    expect(intakeRoutingFlags("Plan the workflow migration")).toEqual({ planning: "true" });
    expect(intakeRoutingFlags("Sourdough starter notes")).toEqual({});
    expect(intakeRoutingFlags("Review the scheduled job")).toEqual({});
  });

  it("records both flags in extractedFields and stores them on ask_requests for the report", () => {
    const context: IntakeWorkspaceContext = { projects: [], templates: [] } as unknown as IntakeWorkspaceContext;
    const result = resolveIntake("Every week publish the workflow roadmap", context);
    expect(result.extractedFields).toMatchObject({ recurrence: "true", planning: "true" });

    const workspace = workspaceWithArcadia();
    const flagged = runAskCommand({ workspace, request: "Notes on a weekly workflow roadmap" });
    expect(askRow(workspace, flagged.data.ask?.id)).toMatchObject({ recurrence_flag: 1, planning_flag: 1 });
    const plain = runAskCommand({ workspace, request: "Sourdough starter notes for Sunday" });
    expect(askRow(workspace, plain.data.ask?.id)).toMatchObject({ recurrence_flag: 0, planning_flag: 0 });

    const report = runAskCoverageCommand({ workspace, ingressRoot: temp("ingress") }).data;
    expect(report.routing).toMatchObject({ asks: 2, recurrence: 1, planning: 1 });
  });
});

describe("ask.routing.v2: only an acknowledgement or an exact open duplicate creates no question", () => {
  it("lists a closed set, and never bare 'done'", () => {
    expect(ACKNOWLEDGEMENTS).toEqual(["thanks", "thank you", "ok", "okay", "got it", "ack"]);
    expect(ACKNOWLEDGEMENTS).not.toContain("done");
  });

  it.each(["thanks", "Thanks!", "  THANK YOU.  ", "ok", "OK...", "Okay", "got it", "Got it!!", "ack", "👍", "👍🏽 🎉", "❤️"])(
    "treats %j as an acknowledgement",
    (message) => {
      expect(isTrivialAcknowledgement(message)).toBe(true);
    }
  );

  it.each(["done", "Done.", "ok, ship X", "thanks, now ship X", "ok ok", "thank you very much", "ok 👍", "", "   ", "okay?!x"])(
    "does not treat %j as an acknowledgement",
    (message) => {
      expect(isTrivialAcknowledgement(message)).toBe(false);
    }
  );

  it("creates no question for an acknowledgement, says why in the receipt, and counts it as suppressed", () => {
    const workspace = workspaceWithArcadia();
    const thanks = runAskCommand({ workspace, request: "Thanks!" });

    expect(thanks.data.result).toEqual({
      status: "ignored",
      summary: "Suppressed: the whole message is an acknowledgement, so no new question was created."
    });
    expect(thanks.data.reviewItemId).toBeNull();
    expect(thanks.data.suppressed).toEqual({ reason: "acknowledgement", openQuestionId: null });
    expect(thanks.data.backBurnerItemId).toBeNull();
    expect(askRow(workspace, thanks.data.ask?.id)).toMatchObject({ output_kind: "suppressed", suppressed_reason: "acknowledgement" });
    // The words are still preserved in the capture envelope.
    expect(thanks.data.captureEnvelope.originalText).toBe("Thanks!");
    expect(todo(workspace).data.counts.askQuestions).toBe(0);

    runAskCommand({ workspace, request: "👍" });
    const report = runAskCoverageCommand({ workspace, ingressRoot: temp("ingress") }).data;
    expect(report.routing.suppressed).toEqual({ total: 2, acknowledgement: 2, duplicate: 0 });
  });

  it("treats 'done' as a real Ask, since it may be a completion report", () => {
    const workspace = workspaceWithArcadia();
    const done = runAskCommand({ workspace, request: "done" });
    expect(done.data.reviewItemId).toMatch(/^review_/);
    expect(askRow(workspace, done.data.ask?.id).suppressed_reason).toBeNull();
    expect(todo(workspace).data.counts.askQuestions).toBe(1);
  });

  it("never suppresses 'ok, ship X'", () => {
    const workspace = workspaceWithArcadia();
    const ship = runAskCommand({ workspace, request: "ok, ship the sidebar change" });
    expect(ship.data.reviewItemId).toMatch(/^review_/);
    expect(askRow(workspace, ship.data.ask?.id).suppressed_reason).toBeNull();
  });

  it("suppresses an exact duplicate of an open Ask question within 24 hours, pointing at the open question", () => {
    const workspace = workspaceWithArcadia();
    const first = runAskCommand({ workspace, request: "Sourdough starter notes for Sunday" });
    const again = runAskCommand({ workspace, request: "  Sourdough starter notes for Sunday  " });

    expect(again.data.result.status).toBe("ignored");
    expect(again.data.result.summary).toContain("an identical question");
    expect(again.data.reviewItemId).toBeNull();
    expect(again.data.suppressed).toEqual({ reason: `duplicate:${first.data.reviewItemId}`, openQuestionId: first.data.reviewItemId });
    expect(askRow(workspace, again.data.ask?.id)).toMatchObject({
      output_kind: "suppressed",
      suppressed_reason: `duplicate:${first.data.reviewItemId}`
    });
    expect(todo(workspace).data.counts.askQuestions).toBe(1);

    // A different sentence is not a duplicate.
    const different = runAskCommand({ workspace, request: "Sourdough starter notes for Monday" });
    expect(different.data.reviewItemId).not.toBe(first.data.reviewItemId);

    const report = runAskCoverageCommand({ workspace, ingressRoot: temp("ingress") }).data;
    expect(report.routing.suppressed).toEqual({ total: 1, acknowledgement: 0, duplicate: 1 });
    expect(report.routing.asks).toBe(3);
  });

  it("asks again once the earlier question is older than 24 hours or no longer open", () => {
    const workspace = workspaceWithArcadia();
    const text = "Sourdough starter notes for Sunday";
    const first = runAskCommand({ workspace, request: text });
    withDatabase(workspace, (db) =>
      db.prepare("UPDATE review_items SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), first.data.reviewItemId)
    );
    const stale = runAskCommand({ workspace, request: text });
    expect(stale.data.reviewItemId).not.toBe(first.data.reviewItemId);
    expect(askRow(workspace, stale.data.ask?.id).suppressed_reason).toBeNull();

    withDatabase(workspace, (db) =>
      db.prepare("UPDATE review_items SET status = 'rejected' WHERE ask_request_id IS NOT NULL").run()
    );
    const closed = runAskCommand({ workspace, request: text });
    expect(closed.data.reviewItemId).not.toBe(stale.data.reviewItemId);
    expect(askRow(workspace, closed.data.ask?.id).suppressed_reason).toBeNull();
  });
});

describe("arcadia todo: Yours, Agents are doing, and the Back Burner count", () => {
  function insertPlainReview(workspace: string, index: number): void {
    withDatabase(workspace, (db) => {
      createReviewItem(db, {
        decisionNeeded: `Plain review question ${index}`,
        recommendation: "Decide.",
        sourceInput: `plain source ${index}`,
        proposedAction: "Decide",
        resolvedIntent: "SomethingElse",
        confidenceLabel: "low",
        confidence: 0.1,
        missingFields: [],
        context: {}
      });
    });
  }

  it("renders the Yours and Agents are doing sections, the Ask group, and the Back Burner counts line", () => {
    const workspace = workspaceWithArcadia();
    runAskCommand({ workspace, request: "Sourdough starter notes for Sunday" });
    runAskCommand({ workspace, request: "Maybe creator partnerships could help someday." });
    const old = runAskCommand({ workspace, request: "Maybe a podcast about gardening could be worth exploring someday." });
    withDatabase(workspace, (db) =>
      db.prepare("UPDATE back_burner_items SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), old.data.backBurnerItemId)
    );

    const response = todo(workspace);
    const lines = renderTodoSuccess(response);

    expect(response.data.counts.backBurner).toEqual({ incubating: 2, newInSevenDays: 1 });
    expect(lines).toContain("Yours");
    expect(lines).toContain("Your Asks need one answer (1):");
    expect(lines).toContain("Agents are doing");
    expect(lines).toContain("Back Burner: 2 incubating (1 new in 7 days)");
    expect(lines).toContain("  0 in flight: arcadia todo --agents lists them");
    expect(lines.indexOf("Yours")).toBeLessThan(lines.indexOf("Your Asks need one answer (1):"));
    expect(lines.indexOf("Your Asks need one answer (1):")).toBeLessThan(lines.indexOf("Agents are doing"));
    // Existing Back Burner items are counted, not moved or changed.
    expect(withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM back_burner_items WHERE status IN ('incubating','opportunistic')").get())).toEqual({ n: 2 });
  });

  it("lists the newest five Ask questions and always shows the full count, whatever the other-items cap hides", () => {
    const workspace = workspaceWithArcadia();
    const keys: string[] = [];
    for (let index = 1; index <= 7; index += 1) {
      const asked = runAskCommand({ workspace, request: `Sourdough starter notes number ${index}` });
      withDatabase(workspace, (db) =>
        db.prepare("UPDATE review_items SET created_at = ? WHERE id = ?").run(`2026-10-0${index}T00:00:00.000Z`, asked.data.reviewItemId)
      );
      keys.push(`review_item:unknown/${asked.data.reviewItemId}`);
    }
    for (let index = 1; index <= TODO_OTHER_CAP + 2; index += 1) insertPlainReview(workspace, index);

    const capped = todo(workspace);
    const listedAsks = capped.data.items.filter((item) => item.askQuestion).map((item) => item.key);
    expect(TODO_ASK_CAP).toBe(5);
    expect(listedAsks).toEqual(keys.slice(2).reverse());
    expect(capped.data.counts.askQuestions).toBe(7);
    expect(capped.data.counts.askHidden).toBe(2);
    // The other-items cap hides plain items only; it never hides an Ask question.
    expect(capped.data.items.filter((item) => !item.askQuestion && !item.blocking)).toHaveLength(TODO_OTHER_CAP);
    expect(capped.data.counts.hidden).toBe(2);
    const lines = renderTodoSuccess(capped);
    expect(lines).toContain("Your Asks need one answer (7):");
    expect(lines).toContain("  2 more Ask question(s): --all");

    const all = todo(workspace, { all: true });
    expect(all.data.items.filter((item) => item.askQuestion)).toHaveLength(7);
    expect(all.data.counts.askHidden).toBe(0);
  });

  it("never collapses an Ask question into a count because its Project has no repo_path", () => {
    const workspace = workspaceWithArcadia();
    withDatabase(workspace, (db) => {
      db.prepare("UPDATE project_metadata SET repo_path = NULL").run();
    });
    const asked = runAskCommand({ workspace, request: "Sourdough starter notes for Sunday", project: "Arcadia" });
    expect(asked.data.reviewItemId).toMatch(/^review_/);
    const response = todo(workspace);
    expect(response.data.counts.askQuestions).toBe(1);
    expect(response.data.items.map((item) => item.key)).toContain(`review_item:${response.data.items[0].project}/${asked.data.reviewItemId}`);
  });

  it("counts in-flight agent work and lists it with --agents", () => {
    const workspace = workspaceWithArcadia();
    withDatabase(workspace, (db) => {
      db.prepare(
        "INSERT INTO execution_runs (id, status, summary, executor_name, created_at, updated_at) VALUES ('run_a', 'running', 'Doing the thing', 'claude-code', ?, ?)"
      ).run("2026-10-08T10:00:00.000Z", "2026-10-08T10:00:00.000Z");
      db.prepare(
        "INSERT INTO execution_runs (id, status, summary, executor_name, created_at, updated_at) VALUES ('run_b', 'completed', 'Done thing', 'codex', ?, ?)"
      ).run("2026-10-08T09:00:00.000Z", "2026-10-08T09:00:00.000Z");
    });

    const summary = todo(workspace);
    expect(summary.data.counts.agentsDoing).toBe(1);
    expect(summary.data.agentWork).toEqual([]);
    expect(renderTodoSuccess(summary)).toContain("  1 in flight: arcadia todo --agents lists them");

    const listing = todo(workspace, { agents: true });
    expect(listing.data.view).toBe("agents");
    expect(listing.data.agentWork).toEqual([
      { kind: "run", id: "run_a", project: "unknown", action: null, status: "running", agent: "claude-code", since: "2026-10-08T10:00:00.000Z" }
    ]);
    expect(listing.data.items).toEqual([]);
    const lines = renderTodoSuccess(listing);
    expect(lines[0]).toContain("Agents are doing: 1 in flight");
    expect(lines.join("\n")).toContain("run run_a");
  });

  it("states that Ask questions and Ask-origin tasks are unavailable when no workspace resolves", () => {
    const repo = temp("repo");
    mkdirSync(repo, { recursive: true });
    const response = runTodoCommand({ workspace: path.join(temp("missing"), "no-workspace-here"), now: NOW, repoRoot: repo, fixtureRoots: [] });

    expect(response.data.askUnavailable).toBe("Ask questions and Ask-origin tasks are unavailable: no workspace could be read.");
    expect(response.data.counts.backBurner).toBeNull();
    expect(response.data.counts.agentsDoing).toBeNull();
    const lines = renderTodoSuccess(response);
    expect(lines).toContain("Ask questions and Ask-origin tasks are unavailable: no workspace could be read.");
    expect(lines).toContain("  in-flight agent work is unavailable (see below)");
  });
});

describe("the morning packet counts the Ask questions", () => {
  it("counts them from the same to-do data and says they are unavailable when the workspace is", () => {
    const workspace = workspaceWithArcadia();
    runAskCommand({ workspace, request: "Sourdough starter notes for Sunday" });
    runAskCommand({ workspace, request: "The sidebar is broken on mobile" });
    const lines = formatOperatorTodoLines(todo(workspace).data);
    expect(lines).toContain("2 Ask questions need one answer: arcadia todo");

    const repo = temp("repo");
    const degraded = formatOperatorTodoLines(
      runTodoCommand({ workspace: path.join(temp("missing"), "none"), now: NOW, repoRoot: repo, fixtureRoots: [] }).data
    );
    expect(degraded.join("\n")).toContain("Ask questions and Ask-origin tasks are unavailable");
  });
});

const WISH = "It would be good if Arcadia loaded the sidebar faster";

describe("ask.routing.v2: the rollback and agent-sourced Asks are exact, wish phrasings included", () => {
  it("sends a wish phrase to Plan First for an operator Ask with the flag on", () => {
    const workspace = workspaceWithArcadia();
    const asked = runAskCommand({ workspace, request: WISH });
    expect(asked.data.stewardship.recommendedExecutionPath).toBe("Plan First");
    expect(asked.data.backBurnerItemId).toBeNull();
  });

  it("keeps the earlier route for a wish phrase when the flag is off", () => {
    const workspace = workspaceWithArcadia();
    setRoutingV2(workspace, false);
    const asked = runAskCommand({ workspace, request: WISH });
    expect(asked.data.stewardship.recommendedExecutionPath).toBe("Back Burner");
    expect(asked.data.stewardship.intentType).toBe("Back Burner Idea");
    expect(asked.data.workItem).toBeNull();
    expect(asked.data.backBurnerItemId).toMatch(/^bb_/);
  });

  it.each(["agent.ask", "codex.dogfood"])("keeps the earlier route for a wish phrase from %s", (sourceIngress) => {
    const workspace = workspaceWithArcadia();
    const asked = runAskCommand({ workspace, request: WISH, sourceIngress });
    expect(asked.data.stewardship.recommendedExecutionPath).toBe("Back Burner");
    expect(asked.data.workItem).toBeNull();
    expect(asked.data.backBurnerItemId).toMatch(/^bb_/);
  });
});

describe("answering an Ask question never starts an executor", () => {
  function runCount(workspace: string): number {
    return (withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM execution_runs").get()) as { n: number }).n;
  }
  function question(workspace: string, text = "Sourdough starter notes for Sunday"): string {
    const asked = runAskCommand({ workspace, request: text });
    expect(asked.data.reviewItemId).toMatch(/^review_/);
    return asked.data.reviewItemId as string;
  }

  it("lists a --no-execute answer command", () => {
    const workspace = workspaceWithArcadia();
    const id = question(workspace);
    expect(todo(workspace).data.items.find((item) => item.askQuestion)?.answer).toBe(`arcadia review approve ${id} --no-execute`);
  });

  it("creates no Run through `review approve`, by default or with an explicit execute", () => {
    for (const execute of [undefined, true, false]) {
      const workspace = workspaceWithArcadia();
      const id = question(workspace);
      const approved = runReviewApproveCommand({ workspace, id, execute });
      expect(approved.data.run, String(execute)).toBeNull();
      expect(approved.data.item.status, String(execute)).toBe("approved");
      expect(runCount(workspace), String(execute)).toBe(0);
    }
  });

  it("creates no Run when the Ask question has no Project at all", () => {
    const workspace = temp("noproj");
    initWorkspace(workspace);
    const id = question(workspace);
    expect(runReviewApproveCommand({ workspace, id, execute: true }).data.run).toBeNull();
    expect(runCount(workspace)).toBe(0);
  });

  it("creates no Run through the Discord reply path (review resolve-reply approve)", () => {
    const workspace = workspaceWithArcadia();
    const id = question(workspace);
    const replied = runReviewResolveReplyCommand({ workspace, id, reply: "approve" });
    expect(replied.data.run).toBeNull();
    expect(runCount(workspace)).toBe(0);
  });

  it("creates no Run through the Discord approve command, which asks for execution explicitly", async () => {
    const workspace = workspaceWithArcadia();
    const id = question(workspace);
    const cli = {
      reviewApproveWithExecute: async (reviewId: string) => ({
        ok: true,
        command: "review.approve",
        data: runReviewApproveCommand({ workspace, id: reviewId, execute: true }).data
      })
    } as unknown as ArcadiaCli;
    await requiresReviewApproveCommand(cli, id, {
      arcadiaWorkspace: workspace,
      discordBotToken: "t",
      discordClientId: "c",
      discordGuildId: "g",
      discordChannelId: "ch",
      arcadiaCliPath: null,
      pollIntervalSeconds: 60
    });
    expect(runCount(workspace)).toBe(0);
  });
});

describe("ask.routing.v2: duplicates are per Project, and a broken config never loses an Ask", () => {
  it("does not treat a re-send that adds --project as a duplicate", () => {
    const workspace = workspaceWithArcadia();
    const text = "Sourdough starter notes for Sunday";
    const first = runAskCommand({ workspace, request: text });
    const named = runAskCommand({ workspace, request: text, project: "Arcadia" });
    expect(named.data.suppressed).toBeUndefined();
    expect(named.data.reviewItemId).toMatch(/^review_/);
    expect(named.data.reviewItemId).not.toBe(first.data.reviewItemId);
    const again = runAskCommand({ workspace, request: text, project: "Arcadia" });
    expect(again.data.suppressed?.openQuestionId).toBe(named.data.reviewItemId);
  });

  it("only treats an Ask question as a duplicate target, not a Decision an Ask raised for another reason", () => {
    const workspace = workspaceWithArcadia();
    const text = "Sourdough starter notes for Sunday";
    const first = runAskCommand({ workspace, request: text });
    withDatabase(workspace, (db) =>
      db.prepare("UPDATE ask_requests SET stewardship_json = json_set(stewardship_json, '$.recommendedExecutionPath', 'Requires Review') WHERE id = ?").run(first.data.ask?.id)
    );
    const second = runAskCommand({ workspace, request: text });
    expect(second.data.suppressed).toBeUndefined();
  });

  it("fails open on a malformed config/arcadia.json: default on, one warning in the receipt", () => {
    const workspace = workspaceWithArcadia();
    setRoutingV2(workspace, "off");
    const setting = askRoutingV2Setting(workspace);
    expect(setting.enabled).toBe(true);
    expect(setting.warning).toContain("ask.routing.v2 must be a boolean");

    const asked = runAskCommand({ workspace, request: "Sourdough starter notes for Sunday" });
    expect(asked.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    expect(asked.data.reviewItemId).toMatch(/^review_/);
    expect(asked.data.routingWarning).toContain("could not be read");
    expect(asked.warnings.filter((warning) => warning.includes("ask.routing.v2"))).toHaveLength(1);

    writeFileSync(path.join(workspace, "config", "arcadia.json"), "{ not json");
    const unreadable = runAskCommand({ workspace, request: "The sidebar is broken on mobile" });
    expect(unreadable.data.reviewItemId).toMatch(/^review_/);
    expect(unreadable.data.routingWarning).toContain("not valid JSON");
  });
});
