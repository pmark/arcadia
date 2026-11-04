import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWorkMonitorSuccess } from "../src/commands/workMonitor.js";
import { withDatabase } from "../src/db/connection.js";
import { activateProduction, fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";
import { formatRunWindowLines, observeRunWindow, type RunWindowDeps } from "../src/workMonitoring/runWindow.js";
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

function card(id: string, pins: { reviewedRevision?: string; expires_at?: string; consumed?: boolean } = {}): void {
  writeFileSync(path.join(library, `${id}.json`), JSON.stringify({
    schema: "arcadia-operator-script-v1",
    id,
    expires_at: pins.expires_at ?? "2026-11-05T00:00:00.000Z",
    startRun: { schema: "arcadia-start-run-v1", reviewedRevision: pins.reviewedRevision ?? MAIN }
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
    expect(text).toContain("refuse or disturb");
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
});
