import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  askTextHash,
  findAskMemo,
  hasAskCorrectionsTable,
  normalizeAskText,
  recordAskCorrection
} from "../src/ask/corrections.js";
import { runAskCommand } from "../src/commands/ask.js";
import { runAskCorrectCommand } from "../src/commands/askCorrect.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import { createAskRequest, createProjectWithInitialWork, createReviewItem, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const UNCLEAR_TEXT = "Sourdough starter notes for Sunday";
const OTHER_TEXT = "Sourdough starter notes for Monday";
const IDEA_TEXT = "Maybe creator partnerships could help someday.";
const MEMO_LINE = /^Heard: work \(memo \d{4}-\d{2}-\d{2}\) -> .+ \. wrong\? reply type: work\|idea\|answer\|status$/;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspaceWithProjects(): { workspace: string; arcadiaId: string; songbookId: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-corrections-stick-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return withDatabase(workspace, (db) => {
    const make = (name: string, alias: string) => {
      const created = createProjectWithInitialWork(db, {
        name,
        mission: "Fixture project.",
        goal: "Fixture goal.",
        status: "active",
        currentMilestone: "Fixture",
        nextAction: "Fixture next action.",
        workClassification: "agent"
      });
      upsertProjectMetadata(db, {
        projectId: created.project.id,
        aliases: [alias],
        repoPath: workspace,
        validationCommands: ["node -e \"process.exit(0)\""]
      });
      return created.project.id;
    };
    return { workspace, arcadiaId: make("Arcadia", "Arcadia"), songbookId: make("Living Songbook", "Songbook") };
  });
}

function count(workspace: string, table: string, where = "1 = 1"): number {
  return (withDatabase(workspace, (db) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get()) as { n: number }).n;
}

function row<T>(workspace: string, sql: string, ...params: unknown[]): T {
  return withDatabase(workspace, (db) => db.prepare(sql).get(...params)) as T;
}

function setRoutingV2(workspace: string, value: boolean): void {
  const configPath = path.join(workspace, "config", "arcadia.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.ask = { routing: { v2: value } };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/** The Ask is sent, then corrected the way an operator would at a terminal. */
function sendAndCorrect(workspace: string, text: string, type: string, project?: string) {
  const asked = runAskCommand({ workspace, request: text });
  const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type, project });
  return { asked, corrected };
}

describe("ask_corrections: the migration", () => {
  it("creates the table with the required columns, no foreign keys, and nullable columns on ask_requests", () => {
    const { workspace } = workspaceWithProjects();
    withDatabase(workspace, (db) => {
      expect(hasAskCorrectionsTable(db)).toBe(true);
      const columns = (db.prepare("PRAGMA table_info(ask_corrections)").all() as Array<{ name: string }>).map((column) => column.name);
      expect(columns).toEqual(
        expect.arrayContaining([
          "ask_request_id", "normalized_text", "text_hash", "predicted_type", "corrected_type", "corrected_project", "source", "created_at"
        ])
      );
      expect(db.prepare("PRAGMA foreign_key_list(ask_corrections)").all()).toEqual([]);
      const askColumns = db.prepare("PRAGMA table_info(ask_requests)").all() as Array<{ name: string; notnull: number }>;
      for (const name of ["confidence", "corrected_type"]) {
        expect(askColumns.find((column) => column.name === name), name).toMatchObject({ notnull: 0 });
      }
    });
  });

  it("is additive and idempotent: reopening a database keeps its rows", () => {
    const { workspace } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "work");
    expect(count(workspace, "ask_corrections")).toBe(1);
    withDatabase(workspace, () => undefined);
    withDatabase(workspace, () => undefined);
    expect(count(workspace, "ask_corrections")).toBe(1);
  });

  it("records the rules' confidence on the Ask and the corrected type once corrected", () => {
    const { workspace } = workspaceWithProjects();
    const { asked } = sendAndCorrect(workspace, UNCLEAR_TEXT, "work");
    expect(row(workspace, "SELECT confidence, corrected_type FROM ask_requests WHERE id = ?", asked.data.ask?.id)).toEqual({
      confidence: asked.data.intake.confidenceLabel,
      corrected_type: "work"
    });
  });
});

