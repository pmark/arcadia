import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPendingAgentAskNotifications } from "../src/ask/settlement.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import {
  BUNDLE_FILE_MAX_BYTES,
  collectHangEvidence,
  DEFAULT_HANG_EVIDENCE_LIMITS,
  HANG_CHILD_MIN_AGE_MS,
  LOG_TAIL_MAX_BYTES,
  parseElapsedMs,
  scrubText,
  writeEvidenceBundle,
  type BundleAlert,
  type HangEvidence
} from "../src/production/evidenceBundle.js";
import { listOpenRedAlerts, observeStall, raiseRedAlert } from "../src/production/redAlerts.js";
import { REVIEW_REPAIR_ROUNDS_EXHAUSTED, verdictIsRepairable, type ReviewRepairCheck, type ReviewRepairFinding } from "../src/production/reviewRepair.js";
import { ensureReviewRepairTable } from "../src/sessions/reviewRepair.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * The evidence bundle: a replayed hang (#2084) and attempt 2's QA stop each
 * yield a bundle a fixture can be cut from, and capture stays bounded, scrubbed
 * and unable to hold the write lock or stop the tick.
 *
 * The hang replays use real processes and the host's real `ps`, `lsof` and
 * `sample`. Under a macOS Seatbelt sandbox `ps` is refused, so run this file
 * outside the sandbox.
 */

// Assembled at runtime, so no secret-shaped literal sits in the repository.
const GITHUB_TOKEN = `ghp_${"a1B2".repeat(9)}`;
const API_KEY = `sk-${"x9Y8".repeat(8)}`;
const NOW = new Date("2026-11-05T02:11:00.000Z");
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const FIXTURE = path.resolve("tests/fixtures/evidence-bundle/attempt-2-qa-stop");

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) { try { cleanup(); } catch { /* already gone */ } } });

