import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { listPendingOperatorPings } from "../src/ping/operatorPing.js";
import { IDLE_FRONT_ROW_SCHEMA, type IdleFrontRow } from "../src/production/idleFront.js";
import {
  coordinatorRoleOfTitle,
  levelOf,
  readClaudeTranscript,
  readCodexRollout,
  type CoordinatorBudgetMarker
} from "../src/coordinators/budget.js";
import {
  defaultBudgetSources,
  markerPath,
  renderCoordinatorBudgetSuccess,
  runCoordinatorBudgetCheck,
  runCoordinatorBudgetCommand,
  type BudgetSources
} from "../src/commands/coordinatorBudget.js";
import { renderProductionLivenessTimerSuccess, runProductionLivenessTimerCommand } from "../src/commands/productionMomentum.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function workspace(): string {
  const root = temp("arcadia-budget-ws-");
  initWorkspace(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  return root;
}

const SIGNAL = "11111111-1111-4111-8111-111111111111";
const ROWAN = "22222222-2222-4222-8222-222222222222";
const HELPER = "33333333-3333-4333-8333-333333333333";
const WINDOW = 1_000_000;

interface Turn {
  tokens?: number;
  model?: string;
  sidechain?: boolean;
  id?: string;
  compact?: { pre: number; post: number; at: string };
}

/** A Claude Code transcript in the shape observed on 2026-11-07: title, usage and compaction lines among others. */
function claudeTranscript(sessionId: string, title: string | null, turns: Turn[]): string {
  const lines: string[] = [JSON.stringify({ type: "user", sessionId, isSidechain: false, message: { role: "user", content: "hello" } })];
  turns.forEach((turn, index) => {
    if (turn.compact) {
      lines.push(JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId, isSidechain: false, timestamp: turn.compact.at, compactMetadata: { trigger: "manual", preTokens: turn.compact.pre, postTokens: turn.compact.post } }));
      return;
    }
    const tokens = turn.tokens ?? 0;
    lines.push(JSON.stringify({
      type: "assistant",
      sessionId,
      isSidechain: turn.sidechain ?? false,
      timestamp: `2026-11-07T20:${String(index).padStart(2, "0")}:00.000Z`,
      message: { id: turn.id ?? `msg_${index}`, model: turn.model ?? "claude-opus-5-5", usage: { input_tokens: 4, cache_creation_input_tokens: 1000, cache_read_input_tokens: tokens - 1004, output_tokens: 300 } }
    }));
    if (title) lines.push(JSON.stringify({ type: "custom-title", customTitle: title, sessionId }));
  });
  if (title && turns.length === 0) lines.push(JSON.stringify({ type: "custom-title", customTitle: title, sessionId }));
  return `${lines.join("\n")}\n`;
}

function claudeHome(): string {
  return temp("arcadia-budget-claude-");
}

