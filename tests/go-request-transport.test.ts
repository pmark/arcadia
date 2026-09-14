import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertClean } from "../src/git/worktrees.js";
import { GO_RESPONSE_TIMEOUT_MS } from "../src/sessions/goRequestProtocol.js";

const mocks = vi.hoisted(() => ({ broker: vi.fn(), projects: vi.fn(), metadata: vi.fn(), workspace: vi.fn() }));
vi.mock("../src/sessions/goRequestExecutor.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/sessions/goRequestExecutor.js")>(),
  executeHostGo: mocks.broker
}));
vi.mock("../src/db/repositories.js", () => ({ listProjects: mocks.projects, getProjectMetadata: mocks.metadata }));
vi.mock("../src/workspace/resolve.js", () => ({ requireResolvedWorkspace: mocks.workspace }));
vi.mock("../src/commands/preserve.js", () => ({ runPreserveCommand: vi.fn() }));
import { agentGoTransportReady, processPreservationRequests, requestAgentGo } from "../src/sessions/preservationTransport.js";

describe("agent go request transport", () => {
  let root: string;
  let source: string;
  let workspace: string;
  const nonce = "11111111-1111-1111-1111-111111111111";
  const db = { prepare: () => ({ all: () => [] }) } as unknown as Database.Database;
  const result = { ok: true, command: "go-broker", data: { nextWorktree: { path: "/prepared" } } };
  const requestFile = () => path.join(source, ".arcadia-go-request");
  const responseFile = () => path.join(workspace, "artifacts/go-requests", `${nonce}.json`);

  beforeEach(() => {
    vi.stubEnv("CODEX_SANDBOX", "");
    vi.resetAllMocks();
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-go-transport-")));
    source = path.join(root, "repo");
    workspace = path.join(root, "workspace");
    mkdirSync(source);
    execFileSync("git", ["init", "--quiet", source]);
    mocks.workspace.mockReturnValue(workspace);
    mocks.projects.mockReturnValue([{ id: "project", slug: "fixture", status: "active" }]);
    mocks.metadata.mockReturnValue({ repo_path: source });
    mocks.broker.mockImplementation(() => {
      assertClean(source, "source worktree");
      return Promise.resolve({ ok: true, response: result });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("completes a round trip without the request dirtying the source", async () => {
    processPreservationRequests(db, workspace);
    const pending = requestAgentGo(source, "codex");
    expect(existsSync(requestFile())).toBe(true);
    processPreservationRequests(db, workspace);
    await expect(pending).resolves.toEqual(result);
    expect(existsSync(requestFile())).toBe(false);
    expect(mocks.broker).toHaveBeenCalledExactlyOnceWith(source, "codex");
    processPreservationRequests(db, workspace);
    expect(mocks.broker).toHaveBeenCalledTimes(1);
  });

  it("still refuses real uncommitted work and delivers the refusal", async () => {
    processPreservationRequests(db, workspace);
    writeFileSync(path.join(source, "user-work.txt"), "preserve me");
    const pending = requestAgentGo(source, "codex");
    processPreservationRequests(db, workspace);
    await expect(pending).rejects.toMatchObject({
      code: "VALIDATION_ERROR", exitCode: 2,
      details: { path: source, changes: ["?? user-work.txt"], remedy: expect.stringContaining("Review and commit") }
    });
    expect(readFileSync(path.join(source, "user-work.txt"), "utf8")).toBe("preserve me");
  });

  it("does not execute a replay with an existing protected response", () => {
    mkdirSync(path.dirname(responseFile()), { recursive: true });
    writeFileSync(responseFile(), JSON.stringify({ ok: true, response: result }));
    writeFileSync(requestFile(), JSON.stringify({ nonce, agent: "codex" }));
    processPreservationRequests(db, workspace);
    expect(mocks.broker).not.toHaveBeenCalled();
    expect(existsSync(requestFile())).toBe(false);
  });

  it("rejects requests carrying extra authority", () => {
    writeFileSync(requestFile(), JSON.stringify({ nonce, agent: "codex", launch: true }));
    processPreservationRequests(db, workspace);
    expect(mocks.broker).not.toHaveBeenCalled();
    expect(existsSync(responseFile())).toBe(false);
  });

  it("does not follow request symlinks", () => {
    const target = path.join(root, "outside-request");
    writeFileSync(target, JSON.stringify({ nonce, agent: "codex" }));
    symlinkSync(target, requestFile());
    processPreservationRequests(db, workspace);
    expect(mocks.broker).not.toHaveBeenCalled();
    expect(existsSync(target)).toBe(true);
  });

  it("refuses an unavailable worker before writing any request", async () => {
    await expect(requestAgentGo(source, "codex")).rejects.toThrow("unavailable");
    expect(existsSync(requestFile())).toBe(false);
  });

  it("refuses an old worker heartbeat even when preservation is available", async () => {
    processPreservationRequests(db, workspace);
    expect(agentGoTransportReady(workspace)).toBe(true);
    const heartbeat = path.join(workspace, ".arcadia/preservation.heartbeat");
    const old = JSON.parse(readFileSync(heartbeat, "utf8"));
    delete old.goRequests;
    writeFileSync(heartbeat, JSON.stringify(old));
    expect(agentGoTransportReady(workspace)).toBe(false);
    await expect(requestAgentGo(source, "codex")).rejects.toThrow("updated Arcadia worker");
    expect(existsSync(requestFile())).toBe(false);
  });

  it("never overwrites or consumes a tracked request", async () => {
    const body = JSON.stringify({ nonce, agent: "codex" });
    writeFileSync(requestFile(), body);
    execFileSync("git", ["add", ".arcadia-go-request"], { cwd: source });
    processPreservationRequests(db, workspace);
    await expect(requestAgentGo(source, "codex")).rejects.toThrow("must not be tracked");
    expect(mocks.broker).not.toHaveBeenCalled();
    expect(readFileSync(requestFile(), "utf8")).toBe(body);
    expect(() => assertClean(source, "source")).toThrow("not clean");
  });

  it("cleans up its timed-out request and does not count stale transport as user work", async () => {
    vi.useFakeTimers();
    processPreservationRequests(db, workspace);
    const pending = requestAgentGo(source, "codex");
    expect(() => assertClean(source, "source")).not.toThrow();
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(GO_RESPONSE_TIMEOUT_MS + 250);
    await rejected;
    expect(existsSync(requestFile())).toBe(false);
  });

  it("skips an inaccessible Project without losing healthy routes or heartbeat", () => {
    mocks.projects.mockReturnValue([
      { id: "bad", status: "active" }, { id: "good", status: "active" }, { id: "inactive", status: "archived" }
    ]);
    mocks.metadata.mockImplementation((_db, id) => {
      if (id === "bad") return { repo_path: path.join(root, "missing") };
      return { repo_path: source };
    });
    expect(() => processPreservationRequests(db, workspace)).not.toThrow();
    expect(agentGoTransportReady(workspace)).toBe(true);
    const heartbeat = JSON.parse(readFileSync(path.join(workspace, ".arcadia/preservation.heartbeat"), "utf8"));
    expect(heartbeat.repositories).toEqual([{ path: source }]);
    expect(mocks.metadata).not.toHaveBeenCalledWith(db, "inactive");
  });

  it("keeps the transport ticking while go is still executing", async () => {
    vi.useFakeTimers();
    let finish!: (result: unknown) => void;
    mocks.broker.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    processPreservationRequests(db, workspace);
    const pending = requestAgentGo(source, "claude");
    processPreservationRequests(db, workspace);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.broker).toHaveBeenCalledExactlyOnceWith(source, "claude");
    processPreservationRequests(db, workspace);
    expect(agentGoTransportReady(workspace)).toBe(true);
    finish({ ok: true, response: result });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual(result);
  });
});