describe("the transactional write", () => {
  it("writes the correction in the same transaction as the supersession link and the retirement", () => {
    const { workspace, arcadiaId } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work", project: arcadiaId });

    expect(count(workspace, "ask_supersessions")).toBe(1);
    const correction = row<Record<string, string>>(workspace, "SELECT * FROM ask_corrections");
    expect(correction).toMatchObject({
      ask_request_id: asked.data.ask?.id,
      normalized_text: normalizeAskText(UNCLEAR_TEXT),
      text_hash: askTextHash(normalizeAskText(UNCLEAR_TEXT)),
      predicted_type: "unclear",
      corrected_type: "work",
      corrected_project: arcadiaId,
      source: "cli"
    });
    expect(corrected.data.previous.disposition).toBe("closed");
  });

  it("rolls back the link and the retirement when the correction row cannot be written", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    withDatabase(workspace, (db) =>
      db.exec("CREATE TRIGGER no_memo BEFORE INSERT ON ask_corrections BEGIN SELECT RAISE(ABORT, 'memo refused'); END")
    );

    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" })).toThrow(/memo refused/);

    expect(count(workspace, "ask_corrections")).toBe(0);
    expect(count(workspace, "ask_supersessions")).toBe(0);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", asked.data.reviewItemId)).toEqual({ status: "open" });
  });

  it("writes no correction when the link cannot be written, so a memo never exists without its re-route", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    withDatabase(workspace, (db) =>
      db.exec("CREATE TRIGGER no_link BEFORE INSERT ON ask_supersessions BEGIN SELECT RAISE(ABORT, 'link refused'); END")
    );

    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" })).toThrow(/link refused/);

    expect(count(workspace, "ask_corrections")).toBe(0);
    expect(row<{ corrected_type: string | null }>(workspace, "SELECT corrected_type FROM ask_requests WHERE id = ?", asked.data.ask?.id))
      .toEqual({ corrected_type: null });
  });

  it("remembers the source of a Discord correction", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "idea", source: "discord", actor: "424242" });
    expect(row(workspace, "SELECT source, corrected_type FROM ask_corrections")).toEqual({ source: "discord", corrected_type: "idea" });
  });
});

