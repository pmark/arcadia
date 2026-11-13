import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentIdSnapshot, buildLaunchProof, claudeFolderTrust, defaultClaudeStatePath, discoverBackgroundSession, modelMatches, observeTranscript, sha256 } from "../src/coordinator/launchProof.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-launch-proof-"));
  roots.push(root);
  return root;
}

describe("claudeFolderTrust (probe P1: a fresh folder hits the trust prompt)", () => {
  const state = (projects: Record<string, unknown>): string => {
    const file = path.join(scratch(), "claude.json");
    writeFileSync(file, JSON.stringify({ projects }));
    return file;
  };
  const real = (target: string): string => realpathSync(target);
  it("trusts an exactly listed folder and any folder under a trusted one, including one that does not exist yet", () => {
    const repo = real(scratch());
    const file = state({ [repo]: { hasTrustDialogAccepted: true } });
    expect(claudeFolderTrust(repo, file)).toMatchObject({ trusted: true, trustedFolder: repo });
    expect(claudeFolderTrust(path.join(repo, ".claude", "worktrees", "x"), file)).toMatchObject({ trusted: true, trustedFolder: repo });
  });
  it("does not trust a fresh folder, an unaccepted entry, a sibling with a shared prefix, a missing or an unreadable state file", () => {
    const file = state({ "/work/repo": { hasTrustDialogAccepted: false }, "/work/rep": { hasTrustDialogAccepted: true } });
    expect(claudeFolderTrust("/work/repo", file).trusted).toBe(false);
    expect(claudeFolderTrust("/elsewhere/fresh", file).detail).toMatch(/Is this a project you trust/);
    expect(claudeFolderTrust("/x", path.join(scratch(), "absent.json")).detail).toMatch(/does not exist/);
    const broken = path.join(scratch(), "broken.json");
    writeFileSync(broken, "{not json");
    expect(claudeFolderTrust("/x", broken)).toMatchObject({ trusted: false, detail: expect.stringMatching(/cannot be read/) });
  });
  it("judges a symlink by its real path: one pointing out of a trusted tree is untrusted, a symlinked repo path is trusted by its target", () => {
    const trustedRoot = real(scratch());
    const outside = real(scratch());
    const file = state({ [trustedRoot]: { hasTrustDialogAccepted: true } });
    const escape = path.join(trustedRoot, "escape");
    symlinkSync(outside, escape);
    expect(claudeFolderTrust(escape, file).trusted).toBe(false);
    const alias = path.join(real(scratch()), "alias");
    symlinkSync(trustedRoot, alias);
    expect(claudeFolderTrust(alias, file)).toMatchObject({ trusted: true, trustedFolder: trustedRoot });
  });
  it("refuses a grant that exists only because the filesystem root or the home directory is trusted, naming it", () => {
    const home = real(scratch());
    const project = path.join(home, "Dev", "repo");
    mkdirSync(project, { recursive: true });
    const viaHome = claudeFolderTrust(project, state({ [home]: { hasTrustDialogAccepted: true } }), home);
    expect(viaHome).toMatchObject({ trusted: false, detail: expect.stringContaining(`only through ${home}`) });
    expect(claudeFolderTrust(project, state({ "/": { hasTrustDialogAccepted: true } }), home).trusted).toBe(false);
    // A specific grant below the blanket one still counts.
    expect(claudeFolderTrust(project, state({ [home]: { hasTrustDialogAccepted: true }, [project]: { hasTrustDialogAccepted: true } }), home)).toMatchObject({ trusted: true, trustedFolder: project });
  });
});

