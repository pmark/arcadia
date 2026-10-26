import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRIEF_CHILD_ENV, BRIEF_SELF_TEST_ENV } from "../src/briefSupervisor.js";
import {
  stageBrokerLaunchers, stageGoBrokerDatabaseSchema, stageGoBrokerDependencies,
  stageGoBrokerRoleRegistry, stageGoBrokerWorkerDefaults, stageGoBrokerSessionScripts, validateExistingRelease, validateGoBrokerRoleRegistry, validateGoBrokerSessionScripts
} from "../src/commands/goBrokerInstall.js";

const repository = path.resolve(import.meta.dirname, "..");
const canonical = readFileSync(path.join(repository, "config/defaults/agent-roles.json"));
let root: string;
let release: string;
let registry: string;
let launcher: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-broker-registry-")));
  const source = path.join(root, "source");
  release = path.join(root, "release");
  mkdirSync(source);
  // Build the real broker graph, independently of any pre-existing dist tree.
  execFileSync(process.execPath, [
    path.join(repository, "node_modules/typescript/bin/tsc"),
    "-p", path.join(repository, "tsconfig.json"), "--outDir", path.join(source, "dist")
  ], { cwd: repository, stdio: "pipe", timeout: 90_000 });
  symlinkSync(path.join(repository, "node_modules"), path.join(source, "node_modules"), "dir");
  stageGoBrokerDependencies(source, release);
  cpSync(path.join(source, "dist/src"), path.join(release, "dist/src"), { recursive: true });
  mkdirSync(path.join(release, "dist/scripts"), { recursive: true });
  const entrypoint = path.join(release, "dist/scripts/arcadia-go-broker.js");
  copyFileSync(path.join(source, "dist/scripts/arcadia-go-broker.js"), entrypoint);
  mkdirSync(path.join(source, "config/defaults"), { recursive: true });
  copyFileSync(path.join(repository, "config/defaults/agent-roles.json"), path.join(source, "config/defaults/agent-roles.json"));
  registry = stageGoBrokerRoleRegistry(source, release);
  stageGoBrokerWorkerDefaults(repository, release);
  stageGoBrokerSessionScripts(repository, release);
  stageGoBrokerDatabaseSchema(repository, release);
  mkdirSync(path.join(release, "scripts"), { recursive: true });
  copyFileSync(path.join(repository, "scripts/bridge-worktree-deps.mjs"), path.join(release, "scripts/bridge-worktree-deps.mjs"));
  stageBrokerLaunchers(release, entrypoint);
  launcher = path.join(release, "arcadia-brief-broker-codex");
  writeFileSync(path.join(release, "broker-manifest.json"), JSON.stringify({
    schema: "arcadia-go-broker-install-v1", revision: "fixture", brokerEntrypoint: entrypoint,
    roleRegistrySha256: createHash("sha256").update(canonical).digest("hex")
  }));
  // Remove the build source. Node's permission boundary additionally denies
  // the real checkout and its dependencies, proving no source fallback loads.
  rmSync(source, { recursive: true, force: true });
  expect(existsSync(source)).toBe(false);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function launcherEnvironment() {
  const env = {
    ...process.env,
    HOME: path.join(root, "unused-home"),
    NODE_OPTIONS: `--permission --allow-fs-read=${release} --allow-child-process`,
    [BRIEF_SELF_TEST_ENV]: "1"
  };
  delete env[BRIEF_CHILD_ENV];
  return env;
}

function runLauncher() {
  return spawnSync(launcher, [], { cwd: release, env: launcherEnvironment(), encoding: "utf8", timeout: 20_000 });
}

