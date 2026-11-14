import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorScriptRunnerSource } from "../src/operatorActions/operatorExecution.js";
import { relayStartPressInterlock, runCoordinatorRenewCommand } from "../src/commands/coordinator.js";
import type { CapsuleSources } from "../src/coordinator/capsule.js";
import { coordinatorPaths } from "../src/coordinator/paths.js";
import { BILLING_ENV_NAMES } from "../src/spend/spendCheck.js";
import type { LaunchSpendResult } from "../src/spend/spendGuard.js";
import { COORDINATOR_ENV, listGenerations, seedCustodianGeneration } from "../src/coordinator/generations.js";
import {
  RELAY_LAUNCH_DECISION_ID,
  claudeProjectSlug,
  readDecisionFromMain,
  readFirstUserMessage,
  readRelayDecision,
  renewCoordinator,
  pidLiveness,
  startPressInProgressIn,
  type PidLiveness,
  type RelayDeps
} from "../src/coordinator/relay.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-relay-"));
  roots.push(root);
  const ws = path.join(root, "workspace");
  initWorkspace(ws);
  const repo = path.join(root, "repo");
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  const projects = path.join(root, "claude-projects");
  withDatabase(ws, (db) => seedCustodianGeneration(db, ws, {
    project: "arcadia", role: "rowan", provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas",
    nativeSessionId: "11111111-1111-4111-8111-111111111111", now: new Date("2026-11-07T20:00:00Z")
  }));
  return { root, ws, repo, projects };
}

const sources: CapsuleSources = {
  plan: () => ({ activePlan: null, currentAction: null, mainSha: "abc" }),
  production: () => ({ status: "inactive", revision: 0, epoch: 0, openEscalations: [], redAlerts: [] }),
  prs: () => [], sessions: () => [], decisions: () => ({ open: [], recentlyAnswered: [], pendingMerge: [] }),
  pings: () => ({ pending: [], recent: [] }), budget: () => null
};

interface Fake { launches: Array<{ name: string; cwd: string; args: string[] }>; killed: string[]; pings: string[]; deps: RelayDeps }

function fakeDeps(projects: string, options: { deliver: boolean[]; inForce?: boolean; signedIn?: boolean; spend?: LaunchSpendResult }): Fake {
  let clock = new Date("2026-11-07T21:00:00Z").getTime();
  let attempt = 0;
  let ids = 0;
  const fake: Fake = { launches: [], killed: [], pings: [], deps: undefined as unknown as RelayDeps };
  fake.deps = {
    tmux: {
      hasSession: () => false,
      launch(input) {
        fake.launches.push({ name: input.name, cwd: input.cwd, args: input.args });
        const deliver = options.deliver[attempt++];
        if (deliver) {
          const sessionId = input.args[input.args.indexOf("--session-id") + 1];
          const file = path.join(projects, claudeProjectSlug(input.cwd), `${sessionId}.jsonl`);
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, `${JSON.stringify({ type: "user", isSidechain: false, message: { content: input.args.at(-1) } })}\n`);
        }
      },
      killSession: (name) => { fake.killed.push(name); }
    },
    decision: () => ({ inForce: options.inForce ?? true, reason: "test decision" }),
    signIn: () => ({ signedIn: options.signedIn ?? true, remedy: "sign in", ...(options.spend ? { spend: options.spend } : {}) }),
    capacity: () => ({ admitted: true, reason: "ok" }),
    createWorktree: (_repo, directory) => { mkdirSync(directory, { recursive: true }); },
    firstUserMessage: readFirstUserMessage,
    claudeProjectsDirectory: projects,
    sleep: (ms) => { clock += ms; },
    now: () => new Date(clock),
    newSessionId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    ping: (message) => { fake.pings.push(message); },
    sources: () => sources,
    startPressInProgress: () => ({ inProgress: false, detail: "none" }),
    folderTrust: () => ({ trusted: true, trustedFolder: "/trusted", detail: "test trust" })
  };
  return fake;
}

