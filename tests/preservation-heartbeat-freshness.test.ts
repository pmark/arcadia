import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ projects: vi.fn(), metadata: vi.fn() }));
vi.mock("../src/db/repositories.js", () => ({ listProjects: mocks.projects, getProjectMetadata: mocks.metadata }));
vi.mock("../src/commands/preserve.js", () => ({ runPreserveCommand: vi.fn() }));
import { probeWorkerCapability } from "../src/production/sessionCapability.js";
import { agentGoTransportReady, preservationTransportReady, processPreservationRequests, refreshPreservationHeartbeat, transportHeartbeatDiagnostic, transportPublishedSince, TRANSPORT_FRESHNESS_MS } from "../src/sessions/preservationTransport.js";
import {
  HEARTBEAT_STALENESS_FLOOR_MS,
  heartbeatStalenessLimitMs,
  LEGACY_HEARTBEAT_INTERVAL_MS,
  PRESERVATION_HEARTBEAT_REFRESH_MS,
  PRESERVATION_RECHECK_CAP_MS
} from "../src/sessions/transportHeartbeat.js";

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

  const preservationWall = () => probeWorkerCapability(workspace, null).find((entry) => entry.wallClass === "preservation");
  const writeHeartbeat = (fields: Record<string, unknown>) => {
    mkdirSync(path.dirname(heartbeatPath()), { recursive: true });
    writeFileSync(heartbeatPath(), JSON.stringify({ schema: "arcadia-preservation-transport-v1", sessions: [], goRequests: true, goRequestsAt: Date.now(), ...fields }));
  };

  it("publishes its own refresh interval and is judged by three of them, never below the floor", () => {
    processPreservationRequests(db, workspace);
    expect(JSON.parse(readFileSync(heartbeatPath(), "utf8")).intervalMs).toBe(PRESERVATION_HEARTBEAT_REFRESH_MS);
    expect(heartbeatStalenessLimitMs({ intervalMs: 5_000 })).toBe(15_000);
    expect(heartbeatStalenessLimitMs({ intervalMs: 30_000 })).toBe(90_000);
    expect(heartbeatStalenessLimitMs({ intervalMs: 1_000 })).toBe(HEARTBEAT_STALENESS_FLOOR_MS);
    expect(TRANSPORT_FRESHNESS_MS).toBe(heartbeatStalenessLimitMs({ intervalMs: PRESERVATION_HEARTBEAT_REFRESH_MS }));
  });

  it("does not refuse a 30s-interval writer at a 33s age the old fixed 15s limit walled (live 2026-11-02)", () => {
    writeHeartbeat({ at: Date.now() - 33_000, intervalMs: 30_000 });
    expect(preservationTransportReady(workspace)).toBe(true);
    expect(preservationWall()).toBeUndefined();
  });

  it("judges a heartbeat without intervalMs (an older writer) by the conservative legacy cadence, never 15s", () => {
    expect(heartbeatStalenessLimitMs({})).toBe(3 * LEGACY_HEARTBEAT_INTERVAL_MS);
    expect(heartbeatStalenessLimitMs({})).toBeGreaterThan(15_000);
    writeHeartbeat({ at: Date.now() - 33_000 });
    expect(preservationTransportReady(workspace)).toBe(true);
    expect(preservationWall()).toBeUndefined();
    writeHeartbeat({ at: Date.now() - 3 * LEGACY_HEARTBEAT_INTERVAL_MS - 1 });
    expect(preservationWall()).toMatchObject({ wallClass: "preservation", transient: true });
  });

  it("marks a stale-but-recent reading transient (rechecked) and a dead writer a durable wall", () => {
    processPreservationRequests(db, workspace);
    expect(preservationWall()).toBeUndefined();
    // The live reading at a 5s cadence: 33s old, past 3 x 5s.
    vi.setSystemTime(new Date(Date.now() + 33_000));
    expect(preservationWall()).toMatchObject({ wallClass: "preservation", transient: true });
    expect(transportHeartbeatDiagnostic(workspace, "preservation")).toMatch(/stale \(33s old, limit 15s\)/);
    // Past its limit plus the whole recheck window: the writer is dead.
    vi.setSystemTime(new Date(Date.now() + PRESERVATION_RECHECK_CAP_MS));
    expect(preservationWall()).toMatchObject({ wallClass: "preservation" });
    expect(preservationWall()?.transient).toBeFalsy();
  });

  it("a successor worker never revives its predecessor's heartbeat before publishing its own projection", () => {
    // The predecessor's last projection, 33s old, left on disk.
    writeHeartbeat({ at: Date.now() - 33_000, intervalMs: PRESERVATION_HEARTBEAT_REFRESH_MS });
    const left = readFileSync(heartbeatPath(), "utf8");
    // The successor's pre-probe refresh has no projection of its own yet: a no-op.
    expect(refreshPreservationHeartbeat(workspace)).toBe(false);
    expect(readFileSync(heartbeatPath(), "utf8")).toBe(left);
    expect(preservationWall()).toMatchObject({ wallClass: "preservation", transient: true });
    // Once it publishes, its own refresh vouches for it.
    processPreservationRequests(db, workspace);
    vi.setSystemTime(new Date(Date.now() + 33_000));
    expect(refreshPreservationHeartbeat(workspace)).toBe(true);
    expect(preservationWall()).toBeUndefined();
  });

  it("never calls a missing heartbeat transient", () => {
    expect(preservationWall()).toMatchObject({ wallClass: "preservation" });
    expect(preservationWall()?.transient).toBeFalsy();
  });

  it("re-stamps a fresh at for preservation while go serviceability ages out across a stuck tick", () => {
    processPreservationRequests(db, workspace);
    const published = JSON.parse(readFileSync(heartbeatPath(), "utf8"));
    expect(published.schema).toBe("arcadia-preservation-transport-v1");
    expect(preservationTransportReady(workspace)).toBe(true);
    expect(agentGoTransportReady(workspace)).toBe(true);

    // One short gap: no route has changed and the last go pass is still within
    // the freshness window, so serviceability is still trustworthy.
    vi.setSystemTime(new Date(Date.now() + 5_000));
    expect(refreshPreservationHeartbeat(workspace)).toBe(true);
    expect(preservationTransportReady(workspace)).toBe(true);
    expect(agentGoTransportReady(workspace)).toBe(true);

    // The tick blocks the event loop for minutes, so the worker's 5s loop
    // cannot fire mid-tick; its re-stamp is driven explicitly and must keep the
    // preservation transport READY. Go is different: no pass actually ran the
    // go route, so a merely fresh heartbeat must not keep reporting it ready.
    for (let elapsed = 0; elapsed < 180_000; elapsed += 5_000) {
      vi.setSystemTime(new Date(Date.now() + 5_000));
      expect(refreshPreservationHeartbeat(workspace)).toBe(true);
      expect(preservationTransportReady(workspace)).toBe(true);
    }
    expect(agentGoTransportReady(workspace)).toBe(false);

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

  it("names the route and heartbeat file when the heartbeat is missing or stale", () => {
    expect(transportHeartbeatDiagnostic(workspace, "preservation")).toMatch(/preservation route has no readable heartbeat at .*preservation\.heartbeat.*worker not running/);
    processPreservationRequests(db, workspace);
    expect(transportHeartbeatDiagnostic(workspace, "go")).toMatch(/go route heartbeat .* is fresh/);
    vi.setSystemTime(new Date(Date.now() + 60_000));
    expect(preservationTransportReady(workspace)).toBe(false);
    expect(transportHeartbeatDiagnostic(workspace, "go")).toMatch(/go route heartbeat at .* is stale \(60s old/);
  });

  it("does not let a heartbeat published before the install vouch for a worker that never started", () => {
    processPreservationRequests(db, workspace);
    const installedAt = Date.now() + 1_000;
    vi.setSystemTime(new Date(installedAt));
    expect(agentGoTransportReady(workspace)).toBe(true);
    expect(transportPublishedSince(workspace, installedAt)).toBe(false);
    processPreservationRequests(db, workspace);
    expect(transportPublishedSince(workspace, installedAt)).toBe(true);
  });
});