function writeClaude(home: string, sessionId: string, title: string | null, turns: Turn[], ageMinutes = 1): string {
  const directory = path.join(home, "-Users-someone-project");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${sessionId}.jsonl`);
  writeFileSync(file, claudeTranscript(sessionId, title, turns));
  const when = new Date(Date.now() - ageMinutes * 60_000);
  utimesSync(file, when, when);
  return file;
}

const sources = (claude: string | null, codex: string | null = null): BudgetSources => ({ claudeProjectsDir: claude, codexHome: codex, claudeStatusLinePath: null });
const pending = (root: string) => withDatabase(root, (db) => listPendingOperatorPings(db));

function check(root: string, src: BudgetSources, nowMs = Date.now()) {
  return runCoordinatorBudgetCheck({ workspace: root, dashboardUrl: "http://arcadia.example.ts.net" }, { now: () => nowMs, sources: src });
}

function marker(root: string, sessionId: string, agent: "claude" | "codex" = "claude"): CoordinatorBudgetMarker {
  return JSON.parse(readFileSync(markerPath(root, agent, sessionId), "utf8")) as CoordinatorBudgetMarker;
}

describe("coordinator titles are the registration", () => {
  it("knows ⭐ Signal and 🚦 Rowan, and nothing else", () => {
    expect(coordinatorRoleOfTitle("⭐ Signal 3: batch 2 running")).toBe("signal");
    expect(coordinatorRoleOfTitle("  🚦 Rowan: pressing")).toBe("rowan");
    expect(coordinatorRoleOfTitle("↳ Ellis: budget pings")).toBeNull();
    expect(coordinatorRoleOfTitle("Signal ⭐")).toBeNull();
    expect(coordinatorRoleOfTitle(null)).toBeNull();
  });
});

describe("reading occupancy from the host's own files", () => {
  it("takes the last main-chain usage as input + cache_creation + cache_read over the registered window", () => {
    const read = readClaudeTranscript(claudeTranscript(SIGNAL, "⭐ Signal 3", [{ tokens: 300_000 }, { tokens: 900_000, sidechain: true }, { tokens: 513_972 }]));
    expect(read.title).toBe("⭐ Signal 3");
    expect(read.sessionId).toBe(SIGNAL);
    expect(read.occupancy).toMatchObject({ kind: "measured", tokens: 513_972, window: WINDOW });
    expect(levelOf(read.occupancy)).toBe("prepare");
  });

  it("starts a new episode at a compaction and uses postTokens until a turn follows", () => {
    const at = "2026-11-07T17:47:56.544Z";
    const justCompacted = readClaudeTranscript(claudeTranscript(SIGNAL, "⭐ Signal", [{ tokens: 950_000 }, { compact: { pre: 977_536, post: 19_697, at } }]));
    expect(justCompacted.episodeStart).toBe(at);
    expect(justCompacted.occupancy).toMatchObject({ kind: "measured", tokens: 19_697, tokensSource: "transcript compact_boundary.postTokens" });
    const later = readClaudeTranscript(claudeTranscript(SIGNAL, "⭐ Signal", [{ tokens: 950_000 }, { compact: { pre: 977_536, post: 19_697, at } }, { tokens: 120_000 }]));
    expect(later.occupancy).toMatchObject({ kind: "measured", tokens: 120_000 });
    expect(later.turns).toBe(1);
  });

  it("is unmeasured, never guessed, without a registered window, with a window below an observed compaction, or with no usage", () => {
    const unknown = readClaudeTranscript(claudeTranscript(SIGNAL, "⭐ Signal", [{ tokens: 100_000, model: "claude-haiku-9" }]));
    expect(unknown.occupancy).toEqual({ kind: "unmeasured", reason: "no registered context window for model claude-haiku-9" });
    const tooSmall = readClaudeTranscript(
      claudeTranscript(SIGNAL, "⭐ Signal", [{ compact: { pre: 977_536, post: 19_697, at: "2026-11-07T17:00:00.000Z" } }, { tokens: 100_000 }]),
      { windows: { "claude-opus-5-5": { tokens: 200_000, evidence: "test" } } }
    );
    expect(tooSmall.occupancy.kind).toBe("unmeasured");
    expect(tooSmall.occupancy.kind === "unmeasured" && tooSmall.occupancy.reason).toMatch(/below an observed compaction of 977,536 tokens/);
    const none = readClaudeTranscript(claudeTranscript(SIGNAL, "⭐ Signal", []));
    expect(none.occupancy.kind).toBe("unmeasured");
    expect(none.noUsageYet).toBe(true);
    expect(levelOf(none.occupancy)).toBe("unmeasured");
  });

  it("prefers the status line's window for its own session only", () => {
    const content = claudeTranscript(SIGNAL, "⭐ Signal", [{ tokens: 150_000 }]);
    expect(readClaudeTranscript(content, { statusLine: { sessionId: SIGNAL, windowSize: 200_000 } }).occupancy).toMatchObject({ window: 200_000, percent: 75 });
    expect(readClaudeTranscript(content, { statusLine: { sessionId: ROWAN, windowSize: 200_000 } }).occupancy).toMatchObject({ window: WINDOW });
  });

  it("reads a Codex rollout's last token_count, and is unmeasured just after a compaction", () => {
    const meta = JSON.stringify({ type: "session_meta", payload: { id: ROWAN } });
    const turn = JSON.stringify({ type: "turn_context", payload: { model: "gpt-6.1-sol" } });
    const count = (input: number) => JSON.stringify({ type: "event_msg", timestamp: "2026-11-07T21:49:26.693Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, cached_input_tokens: input - 1000 }, model_context_window: 475_000 } } });
    const rateOnly = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } });
    const read = readCodexRollout([meta, turn, count(100_000), turn, count(351_348), rateOnly].join("\n"), "🚦 Rowan");
    expect(read.occupancy).toMatchObject({ kind: "measured", tokens: 351_348, window: 475_000 });
    expect(levelOf(read.occupancy)).toBe("due");
    const compacted = readCodexRollout([meta, turn, count(351_348), JSON.stringify({ type: "compacted", timestamp: "2026-11-07T21:50:00.000Z", payload: {} })].join("\n"));
    expect(compacted.occupancy).toEqual({ kind: "unmeasured", reason: "compacted since its last token count" });
    expect(compacted.episodeStart).toBe("2026-11-07T21:50:00.000Z");
  });
});

describe("the liveness timer pages each threshold once per session", () => {
  it("pages prepare at 50%, due at 60% with the loud first line, and never repeats", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 510_000 }]);
    const first = check(root, sources(home));
    expect(first.data.coordinators).toHaveLength(1);
    expect(first.data.coordinators[0]).toMatchObject({ level: "prepare", page: "prepare", handoffDue: false });
    expect(pending(root)).toHaveLength(1);
    expect(pending(root)[0]?.message).toMatch(/^👆 HANDOFF PREPARE: ⭐ Signal 3 at 51% context/);
    expect(marker(root, SIGNAL)).toMatchObject({ level: "prepare", handoff_due: false, percent: 51 });

    expect(check(root, sources(home)).data.coordinators[0]?.page).toBeNull();
    expect(pending(root)).toHaveLength(1);

    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 510_000 }, { tokens: 612_345 }]);
    const due = check(root, sources(home));
    expect(due.data.coordinators[0]).toMatchObject({ level: "due", page: "due", handoffDue: true });
    const message = pending(root)[1]?.message ?? "";
    expect(message).toMatch(/^👆👆 HANDOFF DUE: ⭐ Signal 3 at 61% context — start its successor: /);
    expect(message).toContain("612,345 of 1,000,000 tokens");
    expect(message).toContain("arcadia coordinator budget");
    expect(message.length).toBeLessThanOrEqual(500);
    expect(pending(root)[1]?.agent).toBe("Coordinator budget");
    expect(marker(root, SIGNAL)).toMatchObject({ level: "due", handoff_due: true });
    expect(Object.keys(marker(root, SIGNAL).pings).sort()).toEqual(["due", "prepare"]);

    for (let run = 0; run < 3; run += 1) check(root, sources(home));
    expect(pending(root)).toHaveLength(2);
  });

  it("pages only the highest line on a jump, and never the lower ones later", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, ROWAN, "🚦 Rowan: pressing", [{ tokens: 400_000 }]);
    check(root, sources(home));
    expect(pending(root)).toHaveLength(0);
    expect(existsSync(markerPath(root, "claude", ROWAN))).toBe(false);
    writeClaude(home, ROWAN, "🚦 Rowan: pressing", [{ tokens: 400_000 }, { tokens: 800_000 }]);
    expect(check(root, sources(home)).data.coordinators[0]?.page).toBe("forced");
    expect(check(root, sources(home)).data.coordinators[0]?.page).toBeNull();
    expect(pending(root).map((ping) => ping.message.split(":")[0])).toEqual(["👆👆👆 HANDOFF OVERDUE"]);
  });

  it("says unmeasured plainly, once, and treats it as due", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 100_000, model: "claude-haiku-9" }]);
    expect(check(root, sources(home)).data.coordinators[0]?.page).toBe("unmeasured");
    // The state file, not only the outbox's episode key, holds the second run.
    expect(check(root, sources(home)).data.coordinators[0]?.page).toBeNull();
    const pings = pending(root);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.message).toMatch(/^👆👆 HANDOFF DUE: ⭐ Signal 3 context unmeasured — treat it as due/);
    expect(pings[0]?.message).toContain("no registered context window for model claude-haiku-9");
    expect(pings[0]?.message).not.toMatch(/\d%/);
    expect(marker(root, SIGNAL)).toMatchObject({ level: "unmeasured", handoff_due: true, percent: null });
  });

  it("holds the unmeasured page for a fresh session with no usage yet, then pages after an hour", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 4", []);
    check(root, sources(home));
    expect(pending(root)).toHaveLength(0);
    check(root, sources(home), Date.now() + 61 * 60_000);
    expect(pending(root)).toHaveLength(1);
    expect(pending(root)[0]?.message).toContain("no main-chain assistant usage in the transcript yet");
  });

  it("ignores helpers, untitled sessions and transcripts idle past the live window", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, HELPER, "↳ Ellis: budget", [{ tokens: 900_000 }]);
    writeClaude(home, ROWAN, "🚦 Rowan: stale", [{ tokens: 900_000 }], 180);
    writeClaude(home, "44444444-4444-4444-8444-444444444444", null, [{ tokens: 900_000 }]);
    expect(check(root, sources(home)).data.coordinators).toEqual([]);
    expect(pending(root)).toHaveLength(0);
  });

  it("does not page twice after the state file is lost: the outbox's episode key holds", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 650_000 }]);
    check(root, sources(home));
    rmSync(path.join(root, ".arcadia", "coordinator-budget", "state.json"));
    check(root, sources(home));
    expect(pending(root)).toHaveLength(1);
  });

  it("opens a new episode after a compaction, so a later crossing pages again", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 650_000 }]);
    check(root, sources(home));
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 650_000 }, { compact: { pre: 700_000, post: 20_000, at: new Date().toISOString() } }, { tokens: 630_000 }]);
    check(root, sources(home));
    expect(pending(root).map((ping) => ping.message.split(":")[0])).toEqual(["👆👆 HANDOFF DUE", "👆👆 HANDOFF DUE"]);
  });

  it("retries a page that could not be queued on the next run", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 650_000 }]);
    expect(() => runCoordinatorBudgetCheck({ workspace: root }, { sources: sources(home), queuePing: () => { throw new Error("outbox locked"); } }))
      .toThrow(/due page for claude:1111.*will be retried.*outbox locked/);
    check(root, sources(home));
    expect(pending(root)).toHaveLength(1);
  });

  it("measures a 🚦 Codex coordinator from its rollout, titled in the session index", () => {
    const root = workspace();
    const codex = temp("arcadia-budget-codex-");
    writeFileSync(path.join(codex, "session_index.jsonl"), `${JSON.stringify({ id: ROWAN, thread_name: "🚦 Rowan (codex)", updated_at: "2026-11-07T21:09:03Z" })}\n`);
    const directory = path.join(codex, "sessions", "2026", "11", "07");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, `rollout-2026-11-07T12-09-46-${ROWAN}.jsonl`), [
      JSON.stringify({ type: "session_meta", payload: { id: ROWAN } }),
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-6.1-sol" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 300_000 }, model_context_window: 475_000 } } })
    ].join("\n"));
    const response = check(root, sources(null, codex));
    expect(response.data.coordinators[0]).toMatchObject({ agent: "codex", sessionId: ROWAN, level: "due", page: "due" });
    expect(pending(root)[0]?.message).toMatch(/^👆👆 HANDOFF DUE: 🚦 Rowan \(codex\) at 63% context/);
  });
});

/** Production Off with nothing waiting: the momentum alarm's window is closed, so it pages nobody. */
function closedRow(): IdleFrontRow {
  return {
    schema: IDLE_FRONT_ROW_SCHEMA,
    ts: new Date().toISOString(),
    critical_path: { state: "idle", label: "Inactive · Idle", desired_state: "inactive", revision: 106, epoch: 58, live_admissions: 0 },
    blocker_class: "no_ready_work",
    blocked_since: null,
    detected_at: null,
    route_at: null,
    tap_ready: null,
    ready_actions: 0,
    blockers: [],
    idle_minutes: 0,
    idle_minutes_by_cause: { detection_lag: 0, no_route: 0, waiting_on_operator: 0, no_ready_work: 0 },
    armed_wakes: [],
    no_armed_wake: true,
    missing_wakes: [],
    notes: []
  } as IdleFrontRow;
}

describe("liveness-check runs the budget on the same timer", () => {
  it("renders the handoff page with the worker and momentum checks", async () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 620_000 }]);
    const response = await runProductionLivenessTimerCommand(
      { workspace: root },
      {
        liveness: { readProductionActive: () => false },
        momentum: { readRow: async () => { throw new Error("status read failed"); } },
        budget: { sources: sources(home) }
      }
    ).catch((error: Error) => error);
    // The momentum read failure makes the run exit non-zero, but the budget page still went out and is in the log line.
    expect(response).toBeInstanceOf(Error);
    expect((response as Error).message).toMatch(/👆👆 HANDOFF DUE: ⭐ Signal 3 at 62% context/);
    expect(pending(root).filter((ping) => ping.agent === "Coordinator budget")).toHaveLength(1);
  });

  it("keeps the budget quiet when there is no coordinator, and adds its data to --json", async () => {
    const root = workspace();
    const response = await runProductionLivenessTimerCommand(
      { workspace: root },
      { liveness: { readProductionActive: () => false }, momentum: { readRow: async () => closedRow() }, budget: { sources: sources(claudeHome()) } }
    );
    expect(response.data.coordinatorBudget).toEqual({ coordinators: [], problems: [] });
    expect(renderProductionLivenessTimerSuccess(response)).toEqual([]);
  });

  it("never reads a developer's real sessions from a test process", () => {
    expect(defaultBudgetSources({ VITEST: "true" })).toEqual({ claudeProjectsDir: null, codexHome: null, claudeStatusLinePath: null });
  });
});

describe("arcadia coordinator budget", () => {
  it("shows this session's level from the environment and writes nothing", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 612_000 }]);
    writeClaude(home, ROWAN, "🚦 Rowan", [{ tokens: 200_000 }]);
    const response = runCoordinatorBudgetCommand({ workspace: root }, { sources: sources(home), env: { CLAUDE_CODE_SESSION_ID: SIGNAL } });
    expect(response.data.selfRow).toMatchObject({ sessionId: SIGNAL, level: "due", handoffDue: true });
    expect(response.data.coordinators.map((row) => row.level)).toEqual(["due", "ok"]);
    const lines = renderCoordinatorBudgetSuccess(response);
    expect(lines[0]).toMatch(/^👆👆 HANDOFF DUE for this session: ⭐ Signal 3 .*61% context/);
    expect(existsSync(path.join(root, ".arcadia", "coordinator-budget"))).toBe(false);
    expect(pending(root)).toHaveLength(0);
  });

  it("reports the pages the timer sent, from its marker", () => {
    const root = workspace();
    const home = claudeHome();
    writeClaude(home, SIGNAL, "⭐ Signal 3", [{ tokens: 612_000 }]);
    check(root, sources(home));
    const before = readdirSync(path.join(root, ".arcadia", "coordinator-budget")).sort();
    const response = runCoordinatorBudgetCommand({ workspace: root, session: SIGNAL }, { sources: sources(home), env: {} });
    expect(Object.keys(response.data.selfRow?.pings ?? {}).sort()).toEqual(["due", "prepare"]);
    expect(readdirSync(path.join(root, ".arcadia", "coordinator-budget")).sort()).toEqual(before);
  });

  it("says unmeasured when it cannot find this session's transcript", () => {
    const root = workspace();
    const response = runCoordinatorBudgetCommand({ workspace: root, session: SIGNAL }, { sources: sources(claudeHome()), env: {} });
    expect(response.data.selfRow).toBeNull();
    expect(renderCoordinatorBudgetSuccess(response)[0]).toMatch(/unmeasured/);
  });
});