function report(name: string, evidence: unknown) {
  const destination = process.env.ARCADIA_BROKER_PACKAGING_REPORT_DIR;
  if (destination) {
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}

describe("protected broker release role registry", () => {
  it("runs the actual compiled fixed launcher with canonical bytes and source access denied", () => {
    expect(readFileSync(registry).equals(canonical)).toBe(true);
    expect(() => validateExistingRelease(release, "fixture")).not.toThrow();
    const denied = spawnSync(process.execPath, [
      "-e", "require('node:fs').readFileSync(process.argv[1])", path.join(repository, "config/defaults/agent-roles.json")
    ], { cwd: release, env: launcherEnvironment(), encoding: "utf8", timeout: 5_000 });
    expect(denied.status).not.toBe(0);
    expect(denied.stderr).toContain("ERR_ACCESS_DENIED");
    const result = runLauncher();
    report("canonical-success", { sourceReadDenied: true, allowedFsRead: release, status: result.status, stdout: result.stdout, stderr: result.stderr });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true, command: "brief-broker.self-test", data: { readOnly: true }
    });
  });

  it.each(["session-capability-probe.mjs", "record-session-exit.mjs"])(
    "ships %s without source fallback and refuses its absence before release reuse", (name) => {
      const script = path.join(release, "dist/scripts", name);
      const bytes = readFileSync(path.join(repository, "scripts", name));
      expect(readFileSync(script).equals(bytes)).toBe(true);
      rmSync(script);
      try {
        expect(() => validateExistingRelease(release, "fixture")).toThrow("Session launch script is missing or not release-local");
      } finally {
        writeFileSync(script, bytes);
      }
    }
  );

  it("rejects a Session script symlink outside the release", () => {
    const script = path.join(release, "dist/scripts/session-capability-probe.mjs");
    const bytes = readFileSync(script);
    const external = path.join(root, "external-probe.mjs");
    writeFileSync(external, bytes);
    rmSync(script);
    symlinkSync(external, script);
    try {
      expect(() => validateGoBrokerSessionScripts(release)).toThrow("Session launch script is missing or not release-local");
    } finally {
      rmSync(script);
      writeFileSync(script, bytes);
    }
  });

  it("refuses missing registry on reuse and reproduces the actual launcher's module-load refusal", () => {
    rmSync(registry);
    try {
      expect(() => validateExistingRelease(release, "fixture")).toThrow("role registry is missing or malformed");
      const result = runLauncher();
      report("missing-refusal", { status: result.status, stdout: result.stdout, stderr: result.stderr });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ERR_MODULE_NOT_FOUND");
      expect(result.stderr).toContain("dist/config/defaults/agent-roles.json");
      expect(result.stdout).toBe("");
    } finally {
      writeFileSync(registry, canonical);
    }
  });

  it.each(["not JSON", '{"schema":"arcadia-agent-roles-v1","session_start_role":"lead","roles":[]}'])(
    "refuses malformed registry before release reuse: %s", (value) => {
      writeFileSync(registry, value);
      try {
        expect(() => validateExistingRelease(release, "fixture")).toThrow("role registry is missing or malformed");
        if (value === "not JSON") {
          const result = runLauncher();
          expect(result.status).not.toBe(0);
          expect(result.stdout).not.toContain('"ok": true');
        }
      } finally {
        writeFileSync(registry, canonical);
      }
    }
  );

  it("rejects operational-default overrides and noncanonical byte changes", () => {
    const altered = JSON.parse(canonical.toString("utf8"));
    altered.roles[0].default_tier = altered.roles[0].default_tier === "light" ? "heavy" : "light";
    writeFileSync(registry, JSON.stringify(altered));
    expect(() => validateGoBrokerRoleRegistry(release)).toThrow("does not match its canonical data");
    writeFileSync(registry, JSON.stringify(JSON.parse(canonical.toString("utf8"))));
    expect(() => validateGoBrokerRoleRegistry(release)).toThrow("does not match its canonical byte fingerprint");
    writeFileSync(registry, canonical);
  });

  it("refuses source-linked registry reuse even when its bytes are canonical", () => {
    rmSync(registry);
    try {
      symlinkSync(path.join(repository, "config/defaults/agent-roles.json"), registry);
      expect(() => validateExistingRelease(release, "fixture")).toThrow("role registry is missing or malformed");
    } finally {
      rmSync(registry);
      writeFileSync(registry, canonical);
    }
  });

  it.each(["file", "dangling-file", "parent"])("refuses a linked staging %s before changing the external target", (kind) => {
    const stage = path.join(root, `linked-stage-${kind}`);
    const external = path.join(root, `external-${kind}`);
    mkdirSync(external);
    const target = path.join(external, "agent-roles.json");
    writeFileSync(target, "keep these bytes");
    mkdirSync(path.join(stage, "dist/config/defaults"), { recursive: true });
    if (kind !== "parent") {
      symlinkSync(kind === "dangling-file" ? path.join(external, "missing.json") : target, path.join(stage, "dist/config/defaults/agent-roles.json"));
    } else {
      rmSync(path.join(stage, "dist/config/defaults"), { recursive: true });
      symlinkSync(external, path.join(stage, "dist/config/defaults"), "dir");
    }
    expect(() => stageGoBrokerRoleRegistry(repository, stage)).toThrow("staging path is not release-local");
    expect(readFileSync(target, "utf8")).toBe("keep these bytes");
    expect(existsSync(path.join(external, "missing.json"))).toBe(false);
  });

  it("rejects missing or malformed canonical bytes during staging before publication", () => {
    const badSource = path.join(root, "bad-source");
    const staged = path.join(root, "bad-stage");
    const emitted = path.join(badSource, "config/defaults/agent-roles.json");
    mkdirSync(path.dirname(emitted), { recursive: true });
    writeFileSync(emitted, "{");
    expect(() => stageGoBrokerRoleRegistry(badSource, staged)).toThrow("role registry is missing or malformed");
    rmSync(emitted);
    expect(() => stageGoBrokerRoleRegistry(badSource, staged)).toThrow();
  });
});