describe("discoverBackgroundSession (probe P2: --bg ignores --session-id; only a NEW agents row can be the session)", () => {
  const cwd = "/work/repo";
  const uuid = "686736ac-1111-4222-8333-444455556666";
  const find = (launchOutput: string, rows: unknown[] | null, preexisting: string[] = [], name = "n") =>
    discoverBackgroundSession({ launchOutput, agentsJson: rows === null ? null : JSON.stringify(rows), name, cwd, preexisting });
  it("snapshots every id and sessionId, lower-cased, and refuses an unreadable listing", () => {
    expect(agentIdSnapshot(JSON.stringify([{ id: "ABCD1234", sessionId: uuid }, { name: "no id" }]))).toEqual(["abcd1234", uuid]);
    expect(agentIdSnapshot("nope")).toBeNull();
  });
  it("accepts a printed id only when it matches the single new row in this cwd, and resolves the full id and model", () => {
    const rows = [{ id: "686736ac", sessionId: uuid, name: "renamed since", cwd, model: "claude-haiku-5-5", effort: "low" }];
    const out = "--bg manages the session id; ignoring --session-id a63607ad\nstarted background session 686736ac";
    expect(find(out, rows)).toMatchObject({ verified: true, stopId: "686736ac", sessionId: uuid, model: "claude-haiku-5-5", effort: "low" });
  });
  it("ignores decoy 8-hex tokens (a date, a hex word) and takes the single new row with the launch's name", () => {
    expect(find("started 20261112 build deadbeef", [{ id: uuid, name: "n", cwd }, { id: "ffffffff", name: "n", cwd: "/other" }])).toMatchObject({ verified: true, stopId: uuid, sessionId: uuid });
  });
  it("never takes a stale row: an old same-name row alone is unverified (reproduced: stopId oldoldol)", () => {
    const old = { id: "oldoldol", sessionId: uuid, name: "n", cwd };
    expect(find("started", [old], ["oldoldol"])).toMatchObject({ verified: false, stopId: null });
    // Matched by sessionId too, in either case.
    expect(find("started", [old], [uuid.toUpperCase()])).toMatchObject({ verified: false, stopId: null });
  });
  it("never takes a printed token that matches an OLD row (reproduced: stopId deadbeef); the new row is used, or nothing", () => {
    const old = { id: "deadbeef", name: "other keeper", cwd };
    expect(find("started deadbeef", [old], ["deadbeef"])).toMatchObject({ verified: false, stopId: null, unverifiedPrintedId: "deadbeef" });
    expect(find("started deadbeef", [old, { id: "feedc0de", name: "n", cwd }], ["deadbeef"])).toMatchObject({ verified: true, stopId: "feedc0de" });
  });
  it("finds a new row that appears late: an early listing without it is unverified, the later one verifies", () => {
    const old = { id: "oldoldol", name: "n", cwd };
    expect(find("", [old], ["oldoldol"]).verified).toBe(false);
    expect(find("", [old, { id: "newnewne", name: "n", cwd }], ["oldoldol"])).toMatchObject({ verified: true, stopId: "newnewne" });
  });
  it("rejects a matching new row that has no usable session id (an interactive row), never returning an empty stopId", () => {
    expect(find("", [{ name: "n", cwd }])).toMatchObject({ verified: false, stopId: null });
    expect(find("", [{ id: "", sessionId: "", name: "n", cwd }])).toMatchObject({ verified: false, stopId: null });
  });
  it("leaves several new rows in the cwd unverified, even if one matches the name or the printed token", () => {
    const rows = [{ id: "aaaaaaaa", name: "n", cwd }, { id: "bbbbbbbb", name: "other", cwd }];
    expect(find("started aaaaaaaa", rows)).toMatchObject({ verified: false, stopId: null });
    expect(find("", rows)).toMatchObject({ verified: false, stopId: null });
  });
  it("is unverified for a new row that matches neither the printed id nor the name, a new row in another cwd, bad JSON, no listing, or the notice only", () => {
    expect(find("started 20261112", [{ id: "ffffffff", name: "someone else", cwd }])).toMatchObject({ verified: false, stopId: null, unverifiedPrintedId: "20261112" });
    expect(find("20261112", [{ id: "20261112", name: "n", cwd: "/other" }])).toMatchObject({ verified: false, stopId: null });
    expect(discoverBackgroundSession({ launchOutput: "", agentsJson: "nope", name: "n", cwd, preexisting: [] }).verified).toBe(false);
    expect(find("started 686736ac", null)).toMatchObject({ verified: false, stopId: null, unverifiedPrintedId: "686736ac" });
    expect(find("--bg manages the session id; ignoring --session-id deadbeef", null)).toMatchObject({ verified: false, unverifiedPrintedId: null });
  });
});

