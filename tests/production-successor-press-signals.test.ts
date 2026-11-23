import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderSuccessorLines, runProductionSuccessorCommand, type ProductionSuccessorData } from "../src/commands/productionSuccessor.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import type { SuccessorPorts } from "../src/production/successorPress.js";

/**
 * The host timer's successor press must not fail silently (#2978): a skip reason logs one line an hour and a port exception that
 * repeats for more than ten minutes pings once. Fake ports and a fake clock; the step's own decisions are not under test here.
 */
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => {
  try { chmodSync(path.join(directory, "workspace", ".arcadia"), 0o700); } catch { /* not made read-only */ }
  rmSync(directory, { recursive: true, force: true });
}));
const MINUTE = 60_000;
const T0 = Date.parse("2026-11-22T20:00:00Z");

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-successor-signals-")));
  directories.push(root);
  const workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  const w = { workspace, minutes: 0, grantOpen: false, active: false, error: null as string | null, pings: [] as Array<{ message: string; key: string }> };
  const ports = (now: Date): SuccessorPorts => ({
    now,
    grant: () => { if (w.error) throw new Error(w.error); return { open: w.grantOpen, plan: "plan", approvalCard: "card", approvalRun: "run" }; },
    production: () => ({ desiredState: w.active ? "active" : "inactive", liveAdmissions: 1, scopeComplete: false, revision: 1 }),
    batch: () => { throw new Error("unexpected batch read"); },
    ping: (input) => { w.pings.push(input); return `ping-${w.pings.length}`; }
  } as unknown as SuccessorPorts);
  /** One timer run `minutes` after the start; a thrown error is returned, not raised. */
  const run = (minutes: number) => {
    w.minutes = minutes;
    try { return { data: runProductionSuccessorCommand({ workspace }, { now: () => T0 + minutes * MINUTE, ports }).data, error: null as Error | null }; }
    catch (error) { return { data: null, error: error as Error }; }
  };
  return { w, run };
}
const lines = (result: { data: ProductionSuccessorData | null }) => (result.data ? renderSuccessorLines(result.data, "STAMP") : []);

describe("successor press: loud skips", () => {
  it("logs one line per skip reason per hour, again after the hour, and a different reason at once", () => {
    const { w, run } = fixture();
    const first = lines(run(0));
    expect(first).toEqual(["STAMP successor press: skipped (GRANT_NOT_OPEN): no standing grant is open; repeats are logged once an hour"]);
    expect(lines(run(1))).toEqual([]);
    expect(lines(run(59))).toEqual([]);
    w.grantOpen = true;
    w.active = true;
    const other = lines(run(59));
    expect(other).toHaveLength(1);
    expect(other[0]).toContain("skipped (PRODUCTION_NOT_OFF)");
    expect(lines(run(60))).toEqual([]);
    w.grantOpen = false;
    // GRANT_NOT_OPEN was last logged at minute 0, a different reason since: the hour has passed.
    expect(lines(run(60))).toHaveLength(1);
  });

  it("logs the first skip again once the hour has passed, and keeps the outcome and press state unchanged", () => {
    const { run } = fixture();
    expect(lines(run(0))).toHaveLength(1);
    expect(lines(run(59))).toEqual([]);
    const after = run(60);
    expect(lines(after)).toHaveLength(1);
    expect(after.data!.outcome).toEqual({ kind: "skipped", reason: "GRANT_NOT_OPEN", detail: "no standing grant is open", offIssued: false });
  });

  it("adds no key to the data of a run that has nothing new to log", () => {
    const { run } = fixture();
    run(0);
    expect(Object.keys(run(1).data!)).toEqual(["outcome"]);
  });
});

