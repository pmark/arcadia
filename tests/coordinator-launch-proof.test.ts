import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLaunchProof, claudeFolderTrust, discoverBackgroundSession, modelMatches, observeTranscript, sha256 } from "../src/coordinator/launchProof.js";

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
  it("trusts an exactly listed folder and any folder under a trusted one", () => {
    const file = state({ "/work/repo": { hasTrustDialogAccepted: true } });
    expect(claudeFolderTrust("/work/repo", file)).toMatchObject({ trusted: true, trustedFolder: "/work/repo" });
    expect(claudeFolderTrust("/work/repo/.claude/worktrees/x", file)).toMatchObject({ trusted: true, trustedFolder: "/work/repo" });
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
});

describe("discoverBackgroundSession (probe P2: --bg ignores --session-id)", () => {
  const cwd = "/work/repo";
  const uuid = "686736ac-1111-4222-8333-444455556666";
  it("takes the id the launch printed and never the id that was asked for, ignoring the notice line", () => {
    const out = "--bg manages the session id; ignoring --session-id a63607ad\nstarted background session 686736ac";
    const found = discoverBackgroundSession({ launchOutput: out, agentsJson: null, name: "n", cwd });
    expect(found).toMatchObject({ stopId: "686736ac", sessionId: null, source: "launch-output" });
  });
  it("resolves the full session id from the matching claude agents row", () => {
    const rows = JSON.stringify([{ id: "686736ac", sessionId: uuid, name: "n", cwd, model: "claude-haiku-5-5", effort: "low" }]);
    expect(discoverBackgroundSession({ launchOutput: "started 686736ac", agentsJson: rows, name: "n", cwd })).toMatchObject({ stopId: "686736ac", sessionId: uuid, model: "claude-haiku-5-5", effort: "low" });
  });
  it("falls back to the single row with this exact name and cwd when nothing was printed", () => {
    const rows = JSON.stringify([{ id: uuid, name: "n", cwd }, { id: "ffffffff", name: "n", cwd: "/other" }]);
    expect(discoverBackgroundSession({ launchOutput: "", agentsJson: rows, name: "n", cwd })).toMatchObject({ stopId: uuid, sessionId: uuid, source: "agents-json" });
  });
  it("returns null rather than guess: two matching rows, no match, bad JSON, or nothing at all", () => {
    const two = JSON.stringify([{ id: "aaaaaaaa", name: "n", cwd }, { id: "bbbbbbbb", name: "n", cwd }]);
    expect(discoverBackgroundSession({ launchOutput: "", agentsJson: two, name: "n", cwd })).toBeNull();
    expect(discoverBackgroundSession({ launchOutput: "", agentsJson: "[]", name: "n", cwd })).toBeNull();
    expect(discoverBackgroundSession({ launchOutput: "", agentsJson: "nope", name: "n", cwd })).toBeNull();
    expect(discoverBackgroundSession({ launchOutput: "--bg manages the session id; ignoring --session-id deadbeef", agentsJson: null, name: "n", cwd })).toBeNull();
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
});