describe("a memo hit on the identical Ask", () => {
  it("routes the repeat to the corrected type and Project, says (memo <date>) and creates no question", () => {
    const { workspace, songbookId } = workspaceWithProjects();
    const first = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(first.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    expect(first.data.heard?.source).toBe("rule");
    runAskCorrectCommand({ workspace, askId: first.data.ask?.id as string, type: "work", project: songbookId });
    const questions = count(workspace, "review_items");
    const runs = count(workspace, "execution_runs");

    const second = runAskCommand({ workspace, request: UNCLEAR_TEXT });

    expect(second.data.heard?.line).toMatch(MEMO_LINE);
    expect(second.data.heard?.source).toBe("memo");
    expect(second.data.memo).toMatchObject({ type: "work" });
    expect(second.data.workItem?.project_id).toBe(songbookId);
    expect(second.data.reviewItemId).toBeNull();
    expect(count(workspace, "review_items")).toBe(questions);
    expect(count(workspace, "execution_runs")).toBe(runs);
    expect(row<{ confidence: string }>(workspace, "SELECT confidence FROM ask_requests WHERE id = ?", second.data.ask?.id)).toEqual({ confidence: "memo" });
  });

  it("matches only after exact normalization: case and spacing, never wording", () => {
    const { workspace } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "work");

    const reshaped = runAskCommand({ workspace, request: `  ${UNCLEAR_TEXT.toUpperCase()}\n` });
    expect(reshaped.data.heard?.line).toMatch(MEMO_LINE);
  });

  it("an explicit Project on the repeat wins over the remembered one", () => {
    const { workspace, arcadiaId, songbookId } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "work", songbookId);
    const second = runAskCommand({ workspace, request: UNCLEAR_TEXT, project: arcadiaId });
    expect(second.data.heard?.source).toBe("memo");
    expect(second.data.workItem?.project_id).toBe(arcadiaId);
  });

  it("routes a repeat corrected to idea into Back Burner", () => {
    const { workspace } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "idea");
    const second = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(second.data.heard?.line).toMatch(/^Heard: idea \(memo \d{4}-\d{2}-\d{2}\) -> Back Burner item /);
    expect(second.data.backBurnerItemId).toMatch(/^bb_/);
    expect(second.data.reviewItemId).toBeNull();
  });

  it("routes a repeat corrected to status to the status view and creates nothing", () => {
    const { workspace } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "status");
    const workItems = count(workspace, "work_items");
    const second = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(second.data.heard?.line).toMatch(/^Heard: status \(memo \d{4}-\d{2}-\d{2}\) -> status shown/);
    expect(second.data.status).not.toBeNull();
    expect(count(workspace, "work_items")).toBe(workItems);
    expect(second.data.reviewItemId).toBeNull();
  });

  it("the newest operator correction wins", () => {
    const { workspace } = workspaceWithProjects();
    const { corrected } = sendAndCorrect(workspace, UNCLEAR_TEXT, "idea");
    runAskCorrectCommand({ workspace, askId: corrected.data.newAskId, type: "work" });
    const third = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(third.data.heard?.line).toMatch(MEMO_LINE);
    expect(third.data.workItem).not.toBeNull();
  });

  it("never runs anything, even when the repeat asks for a safe run", () => {
    const { workspace } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "work");
    const runs = count(workspace, "execution_runs");
    const second = runAskCommand({ workspace, request: UNCLEAR_TEXT, runSafe: true });
    expect(second.data.run).toBeNull();
    expect(count(workspace, "execution_runs")).toBe(runs);
  });
});

describe("a miss", () => {
  it("does not memo different text, even one word apart", () => {
    const { workspace } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "work");

    const other = runAskCommand({ workspace, request: OTHER_TEXT });
    expect(other.data.heard?.source).toBe("rule");
    expect(other.data.memo).toBeUndefined();
    expect(other.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    expect(other.data.reviewItemId).not.toBeNull();
  });

  it("ignores a Project that no longer exists and routes the repeat ordinarily", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    withDatabase(workspace, (db) =>
      recordAskCorrection(db, {
        askRequestId: asked.data.ask?.id as string,
        text: UNCLEAR_TEXT,
        predictedType: "unclear",
        correctedType: "work",
        correctedProject: "project_gone",
        source: "cli"
      })
    );
    const second = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(second.data.heard?.source).toBe("rule");
  });
});

describe("no cascade", () => {
  it("keeps the correction when the Ask, its question and its capture are deleted", () => {
    const { workspace } = workspaceWithProjects();
    const { asked } = sendAndCorrect(workspace, UNCLEAR_TEXT, "work");
    withDatabase(workspace, (db) => {
      db.pragma("foreign_keys = ON");
      db.prepare("DELETE FROM review_items WHERE ask_request_id = ?").run(asked.data.ask?.id);
      db.prepare("DELETE FROM ask_requests WHERE id = ?").run(asked.data.ask?.id);
      db.prepare("DELETE FROM ask_capture_envelopes WHERE id = ?").run(asked.data.captureEnvelope.id);
    });
    expect(count(workspace, "ask_requests", `id = '${asked.data.ask?.id}'`)).toBe(0);
    expect(count(workspace, "ask_corrections")).toBe(1);
    expect(runAskCommand({ workspace, request: UNCLEAR_TEXT }).data.heard?.line).toMatch(MEMO_LINE);
  });
});