describe("coordinator relay launch (change 3)", () => {
  it("names the relay Decision by its full stem and matches it exactly", () => {
    const stem = "0191-may-arcadia-s-deterministic-relay-launch-successor-coordinator-sessions-signal";
    expect(RELAY_LAUNCH_DECISION_ID).toBe(stem);
    const { repo } = setup();
    const decision = (id: string, slug: string, answer: string) =>
      `---\nid: "${id}"\nslug: ${slug}\nstatus: approved\nanswer: "${answer}"\ndecided: 2026-11-07\n---\n`;
    const otherStem = "0191-authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-07-f9415ce1";
    const onMain: Record<string, string> = {
      [stem]: decision("0191", stem.slice(5), "A. Yes, pinned"),
      [otherStem]: decision("0191", otherStem.slice(5), "A. Approve"),
      "0192-relay-c": decision("0192", "relay-c", "C. No launches"),
      "0194-wrong-slug": decision("0194", "some-other-slug", "A. Yes"),
      "0195-wrong-id": decision("0196", "wrong-id", "A. Yes")
    };
    const read = (_repo: string, id: string) => onMain[id] ?? null;
    const at = new Date("2026-11-08T00:00:00Z");
    expect(readRelayDecision(repo, at, stem, read)).toMatchObject({ inForce: true });
    expect(readRelayDecision(repo, new Date("2026-12-20T00:00:00Z"), stem, read).reason).toMatch(/expired/);
    // A bare number is ambiguous (two Decisions are numbered 0191): refused before any read.
    expect(readRelayDecision(repo, at, "0191", () => onMain[stem]).reason).toMatch(/not a full <number>-<slug> file stem/);
    expect(readRelayDecision(repo, at, "0192-relay-c", read).inForce).toBe(false);
    // The file's own id and slug must equal the stem.
    expect(readRelayDecision(repo, at, "0194-wrong-slug", read).reason).toMatch(/not an exact match/);
    expect(readRelayDecision(repo, at, "0195-wrong-id", read).reason).toMatch(/not an exact match/);
    // A stem that names no file is not in force; a prefix of a real stem names none.
    expect(readRelayDecision(repo, at, "0191-may-arcadia", read).inForce).toBe(false);
    // The default reader takes no prefix match and reads origin/main only, never the working tree.
    expect(readDecisionFromMain(repo, "0191")).toBeNull();
    writeFileSync(path.join(repo, "docs", "decisions", "0193-relay.md"), onMain[stem]);
    expect(readRelayDecision(repo, at, "0193-relay").inForce).toBe(false);
    expect(readRelayDecision(repo, at, null, read).inForce).toBe(false);
  });

  it("refuses before any claim or launch when the Decision is not in force", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [true], inForce: false });
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(result).toMatchObject({ outcome: "refused", reason: "decision_not_in_force" });
    expect(fake.launches).toEqual([]);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"))).toHaveLength(1);
  });

  it("refuses any role other than the coordinator roles Decision 0191 names, before any claim or launch", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [true] });
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "builder", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(result).toMatchObject({ outcome: "refused", reason: "role_not_allowed" });
    expect(fake.launches).toEqual([]);
  });

  it("launches one successor with the pinned model, effort, permission mode and custody identity, and verifies delivery", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [true] });
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(result).toMatchObject({ outcome: "launched", generation: 2, tmuxName: "arcadia-coord-rowan-g2", attempts: 1 });
    const [launch] = fake.launches;
    expect(launch.args).toEqual(expect.arrayContaining(["--model", "opus", "--effort", "high", "--permission-mode", "auto", "--remote-control"]));
    expect(launch.args.some((arg) => arg.startsWith(`${COORDINATOR_ENV.token}=`))).toBe(true);
    expect(launch.args).not.toContain("--dangerously-skip-permissions");
    expect(launch.args.at(-1)).toMatch(/subscribe --project arcadia --role rowan --from-snapshot [0-9a-f]{64}/);
    const rows = withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"));
    expect(rows.map((row) => [row.generation, row.status])).toEqual([[1, "custodian"], [2, "launching"]]);
    expect(rows[1].transcriptPath).toContain(claudeProjectSlug(launch.cwd));
    // One successor at a time.
    const again = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(again).toMatchObject({ outcome: "refused", reason: "launch_in_progress" });
    expect(fake.launches).toHaveLength(1);
  });

  it("refuses a successor launch while a START press is in progress, before any claim or launch", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [true] });
    const deps = { ...fake.deps, startPressInProgress: () => ({ inProgress: true, detail: "card/press status running" }) };
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, deps));
    expect(result).toMatchObject({ outcome: "refused", reason: "start_in_progress" });
    expect(fake.launches).toHaveLength(0);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => row.status)).toEqual(["custodian"]);
  });

  it("strips every billing variable by name from the successor's environment (env -u), ahead of the custody variables", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [true] });
    withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    const [launch] = fake.launches;
    const unset = launch.args.flatMap((arg, index) => (launch.args[index - 1] === "-u" ? [arg] : []));
    expect(unset).toEqual(expect.arrayContaining([...BILLING_ENV_NAMES]));
    expect(launch.args.indexOf("-u")).toBeLessThan(launch.args.findIndex((arg) => arg.startsWith(`${COORDINATOR_ENV.token}=`)));
  });

  it.each([
    ["risk", { provider: "claude", verdict: "risk", codes: ["extra_usage_enabled"], unknown: [] }, /extra_usage_enabled/],
    ["unknown", { provider: "claude", verdict: "unknown", codes: [], unknown: ["not_subscription_auth:binary_missing"] }, /not_subscription_auth:binary_missing/]
  ] as const)("a %s spend verdict means no claim and no tmux launch, and the predecessor keeps custody", (_label, spend, detail) => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [true], spend: spend as unknown as LaunchSpendResult });
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(result).toMatchObject({ outcome: "refused", reason: "spend", detail: expect.stringMatching(detail) });
    expect(fake.launches).toEqual([]);
    expect(fake.killed).toEqual([]);
    // No claim: only the seeded custodian generation exists.
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => [row.generation, row.status])).toEqual([[1, "custodian"]]);
    expect(fake.pings).toHaveLength(1);
    expect(fake.pings[0]).toMatch(/spend gate refused; the predecessor keeps custody/);
  });

  it("retries once with a fresh session id, then pings once and leaves custody with the predecessor", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [false, false] });
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(result).toMatchObject({ outcome: "failed", attempts: 2, pinged: true });
    expect(fake.launches).toHaveLength(2);
    const sessionIds = fake.launches.map((launch) => launch.args[launch.args.indexOf("--session-id") + 1]);
    expect(new Set(sessionIds).size).toBe(2);
    expect(fake.killed).toEqual(["arcadia-coord-rowan-g2", "arcadia-coord-rowan-g3"]);
    expect(fake.pings).toHaveLength(1);
    expect(fake.pings[0]).toMatch(/arcadia coordinator renew --project arcadia --role rowan/);
    const rows = withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"));
    expect(rows.map((row) => [row.generation, row.status, row.failureReason])).toEqual([
      [1, "custodian", null], [2, "failed", "prompt_not_delivered"], [3, "failed", "prompt_not_delivered"]
    ]);
  });

  it("counts failed attempts toward the daily cap, so retrying callers cannot launch indefinitely", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: Array(40).fill(false) });
    const outcomes: string[] = [];
    for (let call = 0; call < 10; call += 1) {
      const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
      outcomes.push(result.outcome === "refused" ? result.reason : result.outcome);
    }
    expect(fake.launches).toHaveLength(12);
    expect(outcomes.slice(6)).toEqual(["renewal_limit", "renewal_limit", "renewal_limit", "renewal_limit"]);
  });

  it("never kills or replaces a successor that accepted while the delivery read lagged", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [false] });
    const launch = fake.deps.tmux.launch;
    fake.deps.tmux.launch = (input) => {
      launch(input);
      // The successor accepts immediately, but its transcript is not readable yet.
      withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET status = CASE generation WHEN 1 THEN 'handed_off' ELSE 'custodian' END").run());
    };
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(result).toMatchObject({ outcome: "launched", generation: 2 });
    expect(fake.killed).toEqual([]);
    expect(fake.launches).toHaveLength(1);
  });

  it("refuses at a failed pre-launch gate and never launches in a bypass mode", () => {
    const { ws, repo, projects } = setup();
    const fake = fakeDeps(projects, { deliver: [true], signedIn: false });
    expect(withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps)))
      .toMatchObject({ outcome: "refused", reason: "sign_in" });
    expect(() => withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep", permissionMode: "bypassPermissions" }, fake.deps)))
      .toThrow(/bypass/);
    expect(fake.launches).toEqual([]);
  });

  function repoWithLinkedWorktree(root: string) {
    const main = path.join(root, "main-repo");
    mkdirSync(main);
    const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
    run(main, "init", "-q", "-b", "main");
    run(main, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "--allow-empty", "-m", "init");
    const linked = path.join(root, "linked-coord");
    run(main, "worktree", "add", "-q", linked);
    return { main: realpathSync(main), linked: realpathSync(linked) };
  }

  function withInvokedFrom<T>(directory: string, body: () => T): T {
    const before = process.env.ARCADIA_INVOKED_FROM;
    process.env.ARCADIA_INVOKED_FROM = directory;
    try { return body(); } finally { if (before === undefined) delete process.env.ARCADIA_INVOKED_FROM; else process.env.ARCADIA_INVOKED_FROM = before; }
  }

  it("renew run from a coordinator's own linked worktree launches from the main worktree, never nested", () => {
    const { root, ws, projects } = setup();
    const { main, linked } = repoWithLinkedWorktree(root);
    const fake = fakeDeps(projects, { deliver: [true] });
    const result = withInvokedFrom(linked, () => runCoordinatorRenewCommand({ workspace: ws, project: "arcadia", role: "rowan", env: {}, deps: fake.deps }));
    expect(result.data).toMatchObject({ outcome: "launched", generation: 2, worktree: path.join(main, ".claude", "worktrees", "coord-rowan-g2") });
    expect(fake.launches[0].cwd).toBe(path.join(main, ".claude", "worktrees", "coord-rowan-g2"));
  });

  it("an explicit --repo wins over the invocation directory for renew", () => {
    const { root, ws, projects } = setup();
    const { linked } = repoWithLinkedWorktree(root);
    const explicit = path.join(root, "explicit-repo");
    mkdirSync(explicit);
    const fake = fakeDeps(projects, { deliver: [true] });
    const result = withInvokedFrom(linked, () => runCoordinatorRenewCommand({ workspace: ws, project: "arcadia", role: "rowan", repo: explicit, env: {}, deps: fake.deps }));
    expect(result.data).toMatchObject({ outcome: "launched", worktree: path.join(explicit, ".claude", "worktrees", "coord-rowan-g2") });
  });

  it("renew refuses with repository_unresolved outside any repository and pings, so a tick without --repo cannot refuse silently", () => {
    const { root, ws, projects } = setup();
    const outside = path.join(root, "not-a-repo");
    mkdirSync(outside);
    const fake = fakeDeps(projects, { deliver: [true] });
    const result = withInvokedFrom(outside, () => runCoordinatorRenewCommand({ workspace: ws, project: "arcadia", role: "rowan", env: {}, deps: fake.deps }));
    process.exitCode = undefined;
    expect(result.data).toMatchObject({ outcome: "refused", reason: "repository_unresolved" });
    expect(fake.launches).toEqual([]);
    expect(fake.pings).toHaveLength(1);
    expect(fake.pings[0]).toMatch(/repository unresolved/);
    expect(fake.pings[0]).toMatch(/--repo/);
    // Nothing was claimed: custody and the generation table are untouched.
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => row.status)).toEqual(["custodian"]);
  });

  it("renew passes an explicit --repo through to the worktree and never pings for it", () => {
    const { root, ws, projects } = setup();
    const explicit = path.join(root, "primary");
    mkdirSync(explicit);
    const fake = fakeDeps(projects, { deliver: [true] });
    const outside = path.join(root, "not-a-repo");
    mkdirSync(outside);
    const result = withInvokedFrom(outside, () => runCoordinatorRenewCommand({ workspace: ws, project: "arcadia", role: "rowan", repo: explicit, env: {}, deps: fake.deps }));
    expect(result.data).toMatchObject({ outcome: "launched" });
    expect(fake.pings).toEqual([]);
  });

  it("renew surfaces a failed log write on a failed claim instead of discarding it", () => {
    const { ws, repo, projects } = setup();
    const log = coordinatorPaths(ws, "arcadia", "rowan").generationsLog;
    unlinkSync(log);
    mkdirSync(log);
    const fake = fakeDeps(projects, { deliver: [false, false] });
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" ? result.warnings?.some((warning) => /log write failed/.test(warning)) : false).toBe(true);
  });

  it("renew reports a failed log write as a warning and still launches", () => {
    const { ws, repo, projects } = setup();
    const log = coordinatorPaths(ws, "arcadia", "rowan").generationsLog;
    unlinkSync(log);
    mkdirSync(log);
    const fake = fakeDeps(projects, { deliver: [true] });
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, fake.deps));
    expect(result).toMatchObject({ outcome: "launched", generation: 2 });
    expect(result.outcome === "launched" ? result.warnings?.[0] : null).toMatch(/log write failed/);
  });
});

