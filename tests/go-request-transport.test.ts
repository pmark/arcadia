import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertClean } from "../src/git/worktrees.js";

const mocks = vi.hoisted(() => ({ broker: vi.fn(), projects: vi.fn(), metadata: vi.fn(), workspace: vi.fn() }));
vi.mock("../src/goBroker.js", () => ({ runGoBroker: mocks.broker }));
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
    mocks.projects.mockReturnValue([{ id: "project", slug: "fixture" }]);
    mocks.metadata.mockReturnValue({ repo_path: source });
    mocks.broker.mockImplementation(() => {
      assertClean(source, "source worktree");
      return result;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("completes a round trip without the request dirtying the source", async () => {
    processPreservationRequests(db, workspace);
    const pending = requestAgentGo(source, "codex");
    expect(existsSync(requestFile())).toBe(true);
    processPreservationRequests(db, workspace);
    await expect(pending).resolves.toEqual(result);
    expect(existsSync(requestFile())).toBe(false);
    expect(mocks.broker).toHaveBeenCalledExactlyOnceWith({ source, agent: "codex", operation: "go" });
    processPreservationRequests(db, workspace);
    expect(mocks.broker).toHaveBeenCalledTimes(1);
  });

  it("still refuses real uncommitted work and delivers the refusal", async () => {
    processPreservationRequests(db, workspace);
    writeFileSync(path.join(source, "user-work.txt"), "preserve me");
    const pending = requestAgentGo(source, "codex");
    processPreservationRequests(db, workspace);
    await expect(pending).rejects.toThrow("not clean");
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
});
