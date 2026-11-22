import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../scripts/wait-for-event.sh");
const dirs: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), "wait-event-")); dirs.push(d); return d; };

/**
 * Fake `gh` (answers `pr view <n>` from a table) and `arcadia` (prints the file named by FAKE_PRODUCTION).
 * With FAKE_GH_DIR set, `gh pr view <n>` prints view-<n>.json and `gh api .../issues/<n>/comments` prints
 * comments-<n>.jsonl (a missing file is a failed read).
 */
function fakeBin(states: Record<string, string> = {}): string {
  const dir = temp();
  const cases = Object.entries(states).map(([n, s]) => `  ${n}) echo "${s}" ;;`).join("\n");
  const files = `if [ -n "\${FAKE_GH_DIR:-}" ]; then
  case "$1" in
    pr) cat "$FAKE_GH_DIR/view-$3.json" ;;
    api) n=\${3%/comments}; cat "$FAKE_GH_DIR/comments-\${n##*/}.jsonl" ;;
  esac
  exit $?
fi
`;
  writeFileSync(join(dir, "gh"), `#!/usr/bin/env bash\n${files}case "$3" in\n${cases}\n  *) exit 1 ;;\nesac\n`);
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

// ready mode: the PR's two reads live in a directory the fake `gh` serves (FAKE_GH_DIR).
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OK = "PASS — Loosens a gate: no. Changes agent authority: no.";
type Comment = { body: string; html_url: string };
const view = (over: object = {}) => ({ state: "OPEN", isDraft: false, headRefOid: HEAD, mergeStateStatus: "CLEAN", mergeCommit: null,
  statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }], ...over });
const note = (body: string, id: string): Comment => ({ body, html_url: `https://github.com/o/r/pull/7#issuecomment-${id}` });
const review = (verdict: string, head = HEAD): Comment => note(`Independent review, head ${head}: ${verdict}`, "9");
const MARKER_URL = "https://github.com/o/r/pull/7#issuecomment-9";
function served(v: object, comments: Comment[], dir = temp()): string {
  writeFileSync(join(dir, "view-7.json"), JSON.stringify(v));
  writeFileSync(join(dir, "comments-7.jsonl"), comments.map((c) => `${JSON.stringify(c)}\n`).join(""));
  return dir;
}
const ready = (v: object, comments: Comment[]) =>
  runSync(["ready", "o/r", "7"], envFor(fakeBin(), { FAKE_GH_DIR: served(v, comments), WAIT_TIMEOUT: "0" }));