describe("successor press: a repeated port exception", () => {
  const ERROR = "git ls-tree: fatal: not a tree object";

  it("pings once after more than ten minutes, never again for the same text, and pings a different text", () => {
    const { w, run } = fixture();
    w.error = ERROR;
    for (let minute = 0; minute <= 10; minute += 1) {
      const result = run(minute);
      expect(result.error?.message).toBe(ERROR);
    }
    expect(w.pings).toEqual([]);
    const pinged = run(11);
    expect(w.pings).toHaveLength(1);
    expect(w.pings[0].key).toMatch(/^successor-press-exception-[0-9a-f]{12}$/);
    expect(w.pings[0].message).toContain(ERROR);
    expect(pinged.error?.message).toContain(`${ERROR} (same error for 11 min; queued ping ping-1)`);
    for (let minute = 12; minute <= 40; minute += 1) expect(run(minute).error?.message).toBe(ERROR);
    expect(w.pings).toHaveLength(1);
    w.error = "a different failure";
    for (let minute = 41; minute <= 51; minute += 1) run(minute);
    expect(w.pings).toHaveLength(1);
    run(52);
    expect(w.pings).toHaveLength(2);
    expect(w.pings[1].key).not.toBe(w.pings[0].key);
  });

  it("pings nothing for an exception that lasts five minutes", () => {
    const { w, run } = fixture();
    w.error = ERROR;
    for (let minute = 0; minute <= 5; minute += 1) run(minute);
    w.error = null;
    expect(run(6).error).toBeNull();
    expect(w.pings).toEqual([]);
  });

  it("starts over after a run that does not throw", () => {
    const { w, run } = fixture();
    w.error = ERROR;
    for (let minute = 0; minute <= 8; minute += 1) run(minute);
    w.error = null;
    expect(run(9).error).toBeNull();
    w.error = ERROR;
    for (let minute = 10; minute <= 20; minute += 1) run(minute);
    expect(w.pings).toEqual([]);
    run(21);
    expect(w.pings).toHaveLength(1);
  });

  it("keeps the press state file untouched by the tracking", () => {
    const { w, run } = fixture();
    w.error = ERROR;
    run(0);
    expect(existsSync(path.join(w.workspace, ".arcadia", "successor-press.json"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(w.workspace, ".arcadia", "successor-press-signals.json"), "utf8")).exception.pinged).toBe(false);
  });

  const SHA_A = "a".repeat(40);
  const moved = (sha: string) => `.arcadia/START_RUN.md is not readable at origin main ${sha}; ls-tree: fatal: not a tree object`;
  const hex = (n: number) => n.toString(16).padStart(40, "0");

  it("keeps one episode when origin main's sha changes every 30 minutes for a day: exactly one ping", () => {
    const { w, run } = fixture();
    for (let minute = 0; minute <= 24 * 60; minute += 1) { w.error = moved(hex(Math.floor(minute / 30) + 1)); run(minute); }
    expect(w.pings).toHaveLength(1);
  });

  it("still pings once after 11 minutes when the sha changes every 8 minutes, and ignores numbers in the text", () => {
    const { w, run } = fixture();
    for (let minute = 0; minute <= 40; minute += 1) {
      w.error = `${moved(hex(Math.floor(minute / 8) + 1))} (attempt ${minute}, 3 of 9)`;
      run(minute);
      expect(w.pings).toHaveLength(minute >= 11 ? 1 : 0);
    }
  });

  it("gives genuinely different errors separate clocks and pings", () => {
    const { w, run } = fixture();
    for (let minute = 0; minute <= 11; minute += 1) { w.error = moved(SHA_A); run(minute); }
    expect(w.pings).toHaveLength(1);
    for (let minute = 12; minute <= 23; minute += 1) { w.error = `gh: authentication failed at ${SHA_A}`; run(minute); }
    expect(w.pings).toHaveLength(2);
    expect(new Set(w.pings.map((ping) => ping.key)).size).toBe(2);
  });

  it("keeps the ping text stable, keyed in the message and free of home paths, so the queue's episode dedup holds", () => {
    const { w, run } = fixture();
    w.error = "cannot read /Users/pmark/Dev/MR/Arcadia/arcadia/objects: not a tree object";
    run(0);
    chmodSync(path.join(w.workspace, ".arcadia"), 0o500); // the tracking cannot be saved from here on
    for (let minute = 1; minute <= 30; minute += 1) run(minute);
    expect(w.pings.length).toBeGreaterThan(0);
    for (const ping of w.pings) {
      expect(ping.message).toContain(`[${ping.key}]`);
      expect(ping.message).toBe(w.pings[0].message);
      expect(ping.message).not.toContain("pmark");
      expect(ping.message).toContain("~/Dev/MR/Arcadia/arcadia/objects");
    }
    // The queue's episode dedup (instr(message, key)) collapses these to one row.
    const rows: string[] = [];
    for (const ping of w.pings) if (!rows.some((message) => message.includes(ping.key))) rows.push(ping.message);
    expect(rows).toHaveLength(1);
  });

  it("restarts the clock for an unparseable `since` and reads a malformed signals file as empty", () => {
    const { w, run } = fixture();
    const file = path.join(w.workspace, ".arcadia", "successor-press-signals.json");
    w.error = ERROR;
    run(0);
    const tracked = JSON.parse(readFileSync(file, "utf8")) as { exception: { since: string } };
    tracked.exception.since = "not a date";
    writeFileSync(file, JSON.stringify(tracked));
    run(30);
    expect(JSON.parse(readFileSync(file, "utf8")).exception.since).toBe(new Date(T0 + 30 * MINUTE).toISOString());
    run(40);
    expect(w.pings).toEqual([]);
    run(41);
    expect(w.pings).toHaveLength(1);
    writeFileSync(file, "{ not json");
    expect(run(42).error?.message).toContain(ERROR);
    expect(JSON.parse(readFileSync(file, "utf8")).exception.since).toBe(new Date(T0 + 42 * MINUTE).toISOString());
  });
});
