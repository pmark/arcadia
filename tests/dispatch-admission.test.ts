import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { assertPreparedDispatchAdmission } from "../src/sessions/dispatchAdmission.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

describe("prepared-dispatch admission", () => {
  let root: string;
  let workspace: string;
  const heartbeatFile = () => path.join(workspace, ".arcadia/preservation.heartbeat");
  const publish = (overrides: Record<string, unknown> = {}) => {
    mkdirSync(path.dirname(heartbeatFile()), { recursive: true });
    const now = Date.now();
    writeFileSync(heartbeatFile(), JSON.stringify({
      schema: "arcadia-preservation-transport-v1", at: now, sessions: [], goRequests: true, goRequestsAt: now, ...overrides
    }));
  };
  const refusal = () => {
    try { assertPreparedDispatchAdmission(workspace); } catch (error) { return error as ArcadiaError; }
    throw new Error("expected a refusal");
  };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-admission-")));
    workspace = path.join(root, "workspace");
    initWorkspace(workspace);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("admits a writable database with fresh preservation and Go heartbeats", () => {
    publish();
    expect(() => assertPreparedDispatchAdmission(workspace)).not.toThrow();
  });

  it("refuses with a remedy when no worker has published a heartbeat", () => {
    const error = refusal();
    expect(error.message).toMatch(/no fresh heartbeat/);
    expect(JSON.stringify(error.details)).toMatch(/worker not running/);
    expect(JSON.stringify(error.details)).toMatch(/go-broker status/);
  });

  it("refuses when the heartbeat is fresh but the Go route stamp is stale", () => {
    publish({ goRequestsAt: Date.now() - 60_000 });
    const error = refusal();
    expect(JSON.stringify(error.details)).toMatch(/go route heartbeat/);
  });

  it("refuses a stale heartbeat", () => {
    publish({ at: Date.now() - 60_000, goRequestsAt: Date.now() - 60_000 });
    expect(refusal().message).toMatch(/no fresh heartbeat/);
  });

  it.skipIf(process.getuid?.() === 0)("refuses before checking transport when the database cannot be written", () => {
    publish();
    const database = getWorkspacePaths(workspace).databaseFile;
    expect(existsSync(database)).toBe(true);
    chmodSync(database, 0o444);
    const error = refusal();
    expect(error.message).toMatch(/cannot write the workspace database/);
    expect(JSON.stringify(error.details)).toMatch(/additionalDirectories/);
  });
});
