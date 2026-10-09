import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordAskCorrection } from "../src/ask/corrections.js";
import { GOLDEN_RELATIVE_PATH } from "../src/ask/goldenCases.js";
import { MEMO_PATTERN_THRESHOLD, backingKey, tokenPattern } from "../src/ask/memoPattern.js";
import { SCHEDULE_REVIVAL_THRESHOLD, askOutcome } from "../src/ask/report.js";
import { buildProgram } from "../src/cli.js";
import { runAskCommand } from "../src/commands/ask.js";
import { runAskCorrectCommand } from "../src/commands/askCorrect.js";
import { renderAskReportSuccess, runAskReportCommand } from "../src/commands/askReport.js";
import { runReviewRejectCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const HOUR = 3_600_000;

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function workspaceWithArcadia(): string {
  const workspace = scratch("arcadia-ask-report-");
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

function setRoutingV2(workspace: string, value: boolean): void {
  const configPath = path.join(workspace, "config", "arcadia.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.ask = { routing: { v2: value } };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/** Moves an Ask's capture back in time so it is old enough to be judged. */
function age(workspace: string, askId: string | undefined, ms: number): void {
  withDatabase(workspace, (db) => {
    db.prepare(
      "UPDATE ask_capture_envelopes SET captured_at = ? WHERE id = (SELECT capture_id FROM ask_requests WHERE id = ?)"
    ).run(new Date(Date.now() - ms).toISOString(), askId);
  });
}

function sendOld(workspace: string, request: string, options: { sourceIngress?: string } = {}) {
  const asked = runAskCommand({ workspace, request, ...options });
  age(workspace, asked.data.ask?.id, 3 * HOUR);
  return asked;
}

/** The repo the report reads the golden set from: empty unless the test writes one. */
function repoWithGolden(lines: string[]): string {
  const repo = scratch("arcadia-ask-report-repo-");
  mkdirSync(path.join(repo, path.dirname(GOLDEN_RELATIVE_PATH)), { recursive: true });
  writeFileSync(path.join(repo, GOLDEN_RELATIVE_PATH), `${lines.join("\n")}\n`);
  return repo;
}

function report(workspace: string, options: { since?: string; repoRoot?: string } = {}) {
  return runAskReportCommand({ workspace, fixtureRoots: [], repoRoot: options.repoRoot ?? scratch("arcadia-ask-report-empty-"), ...options });
}

describe("askOutcome: where one Ask stands", () => {
  const base = { outputKind: "requires_review", workItemId: null, reviews: [], ideas: [], listed: new Set<string>() };

  it("is listed when arcadia todo lists a review item or the Action it made", () => {
    expect(askOutcome({ ...base, reviews: [{ id: "review_1", status: "open" }], listed: new Set(["review_items:review_1"]) })).toBe("listed");
    expect(askOutcome({ ...base, workItemId: "work_1", listed: new Set(["work_items:work_1"]) })).toBe("listed");
  });

  it("is acted, answered or an operator-filed idea without being listed", () => {
    expect(askOutcome({ ...base, outputKind: "status_report" })).toBe("acted");
    expect(askOutcome({ ...base, workItemId: "work_1" })).toBe("acted");
    expect(askOutcome({ ...base, outputKind: "review_response" })).toBe("answered");
    expect(askOutcome({ ...base, reviews: [{ id: "review_1", status: "rejected" }] })).toBe("answered");
    expect(askOutcome({ ...base, outputKind: "back_burner", ideas: [{ operatorFiled: true }] })).toBe("idea");
  });

  it("vanishes when the only record is an open review item todo does not list, or a fallback shelf", () => {
    expect(askOutcome({ ...base, reviews: [{ id: "review_1", status: "open" }] })).toBe("vanished");
    expect(askOutcome({ ...base, outputKind: "back_burner", ideas: [{ operatorFiled: false }] })).toBe("vanished");
    expect(askOutcome(base)).toBe("vanished");
  });
});

describe("tokenPattern and backingKey", () => {
  it("keeps the first three meaningful words, skipping leading filler", () => {
    expect(tokenPattern("Please, the Sourdough starter notes for Sunday")).toBe("sourdough starter notes");
    expect(tokenPattern("I want to schedule a thing")).toBe("i want to");
    expect(tokenPattern("  Hi   there ")).toBe("hi there");
    expect(tokenPattern("")).toBe("");
  });

  it("matches a correction and a golden case of the same type that open the same way", () => {
    expect(backingKey("work", "I want to book the venue")).toBe(backingKey("work", "i want to  plan the party"));
    expect(backingKey("work", "I want to book the venue")).not.toBe(backingKey("idea", "I want to book the venue"));
  });
});

describe("arcadia ask report", () => {
  it("counts a question, an Action and a filed idea as present, and the flag-off fallback shelf as a vanish", () => {
    const workspace = workspaceWithArcadia();
    sendOld(workspace, "Notes on fermenting hot sauce next weekend");
    sendOld(workspace, "Plan the next quarter of releases for Arcadia");
    sendOld(workspace, "Perhaps a seasonal playlist generator could be fun someday.");
    sendOld(workspace, "thanks");
    setRoutingV2(workspace, false);
    const fallback = sendOld(workspace, "Lantern festival volunteer notes");
    expect(fallback.data.backBurnerItemId).toMatch(/^bb_/);

    const data = report(workspace).data;
    expect(data.sources).toHaveLength(1);
    expect(data.sources[0].source).toBe("ask");
    expect(data.total).toMatchObject({
      asks: 5,
      suppressed: 1,
      classified: 4,
      questions: 1,
      eligible: 4,
      vanished: 1,
      vanishRate: 0.25,
      backBurnerArrivals: 2,
      backBurnerOperatorFiled: 1
    });
    expect(data.total.vanishedAskIds).toEqual([fallback.data.ask?.id]);
    expect(data.total.questionRate).toBe(0.2);
  });

  it("does not judge an Ask younger than an hour, and counts a rejected question as answered", () => {
    const workspace = workspaceWithArcadia();
    runAskCommand({ workspace, request: "Lantern festival volunteer notes" });
    const old = sendOld(workspace, "Notes on fermenting hot sauce next weekend");
    runReviewRejectCommand({ workspace, id: old.data.reviewItemId as string });
    setRoutingV2(workspace, false);
    runAskCommand({ workspace, request: "Orchard path lighting notes" });

    const total = report(workspace).data.total;
    expect(total.asks).toBe(3);
    expect(total.eligible).toBe(1);
    expect(total.vanished).toBe(0);
    expect(total.vanishRate).toBe(0);
  });

  it("excludes agent-written Asks and keeps each operator source apart", () => {
    const workspace = workspaceWithArcadia();
    sendOld(workspace, "Notes on fermenting hot sauce next weekend", { sourceIngress: "discord.message" });
    sendOld(workspace, "Why does the archive feel slow?", { sourceIngress: "discord.message" });
    sendOld(workspace, "Plan the next quarter of releases for Arcadia", { sourceIngress: "ingress:notes" });
    sendOld(workspace, "Notes on tide tables", { sourceIngress: "agent.ask" });

    const data = report(workspace).data;
    expect(data.sources.map((source) => [source.source, source.asks])).toEqual([
      ["discord.message", 2],
      ["ingress:notes", 1]
    ]);
    expect(data.total.asks).toBe(3);
  });

  it("counts a correction, a memo hit and the recurrence and planning flags, and reports the Schedule trigger", () => {
    const workspace = workspaceWithArcadia();
    const first = sendOld(workspace, "Orchard path lighting notes");
    runAskCorrectCommand({ workspace, askId: first.data.ask?.id as string, type: "idea" });
    const again = sendOld(workspace, "Orchard path lighting notes");
    expect(again.data.memo).toBeDefined();
    sendOld(workspace, "I want to be able to set up a weekly digest in Arcadia");
    sendOld(workspace, "I want to be able to schedule a daily backup in Arcadia");

    const before = report(workspace).data;
    expect(before.total).toMatchObject({ asks: 4, corrected: 1, memoHits: 1, recurrence: 2, planning: 0 });
    expect(before.schedule).toEqual({ recurrence: 2, threshold: SCHEDULE_REVIVAL_THRESHOLD, revivalTriggerMet: false });

    sendOld(workspace, "I want to be able to run a recurring cleanup in Arcadia");
    const after = report(workspace).data;
    expect(after.schedule.revivalTriggerMet).toBe(true);
    expect(renderAskReportSuccess({ ...runAskReportCommand({ workspace, fixtureRoots: [], repoRoot: scratch("r-") }) }).join("\n")).toMatch(
      /Schedule revival trigger: 3 Ask\(s\) flagged recurrence, 3 or more revives it: MET/
    );
  });

  it("reports corrections no golden case backs, and says so when 3 memos share a type and a token pattern", () => {
    const workspace = workspaceWithArcadia();
    withDatabase(workspace, (db) => {
      // Explicit, increasing times: two corrections in one millisecond have no defined order.
      let clock = Date.parse("2026-10-01T00:00:00Z");
      const memo = (text: string, type: string, source = "cli") =>
        recordAskCorrection(db, {
          askRequestId: "ask_x",
          text,
          predictedType: "unclear",
          correctedType: type,
          correctedProject: null,
          source,
          createdAt: new Date((clock += 1000)).toISOString()
        });
      memo("Sourdough starter notes for Sunday", "work");
      memo("Sourdough starter notes for Monday", "work");
      memo("Sourdough starter notes: feeding", "work");
      memo("Sourdough starter notes for Tuesday", "idea");
      // A model's re-route is never a memo, and a newer correction retires an older memo of the same text.
      memo("Sourdough starter notes for Friday", "work", "model");
      memo("Garden gate repair", "work");
      memo("Garden gate repair", "answer");
    });
    expect(MEMO_PATTERN_THRESHOLD).toBe(3);

    const unbacked = report(workspace).data;
    expect(unbacked.corrections.memos).toBe(4);
    expect(unbacked.corrections.notBackedByGolden).toBeNull();
    expect(unbacked.patternHints).toEqual([{ type: "work", pattern: "sourdough starter notes", memos: 3, backedByGolden: false }]);

    const repo = repoWithGolden([
      JSON.stringify({ id: "backs-work", text: "Sourdough starter notes, paraphrased", expected_type: "work" })
    ]);
    const backed = report(workspace, { repoRoot: repo }).data;
    expect(backed.corrections.notBackedByGolden).toBe(1);
    expect(backed.corrections.golden).toEqual({ path: GOLDEN_RELATIVE_PATH, cases: 1 });
    expect(backed.patternHints[0].backedByGolden).toBe(true);

    const text = renderAskReportSuccess(runAskReportCommand({ workspace, fixtureRoots: [], repoRoot: repo })).join("\n");
    expect(text).toContain('3 memos share corrected type work and the token pattern "sourdough starter notes"');
    expect(text).toContain("No rule is generated automatically");
  });

  it("is read-only, and its window rejects the future", () => {
    const workspace = workspaceWithArcadia();
    sendOld(workspace, "Notes on fermenting hot sauce next weekend");
    const counts = () =>
      withDatabase(workspace, (db) =>
        ["ask_requests", "ask_capture_envelopes", "ask_corrections", "review_items", "back_burner_items", "work_items"].map(
          (table) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
        )
      );
    const before = counts();
    report(workspace);
    expect(counts()).toEqual(before);
    expect(() => report(workspace, { since: "2999-01-01T00:00Z" })).toThrow(/future/);
    expect(report(workspace, { since: "1h" }).data.total.asks).toBe(0);
  });

  it("runs as arcadia ask report with --json and --since", async () => {
    const workspace = workspaceWithArcadia();
    sendOld(workspace, "Notes on fermenting hot sauce next weekend");
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    try {
      await buildProgram().parseAsync(["node", "arcadia", "ask", "report", "--workspace", workspace, "--since", "2d", "--json"]);
    } finally {
      vi.restoreAllMocks();
      process.exitCode = undefined;
    }
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("ask.report");
    expect(parsed.data.schema).toBe("arcadia-ask-report-v1");
    expect(parsed.data.total.asks).toBe(1);
    expect(Object.keys(parsed.data).sort()).toEqual([
      "capturedWithoutAskRecord", "corrections", "notes", "patternHints", "schedule", "schema", "sources", "total", "window"
    ]);
  });

  it("renders every metric per source in text", () => {
    const workspace = workspaceWithArcadia();
    sendOld(workspace, "Notes on fermenting hot sauce next weekend");
    const text = renderAskReportSuccess(runAskReportCommand({ workspace, fixtureRoots: [], repoRoot: scratch("r-") })).join("\n");
    for (const label of [
      "Source ask",
      "Vanish rate (target zero): 0/1",
      "Corrected ÷ classified: 0/1",
      "Questions ÷ Asks: 1/1 (100.0%)",
      "Back Burner arrivals: 0",
      "Memo hits: 0 · flagged recurrence 0 · flagged planning 0",
      "Schedule revival trigger",
      "not yet backed by a golden case: unknown"
    ]) {
      expect(text).toContain(label);
    }
  });
});
