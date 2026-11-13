import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CapsuleSources } from "../src/coordinator/capsule.js";
import { listGenerations, seedCustodianGeneration } from "../src/coordinator/generations.js";
import { readFirstUserMessage, renderResumePrompt, renewCoordinator, type RelayDeps } from "../src/coordinator/relay.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * #2286 gate 6: the relay's launch prompt is delivered, and its delivery check passes, only when the first user message
 * in the successor's transcript equals the prompt exactly. Until a real launch has shown what the real `claude` writes,
 * this test is the substitute: it runs the relay's real argv (the `env ... claude ... "<prompt>"` command it would hand
 * to tmux) against a stand-in `claude` that writes a transcript the way the real one is observed to (tests/fixtures/
 * coordinator-relay/fake-claude.mjs), and checks the real delivery check against it. No tmux server starts, no real
 * session launches, nothing leaves the temporary directory. It proves the plumbing and pins the failure modes; it does
 * NOT prove what the real `claude` writes. The real proof is "Real launch proof" in
 * docs/agent-guidance/coordinator-handoff-design.md.
 */
const fixture = path.resolve(import.meta.dirname, "fixtures", "coordinator-relay", "fake-claude.mjs");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const sources: CapsuleSources = {
  plan: () => ({ activePlan: null, currentAction: null, mainSha: "abc" }),
  production: () => ({ status: "inactive", revision: 0, epoch: 0, openEscalations: [], redAlerts: [] }),
  prs: () => [], sessions: () => [], decisions: () => ({ open: [], recentlyAnswered: [], pendingMerge: [] }),
  pings: () => ({ pending: [], recent: [] }), budget: () => null
};

