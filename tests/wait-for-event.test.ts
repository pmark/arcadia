import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../scripts/wait-for-event.sh");
const dirs: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), "wait-event-")); dirs.push(d); return d; };

/** Fake `gh` (answers `pr view <n>` from a table) and `arcadia` (prints the file named by FAKE_PRODUCTION). */
function fakeBin(states: Record<string, string> = {}): string {
  const dir = temp();
  const cases = Object.entries(states).map(([n, s]) => `  ${n}) echo "${s}" ;;`).join("\n");
  writeFileSync(join(dir, "gh"), `#!/usr/bin/env bash\ncase "$3" in\n${cases}\n  *) exit 1 ;;\nesac\n`);
  writeFileSync(join(dir, "arcadia"), `#!/usr/bin/env bash\ncat "$FAKE_PRODUCTION"\n`);
  chmodSync(join(dir, "gh"), 0o755);
  chmodSync(join(dir, "arcadia"), 0o755);
  return dir;
}

const envFor = (bin: string, extra: Record<string, string> = {}) =>
  ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, WAIT_INTERVAL: "0", ...extra });

const runSync = (args: string[], env: NodeJS.ProcessEnv) =>
  spawnSync("bash", [script, ...args], { encoding: "utf8", env, timeout: 10_000 });

/** Start the waiter, apply the changes in turn once it reports its baseline (stderr "WATCHING"), and collect its exit. */
function runWithChange(args: string[], env: NodeJS.ProcessEnv, ...changes: Array<() => void>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn("bash", [script, ...args], { env });
    let stdout = "", stderr = "", started = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      if (started || !stderr.includes("WATCHING")) return;
      started = true;
      changes.forEach((change, i) => setTimeout(change, 150 * i));
    });
    child.on("exit", (status) => done({ status, stdout, stderr }));
  });
}

const production = (state: string, revision: number, escalations: Array<[string, string]> = [], scope?: string[]) =>
  JSON.stringify({
    ok: true,
    data: {
      display: { state },
      read: { policy: { revision, scope: scope ? { actions: scope } : null } },
      operatorEscalations: escalations.map(([actionKey, kind]) => ({ actionKey, kind, message: "m" })),
    },
  });

afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("wait-for-event.sh", () => {
  it("pr: skips an open PR and reports the merged one with its sha", () => {
    const r = runSync(["pr", "o/r", "1", "2"], envFor(fakeBin({ "1": "OPEN ", "2": "MERGED abc123" })));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("PR 2 MERGED abc123");
  });

  it("pr: reports a closed PR without a trailing space", () => {
    const r = runSync(["pr", "o/r", "7"], envFor(fakeBin({ "7": "CLOSED " })));
    expect(r.stdout.trim()).toBe("PR 7 CLOSED");
  });

  it("times out with exit 3 instead of staying silent, and survives failed reads", () => {
    const r = runSync(["pr", "o/r", "1", "9"], envFor(fakeBin({ "1": "OPEN " }), { WAIT_TIMEOUT: "0" }));
    expect(r.status).toBe(3);
    expect(r.stdout.trim()).toBe("TIMEOUT waiting on pr 1 9");
  });

  it("press: ignores preflights and earlier presses, then reports the next pressed run", async () => {
    const lib = temp();
    const receipt = (run: string, body: object) => {
      mkdirSync(join(lib, "runs", "card-a", run), { recursive: true });
      writeFileSync(join(lib, "runs", "card-a", run, "receipt.json"), JSON.stringify(body));
    };
    receipt("20261106T010000Z-1", { mode: "run", outcome: "refused", phase: "P6" });
    const r = await runWithChange(["press", "card-a", lib], envFor(fakeBin()), () => {
      receipt("20261106T020000Z-2", { mode: "preflight", outcome: "preflight_ok", phase: "P2" });
      receipt("20261106T030000Z-3", { mode: "run", outcome: "succeeded", phase: "P6" });
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("PRESS card-a 20261106T030000Z-3 succeeded P6");
  });

  it("press: ignores a press already in flight when it finishes, and waits for a new press's final outcome", async () => {
    const lib = temp();
    const receipt = (run: string, body: object) => {
      mkdirSync(join(lib, "runs", "card-b", run), { recursive: true });
      writeFileSync(join(lib, "runs", "card-b", run, "receipt.json"), JSON.stringify(body));
    };
    receipt("20261106T010000Z-1", { mode: "run", outcome: "in_progress", phase: "P3" });
    const r = await runWithChange(["press", "card-b", lib], envFor(fakeBin(), { WAIT_INTERVAL: "0.05" }),
      () => receipt("20261106T010000Z-1", { mode: "run", outcome: "succeeded", phase: "P6" }),
      () => receipt("20261106T020000Z-2", { mode: "run", outcome: "in_progress", phase: "P0" }),
      () => receipt("20261106T020000Z-2", { mode: "run", outcome: "refused", phase: "P6" }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("PRESS card-b 20261106T020000Z-2 refused P6");
  });

  it("production: a payload missing its state or revision is a failed read, not a change", async () => {
    const file = join(temp(), "status.json");
    writeFileSync(file, production("active_building", 98));
    const r = await runWithChange(["production"], envFor(fakeBin(), { FAKE_PRODUCTION: file, WAIT_INTERVAL: "0.05" }),
      () => writeFileSync(file, JSON.stringify({ ok: false, data: { read: { status: "unavailable" } } })),
      () => writeFileSync(file, production("active_idle", 98)));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("PRODUCTION active_idle rev 98 (was active_building rev 98)");
    expect(r.stderr).toContain("a production read failed");
  });

  it("production: exits when the state or policy revision changes", async () => {
    const file = join(temp(), "status.json");
    writeFileSync(file, production("inactive_idle", 97));
    const r = await runWithChange(["production"], envFor(fakeBin(), { FAKE_PRODUCTION: file }), () =>
      writeFileSync(file, production("active_idle", 98)));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("PRODUCTION active_idle rev 98 (was inactive_idle rev 97)");
  });

  it("production: wakes on a new in-scope escalation that changes neither state nor revision", async () => {
    // 2026-11-06: #2145's red required check sat as "Active · No admitted work" for an hour with no wake.
    const file = join(temp(), "status.json");
    const scope = ["arcadia/a", "arcadia/b"];
    const old: [string, string] = ["arcadia/a", "awaiting_independent_verdicts"];
    writeFileSync(file, production("active_idle", 98, [old, ["other/x", "build_packet_approval_pending"]], scope));
    const r = await runWithChange(["production"],
      envFor(fakeBin(), { FAKE_PRODUCTION: file, WAIT_INTERVAL: "0.05", WAIT_TIMEOUT: "4" }),
      () => writeFileSync(file, production("active_idle", 98, [old, ["other/y", "required_checks_failed"]], scope)),
      () => writeFileSync(file, production("active_idle", 98, [old, ["arcadia/b", "required_checks_failed"]], scope)));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("PRODUCTION active_idle rev 98 ESCALATION arcadia/b required_checks_failed");
  });

  it("production: an escalation that clears and returns wakes; with no scope every Action counts", async () => {
    const file = join(temp(), "status.json");
    const red: [string, string] = ["arcadia/a", "required_checks_failed"];
    writeFileSync(file, production("inactive_idle", 99, [red]));
    const cleared = () => writeFileSync(file, production("inactive_idle", 99));
    const r = await runWithChange(["production"],
      envFor(fakeBin(), { FAKE_PRODUCTION: file, WAIT_INTERVAL: "0.05", WAIT_TIMEOUT: "4" }),
      // hold the cleared state about 1.2 s, many 50 ms polls, so a loaded host still sees it
      cleared, cleared, cleared, cleared, cleared, cleared, cleared, cleared,
      () => writeFileSync(file, production("inactive_idle", 99, [red])));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("PRODUCTION inactive_idle rev 99 ESCALATION arcadia/a required_checks_failed");
  });

  it("prints usage and exits 2 for an unknown kind", () => {
    const r = runSync(["nope"], envFor(fakeBin()));
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("wait-for-event.sh production");
  });
});
