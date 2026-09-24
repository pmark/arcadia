import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandSuccess } from "../src/cli/response.js";
import { validationError } from "../src/cli/errors.js";
import {
  runGoBrokerEnsureCommand,
  type GoBrokerInstallData,
  type GoBrokerStatusData
} from "../src/commands/goBrokerInstall.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tinyGitRepo(): { repository: string; revision: string } {
  const repository = mkdtempSync(path.join(tmpdir(), "arcadia-ensure-repo-"));
  roots.push(repository);
  const run = (...args: string[]) => execFileSync("git", args, { cwd: repository });
  run("init", "--quiet");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  run("commit", "--quiet", "--allow-empty", "-m", "initial");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository }).toString().trim();
  return { repository, revision };
}

function statusResult(data: GoBrokerStatusData): CommandSuccess<GoBrokerStatusData> {
  return { ok: true, command: "go-broker.status", data, artifacts: [], warnings: [] };
}

function installResult(data: GoBrokerInstallData): CommandSuccess<GoBrokerInstallData> {
  return { ok: true, command: "go-broker.install", data, artifacts: [], warnings: [] };
}

const baseStatusData: Omit<GoBrokerStatusData, "ready" | "revision"> = {
  releaseDirectory: null,
  brokerIssues: [],
  agentSetup: {
    ready: true,
    changed: [],
    backups: [],
    issues: [],
    checks: [],
    workspaceTrust: { required: [], missing: [], refused: [] }
  },
  preservationTransport: { ready: true, detail: "Fresh host worker heartbeat." },
  agentGoTransport: { ready: true, state: "ready", detail: "Host worker has serviced agent go requests recently." },
  preservationChecks: null
};

describe("go-broker ensure", () => {
  it("skips the expensive install when status already reports the current revision as ready", () => {
    const { repository, revision } = tinyGitRepo();
    const statusRunner = vi.fn().mockReturnValue(statusResult({ ...baseStatusData, ready: true, revision }));
    const installRunner = vi.fn();

    const response = runGoBrokerEnsureCommand({ repository }, statusRunner, installRunner);

    expect(response.data.action).toBe("skipped");
    expect(response.data.revision).toBe(revision);
    expect(installRunner).not.toHaveBeenCalled();
    expect(statusRunner).toHaveBeenCalledTimes(1);
  });

  it("installs when status reports a different revision than the current one", () => {
    const { repository, revision } = tinyGitRepo();
    const statusRunner = vi.fn().mockReturnValue(statusResult({ ...baseStatusData, ready: true, revision: "some-older-sha" }));
    const installRunner = vi.fn().mockReturnValue(
      installResult({
        revision,
        releaseDirectory: "/fake/release",
        executables: {
          go: { codex: "/fake/go-codex", claude: "/fake/go-claude", opencode: "/fake/go-opencode" },
          preserve: { codex: "/fake/preserve-codex", claude: "/fake/preserve-claude", opencode: "/fake/preserve-opencode" },
          advance: { codex: "/fake/advance-codex", claude: "/fake/advance-claude", opencode: "/fake/advance-opencode" },
          workMonitor: { codex: "/fake/wm-codex", claude: "/fake/wm-claude", opencode: "/fake/wm-opencode" },
          brief: { codex: "/fake/brief-codex", claude: "/fake/brief-claude", opencode: "/fake/brief-opencode" }
        },
        manifest: "/fake/release/broker-manifest.json",
        codexRules: [],
        claudePermissions: [],
        agentSetup: { changed: [], backups: [], status: baseStatusData.agentSetup },
        hostProbe: { checked: [] } as GoBrokerInstallData["hostProbe"]
      })
    );

    const response = runGoBrokerEnsureCommand({ repository }, statusRunner, installRunner);

    expect(response.data.action).toBe("installed");
    expect(response.data.install?.revision).toBe(revision);
    expect(installRunner).toHaveBeenCalledTimes(1);
  });

  it("installs when status is not ready and throws, rather than propagating that failure as its own", () => {
    const { repository, revision } = tinyGitRepo();
    const statusRunner = vi.fn().mockImplementation(() => {
      throw validationError("Protected broker setup is not ready.");
    });
    const installRunner = vi.fn().mockReturnValue(
      installResult({
        revision,
        releaseDirectory: "/fake/release",
        executables: {
          go: { codex: "/fake/go-codex", claude: "/fake/go-claude", opencode: "/fake/go-opencode" },
          preserve: { codex: "/fake/preserve-codex", claude: "/fake/preserve-claude", opencode: "/fake/preserve-opencode" },
          advance: { codex: "/fake/advance-codex", claude: "/fake/advance-claude", opencode: "/fake/advance-opencode" },
          workMonitor: { codex: "/fake/wm-codex", claude: "/fake/wm-claude", opencode: "/fake/wm-opencode" },
          brief: { codex: "/fake/brief-codex", claude: "/fake/brief-claude", opencode: "/fake/brief-opencode" }
        },
        manifest: "/fake/release/broker-manifest.json",
        codexRules: [],
        claudePermissions: [],
        agentSetup: { changed: [], backups: [], status: baseStatusData.agentSetup },
        hostProbe: { checked: [] } as GoBrokerInstallData["hostProbe"]
      })
    );

    const response = runGoBrokerEnsureCommand({ repository }, statusRunner, installRunner);

    expect(response.data.action).toBe("installed");
    expect(installRunner).toHaveBeenCalledTimes(1);
  });

  it("installs when status reports the current revision but is not ready", () => {
    const { repository, revision } = tinyGitRepo();
    const statusRunner = vi.fn().mockReturnValue(statusResult({ ...baseStatusData, ready: false, revision }));
    const installRunner = vi.fn().mockReturnValue(
      installResult({
        revision,
        releaseDirectory: "/fake/release",
        executables: {
          go: { codex: "/fake/go-codex", claude: "/fake/go-claude", opencode: "/fake/go-opencode" },
          preserve: { codex: "/fake/preserve-codex", claude: "/fake/preserve-claude", opencode: "/fake/preserve-opencode" },
          advance: { codex: "/fake/advance-codex", claude: "/fake/advance-claude", opencode: "/fake/advance-opencode" },
          workMonitor: { codex: "/fake/wm-codex", claude: "/fake/wm-claude", opencode: "/fake/wm-opencode" },
          brief: { codex: "/fake/brief-codex", claude: "/fake/brief-claude", opencode: "/fake/brief-opencode" }
        },
        manifest: "/fake/release/broker-manifest.json",
        codexRules: [],
        claudePermissions: [],
        agentSetup: { changed: [], backups: [], status: baseStatusData.agentSetup },
        hostProbe: { checked: [] } as GoBrokerInstallData["hostProbe"]
      })
    );

    const response = runGoBrokerEnsureCommand({ repository }, statusRunner, installRunner);

    expect(response.data.action).toBe("installed");
    expect(installRunner).toHaveBeenCalledTimes(1);
  });
});
