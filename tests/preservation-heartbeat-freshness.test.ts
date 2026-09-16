import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ projects: vi.fn(), metadata: vi.fn() }));
vi.mock("../src/db/repositories.js", () => ({ listProjects: mocks.projects, getProjectMetadata: mocks.metadata }));
vi.mock("../src/commands/preserve.js", () => ({ runPreserveCommand: vi.fn() }));
import { agentGoTransportReady, processPreservationRequests, refreshPreservationHeartbeat } from "../src/sessions/preservationTransport.js";

describe("preservation transport heartbeat freshness", () => {
  let root: string;
  let source: string;
  let workspace: string;
  const db = { prepare: () => ({ all: () => [] }) } as unknown as Database.Database;
  const heartbeatPath = () => path.join(workspace, ".arcadia/preservation.heartbeat");

  beforeEach(() => {
    vi.stubEnv("CODEX_SANDBOX", "");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T18:00:00.000Z"));
    vi.resetAllMocks();
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-heartbeat-")));
    source = path.join(root, "repo");
    workspace = path.join(root, "workspace");
    mkdirSync(source);
    execFileSync("git", ["init", "--quiet", source]);
    mocks.projects.mockReturnValue([{ id: "project", slug: "fixture", status: "active" }]);
    mocks.metadata.mockReturnValue({ repo_path: source });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("re-stamps the same routes with a fresh at across a simulated multi-minute tick", () => {
    processPreservationRequests(db, workspace);
    const published = JSON.parse(readFileSync(heartbeatPath(), "utf8"));
    expect(published.schema).toBe("arcadia-preservation-transport-v1");
    expect(agentGoTransportReady(workspace)).toBe(true);

    // The tick blocks the event loop for minutes, so the worker's 5s loop
    // cannot fire mid-tick; its re-stamp is driven explicitly and must keep the
    // transport READY without letting any route change while the tick runs.
    for (let elapsed = 0; elapsed < 180_000; elapsed += 5_000) {
      vi.setSystemTime(new Date(Date.now() + 5_000));
      expect(refreshPreservationHeartbeat(workspace)).toBe(true);
      expect(agentGoTransportReady(workspace)).toBe(true);
    }

    expect(JSON.parse(readFileSync(heartbeatPath(), "utf8"))).toEqual({ ...published, at: Date.now() });
  });

  it("goes stale without a re-stamp, proving the window is what the loop protects", () => {
    processPreservationRequests(db, workspace);
    expect(agentGoTransportReady(workspace)).toBe(true);
    vi.setSystemTime(new Date(Date.now() + 20_000));
    expect(agentGoTransportReady(workspace)).toBe(false);
  });

  it("is a no-op before any projection is published", () => {
    expect(refreshPreservationHeartbeat(workspace)).toBe(false);
    expect(existsSync(heartbeatPath())).toBe(false);
    expect(agentGoTransportReady(workspace)).toBe(false);
  });

  it("adopts the newest routes rather than re-stamping a stale projection", () => {
    processPreservationRequests(db, workspace);
    const other = path.join(root, "other-repo");
    mkdirSync(other);
    execFileSync("git", ["init", "--quiet", other]);
    mocks.projects.mockReturnValue([{ id: "other", slug: "other", status: "active" }]);
    mocks.metadata.mockReturnValue({ repo_path: other });
    processPreservationRequests(db, workspace);
    vi.setSystemTime(new Date(Date.now() + 5_000));
    refreshPreservationHeartbeat(workspace);
    expect(JSON.parse(readFileSync(heartbeatPath(), "utf8")).repositories).toEqual([{ path: other, projectSlug: "other" }]);
    expect(agentGoTransportReady(workspace)).toBe(true);
  });
});
