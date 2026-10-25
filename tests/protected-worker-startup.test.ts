import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertWorkerInstallCustody, buildWorkerPlist, resolveProtectedWorkerLaunch } from "../src/commands/worker.js";
import { stageGoBrokerRoleRegistry, stageGoBrokerWorkerDefaults, validateGoBrokerWorkerDefaults, validateGoBrokerWorkerCode } from "../src/commands/goBrokerInstall.js";
import { captureDiagnosticWorkerBinding } from "../src/production/workerClaudeUsageDiagnostic.js";
import type { LaunchAgentAudit } from "../src/runtime/launchAgents.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-worker-startup-")));
  roots.push(home);
  const revision = "a".repeat(40);
  const directory = path.join(home, ".local/share/arcadia/go-broker/releases", revision);
  const worker = path.join(directory, "dist/src/commands/worker.js");
  const module = path.join(directory, "dist/src/production/workerClaudeUsageDiagnostic.js");
  for (const name of ["dist/src/commands/worker.js", "dist/src/production/workerClaudeUsageDiagnostic.js", "dist/src/codingAgents/providerUsage.js", "dist/src/codingAgents/availability.js", "dist/src/cli.js", "dist/config/defaults/agent-roles.json"]) {
    const file = path.join(directory, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "fixture bytes");
  }
  const manifest = { schema: "arcadia-go-broker-install-v1", revision, sourceRepository: home, runtimeExecutable: process.execPath,
    roleRegistrySha256: createHash("sha256").update(readFileSync(path.join(directory, "dist/config/defaults/agent-roles.json"))).digest("hex"),
    brokerEntrypoint: path.join(directory, "dist/scripts/arcadia-go-broker.js") };
  const manifestPath = path.join(directory, "broker-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  chmodSync(manifestPath, 0o444);
  const url = pathToFileURL(worker).href;
  const binding = captureDiagnosticWorkerBinding(url, { home, moduleUrl: pathToFileURL(module).href });
  return { home, directory, worker, module, url, binding, manifest, manifestPath };
}

function completeWorkerPackage(directory: string): void {
  stageGoBrokerWorkerDefaults(path.resolve(import.meta.dirname, ".."), directory);
  for (const name of ["commands/workerHeartbeatBeacon.js", "sessions/preservationRequestWorker.js", "sessions/preservationRequestPayload.js", "sessions/preservationValidationClient.js"]) {
    const file = path.join(directory, "dist/src", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "fixed worker fixture entry");
  }
}