describe("what is never a memo", () => {
  it("ignores rows recorded from a model re-route or any non-operator source", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    withDatabase(workspace, (db) => {
      for (const source of ["model", "agent", "rule"]) {
        recordAskCorrection(db, {
          askRequestId: asked.data.ask?.id as string,
          text: UNCLEAR_TEXT,
          predictedType: "unclear",
          correctedType: "work",
          correctedProject: null,
          source
        });
      }
      expect(findAskMemo(db, UNCLEAR_TEXT)).toBeNull();
    });
    const second = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(second.data.heard?.source).toBe("rule");
    // Ordinary routing: the original question is still open, so the repeat is its duplicate, not an Action.
    expect(second.data.memo).toBeUndefined();
    expect(second.data.workItem).toBeNull();
  });

  it("an operator row after a model row is the memo; a model row after an operator row does not displace it", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    withDatabase(workspace, (db) => {
      const base = { askRequestId: asked.data.ask?.id as string, text: UNCLEAR_TEXT, predictedType: "unclear", correctedProject: null };
      recordAskCorrection(db, { ...base, correctedType: "idea", source: "cli", createdAt: "2026-10-01T00:00:00.000Z" });
      recordAskCorrection(db, { ...base, correctedType: "work", source: "model", createdAt: "2026-10-02T00:00:00.000Z" });
      expect(findAskMemo(db, UNCLEAR_TEXT)).toMatchObject({ type: "idea", source: "cli", date: "2026-10-01" });
    });
  });

  it("never applies an answer memo, so a repeat can never answer a Decision", () => {
    const { workspace } = workspaceWithProjects();
    const decision = withDatabase(workspace, (db) =>
      createReviewItem(db, {
        askRequestId: createAskRequest(db, {
          rawRequest: "export retention",
          resolvedIntent: "CaptureThought",
          registryVersion: 1,
          outputKind: "requires_review",
          status: "requires_review"
        }).id,
        decisionNeeded: "Which retention window should the export use?",
        recommendation: "90 days",
        sourceInput: "export retention",
        proposedAction: "Pick a window",
        resolvedIntent: "ActionClarification",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      })
    );
    const asked = runAskCommand({ workspace, request: "Use a 90 day window for the export retention." });
    runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "answer", ref: decision.slug ?? decision.id });
    expect(row(workspace, "SELECT corrected_type, source FROM ask_corrections")).toEqual({ corrected_type: "answer", source: "cli" });
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", decision.id)).toEqual({ status: "approved" });

    // A second pending Decision, and the same words again.
    const another = withDatabase(workspace, (db) =>
      createReviewItem(db, {
        askRequestId: createAskRequest(db, {
          rawRequest: "export retention again",
          resolvedIntent: "CaptureThought",
          registryVersion: 1,
          outputKind: "requires_review",
          status: "requires_review"
        }).id,
        decisionNeeded: "Which retention window should the export use?",
        recommendation: "90 days",
        sourceInput: "export retention again",
        proposedAction: "Pick a window",
        resolvedIntent: "ActionClarification",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      })
    );
    const repeat = runAskCommand({ workspace, request: "Use a 90 day window for the export retention." });
    expect(repeat.data.memo).toBeUndefined();
    expect(repeat.data.heard?.source).toBe("rule");
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", another.id)).toEqual({ status: "open" });
    withDatabase(workspace, (db) => expect(findAskMemo(db, "Use a 90 day window for the export retention.")).toBeNull());
  });

  it("does not memo a reply that names a Decision, whatever its text was once corrected to", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const slug = asked.data.decisionSlug ?? asked.data.reviewItemId;
    const reply = `approve ${slug}`;
    withDatabase(workspace, (db) =>
      recordAskCorrection(db, {
        askRequestId: asked.data.ask?.id as string,
        text: reply,
        predictedType: "answer",
        correctedType: "idea",
        correctedProject: null,
        source: "cli"
      })
    );
    const replied = runAskCommand({ workspace, request: reply });
    expect(replied.data.memo).toBeUndefined();
  });

  it("agent-sourced Asks bypass the memo", () => {
    const { workspace } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "work");
    for (const sourceIngress of ["agent.ask", "codex.dogfood"]) {
      const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT, sourceIngress });
      expect(asked.data.memo, sourceIngress).toBeUndefined();
      expect(asked.data.heard?.source, sourceIngress).toBe("rule");
      expect(asked.data.backBurnerItemId, sourceIngress).toMatch(/^bb_/);
    }
  });

  it("the ask.routing.v2 flag off restores today's routing exactly", () => {
    const { workspace } = workspaceWithProjects();
    const baseline = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    sendAndCorrect(workspace, IDEA_TEXT, "work");
    setRoutingV2(workspace, false);

    const off = runAskCommand({ workspace, request: IDEA_TEXT });
    expect(off.data.memo).toBeUndefined();
    expect(off.data.heard?.source).toBe("rule");
    expect(off.data.stewardship.recommendedExecutionPath).toBe("Back Burner");
    expect(off.data.backBurnerItemId).toMatch(/^bb_/);
    expect(baseline.data.stewardship.recommendedExecutionPath).toBe("Clarify First");

    setRoutingV2(workspace, true);
    expect(runAskCommand({ workspace, request: IDEA_TEXT }).data.heard?.line).toMatch(MEMO_LINE);
  });

  it("an explicit --back-burner idea Ask bypasses the memo", () => {
    const { workspace } = workspaceWithProjects();
    sendAndCorrect(workspace, UNCLEAR_TEXT, "work");
    const idea = runAskCommand({ workspace, request: UNCLEAR_TEXT, captureAsIdea: true });
    expect(idea.data.memo).toBeUndefined();
    expect(idea.data.backBurnerItemId).toMatch(/^bb_/);
  });
});