function harness(mode: string, options: { model?: string; effort?: string; trusted?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-relay-proof-")));
  roots.push(root);
  const ws = path.join(root, "workspace");
  initWorkspace(ws);
  const repo = path.join(root, "repo");
  mkdirSync(repo, { recursive: true });
  const projects = path.join(root, "claude-projects");
  const bin = path.join(root, "bin");
  const capture = path.join(root, "capture.jsonl");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
  chmodSync(path.join(bin, "claude"), 0o755);
  withDatabase(ws, (db) => seedCustodianGeneration(db, ws, {
    project: "arcadia", role: "rowan", provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas",
    nativeSessionId: "11111111-1111-4111-8111-111111111111", now: new Date("2026-11-07T20:00:00Z")
  }));
  let clock = new Date("2026-11-07T21:00:00Z").getTime();
  let ids = 0;
  const pings: string[] = [];
  const launched: Array<{ name: string; cwd: string; command: string; args: string[]; status: number | null }> = [];
  const deps: RelayDeps = {
    tmux: {
      hasSession: () => false,
      // The real launcher hands tmux this exact command and argv; here the process is run directly, with the
      // custody variables the argv itself carries (`env VAR=... claude ...`), and no tmux server.
      launch(input) {
        const run = spawnSync(input.command, input.args, { cwd: input.cwd, encoding: "utf8", env: {
          PATH: `${bin}:${process.env.PATH}`, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_PROJECTS: projects, FAKE_CLAUDE_CAPTURE: capture,
          ...(options.model !== undefined ? { FAKE_CLAUDE_MODEL: options.model } : {}), ...(options.effort !== undefined ? { FAKE_CLAUDE_EFFORT: options.effort } : {})
        } });
        launched.push({ name: input.name, cwd: input.cwd, command: input.command, args: input.args, status: run.status });
      },
      killSession: () => undefined
    },
    decision: () => ({ inForce: true, reason: "test decision" }),
    signIn: () => ({ signedIn: true, remedy: "" }),
    capacity: () => ({ admitted: true, reason: "ok" }),
    startPressInProgress: () => ({ inProgress: false, detail: "none" }),
    folderTrust: () => (options.trusted === false ? { trusted: false, trustedFolder: null, detail: "not trusted" } : { trusted: true, trustedFolder: "/trusted", detail: "test trust" }),
    createWorktree: (_repo, directory) => { mkdirSync(directory, { recursive: true }); },
    firstUserMessage: readFirstUserMessage,
    claudeProjectsDirectory: projects,
    sleep: (ms) => { clock += ms; },
    now: () => new Date(clock),
    newSessionId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    ping: (message) => { pings.push(message); },
    sources: () => sources
  };
  const renew = () => withDatabase(ws, (db) => renewCoordinator(db, ws, { project: "arcadia", role: "rowan", repoRoot: repo, effort: "e3_deep" }, deps));
  const captured = () => readFileSync(capture, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { args: string[]; cwd: string; role: string | null; generation: string | null; tokenSet: boolean });
  return { ws, renew, pings, launched, captured };
}

describe("relay launch proof fixture: the exact-match prompt delivery (#2286 gate 6)", () => {
  it("delivers: the stand-in claude receives the relay's own argv and the delivery check reads the prompt back exactly", () => {
    const h = harness("exact");
    const result = h.renew();
    expect(result).toMatchObject({ outcome: "launched", generation: 2, attempts: 1 });
    const [call] = h.captured();
    // The argv the successor really gets: custody variables set, the pinned flags, and the prompt as the last argument.
    expect(call).toMatchObject({ role: "rowan", generation: "2", tokenSet: true });
    expect(call.args).toEqual(expect.arrayContaining(["--remote-control", "--session-id", "--name", "--model", "opus", "--effort", "high", "--permission-mode", "auto"]));
    const row = withDatabase(h.ws, (db) => listGenerations(db, "arcadia", "rowan")).find((candidate) => candidate.generation === 2)!;
    const prompt = renderResumePrompt({ project: "arcadia", role: "rowan", generation: 2, snapshotSha: row.snapshotSha!, snapshotPath: row.snapshotPath! });
    expect(call.args.at(-1)).toBe(prompt);
    // The transcript the check read is the file the stand-in wrote at the path the relay recorded.
    expect(readFirstUserMessage(row.transcriptPath!)).toBe(prompt.trim());
    expect(call.cwd).toBe(h.launched[0].cwd);
    expect(h.pings).toEqual([]);
  });

  it.each([
    ["host context appended as an extra text block", "blocks"],
    ["a truncated prompt", "truncated"],
    ["text added before the prompt", "prefixed"],
    ["a session that never wrote a transcript", "none"]
  ])("fails closed on %s: both attempts fail delivery, custody stays with the predecessor, one ping", (_label, mode) => {
    const h = harness(mode);
    const result = h.renew();
    expect(result).toMatchObject({ outcome: "failed", attempts: 2, pinged: true });
    expect(h.captured()).toHaveLength(2);
    expect(h.pings).toHaveLength(1);
    expect(withDatabase(h.ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => [row.generation, row.status])).toEqual([[1, "custodian"], [2, "failed"], [3, "failed"]]);
  });

  it("never reads a sidechain or meta line as the first user message", () => {
    const h = harness("exact");
    h.renew();
    const row = withDatabase(h.ws, (db) => listGenerations(db, "arcadia", "rowan")).find((candidate) => candidate.generation === 2)!;
    expect(readFirstUserMessage(row.transcriptPath!) ?? "").not.toMatch(/subagent prompt|local-command-caveat/);
  });
});

describe("relay launch proof: exact brief hash and the actual provider, model and effort (acceptance 3 of close-coordinator-relay-gates-6-9-10-11)", () => {
  it("records the brief hash, the delivered hash and the model the Session shows, in the result and beside the generation", () => {
    const h = harness("exact", { model: "claude-opus-4-fixture", effort: "high" });
    const result = h.renew();
    expect(result.outcome).toBe("launched");
    if (result.outcome !== "launched") return;
    const row = withDatabase(h.ws, (db) => listGenerations(db, "arcadia", "rowan")).find((candidate) => candidate.generation === 2)!;
    const prompt = renderResumePrompt({ project: "arcadia", role: "rowan", generation: 2, snapshotSha: row.snapshotSha!, snapshotPath: row.snapshotPath! });
    expect(result.proof.briefSha).toBe(createHash("sha256").update(prompt.trim()).digest("hex"));
    expect(result.proof).toMatchObject({ transport: "tmux", delivered: true, deliveredSha: result.proof.briefSha, observed: { provider: "claude", model: "claude-opus-4-fixture", effort: "high" }, modelMatchesRequest: true, effortMatchesRequest: true });
    expect(result.warnings ?? []).toEqual([]);
    expect(JSON.parse(readFileSync(result.proofPath!, "utf8"))).toEqual(result.proof);
  });

  it("records the OBSERVED model, never the requested one: a different model is flagged, and an unobserved one stays null", () => {
    const wrong = harness("exact", { model: "claude-haiku-5-5" }).renew();
    expect(wrong.outcome).toBe("launched");
    if (wrong.outcome === "launched") {
      expect(wrong.proof.observed.model).toBe("claude-haiku-5-5");
      expect(wrong.proof.requested.model).toBe("opus");
      expect(wrong.proof.modelMatchesRequest).toBe(false);
      expect(wrong.warnings?.join(" ")).toMatch(/does not correspond to the requested opus/);
    }
    const silent = harness("exact", { model: "none" }).renew();
    expect(silent.outcome).toBe("launched");
    if (silent.outcome === "launched") {
      expect(silent.proof.observed).toEqual({ provider: "claude", model: null, effort: null });
      expect(silent.proof.modelMatchesRequest).toBeNull();
      expect(silent.warnings?.join(" ")).toMatch(/unobserved, not as the requested value/);
    }
  });

  it("states an unobserved effort as unobserved rather than echoing the requested effort", () => {
    const result = harness("exact", { model: "claude-opus-4-fixture" }).renew();
    expect(result.outcome === "launched" && result.proof.observed.effort).toBeNull();
    expect(result.outcome === "launched" && result.proof.requested.effort).toBe("high");
  });

  it("refuses an untrusted launch folder before any claim, worktree or session, pings once, and the predecessor keeps custody", () => {
    const h = harness("exact", { trusted: false });
    const result = h.renew();
    expect(result).toMatchObject({ outcome: "refused", reason: "folder_untrusted" });
    expect(h.launched).toEqual([]);
    expect(h.pings).toHaveLength(1);
    expect(withDatabase(h.ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => [row.generation, row.status])).toEqual([[1, "custodian"]]);
  });
});
