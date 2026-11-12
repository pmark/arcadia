import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWorkMonitorSuccess } from "../src/commands/workMonitor.js";
import { withDatabase } from "../src/db/connection.js";
import { activateProduction, fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";
import { formatRunWindowLines, holdStartCard, observeRunWindow, type RunWindowDeps, unholdStartCard } from "../src/workMonitoring/runWindow.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const MAIN = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = new Date("2026-11-04T12:00:00Z");
const roots: string[] = [];
let workspace: string;
let library: string;

beforeEach(() => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-run-window-")));
  roots.push(root);
  workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  library = path.join(root, "library");
  mkdirSync(library);
});
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const deps = (overrides: Partial<RunWindowDeps> = {}): RunWindowDeps => ({
  now: () => NOW,
  libraryDir: () => library,
  originMain: () => MAIN,
  ...overrides
});

function card(id: string, pins: { reviewedRevision?: string; expires_at?: string; consumed?: boolean; workerLabel?: string } = {}): void {
  writeFileSync(path.join(library, `${id}.json`), JSON.stringify({
    schema: "arcadia-operator-script-v1",
    id,
    expires_at: pins.expires_at ?? "2026-11-05T00:00:00.000Z",
    startRun: { schema: "arcadia-start-run-v1", reviewedRevision: pins.reviewedRevision ?? MAIN, ...(pins.workerLabel ? { workerLabel: pins.workerLabel } : {}) }
  }));
  if (pins.consumed) writeFileSync(path.join(library, `${id}.consumed.json`), JSON.stringify({ state: "CONSUMED" }));
}

const observe = (d: RunWindowDeps = deps()) => withDatabase(workspace, (db) => observeRunWindow(db, d));