function tempDirectory(prefix: string): string {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function tempWorkspace(): string {
  const workspace = path.join(tempDirectory("arcadia-bundle-"), "workspace");
  initWorkspace(workspace);
  return workspace;
}

/** Stand-ins for `ps`, `lsof` or `sample`, found first on the search path handed to the collector. */
function fakeCommands(scripts: Record<string, string>): string {
  const directory = tempDirectory("arcadia-bundle-bin-");
  for (const [name, body] of Object.entries(scripts)) {
    const file = path.join(directory, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return directory;
}

/** A process table whose pids exist only in this text: nothing real is sampled. */
const FAKE_TABLE = [
  "  4242     1    10:00 S    /opt/worker/node",
  "  4243  4242    09:00 S    /usr/bin/python3",
  "  4244  4242    08:00 S    /usr/local/bin/reader with spaces",
  "  4245  4242    00:02 S    /usr/bin/young",
  "  9999     1    10:00 S    /usr/bin/unrelated"
].join("\n");
const fakePs = `/bin/cat <<'TABLE'\n${FAKE_TABLE}\nTABLE`;
/** `sample <pid> <seconds> -mayDie -file <path>`: write the result where it was asked for. */
const fakeSample = 'printf "Analysis of sampling\\n" > "$5"';

/** Every file under a directory, so a scrub assertion cannot miss one. */
function allText(directory: string): string {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .map((name) => path.join(directory, name))
    .filter((file) => statSync(file).isFile())
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

async function waitFor(file: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !existsSync(file); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!existsSync(file)) throw new Error(`${file} never appeared`);
}

/**
 * The shape of #2084: a Node parent blocked in spawnSync on its child, as the
 * worker was in `execFileSync`. The child's argv carries a token, as a real
 * command line can. Its own process group, so the test ends all of it.
 */
async function hungTree(): Promise<{ rootPid: number }> {
  const marker = path.join(tempDirectory("arcadia-hang-"), "ready");
  const shell = `echo ready > '${marker}'; /bin/sleep 120; : ${GITHUB_TOKEN}`;
  const root = spawn(process.execPath, ["-e", `require("child_process").spawnSync("/bin/sh", ["-c", ${JSON.stringify(shell)}], { stdio: "ignore" })`], { stdio: "ignore", detached: true });
  cleanups.push(() => process.kill(-root.pid!, "SIGKILL"));
  await waitFor(marker);
  // `ps -o etime=` has one-second resolution.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return { rootPid: root.pid! };
}

function alertFor(overrides: Partial<BundleAlert> = {}): BundleAlert {
  return {
    id: "ra-test",
    episode: 1,
    trigger: "repair_gated",
    projectSlug: "proj",
    actionKey: "proj/act",
    sessionId: null,
    firstSeenAt: NOW.toISOString(),
    detail: "fixture",
    requestId: "red-alert-proj-ra-test-e1",
    ...overrides
  };
}

function insertRepair(workspace: string, row: Record<string, unknown>): void {
  withDatabase(workspace, (db) => {
    ensureReviewRepairTable(db);
    db.prepare(
      `INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head, start_revision,
         pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, outcome, reason, created_at, updated_at)
       VALUES (@request_id, @action_key, @policy_epoch, @round, @failed_session_id, @failed_branch, @failed_head, @start_revision,
         @pull_request_url, @role, @verdict, @summary, @report_path, @findings_json, @failed_checks_json, @outcome, @reason, @created_at, @updated_at)`
    ).run(row);
  });
}

const simpleRepair = (reportPath: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  request_id: "req-1",
  action_key: "proj/act",
  policy_epoch: 1,
  round: 1,
  failed_session_id: "session_x",
  failed_branch: "branch",
  failed_head: "head",
  start_revision: "start",
  pull_request_url: null,
  role: "qa",
  verdict: "fail",
  summary: "summary",
  report_path: reportPath,
  findings_json: "[]",
  failed_checks_json: "[]",
  outcome: "gated",
  reason: "fixture",
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...extra
});

function bundle(workspace: string, overrides: Partial<Parameters<typeof writeEvidenceBundle>[0]> = {}) {
  return withDatabase(workspace, (db) => writeEvidenceBundle({ db, workspace, alert: alertFor(), stopOutcome: "gated", now: NOW, ...overrides }));
}

const readManifest = (directory: string) => JSON.parse(readFileSync(path.join(directory, "bundle.json"), "utf8")) as Record<string, any>;

describe("replay of #2084: a hung child under a blocked parent", () => {
  it("records the tree, open files and stack of each old child, without its arguments", async () => {
    const { rootPid } = await hungTree();
    const workspace = tempWorkspace();
    const evidence = collectHangEvidence({ workspace, label: "liveness-replay", rootPid, limits: { minChildAgeMs: 1_000 } });

    expect(evidence.status).toBe("captured");
    expect(evidence.elapsedMs).toBeLessThan(DEFAULT_HANG_EVIDENCE_LIMITS.budgetMs + 2_000);
    expect(evidence.directory).toBe(path.join(workspace, "artifacts", "generated", "red-alerts", "liveness-replay", "hang"));
    const commands = evidence.processes.map((row) => path.basename(row.command));
    expect(commands).toContain("sleep");
    expect(commands.some((command) => command === "sh" || command === "dash" || command === "bash")).toBe(true);

    // Leaves first: the hung reader is what gets examined first when the budget is short.
    const [leaf] = evidence.targets;
    expect(leaf.role).toBe("child");
    expect(path.basename(leaf.command)).toBe("sleep");
    expect(evidence.targets.at(-1)).toMatchObject({ role: "root", pid: rootPid });

    if (process.platform === "darwin") {
      // #2084's signature: the child's open files and a stack, which the incident never recorded.
      expect(leaf.lsof.status).toBe("captured");
      expect(leaf.sample.status).toBe("captured");
      expect(readFileSync(path.join(evidence.directory!, leaf.lsof.file!), "utf8")).toContain(String(leaf.pid));
      expect(readFileSync(path.join(evidence.directory!, leaf.sample.file!), "utf8")).toContain("Analysis of sampling");
    } else {
      // No `sample` on this host: stated, and the rest still captured.
      expect(leaf.sample.status).toBe("unavailable");
      expect(leaf.sample.note).toContain("macOS");
    }

    // A fixture can be cut from the record alone.
    const record = JSON.parse(readFileSync(path.join(evidence.directory!, "hang-evidence.json"), "utf8")) as HangEvidence;
    const cut = {
      root: record.rootPid,
      children: record.targets.filter((target) => target.role === "child").map((target) => ({ command: path.basename(target.command), ageMs: target.ageMs })),
      tree: readFileSync(path.join(evidence.directory!, record.processTree.file!), "utf8")
    };
    expect(cut.root).toBe(rootPid);
    expect(cut.children[0].command).toBe("sleep");
    expect(cut.children[0].ageMs).toBeGreaterThanOrEqual(1_000);
    expect(cut.tree).toContain(`${rootPid} `);

    // The token in the child's argv and this process's environment reach nothing.
    const everything = allText(evidence.directory!);
    expect(everything).not.toContain(GITHUB_TOKEN);
    expect(everything).not.toContain("HOME=");
    // Only this root's subtree is kept, never the host's process table.
    expect(existsSync(path.join(evidence.directory!, "process-table.txt"))).toBe(false);
    expect(evidence.processes.map((row) => row.pid)).not.toContain(process.pid);
  });

  it("treats a child younger than the limit as not hung, and says so", async () => {
    const { rootPid } = await hungTree();
    const evidence = collectHangEvidence({ workspace: tempWorkspace(), label: "young", rootPid, limits: { minChildAgeMs: 3_600_000 } });
    expect(evidence.processes.length).toBeGreaterThan(1);
    expect(evidence.targets.map((target) => target.role)).toEqual(["root"]);
    expect(evidence.note).toContain("No child is older than");
  });

  it("uses the 5 second limit from #2084 by default", () => {
    expect(HANG_CHILD_MIN_AGE_MS).toBe(5_000);
    expect(DEFAULT_HANG_EVIDENCE_LIMITS.minChildAgeMs).toBe(5_000);
    expect(parseElapsedMs("00:05")).toBe(5_000);
    expect(parseElapsedMs("01:02:03")).toBe(3_723_000);
    expect(parseElapsedMs("2-01:02:03")).toBe(176_523_000);
    expect(parseElapsedMs("nonsense")).toBeNull();
  });

  it("a stalled Session's alert walks its pane process and notes what it saved", async () => {
    const { rootPid } = await hungTree();
    const rehearsal = new Rehearsal();
    cleanups.push(() => rehearsal.dispose());
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    mkdirSync(path.join(rehearsal.workspace, ".arcadia", "sessions"), { recursive: true });
    writeFileSync(path.join(rehearsal.workspace, ".arcadia", "worker.log"), "2026-11-05T02:05:30Z worker line\n");
    writeFileSync(path.join(rehearsal.workspace, ".arcadia", "sessions", "session_x.log"), "agent output\n");

    withDatabase(rehearsal.workspace, (db) => {
      const ctx = { db, workspace: rehearsal.workspace, projectSlug: rehearsal.projectSlug, now: NOW };
      observeStall(ctx, {
        session: { id: "session_x", action_id: "write-marker-a", tmux_session_name: "managed" },
        stalled: true,
        tmux: { capturePane: () => "pane text", panePid: () => rootPid }
      });
      const [alert] = listOpenRedAlerts(db);
      const evidenceFile = readFileSync(alert.evidencePath, "utf8");
      expect(evidenceFile).toContain("## Evidence bundle");
      expect(evidenceFile).toContain("Hang evidence:");
      const manifest = readManifest(path.join(path.dirname(alert.evidencePath), `${alert.id}-e1`));
      expect(manifest.schema).toBe("arcadia-red-alert-bundle/v1");
      expect(manifest.hang.rootPid).toBe(rootPid);
      expect(manifest.files.workerLog.status).toBe("captured");
      expect(manifest.files.sessionLog.status).toBe("captured");
    });
  });

  it("a test double without the pane capability states that no process was known", () => {
    const rehearsal = new Rehearsal();
    cleanups.push(() => rehearsal.dispose());
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    withDatabase(rehearsal.workspace, (db) => {
      observeStall({ db, workspace: rehearsal.workspace, projectSlug: rehearsal.projectSlug, now: NOW }, {
        session: { id: "session_y", action_id: "write-marker-a", tmux_session_name: "managed" }, stalled: true, tmux: {}
      });
      const [alert] = listOpenRedAlerts(db);
      expect(readFileSync(alert.evidencePath, "utf8")).toContain("no live process is known");
    });
  });
});

describe("replay of attempt 2's QA stop, through the real worker tick", () => {
  const repairRow = () => (JSON.parse(readFileSync(path.join(FIXTURE, "repair-row.json"), "utf8")) as Array<Record<string, string | number>>)[0];
  const escalationRow = () => (JSON.parse(readFileSync(path.join(FIXTURE, "escalation-row.json"), "utf8")) as Array<Record<string, string>>)[0];

  function activated(): Rehearsal {
    const rehearsal = new Rehearsal();
    cleanups.push(() => rehearsal.dispose());
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate();
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3);
    return rehearsal;
  }

  /** The saved attempt directory and both records, as attempt 2 left them, under this Action. */
  function replayStop(rehearsal: Rehearsal): void {
    const row = repairRow();
    const attempt = path.join(rehearsal.workspace, path.dirname(String(row.report_path)));
    mkdirSync(attempt, { recursive: true });
    for (const name of ["qa-report.md", "prompt.md"]) writeFileSync(path.join(attempt, name), readFileSync(path.join(FIXTURE, "attempt", name)));
    insertRepair(rehearsal.workspace, { ...row, action_key: rehearsal.actionA });
    escalate(rehearsal);
  }

  function escalate(rehearsal: Rehearsal): void {
    const escalation = escalationRow();
    withDatabase(rehearsal.workspace, (db) => {
      db.prepare("INSERT OR REPLACE INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(rehearsal.actionA, REVIEW_REPAIR_ROUNDS_EXHAUSTED, escalation.message, escalation.remedy, escalation.first_detected_at, escalation.last_seen_at);
    });
  }

  it("yields a bundle a fixture can be cut from, leaving the notice text alone", () => {
    const rehearsal = activated();
    replayStop(rehearsal);
    writeFileSync(path.join(rehearsal.workspace, ".arcadia", "worker.log"), "2026-11-05T03:51:45Z Escalated to the operator\n", { flag: "a" });
    rehearsal.tick();

    const alert = withReadOnlyDatabase(rehearsal.workspace, (db) => listOpenRedAlerts(db)).find((entry) => entry.trigger === "repair_rounds_exhausted")!;
    expect(alert.actionKey).toBe(rehearsal.actionA);
    const directory = path.join(path.dirname(alert.evidencePath), `${alert.id}-e1`);
    const manifest = readManifest(directory);
    const row = repairRow();

    // Cut the fixture from the bundle alone: verdict, findings, report, prompt, replay input.
    const cut = {
      actionKey: manifest.reviewStop.action_key as string,
      round: manifest.reviewStop.round as number,
      role: manifest.reviewStop.role as string,
      verdict: manifest.reviewStop.verdict as string,
      failedHead: manifest.reviewStop.failed_head as string,
      findings: manifest.reviewStop.findings as ReviewRepairFinding[],
      checks: manifest.reviewStop.failed_checks as ReviewRepairCheck[],
      replayInput: manifest.savedAttempt.directory as string,
      report: readFileSync(path.join(directory, manifest.files.verdictReport.file), "utf8"),
      prompt: readFileSync(path.join(directory, manifest.files.prompt.file), "utf8")
    };
    expect(cut).toMatchObject({ actionKey: rehearsal.actionA, round: 3, role: "qa", verdict: "needs-follow-up", failedHead: row.failed_head });
    expect(cut.findings.map((finding) => finding.title)).toEqual(JSON.parse(String(row.findings_json)).map((finding: ReviewRepairFinding) => finding.title));
    expect(cut.checks.map((check) => check.criterion)).toEqual(["managed-documents", "operator-qa-plan"]);
    expect(cut.replayInput).toBe(path.dirname(String(row.report_path)));
    expect(cut.report).toBe(readFileSync(path.join(FIXTURE, "attempt", "qa-report.md"), "utf8"));
    expect(cut.prompt).toBe(readFileSync(path.join(FIXTURE, "attempt", "prompt.md"), "utf8"));
    expect(manifest.savedAttempt.files.map((file: { name: string }) => file.name)).toEqual(["prompt.md", "qa-report.md"]);
    // The cut fixture feeds the repair judgement as saved: this is the verdict that looped.
    expect(verdictIsRepairable(cut.findings, cut.checks)).toBe(true);
    expect(manifest.reviewStop.escalations[0].kind).toBe(REVIEW_REPAIR_ROUNDS_EXHAUSTED);
    expect(manifest.files.workerLog.status).toBe("captured");
    expect(readFileSync(path.join(directory, "worker-log-tail.txt"), "utf8")).toContain("Escalated to the operator");
    expect(manifest.hang).toBeNull();

    const evidenceFile = readFileSync(alert.evidencePath, "utf8");
    expect(evidenceFile).toContain("Verdict report: verdict-report.md (captured)");
    expect(evidenceFile).toContain("Saved prompt: prompt.md (captured)");

    // NOTICE_ONLY text is read off-site: still no host path.
    const notice = withDatabase(rehearsal.workspace, (db) => listPendingAgentAskNotifications(db)).find((entry) => entry.requestId === alert.requestId)!;
    expect(notice.desiredResult).not.toContain("artifacts/");
    expect(notice.desiredResult).not.toContain("file://");
  });

  it("captures once per episode: a repeat leaves it, and a recurrence gets its own", () => {
    const rehearsal = activated();
    replayStop(rehearsal);
    rehearsal.tick();
    const alert = withReadOnlyDatabase(rehearsal.workspace, (db) => listOpenRedAlerts(db)).find((entry) => entry.trigger === "repair_rounds_exhausted")!;
    const first = path.join(path.dirname(alert.evidencePath), `${alert.id}-e1`);
    rmSync(path.join(first, "prompt.md"));

    rehearsal.tick();
    expect(existsSync(path.join(first, "prompt.md"))).toBe(false);

    withDatabase(rehearsal.workspace, (db) => db.prepare("DELETE FROM production_operator_escalations WHERE action_key = ?").run(rehearsal.actionA));
    rehearsal.tick();
    escalate(rehearsal);
    rehearsal.tick();
    const second = path.join(path.dirname(alert.evidencePath), `${alert.id}-e2`);
    expect(readManifest(second).alert.episode).toBe(2);
    expect(existsSync(path.join(first, "bundle.json"))).toBe(true);
  });
});

describe("the write lock", () => {
  const require = createRequire(import.meta.url);

  /** A separate process that tries for the write lock with no wait, and records what happened. */
  function lockProbe(workspace: string, result: string): string {
    const script = path.join(tempDirectory("arcadia-probe-"), "probe.cjs");
    writeFileSync(script, `
const Database = require(${JSON.stringify(require.resolve("better-sqlite3"))});
const { appendFileSync, writeFileSync } = require("node:fs");
let outcome = "free";
try {
  const db = new Database(${JSON.stringify(getWorkspacePaths(workspace).databaseFile)}, { timeout: 0 });
  db.exec("BEGIN IMMEDIATE; COMMIT");
  db.close();
} catch (error) { outcome = "held: " + error.code; }
appendFileSync(${JSON.stringify(result)}, outcome + "\\n");
if (process.argv[6]) writeFileSync(process.argv[6], "Analysis of sampling\\n");
`);
    return script;
  }

  it("is free while a real alert's `sample` runs, in a separate process, and the probe would see it held", async () => {
    const { rootPid } = await hungTree();
    const rehearsal = new Rehearsal();
    cleanups.push(() => rehearsal.dispose());
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    const result = path.join(rehearsal.root, "probe-result");
    const probe = lockProbe(rehearsal.workspace, result);
    const bin = fakeCommands({ sample: `exec "${process.execPath}" "${probe}" "$@"` });

    withDatabase(rehearsal.workspace, (db) => {
      raiseRedAlert(db, {
        workspace: rehearsal.workspace,
        projectSlug: rehearsal.projectSlug,
        actionKey: rehearsal.actionA,
        sessionId: "session_lock",
        trigger: "session_stalled",
        detail: () => "stalled",
        now: NOW,
        hang: { rootPid: () => rootPid, limits: { minChildAgeMs: 1_000 }, searchPath: `${bin}:${SYSTEM_PATH}` }
      });
    });
    const outcomes = readFileSync(result, "utf8").trim().split("\n");
    expect(outcomes.length).toBeGreaterThan(0);
    expect(new Set(outcomes)).toEqual(new Set(["free"]));

    // The same probe with a transaction held: it does detect the lock.
    rmSync(result);
    withDatabase(rehearsal.workspace, (db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        spawnSync(process.execPath, [probe], { stdio: "ignore" });
      } finally {
        db.exec("ROLLBACK");
      }
    });
    expect(readFileSync(result, "utf8")).toContain("held: SQLITE_BUSY");
  });

  it("inside a transaction nothing is spawned, and the skip is stated", () => {
    const rehearsal = new Rehearsal();
    cleanups.push(() => rehearsal.dispose());
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    const ran = path.join(rehearsal.root, "ran");
    const bin = fakeCommands({ ps: `echo ran > '${ran}'`, lsof: `echo ran > '${ran}'`, sample: `echo ran > '${ran}'` });

    const alert = withDatabase(rehearsal.workspace, (db) =>
      db.transaction(() => {
        expect(db.inTransaction).toBe(true);
        return raiseRedAlert(db, {
          workspace: rehearsal.workspace,
          projectSlug: rehearsal.projectSlug,
          actionKey: rehearsal.actionA,
          sessionId: "session_tx",
          trigger: "session_stalled",
          detail: () => "stalled",
          now: NOW,
          hang: { rootPid: () => process.ppid, searchPath: bin }
        }).alert;
      })()
    );

    expect(existsSync(ran)).toBe(false);
    const manifest = readManifest(path.join(path.dirname(alert.evidencePath), `${alert.id}-e1`));
    expect(manifest.hang.status).toBe("skipped");
    expect(manifest.hang.note).toContain("inside a database transaction");
    expect(readFileSync(alert.evidencePath, "utf8")).toContain("inside a database transaction");
  });
});

describe("bounded capture", () => {
  let workspace: string;
  beforeEach(() => { workspace = tempWorkspace(); });

  const collect = (searchPath: string, limits = {}) => collectHangEvidence({ workspace, label: "bounded", rootPid: 4242, searchPath, limits });

  it("examines old children leaves first, then the root, and counts what it left out", () => {
    const evidence = collect(fakeCommands({ ps: fakePs, lsof: "echo open files", sample: fakeSample }), { maxChildren: 1 });
    expect(evidence.targets.map((target) => [target.role, target.pid])).toEqual([["child", 4243], ["root", 4242]]);
    expect(evidence.omittedChildren).toBe(1);
    expect(evidence.processes.map((row) => row.pid)).toEqual([4242, 4243, 4244, 4245]);
    expect(evidence.processes.find((row) => row.pid === 4244)?.command).toBe("/usr/local/bin/reader with spaces");
    const tree = readFileSync(path.join(evidence.directory!, "process-tree.txt"), "utf8");
    expect(tree).not.toContain("unrelated");
    expect(readFileSync(path.join(evidence.directory!, "sample-4243.txt"), "utf8")).toContain("Analysis of sampling");
    expect(readdirSync(evidence.directory!).filter((name) => name.endsWith(".raw") || name.endsWith(".result"))).toEqual([]);
  });

  it("states a failed command and carries on, with no throw", () => {
    const evidence = collect(fakeCommands({ ps: fakePs, lsof: `echo "refused ${GITHUB_TOKEN}" >&2; exit 7`, sample: "exit 3" }));
    expect(evidence.status).toBe("captured");
    expect(evidence.targets[0].lsof).toMatchObject({ status: "failed", file: null });
    expect(evidence.targets[0].lsof.note).toContain("exited 7");
    expect(evidence.targets[0].lsof.note).not.toContain(GITHUB_TOKEN);
    expect(evidence.targets[0].sample).toMatchObject({ status: "failed" });
    expect(allText(evidence.directory!)).not.toContain(GITHUB_TOKEN);
  });

  it("states a failed process table", () => {
    const evidence = collect(fakeCommands({ ps: "exit 1" }));
    expect(evidence.status).toBe("failed");
    expect(evidence.processTree.status).toBe("failed");
    expect(evidence.note).toContain("No process table");
    expect(JSON.parse(readFileSync(path.join(evidence.directory!, "hang-evidence.json"), "utf8")).status).toBe("failed");
  });

  it("stops a command at its timeout, even with a grandchild holding its stdout open", () => {
    const started = Date.now();
    const evidence = collect(fakeCommands({ ps: fakePs, lsof: "/bin/sleep 20 &\nexec /bin/sleep 20", sample: fakeSample }), { lsofTimeoutMs: 300, maxChildren: 1 });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(evidence.targets[0].lsof.status).toBe("timed_out");
    expect(evidence.targets[0].lsof.note).toContain("300ms");
    expect(evidence.targets[0].sample.status).toBe("captured");
  });

  it("stops at the shared budget and states what it did not reach", () => {
    const started = Date.now();
    const evidence = collect(fakeCommands({ ps: fakePs, lsof: "echo open", sample: "exec /bin/sleep 20" }), { sampleTimeoutMs: 2_500, budgetMs: 4_000 });
    expect(Date.now() - started).toBeLessThan(15_000);
    const root = evidence.targets.at(-1)!;
    expect(root.sample.status).toBe("skipped");
    expect(root.sample.note).toContain("4000ms capture budget");
    expect(evidence.targets[0].sample.status).toBe("timed_out");
  });

  it("caps command output, whole lines only, and says so", () => {
    const line = "x".repeat(99);
    // 3 MiB on stdout and in -file's result: the script writes both.
    const flood = `i=0; while [ $i -lt 32 ]; do /bin/cat '${path.join(workspace, "chunk")}'; i=$((i+1)); done`;
    writeFileSync(path.join(workspace, "chunk"), `${line}\n`.repeat(1_000));
    const evidence = collect(fakeCommands({ ps: fakePs, lsof: flood, sample: `(${flood}) > "$5"` }), { maxChildren: 1 });
    for (const item of [evidence.targets[0].lsof, evidence.targets[0].sample]) {
      expect(item).toMatchObject({ status: "captured", truncated: true, sourceBytes: 3_200_000 });
      expect(item.note).toContain("cut to a whole line");
      const written = readFileSync(path.join(evidence.directory!, item.file!));
      expect(written.length).toBeLessThanOrEqual(256 * 1024);
      expect(written.toString("utf8").endsWith(`${line}\n`)).toBe(true);
    }
  });

  it("keeps only the tail of a large worker log, from a whole line, without reading it all", () => {
    mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
    const old = `${GITHUB_TOKEN} old\n`;
    writeFileSync(path.join(workspace, ".arcadia", "worker.log"), `${old}${"line of worker log\n".repeat(200_000)}last line\n`);
    const result = bundle(workspace);
    expect(result.workerLog).toMatchObject({ status: "captured", truncated: true, file: "worker-log-tail.txt" });
    const tail = readFileSync(path.join(result.directory, "worker-log-tail.txt"), "utf8");
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(LOG_TAIL_MAX_BYTES);
    expect(tail.startsWith("line of worker log\n")).toBe(true);
    expect(tail.endsWith("last line\n")).toBe(true);
  });

  it("caps a large report and keeps the original's size on record", () => {
    const attempt = path.join(workspace, "artifacts", "qa", "a");
    mkdirSync(attempt, { recursive: true });
    writeFileSync(path.join(attempt, "qa-report.md"), "report line\n".repeat(BUNDLE_FILE_MAX_BYTES / 4));
    insertRepair(workspace, simpleRepair("artifacts/qa/a/qa-report.md"));
    const result = bundle(workspace);
    expect(result.reportFile).toMatchObject({ status: "captured", truncated: true, sourceBytes: 3 * BUNDLE_FILE_MAX_BYTES });
    expect(statSync(path.join(result.directory, "verdict-report.md")).size).toBeLessThanOrEqual(BUNDLE_FILE_MAX_BYTES);
    expect(result.promptFile).toMatchObject({ status: "unavailable", file: null });
  });

  it("states `sample` being absent, as on any host but macOS, and captures the rest", () => {
    const evidence = collect(fakeCommands({ ps: fakePs, lsof: "echo open files" }));
    expect(evidence.status).toBe("captured");
    for (const target of evidence.targets) {
      expect(target.sample).toMatchObject({ status: "unavailable", file: null });
      expect(target.sample.note).toContain("macOS only");
      expect(target.lsof.status).toBe("captured");
    }
  });

  it("states every tool being absent", () => {
    const evidence = collect(fakeCommands({}));
    expect(evidence.status).toBe("failed");
    expect(evidence.processTree).toMatchObject({ status: "unavailable" });
    expect(evidence.processTree.note).toContain("`ps` is not on this host");
  });

  it("refuses roots that are not a single examinable process", () => {
    const ran = path.join(workspace, "ran");
    const bin = fakeCommands({ ps: `echo ran > '${ran}'` });
    for (const rootPid of [null, 0, 1, -5, 1.5, Number.NaN]) {
      const evidence = collectHangEvidence({ workspace, label: "refused", rootPid, searchPath: bin });
      expect(evidence.status).toBe("skipped");
      expect(evidence.note).toContain("Skipped");
    }
    expect(existsSync(ran)).toBe(false);
  });

  it("states a root that has exited", () => {
    const evidence = collectHangEvidence({ workspace, label: "gone", rootPid: 77777, searchPath: fakeCommands({ ps: fakePs }) });
    expect(evidence.status).toBe("skipped");
    expect(evidence.processTree.note).toContain("has exited");
  });

  it("never writes outside the red alert evidence directory, whatever the label", () => {
    const evidence = collectHangEvidence({ workspace, label: "../../../../escape", rootPid: 4242, searchPath: fakeCommands({ ps: fakePs, lsof: "echo x", sample: fakeSample }) });
    expect(evidence.directory!.startsWith(path.join(workspace, "artifacts", "generated", "red-alerts") + path.sep)).toBe(true);
  });

  it("does not throw when the evidence directory cannot be created", () => {
    mkdirSync(path.join(workspace, "artifacts", "generated", "red-alerts"), { recursive: true });
    writeFileSync(path.join(workspace, "artifacts", "generated", "red-alerts", "blocked"), "a file");
    const evidence = collectHangEvidence({ workspace, label: "blocked", rootPid: 4242, searchPath: fakeCommands({ ps: fakePs }) });
    expect(evidence.status).toBe("failed");
    expect(evidence.note).toContain("Hang evidence capture failed");
  });

  it("a bundle that cannot be written leaves the alert and its notification standing", () => {
    const rehearsal = new Rehearsal();
    cleanups.push(() => rehearsal.dispose());
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    const raise = () => withDatabase(rehearsal.workspace, (db) => raiseRedAlert(db, {
      workspace: rehearsal.workspace,
      projectSlug: rehearsal.projectSlug,
      actionKey: rehearsal.actionA,
      sessionId: null,
      trigger: "repair_gated",
      detail: () => "gated",
      now: NOW
    }));
    // Learn the alert's id, clear it, then put a file where its next episode's bundle goes.
    const { alert } = raise();
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE production_red_alerts SET status = 'cleared' WHERE id = ?").run(alert.id));
    writeFileSync(path.join(path.dirname(alert.evidencePath), `${alert.id}-e2`), "in the way");

    const second = raise();
    expect(second.created).toBe(true);
    expect(readFileSync(second.alert.evidencePath, "utf8")).toContain("The evidence bundle could not be completed");
    const notices = withDatabase(rehearsal.workspace, (db) => listPendingAgentAskNotifications(db)).filter((entry) => entry.requestId === second.alert.requestId);
    expect(notices.length).toBeGreaterThan(0);
  });

  it("a pane lookup that throws is stated", () => {
    const result = bundle(workspace, { hang: { rootPid: () => { throw new Error("tmux gone"); }, searchPath: fakeCommands({ ps: fakePs }) } });
    expect(result.status).toBe("written");
    expect(result.hang?.status).toBe("skipped");
    expect(result.hang?.note).toContain("tmux gone");
  });

  it("states an alert with no Action, and an Action with no verdict", () => {
    expect(bundle(workspace, { alert: alertFor({ actionKey: null }) }).reportFile.note).toContain("names no Action");
    const none = bundle(workspace, { alert: alertFor({ id: "ra-none" }) });
    expect(none.reportFile).toMatchObject({ status: "unavailable" });
    expect(none.reportFile.note).toContain("No review verdict");
    expect(none.workerLog).toMatchObject({ status: "unavailable" });
  });

  it("reads a recorded path only inside this workspace's artifacts", () => {
    const outside = path.join(path.dirname(workspace), "private.md");
    writeFileSync(outside, `${API_KEY} PRIVATE-CONTENT\n`);
    insertRepair(workspace, simpleRepair("../private.md"));
    const traversal = bundle(workspace);
    expect(traversal.reportFile).toMatchObject({ status: "unavailable", file: null });
    expect(allText(traversal.directory)).not.toContain("PRIVATE-CONTENT");

    // A symlink inside the attempt directory, and a symlinked report, are both refused.
    const attempt = path.join(workspace, "artifacts", "qa", "linked");
    mkdirSync(attempt, { recursive: true });
    writeFileSync(path.join(attempt, "qa-report.md"), "the report\n");
    symlinkSync(outside, path.join(attempt, "prompt.md"));
    symlinkSync(outside, path.join(attempt, "linked-report.md"));
    insertRepair(workspace, simpleRepair("artifacts/qa/linked/qa-report.md", { request_id: "req-2", updated_at: "2026-11-05T03:00:00.000Z" }));
    const linked = bundle(workspace, { alert: alertFor({ id: "ra-linked" }) });
    expect(linked.reportFile.status).toBe("captured");
    expect(linked.promptFile).toMatchObject({ status: "failed", file: null });
    expect(allText(linked.directory)).not.toContain("PRIVATE-CONTENT");
    insertRepair(workspace, simpleRepair("artifacts/qa/linked/linked-report.md", { request_id: "req-3", updated_at: "2026-11-05T04:00:00.000Z" }));
    const linkedReport = bundle(workspace, { alert: alertFor({ id: "ra-linked-report" }) });
    expect(linkedReport.reportFile).toMatchObject({ status: "unavailable", file: null });
    expect(allText(linkedReport.directory)).not.toContain("PRIVATE-CONTENT");
  });
});

describe("secret scrubbing", () => {
  const SECRETS: ReadonlyArray<[string, string]> = [
    ["a GitHub token", `token ${GITHUB_TOKEN} here`],
    ["an API key", `key ${API_KEY} here`],
    ["an environment assignment", `ANTHROPIC_API_KEY=${"v".repeat(24)}`],
    ["a JSON value", `{"DISCORD_BOT_TOKEN": "${"v".repeat(24)}"}`],
    ["a space-separated flag", `tool --api-key ${"v".repeat(24)} run`],
    ["a bearer header", `Authorization: Bearer ${"v".repeat(24)}`],
    ["URL credentials", `https://user:${"v".repeat(24)}@example.com/repo.git`],
    ["a private key", `-----BEGIN RSA PRIVATE KEY-----\n${"v".repeat(24)}\n-----END RSA PRIVATE KEY-----`],
    ["a private key cut by the read window", `${"v".repeat(24)}\n-----END RSA PRIVATE KEY-----\nafter`]
  ];

  it.each(SECRETS)("removes %s", (_label, text) => {
    expect(scrubText(text)).not.toContain("v".repeat(24));
    expect(scrubText(text)).not.toContain(GITHUB_TOKEN);
    expect(scrubText(text)).not.toContain(API_KEY);
  });

  it("removes terminal escapes", () => {
    expect(scrubText("\u001b[31mred\u001b[0m")).toBe("red");
  });

  it("scrubs every file and manifest field in a bundle", () => {
    const workspace = tempWorkspace();
    const attempt = path.join(workspace, "artifacts", "qa", "s");
    mkdirSync(attempt, { recursive: true });
    mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
    const secretLine = `ghToken=${GITHUB_TOKEN} ${API_KEY}\n`;
    writeFileSync(path.join(attempt, "qa-report.md"), secretLine);
    writeFileSync(path.join(attempt, "prompt.md"), secretLine);
    writeFileSync(path.join(workspace, ".arcadia", "worker.log"), secretLine);
    insertRepair(workspace, simpleRepair("artifacts/qa/s/qa-report.md", { summary: secretLine, findings_json: JSON.stringify([{ title: secretLine }]), reason: secretLine }));
    withDatabase(workspace, (db) => {
      db.prepare("INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES ('proj/act', 'review_repair_gated', ?, ?, ?, ?)")
        .run(secretLine, secretLine, NOW.toISOString(), NOW.toISOString());
    });
    const bin = fakeCommands({
      ps: `/bin/cat <<TABLE\n  4242 1 10:00 S /opt/${GITHUB_TOKEN}/node\n  4243 4242 09:00 S /usr/bin/python3\nTABLE`,
      lsof: `echo "python3 4243 cwd DIR /tmp/${API_KEY}"`,
      sample: `echo "frame ANTHROPIC_API_KEY=${"v".repeat(24)}" > "$5"`
    });
    const result = bundle(workspace, { alert: alertFor({ detail: secretLine }), hang: { rootPid: () => 4242, searchPath: bin } });

    expect(result.status).toBe("written");
    expect(result.hang?.targets.length).toBeGreaterThan(0);
    const everything = allText(result.directory);
    expect(everything).toContain("[redacted token]");
    expect(everything).not.toContain(GITHUB_TOKEN);
    expect(everything).not.toContain(API_KEY);
    expect(everything).not.toContain("v".repeat(24));
  });

  it("never leaves a fragment of a secret the read window cut", () => {
    const workspace = tempWorkspace();
    mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
    // The cut falls inside the token's line: the fragment would be too short for any pattern.
    const log = `prefix ${"z".repeat(LOG_TAIL_MAX_BYTES)}\nafter the cut\n`;
    writeFileSync(path.join(workspace, ".arcadia", "worker.log"), log.replace(`prefix ${"z".repeat(30)}`, `prefix fragmentSECRET${"z".repeat(10)}`));
    const result = bundle(workspace);
    const tail = readFileSync(path.join(result.directory, "worker-log-tail.txt"), "utf8");
    expect(tail).toBe("after the cut\n");
  });
});
