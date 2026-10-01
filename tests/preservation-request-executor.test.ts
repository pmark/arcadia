import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { executeHostPreservation, writePreservationAttempt, PRESERVATION_EXECUTION_TIMEOUT_MS } from "../src/sessions/preservationRequestExecutor.js";

describe("bounded protected preservation child", () => {
  it("allows ten two-minute checks plus preservation before the total bound", () => {
    expect(PRESERVATION_EXECUTION_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 120_000 + 120_000);
  });
  let root: string;
  let child: EventEmitter & { pid: number; stderr: EventEmitter };
  const input = () => ({ source: root, workspace: root, attemptFile: path.join(root, "attempt.json") });
  beforeEach(() => {
    vi.stubEnv("CODEX_SANDBOX", "");
    vi.useFakeTimers();
    root = mkdtempSync(path.join(tmpdir(), "arcadia-preservation-executor-"));
    child = Object.assign(new EventEmitter(), { pid: 12345, stderr: new EventEmitter() });
    mocks.spawn.mockReturnValue(child);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });

  it("bounds a stuck post-validation stage, retains evidence and waits for process-group exit", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const settled = vi.fn();
    const promise = executeHostPreservation(input(), { total: 2000, stage: 500 }).then(result => { settled(result); return result; });
    writePreservationAttempt(input().attemptFile, { stage: "validation.recheck-snapshot", at: Date.now(), evidenceRef: "/protected/check/validation.json" });
    await vi.advanceTimersByTimeAsync(500);
    expect(kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
    expect(settled).not.toHaveBeenCalled();
    child.emit("close", null, "SIGKILL");
    expect(await promise).toMatchObject({ ok: false, error: { details: { stage: "validation.recheck-snapshot", evidenceRef: "/protected/check/validation.json", attemptRef: input().attemptFile } } });
    expect(JSON.parse(readFileSync(`${input().attemptFile}.result.json`, "utf8")).result.ok).toBe(false);
  });

  it("a changing stage cannot reset the whole-attempt ceiling", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const promise = executeHostPreservation(input(), { total: 1000, stage: 500 });
    for (let i = 0; i < 4; i++) {
      writePreservationAttempt(input().attemptFile, { stage: `stage-${i}`, at: Date.now() });
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(kill).toHaveBeenCalledTimes(1);
    child.emit("close", null, "SIGKILL");
    expect(await promise).toMatchObject({ ok: false });
  });

  it("returns a success only after exit and transfers claim ownership to the child", async () => {
    const onSpawn = vi.fn();
    const promise = executeHostPreservation({ ...input(), onSpawn });
    expect(onSpawn).toHaveBeenCalledWith(child.pid);
    expect(mocks.spawn.mock.calls.at(-1)?.[1].join(" ")).toContain("preservationRequestWorker.ts");
    const response = { ok: true, response: { commitSha: "preserved" } };
    child.emit("message", response);
    child.emit("close", 0, null);
    expect(await promise).toEqual(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains bounded stderr and the exact stage on an unexpected crash", async () => {
    const promise = executeHostPreservation(input());
    writePreservationAttempt(input().attemptFile, { stage: "preserve.receipt", at: Date.now() });
    child.stderr.emit("data", "native crash");
    child.emit("close", 1, null);
    expect(await promise).toMatchObject({ ok: false, error: { details: { stage: "preserve.receipt", stderr: "native crash" } } });
  });
});
