import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CapsuleSources } from "../src/coordinator/capsule.js";
import { COORDINATOR_ENV, listGenerations, seedCustodianGeneration } from "../src/coordinator/generations.js";
import {
  RELAY_LAUNCH_DECISION_ID,
  claudeProjectSlug,
  readDecisionFromMain,
  readFirstUserMessage,
  readRelayDecision,
  renewCoordinator,
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

function fakeDeps(projects: string, options: { deliver: boolean[]; inForce?: boolean; signedIn?: boolean }): Fake {
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
    signIn: () => ({ signedIn: options.signedIn ?? true, remedy: "sign in" }),
    capacity: () => ({ admitted: true, reason: "ok" }),
    createWorktree: (_repo, directory) => { mkdirSync(directory, { recursive: true }); },
    firstUserMessage: readFirstUserMessage,
    claudeProjectsDirectory: projects,
    sleep: (ms) => { clock += ms; },
    now: () => new Date(clock),
    newSessionId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    ping: (message) => { fake.pings.push(message); },
    sources: () => sources
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
});
