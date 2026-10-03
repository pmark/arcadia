import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertClean } from "../src/git/worktrees.js";
import { GO_RESPONSE_TIMEOUT_MS } from "../src/sessions/goRequestProtocol.js";

const mocks = vi.hoisted(() => ({ broker: vi.fn(), enrollment: vi.fn(), projects: vi.fn(), metadata: vi.fn(), workspace: vi.fn() }));
vi.mock("../src/sessions/goRequestExecutor.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/sessions/goRequestExecutor.js")>(),
  executeHostGo: mocks.broker
}));
vi.mock("../src/sessions/enrollmentRequestExecutor.js", () => ({ executeHostEnrollmentRequest: mocks.enrollment }));
vi.mock("../src/db/repositories.js", () => ({ listProjects: mocks.projects, getProjectMetadata: mocks.metadata }));
vi.mock("../src/workspace/resolve.js", () => ({ requireResolvedWorkspace: mocks.workspace }));
vi.mock("../src/commands/preserve.js", () => ({ runPreserveCommand: vi.fn() }));
import { agentGoTransportReady, agentGoTransportState, processPreservationRequests, refreshPreservationHeartbeat, requestAgentEnrollment, requestAgentGo } from "../src/sessions/preservationTransport.js";

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
    vi.stubEnv("CODEX_SESSION_ID", "runtime-11111111-1111-1111-1111-111111111111");
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
    mocks.enrollment.mockResolvedValue({ ok: true, response: {
      requestId: nonce, principal: { kind: "prepared", id: "claim-1", worktree: "/prepared" }
    } });
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

  it("enrolls through the fixed host route and returns the fenced principal", async () => {
    processPreservationRequests(db, workspace);
    const pending = requestAgentEnrollment(source, "codex");
    expect(existsSync(path.join(source, ".arcadia-enrollment-request"))).toBe(true);
    processPreservationRequests(db, workspace);
    await expect(pending).resolves.toMatchObject({ principal: { id: "claim-1", worktree: "/prepared" } });
    expect(mocks.enrollment).toHaveBeenCalledExactlyOnceWith(
      source,
      "codex",
      "enroll:codex:runtime-11111111-1111-1111-1111-111111111111",
      "codex:runtime-11111111-1111-1111-1111-111111111111",
      "prepare"
    );
    expect(existsSync(path.join(source, ".arcadia-enrollment-request"))).toBe(false);
  });

  it("carries only an enum mode, refusing an unknown mode before writing a request", async () => {
    processPreservationRequests(db, workspace);
    vi.stubEnv("ARCADIA_ENROLLMENT_MODE", "managed-launch");
    const pending = requestAgentEnrollment(source, "codex");
    processPreservationRequests(db, workspace);
    await pending;
    expect(mocks.enrollment.mock.calls[0][4]).toBe("managed-launch");
    vi.stubEnv("ARCADIA_ENROLLMENT_MODE", "sh -c true");
    await expect(requestAgentEnrollment(source, "codex")).rejects.toMatchObject({ details: { code: "invalid_enrollment_mode" } });
    expect(existsSync(path.join(source, ".arcadia-enrollment-request"))).toBe(false);
    expect(mocks.enrollment).toHaveBeenCalledTimes(1);
  });

  it("refuses enrollment from a source that is not a configured repository root", async () => {
    processPreservationRequests(db, workspace);
    const nested = path.join(source, "nested");
    mkdirSync(nested);
    await expect(requestAgentEnrollment(nested, "codex")).rejects.toMatchObject({ details: { code: "enrollment_source_not_repository" } });
    expect(existsSync(path.join(nested, ".arcadia-enrollment-request"))).toBe(false);
    expect(mocks.enrollment).not.toHaveBeenCalled();
  });

  it("never runs a go request while an enrollment on the same source is still running", async () => {
    let finishEnrollment!: () => void;
    mocks.enrollment.mockImplementation(() => new Promise(resolve => {
      finishEnrollment = () => resolve({ ok: true, response: { principal: { kind: "prepared", id: "claim-1", worktree: "/prepared" } } });
    }));
    processPreservationRequests(db, workspace);
    const enrolling = requestAgentEnrollment(source, "codex");
    processPreservationRequests(db, workspace);
    expect(mocks.enrollment).toHaveBeenCalledTimes(1);
    const going = requestAgentGo(source, "codex");
    processPreservationRequests(db, workspace);
    expect(mocks.broker).not.toHaveBeenCalled();
    expect(existsSync(requestFile())).toBe(true);
    finishEnrollment();
    await enrolling;
    processPreservationRequests(db, workspace);
    await expect(going).resolves.toEqual(result);
    expect(mocks.broker).toHaveBeenCalledTimes(1);
  });

  it("retains semantic request and caller identity across transport redelivery", async () => {
    processPreservationRequests(db, workspace);
    const first = requestAgentEnrollment(source, "codex");
    processPreservationRequests(db, workspace);
    await first;
    const second = requestAgentEnrollment(source, "codex");
    processPreservationRequests(db, workspace);
    await second;
    expect(mocks.enrollment).toHaveBeenCalledTimes(2);
    expect(mocks.enrollment.mock.calls.map(call => call.slice(2))).toEqual([
      ["enroll:codex:runtime-11111111-1111-1111-1111-111111111111", "codex:runtime-11111111-1111-1111-1111-111111111111", "prepare"],
      ["enroll:codex:runtime-11111111-1111-1111-1111-111111111111", "codex:runtime-11111111-1111-1111-1111-111111111111", "prepare"]
    ]);
  });

  it("refuses enrollment before writing a request when no stable identity exists", async () => {
    vi.stubEnv("CODEX_SESSION_ID", "");
    vi.stubEnv("CODEX_THREAD_ID", "");
    processPreservationRequests(db, workspace);
    await expect(requestAgentEnrollment(source, "codex")).rejects.toMatchObject({
      details: { code: "enrollment_identity_unavailable" }
    });
    expect(existsSync(path.join(source, ".arcadia-enrollment-request"))).toBe(false);
  });

  it("rejects enrollment transport fields that could carry caller commands or authority", () => {
    writeFileSync(path.join(source, ".arcadia-enrollment-request"), JSON.stringify({
      nonce,
      agent: "codex",
      mode: "prepare",
      requestId: "enrollment-request-1",
      callerId: "codex:runtime-1",
      command: "sh"
    }));
    processPreservationRequests(db, workspace);
    expect(mocks.enrollment).not.toHaveBeenCalled();
  });

  it("services an opencode go request and clears its marker", async () => {
    // opencode is a Session agent, so its fixed launcher is installed and its
    // request must be serviced and cleaned like codex's or claude's. The worker
    // reader previously named only codex and claude, which left every opencode
    // request unserviced and its marker impossible for the caller to remove.
    processPreservationRequests(db, workspace);
    const pending = requestAgentGo(source, "opencode");
    expect(existsSync(requestFile())).toBe(true);
    processPreservationRequests(db, workspace);
    await expect(pending).resolves.toEqual(result);
    expect(existsSync(requestFile())).toBe(false);
    expect(mocks.broker).toHaveBeenCalledExactlyOnceWith(source, "opencode");
  });

  it("clears the pending marker when the host refuses the request", async () => {
    mocks.broker.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "host refused the go request", exitCode: 2, details: {} }
    });
    processPreservationRequests(db, workspace);
    const pending = requestAgentGo(source, "codex");
    processPreservationRequests(db, workspace);
    await expect(pending).rejects.toThrow("host refused the go request");
    expect(existsSync(requestFile())).toBe(false);
  });

  it("clears an opencode marker after a timeout so an immediate retry is not blocked", async () => {
    vi.useFakeTimers();
    processPreservationRequests(db, workspace);
    const first = requestAgentGo(source, "opencode");
    const rejected = expect(first).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(GO_RESPONSE_TIMEOUT_MS + 250);
    await rejected;
    expect(existsSync(requestFile())).toBe(false);

    // A healthy tick republishes the projection, then the retry succeeds with
    // no hand-editing of the repository.
    processPreservationRequests(db, workspace);
    const retry = requestAgentGo(source, "opencode");
    expect(existsSync(requestFile())).toBe(true);
    processPreservationRequests(db, workspace);
    await vi.advanceTimersByTimeAsync(500);
    await expect(retry).resolves.toEqual(result);
    expect(existsSync(requestFile())).toBe(false);
  });

  it("submits for a healthy-but-busy worker instead of refusing it", async () => {
    vi.useFakeTimers();
    processPreservationRequests(db, workspace);
    // Age only the go-service stamp; the worker's 5s loop keeps the heartbeat
    // itself fresh, which is exactly the "alive but mid-tick" case.
    vi.setSystemTime(new Date(Date.now() + 20_000));
    expect(refreshPreservationHeartbeat(workspace)).toBe(true);
    expect(agentGoTransportReady(workspace)).toBe(false);
    expect(agentGoTransportState(workspace)).toBe("busy");

    const pending = requestAgentGo(source, "codex");
    expect(existsSync(requestFile())).toBe(true);
    processPreservationRequests(db, workspace);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual(result);
    expect(existsSync(requestFile())).toBe(false);
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