describe("startPressInProgressIn (START interlock detector)", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const started = (agoMs: number) => new Date(now.getTime() - agoMs).toISOString();
  function library() {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-startpress-"));
    roots.push(root);
    return root;
  }
  function press(lib: string, card: string, id: string, input: { run?: unknown; descriptor?: unknown }) {
    const dir = path.join(lib, "runs", "operator", card, id);
    mkdirSync(dir, { recursive: true });
    const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
    if (input.run !== undefined) writeFileSync(path.join(dir, "run.json"), text(input.run));
    if (input.descriptor !== null) writeFileSync(path.join(dir, "descriptor.json"), text(input.descriptor ?? { startRun: { schema: "arcadia-start-run-v1" } }));
  }
  const detect = (lib: string, alive: (pid: number) => boolean = () => true) => startPressInProgressIn(lib, { now, liveness: (pid) => (alive(pid) ? "live" : "dead") });
  const detectWith = (lib: string, liveness: (pid: number) => PidLiveness) => startPressInProgressIn(lib, { now, liveness });

  it("a missing library or no presses is not in progress", () => {
    expect(detect(path.join(library(), "absent"))).toMatchObject({ inProgress: false });
    const lib = library();
    mkdirSync(path.join(lib, "runs", "operator", "markers"), { recursive: true });
    writeFileSync(path.join(lib, "runs", "operator", "x.consumed.json"), "{}");
    expect(detect(lib)).toMatchObject({ inProgress: false });
  });

  it("a running START press with a live pid blocks", () => {
    const lib = library();
    press(lib, "start", "r1", { run: { status: "running", pid: 4242, startedAt: started(60_000) } });
    expect(detect(lib, (pid) => pid === 4242)).toMatchObject({ inProgress: true, detail: expect.stringContaining("start/r1") });
  });

  it("a running START press with the current process pid blocks without a stub", () => {
    const lib = library();
    press(lib, "start", "r1", { run: { status: "running", pid: process.pid, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() } });
    expect(startPressInProgressIn(lib, { now: new Date() })).toMatchObject({ inProgress: true });
  });

  it("a hard-stopped press (dead pid) does not wedge the relay and is named", () => {
    const lib = library();
    press(lib, "start", "r1", { run: { status: "running", pid: 4242, startedAt: started(60_000) } });
    const result = detect(lib, () => false);
    expect(result.inProgress).toBe(false);
    expect(result.detail).toContain("start/r1");
    expect(result.detail).toContain("dead");
  });

  it("a record without a usable pid blocks while recent and stops blocking past the age bound", () => {
    const lib = library();
    press(lib, "start", "r1", { run: { status: "running", startedAt: started(60_000) } });
    expect(detect(lib)).toMatchObject({ inProgress: true });
    const old = library();
    press(old, "start", "r1", { run: { status: "running", startedAt: started(7 * 3_600_000) } });
    expect(detect(old)).toMatchObject({ inProgress: false });
  });

  it("a verified-live runner blocks however old the record is (no age release of a live press)", () => {
    const lib = library();
    press(lib, "start", "r1", { run: { status: "running", pid: 4242, startedAt: started(30 * 3_600_000) } });
    expect(detect(lib, () => true)).toMatchObject({ inProgress: true });
  });

  it("an unverifiable pid blocks while recent and is released past the age bound", () => {
    const recent = library();
    press(recent, "start", "r1", { run: { status: "running", pid: 4242, startedAt: started(60_000) } });
    expect(detectWith(recent, () => "unverified")).toMatchObject({ inProgress: true });
    const old = library();
    press(old, "start", "r1", { run: { status: "running", pid: 4242, startedAt: started(7 * 3_600_000) } });
    expect(detectWith(old, () => "unverified")).toMatchObject({ inProgress: false });
  });

  it("a dead runner with a surviving child still blocks; both dead is a hard stop", () => {
    const lib = library();
    press(lib, "start", "r1", { run: { status: "running", pid: 4242, childPid: 4243, startedAt: started(3_600_000) } });
    expect(detect(lib, (pid) => pid === 4243)).toMatchObject({ inProgress: true, detail: expect.stringContaining("child pid 4243") });
    const result = detect(lib, () => false);
    expect(result.inProgress).toBe(false);
    expect(result.detail).toContain("child pid 4243");
  });

  it("stray files in the library, at card level and inside a card directory, are not presses", () => {
    const lib = library();
    press(lib, "start", "r1", { run: { status: "succeeded" } });
    writeFileSync(path.join(lib, "runs", "operator", ".DS_Store"), "x");
    writeFileSync(path.join(lib, "runs", "operator", "start", ".DS_Store"), "x");
    writeFileSync(path.join(lib, "runs", "operator", "start", "note.lock"), "{");
    expect(detect(lib)).toMatchObject({ inProgress: false });
    // A real press next to the stray files still blocks.
    press(lib, "start", "r2", { run: { status: "running", pid: 4242, startedAt: started(1000) } });
    const blocked = detect(lib);
    expect(blocked.inProgress).toBe(true);
    expect(blocked.unreadable).toBeUndefined();
  });

  it("an unreadable refusal names the actual file and the cause", () => {
    const lib = library();
    press(lib, "start", "r1", { run: "{not json" });
    const result = detect(lib);
    expect(result.detail).toContain(path.join(lib, "runs", "operator", "start", "r1", "run.json"));
    expect(result.detail).toContain("(not valid JSON)");
  });

  it("a corrupt run.json on a non-START card never blocks, and one on a START card still refuses", () => {
    const lib = library();
    press(lib, "other", "r1", { run: "{not json", descriptor: { kind: "script" } });
    expect(detect(lib)).toMatchObject({ inProgress: false });
    press(lib, "start", "r2", { run: "{not json" });
    expect(detect(lib)).toMatchObject({ inProgress: true, unreadable: true });
  });

  it("pidLiveness: ESRCH is dead, EPERM is live, a reused pid (started after the record) is dead", () => {
    const spy = vi.spyOn(process, "kill");
    try {
      spy.mockImplementation(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
      expect(pidLiveness(4242, Date.now())).toBe("dead");
      spy.mockImplementation(() => { throw Object.assign(new Error("not permitted"), { code: "EPERM" }); });
      expect(pidLiveness(4242, Date.now(), { startTime: () => Date.now() - 1000 })).toBe("live");
      expect(pidLiveness(4242, Date.now(), { startTime: () => null })).toBe("unverified");
      expect(pidLiveness(4242, Date.now() - 3_600_000, { startTime: () => Date.now() })).toBe("dead");
    } finally { spy.mockRestore(); }
    // Real ps: this process is live against a record from just before it started, and a different process once the record is years old.
    expect(pidLiveness(process.pid, Date.now() - process.uptime() * 1000)).toBe("live");
    expect(pidLiveness(process.pid, Date.now() - 400 * 86_400_000)).toBe("dead");
  });

  it("a running non-START operator card never blocks", () => {
    const lib = library();
    press(lib, "other", "r1", { run: { status: "running", pid: 4242, startedAt: started(1000) }, descriptor: { kind: "script" } });
    expect(detect(lib)).toMatchObject({ inProgress: false });
  });

  it("a completed press and an in_progress receipt alone do not block", () => {
    const lib = library();
    press(lib, "start", "r1", { run: { status: "succeeded", pid: 4242, startedAt: started(1000) } });
    mkdirSync(path.join(lib, "runs", "start", "r2"), { recursive: true });
    writeFileSync(path.join(lib, "runs", "start", "r2", "receipt.json"), JSON.stringify({ outcome: "in_progress" }));
    expect(detect(lib)).toMatchObject({ inProgress: false });
  });

  it("fails closed on an unparseable run record", () => {
    const lib = library();
    press(lib, "start", "r1", { run: "{not json" });
    expect(detect(lib)).toMatchObject({ inProgress: true, unreadable: true, detail: expect.stringContaining("PRESS_UNREADABLE") });
  });

  it("fails closed on a running press whose descriptor is missing or unparseable, and on a running record with no pid or time", () => {
    const missing = library();
    press(missing, "start", "r1", { run: { status: "running", pid: 4242, startedAt: started(1000) }, descriptor: null });
    expect(detect(missing)).toMatchObject({ inProgress: true, unreadable: true });
    const bad = library();
    press(bad, "start", "r1", { run: { status: "running", pid: 4242, startedAt: started(1000) }, descriptor: "{oops" });
    expect(detect(bad)).toMatchObject({ inProgress: true, unreadable: true });
    const blank = library();
    press(blank, "start", "r1", { run: { status: "running" } });
    expect(detect(blank)).toMatchObject({ inProgress: true, unreadable: true });
  });

  it("renew refuses on an unreadable press with its own reason text, before any launch", () => {
    const { ws, repo, projects } = setup();
    const lib = path.join(repo, "artifacts", "generated", "operator-scripts");
    press(lib, "start", "r1", { run: "{not json" });
    const fake = fakeDeps(projects, { deliver: [true] });
    const deps = { ...fake.deps, startPressInProgress: relayStartPressInterlock };
    const result = withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, deps));
    expect(result).toMatchObject({ outcome: "refused", reason: "start_in_progress", detail: expect.stringContaining("cannot be read") });
    expect(fake.launches).toHaveLength(0);
  });

  it("the command's interlock reads the primary checkout's artifacts/generated/operator-scripts library", () => {
    const { repo } = setup();
    expect(relayStartPressInterlock(repo)).toMatchObject({ inProgress: false });
    press(path.join(repo, "artifacts", "generated", "operator-scripts"), "start", "r1", { run: { status: "running", pid: process.pid, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() } });
    expect(relayStartPressInterlock(repo)).toMatchObject({ inProgress: true });
  });

  it("the operator runner records its child's pid in the press record while the script runs", () => {
    const lib = library();
    const state = path.join(lib, "run.json");
    const script = path.join(lib, "card.sh");
    // The runner records {status, pid} first and adds childPid after spawn(), so wait (bounded) for childPid before sampling.
    writeFileSync(script, `#!/bin/sh\ni=0\nwhile ! grep -q '"childPid"' "${state}" 2>/dev/null && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done\ncp "${state}" "${lib}/seen.json"\necho $$ > "${lib}/child.pid"\n`);
    chmodSync(script, 0o755);
    const result = spawnSync(process.execPath, ["-e", operatorScriptRunnerSource, script, state]);
    expect(result.status).toBe(0);
    const seen = JSON.parse(readFileSync(path.join(lib, "seen.json"), "utf8")) as { status: string; pid: number; childPid: number };
    expect(seen).toMatchObject({ status: "running" });
    expect(seen.childPid).toBe(Number(readFileSync(path.join(lib, "child.pid"), "utf8")));
    expect(seen.pid).not.toBe(seen.childPid);
  });
});