describe("work monitor run window", () => {
  it("is closed with no Active production and no card", () => {
    writeFileSync(path.join(library, "unrelated.json"), JSON.stringify({ schema: "arcadia-operator-script-v1" }));
    const window = observe();
    expect(window).toMatchObject({ state: "closed", reasons: [], unknown: [] });
    expect(formatRunWindowLines(window)).toEqual([]);
  });

  it("is open while managed production is Active", () => {
    const scope = normalizeProductionScope({
      intent: "Run window fixture.", projects: ["fixture"], plans: ["fixture/rehearsal"], actions: ["fixture/one"],
      providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: []
    });
    withDatabase(workspace, (db) => activateProduction(db, {
      requestId: "run-window-activate", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator"
    }));
    const window = observe();
    expect(window.state).toBe("open");
    expect(window.reasons[0]).toMatchObject({ kind: "production_active", until: null });
    const text = formatRunWindowLines(window).join("\n");
    expect(text).toContain("Run window: OPEN");
    expect(text).toContain("rehearsal-freeze-window.md");
    expect(text).not.toContain("Do not merge");
    expect(text).toContain("managed production is Active");
    expect(text).toContain("terminal production Off");
  });

  it("is open for a START card ready to press at origin/main, and says until when", () => {
    card("start-run-waiting", { expires_at: "2026-11-04T18:30:00Z" });
    const window = observe();
    expect(window.state).toBe("open");
    expect(window.reasons).toEqual([expect.objectContaining({ kind: "start_card_waiting", subject: "start-run-waiting", until: "2026-11-04T18:30:00.000Z" })]);
    const text = formatRunWindowLines(window).join("\n");
    expect(text).toContain("Do not merge to main now");
    expect(text).toContain("waiting START card refuse");
    expect(text).toContain("start-run-waiting");
    expect(text).toContain("until 2026-11-04T18:30:00.000Z");
  });

  it("ignores a consumed card and an expired card", () => {
    card("start-run-consumed", { consumed: true });
    card("start-run-expired", { expires_at: "2026-11-04T11:59:59Z" });
    expect(observe()).toMatchObject({ state: "closed", reasons: [], unknown: [] });
  });

  it("ignores a card whose reviewed revision is no longer origin/main", () => {
    card("start-run-stale", { reviewedRevision: OLD });
    expect(observe()).toMatchObject({ state: "closed", reasons: [] });
  });

  it("reports unknown, in one line, when the library cannot be read", () => {
    const window = observe(deps({ libraryDir: () => path.join(library, "missing") }));
    expect(window.state).toBe("unknown");
    const lines = formatRunWindowLines(window);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Run window: UNKNOWN \(the operator-script library could not be read/);
  });

  it("reports unknown when production state is unreadable, or a card cannot be matched", () => {
    const broken = withDatabase(workspace, (db) => {
      db.exec("DROP TABLE IF EXISTS production_policy");
      return observeRunWindow(db, deps());
    });
    expect(broken.state).toBe("unknown");
    expect(broken.unknown[0]).toContain("managed production state could not be read");

    card("start-run-waiting");
    const noOrigin = observe(deps({ originMain: () => null }));
    expect(noOrigin.state).toBe("unknown");
    expect(noOrigin.unknown[0]).toContain("origin/main");
  });

  it("reports unknown when a descriptor is unreadable and no waiting card is seen", () => {
    writeFileSync(path.join(library, "broken.json"), "{not json");
    expect(observe().state).toBe("unknown");
  });

  it("renders the window first in the monitor text and keeps the JSON additive", () => {
    card("start-run-waiting");
    const runWindow = observe();
    const response = {
      ok: true, command: "work.monitor", artifacts: [], warnings: [],
      data: {
        snapshot: { totals: { projects: 0, workingCopies: 0, unsaved: 0, localOnly: 0, pushedWithoutPr: 0, pullRequestUnknown: 0 }, repositories: [] },
        attentionLines: [], runWindow
      }
    } as never;
    const lines = renderWorkMonitorSuccess(response);
    expect(lines[0]).toMatch(/^Run window: OPEN/);
    expect(lines).toContain("Working-copy safety");
    expect(Object.keys((response as { data: object }).data)).toEqual(["snapshot", "attentionLines", "runWindow"]);
  });

  // Issue #2179: the card used to read "ready to press" while preflight P2 would refuse for a worker with no PID.
  it("says a waiting card is not pressable when its pinned worker job has no running PID", () => {
    const label = "com.arcadia.local.742852621.worker";
    card("start-run-down", { workerLabel: label });
    const asked: string[] = [];
    const down = observe(deps({ workerRunning: (l) => { asked.push(l); return false; } }));
    expect(asked).toEqual([label]);
    expect(down.state).toBe("open");
    expect(down.reasons[0]).toMatchObject({ kind: "start_card_waiting", pressable: false });
    expect(down.reasons[0]?.detail).toContain(`not pressable: worker ${label} has no running PID`);
    expect(down.reasons[0]?.detail).not.toContain("ready to press");

    const up = observe(deps({ workerRunning: () => true }));
    expect(up.reasons[0]).toMatchObject({ pressable: true });
    expect(up.reasons[0]?.detail).toContain("ready to press");

    // Unknown (launchctl unavailable) must not invent a refusal.
    const unknown = observe(deps({ workerRunning: () => null }));
    expect(unknown.reasons[0]).toMatchObject({ pressable: true });
  });
});