describe("protected compiled worker startup", () => {
  it("uses the registered release CLI and runtime, separating the source repository", () => {
    const f = fixture();
    completeWorkerPackage(f.directory);
    expect(f.binding).not.toBeNull();
    const launch = resolveProtectedWorkerLaunch(f.url, f.binding, f.home);
    expect(launch).toEqual({ directory: f.directory, sourceRepository: f.home, runtimeExecutable: process.execPath, cliPath: path.join(f.directory, "dist/src/cli.js") });
    const plist = buildWorkerPlist({ workspacePath: "/fixture/workspace", repositoryRoot: f.home, miseBin: "/fixture/mise", logPath: "/fixture/log", home: f.home, protectedRelease: launch });
    expect(plist).toContain(`<string>${f.directory}/dist/src/cli.js</string>`);
    expect(plist).toContain(`<key>WorkingDirectory</key>\n  <string>${f.directory}</string>`);
    expect(plist).not.toContain("cli.ts");
    expect(plist).not.toContain("tsx/dist/cli.mjs");
  });
  it.each(["dist/config/defaults/intent-registry.json", "dist/src/commands/workerHeartbeatBeacon.js",
    "dist/src/sessions/preservationRequestPayload.js"])("refuses removed %s through the actual protected launch resolver", entry => {
    const f = fixture();
    completeWorkerPackage(f.directory);
    rmSync(path.join(f.directory, entry));
    expect(() => resolveProtectedWorkerLaunch(f.url, f.binding, f.home)).toThrow();
  });
  it("retains the source mise/tsx launch defaults", () => {
    expect(resolveProtectedWorkerLaunch(import.meta.url)).toBeUndefined();
    const plist = buildWorkerPlist({ workspacePath: "/workspace", repositoryRoot: "/repository", miseBin: "/mise", logPath: "/log", home: "/home" });
    expect(plist).toContain("/repository/src/cli.ts");
    expect(plist).toContain("/repository/node_modules/tsx/dist/cli.mjs");
  });
  it.each(["runtime", "source", "schema", "handler", "unregistered", "cli-symlink"])("refuses %s drift before installation", kind => {
    const f = fixture();
    completeWorkerPackage(f.directory);
    if (kind === "handler") writeFileSync(f.module, "changed");
    else if (kind === "cli-symlink") {
      rmSync(path.join(f.directory, "dist/src/cli.js"));
      symlinkSync(f.worker, path.join(f.directory, "dist/src/cli.js"));
    } else if (kind !== "unregistered") {
      chmodSync(f.manifestPath, 0o600);
      if (kind === "runtime") f.manifest.runtimeExecutable = "/wrong/node";
      if (kind === "source") f.manifest.sourceRepository = path.dirname(f.home);
      if (kind === "schema") f.manifest.schema = "wrong";
      writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
      chmodSync(f.manifestPath, 0o444);
    }
    expect(() => resolveProtectedWorkerLaunch(f.url, f.binding, kind === "unregistered" ? path.dirname(f.home) : f.home)).toThrow();
  });
  it("refuses existing labels, unknown workspace, unreadable agents and any retained custody", () => {
    const agent = { label: "com.arcadia.local.fixture.worker", role: "worker", workspace: "/workspace", verdict: "pinned" } as LaunchAgentAudit;
    expect(() => assertWorkerInstallCustody("/workspace", [agent], false)).toThrow();
    expect(() => assertWorkerInstallCustody("/workspace", [{ ...agent, workspace: null }], false)).toThrow();
    expect(() => assertWorkerInstallCustody("/workspace", [{ ...agent, workspace: "/other", verdict: "unreadable" }], false)).toThrow();
    expect(() => assertWorkerInstallCustody("/workspace", [{ ...agent, label: "com.arcadia.worker", workspace: "/other" }], false)).toThrow();
    expect(() => assertWorkerInstallCustody("/workspace", [], true)).toThrow();
    expect(() => assertWorkerInstallCustody("/workspace", [{ ...agent, workspace: "/other" }], false)).not.toThrow();
  });
  it("refuses a partial or symlinked compiled worker graph", () => {
    const f = fixture();
    expect(() => validateGoBrokerWorkerCode(f.directory)).toThrow("compiled package");
    for (const name of ["commands/workerHeartbeatBeacon.js", "sessions/preservationRequestWorker.js", "sessions/preservationRequestPayload.js", "sessions/preservationValidationClient.js"]) {
      const file = path.join(f.directory, "dist/src", name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "fixture worker entry");
    }
    expect(() => validateGoBrokerWorkerCode(f.directory)).not.toThrow();
    const file = path.join(f.directory, "dist/src/sessions/preservationRequestPayload.js");
    rmSync(file);
    symlinkSync(f.worker, file);
    expect(() => validateGoBrokerWorkerCode(f.directory)).toThrow("compiled package");
  });
  it("packages and validates the four Phase3 defaults without a source fallback", () => {
    const f = fixture();
    const source = path.resolve(import.meta.dirname, "..");
    stageGoBrokerRoleRegistry(source, f.directory);
    expect(() => validateGoBrokerWorkerDefaults(f.directory)).toThrow("registry defaults");
    stageGoBrokerWorkerDefaults(source, f.directory);
    expect(() => validateGoBrokerWorkerDefaults(f.directory)).not.toThrow();
    const file = path.join(f.directory, "dist/config/defaults/intent-registry.json");
    writeFileSync(file, "{}");
    expect(() => validateGoBrokerWorkerDefaults(f.directory)).toThrow("registry defaults");
  });
});