const mergeCheck = "next=arcadia work merge-check --pr 7";

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
    expect(r.stdout).toContain("wait-for-event.sh ready");
    expect(r.stdout).toContain("--edges");
  });

  describe("ready", () => {
    it("fires on a full-sha PASS for the exact head with green checks and CLEAN, naming the merge-check and the marker", () => {
      const r = ready(view(), [review(OK)]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(`EVENT ready 7 ${HEAD} ${mergeCheck} proof=${MARKER_URL}`);
    });

    it("hands the merge to the operator unless the marker says both authority phrases are no (R5)", () => {
      const operator = `EVENT ready 7 ${HEAD} next=operator-merge proof=${MARKER_URL}`;
      expect(ready(view(), [review("PASS — Loosens a gate: yes. Changes agent authority: no.")]).stdout.trim()).toBe(operator);
      expect(ready(view(), [review("PASS")]).stdout.trim()).toBe(operator);
      const prose = ready(view(), [review("PASS\n\nI checked that it Loosens a gate: no, in prose.\nChanges agent authority: no")]);
      expect(prose.stdout.trim()).toBe(operator);
      const lines = ready(view(), [review("PASS\nLoosens a gate: no\n**Changes agent authority: no**")]);
      expect(lines.stdout.trim()).toBe(`EVENT ready 7 ${HEAD} ${mergeCheck} proof=${MARKER_URL}`);
    });

    it("keeps waiting on a PASS for an older head, then exits after a new marker", async () => {
      const older = review(OK, "f".repeat(40));
      const dir = served(view(), [older]);
      expect(runSync(["ready", "o/r", "7"], envFor(fakeBin(), { FAKE_GH_DIR: dir, WAIT_TIMEOUT: "0" })).status).toBe(3);
      const r = await runWithChange(["ready", "o/r", "7"], envFor(fakeBin(), { FAKE_GH_DIR: dir, WAIT_INTERVAL: "0.05", WAIT_TIMEOUT: "4" }),
        () => served(view(), [older, review(OK)], dir));
      expect(r.stdout.trim()).toBe(`EVENT ready 7 ${HEAD} ${mergeCheck} proof=${MARKER_URL}`);
    });

    it.each([
      ["a marker sha shorter than 40 characters", view(), [review(OK, HEAD.slice(0, 12))]],
      ["a draft PR", view({ isDraft: true }), [review(OK)]],
      ["a marker quoted mid-text", view(), [note(`> as in: Independent review, head ${HEAD}: ${OK}`, "9")]],
      ["PASS WITH FIXES", view(), [review("PASS WITH FIXES — Loosens a gate: no.")]],
      ["pending checks", view({ statusCheckRollup: [{ status: "IN_PROGRESS", conclusion: "" }] }), [review(OK)]],
      ["an empty rollup", view({ statusCheckRollup: [] }), [review(OK)]],
      ["a BEHIND merge state", view({ mergeStateStatus: "BEHIND" }), [review(OK)]],
    ])("keeps waiting on %s", (_name, v, comments) => {
      const r = ready(v, comments);
      expect(r.status).toBe(3);
      expect(r.stdout.trim()).toBe("TIMEOUT waiting on ready 7");
    });

    const worker = note(`Arcadia worker: review of \`${HEAD}\` failed.\n\n**Do not merge** until repaired.`, "4");
    it.each([
      ["a FAIL marker", [review("FAIL")], view(), "review-fail", MARKER_URL],
      ["a Blocking finding line", [review("PASS\n\n- Blocking finding: the guard is gone.")], view(), "review-fail", MARKER_URL],
      ["a worker FAIL posted before a later PASS", [worker, review(OK)], view(), "worker-fail", "https://github.com/o/r/pull/7#issuecomment-4"],
      ["a red check", [review(OK)], view({ statusCheckRollup: [{ status: "COMPLETED", conclusion: "TIMED_OUT" }] }), "checks-fail", "checks"],
    ])("blocks on %s", (_name, comments, v, reason, proof) => {
      const r = ready(v, comments);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(`EVENT blocked 7 ${HEAD} reason=${reason} proof=${proof}`);
    });

    it.each(["No blocking findings.", "Blocking: none", "Blocking findings: 0", "Non-blocking: rename a variable"])("still passes with %j", (line) => {
      expect(ready(view(), [review(`${OK}\n\n${line}`)]).stdout.trim()).toBe(`EVENT ready 7 ${HEAD} ${mergeCheck} proof=${MARKER_URL}`);
    });

    it("prints the pr-mode line when the PR merges or closes, and skips a failed read", () => {
      expect(ready(view({ state: "MERGED", mergeCommit: { oid: "abc123" } }), []).stdout.trim()).toBe("PR 7 MERGED abc123");
      expect(ready(view({ state: "CLOSED" }), []).stdout.trim()).toBe("PR 7 CLOSED");
      const r = runSync(["ready", "o/r", "7"], envFor(fakeBin(), { FAKE_GH_DIR: temp(), WAIT_TIMEOUT: "0" }));
      expect(r.status).toBe(3);
      expect(r.stderr).toContain("a ready read failed");
    });
  });

  describe("production --edges", () => {
    const run = (file: string, ...changes: Array<() => void>) =>
      runWithChange(["production", "--edges"], envFor(fakeBin(), { FAKE_PRODUCTION: file, WAIT_INTERVAL: "0.05", WAIT_TIMEOUT: "6" }), ...changes);
    const put = (file: string, ...args: Parameters<typeof production>) => () => writeFileSync(file, production(...args));

    it("ignores an idle/building flip and a revision bump alone, and wakes on a class change", async () => {
      const file = join(temp(), "status.json");
      writeFileSync(file, production("active_idle", 98));
      const building = put(file, "active_building", 98);
      // each held about 150 ms, three polls, so a loaded host still sees it
      const r = await run(file, building, put(file, "active_building", 99), building, building, building, put(file, "inactive_finishing", 99));
      expect(r.stdout.trim()).toBe("PRODUCTION inactive_finishing rev 99 (was active_building rev 98)");
    });

    it("wakes on a changed scope, null included, and reports the new count", async () => {
      const file = join(temp(), "status.json");
      writeFileSync(file, production("active_idle", 98, [], ["arcadia/a"]));
      const bump = put(file, "active_idle", 99, [], ["arcadia/a"]);
      const r = await run(file, bump, bump, bump, put(file, "active_idle", 99, [], ["arcadia/a", "arcadia/b"]));
      expect(r.stdout.trim()).toBe("PRODUCTION active_idle rev 99 SCOPE 2 actions (was 1)");
    });

    it("wakes on a new in-scope escalation, and on one that clears and returns", async () => {
      const file = join(temp(), "status.json");
      const scope = ["arcadia/a", "arcadia/b"];
      const red: [string, string] = ["arcadia/b", "required_checks_failed"];
      writeFileSync(file, production("active_idle", 98, [["other/x", "k"]], scope));
      const first = await run(file, put(file, "active_idle", 98, [["other/y", "k"]], scope), put(file, "active_idle", 98, [red], scope));
      expect(first.stdout.trim()).toBe("PRODUCTION active_idle rev 98 ESCALATION arcadia/b required_checks_failed");
      writeFileSync(file, production("inactive_idle", 99, [red]));
      const clear = put(file, "inactive_idle", 99);
      const again = await run(file, clear, clear, clear, clear, clear, clear, clear, clear, put(file, "inactive_idle", 99, [red]));
      expect(again.stdout.trim()).toBe("PRODUCTION inactive_idle rev 99 ESCALATION arcadia/b required_checks_failed");
    });
  });
});