describe("an answer to an Ask question writes a correction row", () => {
  it("records it as source answer in the transaction that creates the Action, and the next identical Ask is a memo", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(asked.data.stewardship.recommendedExecutionPath).toBe("Clarify First");

    runReviewApproveCommand({ workspace, id: asked.data.reviewItemId as string, execute: false });

    expect(row(workspace, "SELECT ask_request_id, normalized_text, predicted_type, corrected_type, source FROM ask_corrections")).toEqual({
      ask_request_id: asked.data.ask?.id,
      normalized_text: normalizeAskText(UNCLEAR_TEXT),
      predicted_type: "unclear",
      corrected_type: "work",
      source: "answer"
    });
    expect(row<{ corrected_type: string }>(workspace, "SELECT corrected_type FROM ask_requests WHERE id = ?", asked.data.ask?.id))
      .toEqual({ corrected_type: "work" });

    const repeat = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(repeat.data.heard?.line).toMatch(MEMO_LINE);
    expect(repeat.data.reviewItemId).toBeNull();
  });

  it("writes nothing for a Decision that is not an Ask question", () => {
    const { workspace } = workspaceWithProjects();
    const decision = withDatabase(workspace, (db) =>
      createReviewItem(db, {
        askRequestId: createAskRequest(db, {
          rawRequest: "Add a fixture",
          resolvedIntent: "CaptureThought",
          registryVersion: 1,
          outputKind: "requires_review",
          status: "requires_review"
        }).id,
        decisionNeeded: "Add a deterministic fixture for Arcadia?",
        recommendation: "Approve",
        sourceInput: "Add a deterministic fixture for Arcadia.",
        proposedAction: "Add a deterministic fixture for Arcadia.",
        resolvedIntent: "CaptureThought",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      })
    );
    runReviewApproveCommand({ workspace, id: decision.id, execute: false });
    expect(count(workspace, "ask_corrections")).toBe(0);
  });
});