describe("observeTranscript and buildLaunchProof", () => {
  const brief = "You are the keeper.\nDo the thing.";
  const transcript = (lines: unknown[]): string => {
    const file = path.join(scratch(), "t.jsonl");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    return file;
  };
  it("hashes the first main-chain user message across string and block content, skipping meta and sidechain", () => {
    const file = transcript([
      { type: "user", isMeta: true, message: { content: "caveat" } },
      { type: "user", isSidechain: true, message: { content: "sub" } },
      { type: "user", message: { content: [{ type: "text", text: "You are the keeper." }, { type: "text", text: "\nDo the thing." }] } },
      { type: "user", message: { content: "a later message" } },
      { type: "assistant", message: { model: "claude-sonnet-5-5" }, effort: "medium" }
    ]);
    expect(observeTranscript(file)).toEqual({ deliveredSha: sha256(brief), model: "claude-sonnet-5-5", effort: "medium" });
  });
  it("reports nothing for a transcript that does not exist yet", () => {
    expect(observeTranscript(path.join(scratch(), "none.jsonl"))).toEqual({ deliveredSha: null, model: null, effort: null });
  });
  const now = new Date("2026-11-12T20:00:00Z");
  it("marks delivery true only when the hashes are equal, and warns on a truncated brief", () => {
    const good = buildLaunchProof({ transport: "bg", sessionId: "s", brief, transcript: { deliveredSha: sha256(brief), model: "claude-haiku-5-5", effort: "low" }, requestedModel: "haiku", requestedEffort: "low", now });
    expect(good).toMatchObject({ delivered: true, modelMatchesRequest: true, effortMatchesRequest: true, warnings: [] });
    const cut = buildLaunchProof({ transport: "bg", sessionId: "s", brief, transcript: { deliveredSha: sha256("You are the keeper."), model: null, effort: null }, requestedModel: "haiku", requestedEffort: "low", now });
    expect(cut.delivered).toBe(false);
    expect(cut.warnings.join(" ")).toMatch(/is not the brief/);
  });
  it("falls back to the agents row only for what the transcript did not state, and never to the request", () => {
    const proof = buildLaunchProof({ transport: "bg", sessionId: "s", brief, transcript: { deliveredSha: sha256(brief), model: null, effort: null }, agent: { model: "claude-haiku-5-5", effort: null }, requestedModel: "sonnet", requestedEffort: "high", now });
    expect(proof.observed).toEqual({ provider: "claude", model: "claude-haiku-5-5", effort: null });
    expect(proof.modelMatchesRequest).toBe(false);
    expect(proof.effortMatchesRequest).toBeNull();
  });
  it("matches an alias against a full id", () => {
    expect(modelMatches("opus", "claude-opus-4-1")).toBe(true);
    expect(modelMatches("sonnet", "claude-haiku-5-5")).toBe(false);
    expect(modelMatches("opus[1m]", "claude-opus-4-1")).toBe(true);
  });
  it("matches a full id only by equality or its dated form, never by a longer lookalike", () => {
    expect(modelMatches("claude-sonnet-4-5", "claude-sonnet-4-5")).toBe(true);
    expect(modelMatches("claude-sonnet-4-5", "claude-sonnet-4-5-20250929")).toBe(true);
    expect(modelMatches("claude-sonnet-4-5", "claude-sonnet-4-50")).toBe(false);
    expect(modelMatches("claude-sonnet-4-5", "claude-sonnet-4-5-20250929-extra")).toBe(false);
    // An alias is a whole segment, not a substring.
    expect(modelMatches("opus", "claude-opusish-1")).toBe(false);
  });
  it("resolves the Claude state file from CLAUDE_CONFIG_DIR when set, else the home directory", () => {
    expect(defaultClaudeStatePath({ CLAUDE_CONFIG_DIR: "/cfg/claude" }, "/home/u")).toBe("/cfg/claude/.claude.json");
    expect(defaultClaudeStatePath({ CLAUDE_CONFIG_DIR: "  " }, "/home/u")).toBe("/home/u/.claude.json");
    expect(defaultClaudeStatePath({}, "/home/u")).toBe("/home/u/.claude.json");
  });
});