describe("work monitor run window held START cards", () => {
  const EVIDENCE = "https://github.com/pmark/arcadia/issues/2522";

  it("reports a held card without opening the window, and never edits the card files", () => {
    card("start-run-held");
    const cardBefore = readFileSync(path.join(library, "start-run-held.json"), "utf8");
    writeFileSync(path.join(library, "start-run-held.held.json"), JSON.stringify({
      schema: "arcadia-card-held-v1", id: "start-run-held", reason: "no-go until the fix lands", evidence: EVIDENCE, heldAt: NOW.toISOString(), heldBy: "tester"
    }));
    const window = observe();
    expect(window.state).toBe("closed");
    expect(window.reasons).toEqual([]);
    expect(window.held).toEqual([`START card start-run-held is held: no-go until the fix lands (${EVIDENCE})`]);
    expect(formatRunWindowLines(window)).toEqual([`START card start-run-held is held: no-go until the fix lands (${EVIDENCE})`]);
    expect(readFileSync(path.join(library, "start-run-held.json"), "utf8")).toBe(cardBefore);
  });

  it("keeps the window open for an unheld card alongside a held one", () => {
    card("start-run-held");
    card("start-run-ready");
    writeFileSync(path.join(library, "start-run-held.held.json"), JSON.stringify({
      schema: "arcadia-card-held-v1", id: "start-run-held", reason: "r", evidence: "docs/x.md", heldAt: NOW.toISOString(), heldBy: "tester"
    }));
    const window = observe();
    expect(window.state).toBe("open");
    expect(window.reasons.map((reason) => reason.subject)).toEqual(["start-run-ready"]);
    expect(window.held).toHaveLength(1);
  });

  it("reports unknown, not held, when a hold marker is unreadable", () => {
    card("start-run-bad");
    writeFileSync(path.join(library, "start-run-bad.held.json"), "{not json");
    const window = observe();
    expect(window.state).toBe("open");
    expect(window.held).toEqual([]);
    expect(window.unknown.join(" ")).toContain("START card start-run-bad hold marker could not be read");
  });

  it("unholdStartCard removes only the marker, refuses when none exists, and records the removal in history", () => {
    card("start-run-u");
    const cardBefore = readFileSync(path.join(library, "start-run-u.json"), "utf8");
    holdStartCard(library, "start-run-u", { reason: "first", evidence: EVIDENCE, heldBy: "tester", repository: library }, NOW);
    expect(observe().held).toHaveLength(1);
    unholdStartCard(library, "start-run-u", { reason: "fixed", unheldBy: "tester" }, NOW);
    expect(existsSync(path.join(library, "start-run-u.held.json"))).toBe(false);
    expect(readFileSync(path.join(library, "start-run-u.json"), "utf8")).toBe(cardBefore);
    const history = readFileSync(path.join(library, "start-run-u.held-history.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(history.map((entry) => entry.event)).toEqual(["held", "unheld"]);
    expect(history[1]).toMatchObject({ reason: "fixed", previousReason: "first", previousEvidence: EVIDENCE });
    expect(observe()).toMatchObject({ state: "open", held: [] });
    expect(observe().reasons.map((reason) => reason.subject)).toEqual(["start-run-u"]);
    expect(() => unholdStartCard(library, "start-run-u", { reason: "again", unheldBy: "tester" }, NOW)).toThrow(/no hold marker/);
  });

  it("an expired or consumed card ignores its hold marker", () => {
    card("start-run-exp", { expires_at: "2026-11-01T00:00:00.000Z" });
    writeFileSync(path.join(library, "start-run-exp.held.json"), JSON.stringify({ schema: "arcadia-card-held-v1", id: "start-run-exp", reason: "r", evidence: EVIDENCE, heldAt: NOW.toISOString(), heldBy: "t" }));
    card("start-run-used", { consumed: true });
    writeFileSync(path.join(library, "start-run-used.held.json"), JSON.stringify({ schema: "arcadia-card-held-v1", id: "start-run-used", reason: "r", evidence: EVIDENCE, heldAt: NOW.toISOString(), heldBy: "t" }));
    const window = observe();
    expect(window).toMatchObject({ state: "closed", reasons: [], held: [], unknown: [] });
  });

  it("holdStartCard writes only the marker and refuses missing, consumed or expired cards", () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), "arcadia-hold-repo-"));
    roots.push(repo);
    writeFileSync(path.join(repo, "evidence.md"), "x");
    card("start-run-a");
    const input = { reason: "held for review", evidence: "evidence.md", heldBy: "tester", repository: repo };
    const hold = holdStartCard(library, "start-run-a", input, NOW);
    expect(hold).toMatchObject({ schema: "arcadia-card-held-v1", id: "start-run-a", evidence: "evidence.md", heldBy: "tester" });
    expect(JSON.parse(readFileSync(path.join(library, "start-run-a.held.json"), "utf8"))).toMatchObject({ reason: "held for review" });

    expect(() => holdStartCard(library, "start-run-missing", input, NOW)).toThrow(/missing/);
    card("start-run-consumed", { consumed: true });
    expect(() => holdStartCard(library, "start-run-consumed", input, NOW)).toThrow(/already consumed/);
    card("start-run-old", { expires_at: "2026-11-01T00:00:00.000Z" });
    expect(() => holdStartCard(library, "start-run-old", input, NOW)).toThrow(/expired/);
    expect(() => holdStartCard(library, "start-run-a", { ...input, evidence: "../etc/passwd" }, NOW)).toThrow(/evidence/);
    expect(() => holdStartCard(library, "start-run-a", { ...input, evidence: "missing.md" }, NOW)).toThrow(/does not exist/);
    expect(() => holdStartCard(library, "start-run-a", { ...input, reason: "  " }, NOW)).toThrow(/reason/);
  });
});
