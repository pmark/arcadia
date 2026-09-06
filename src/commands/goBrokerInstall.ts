import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import {
  configureGoBrokerAgents,
  inspectGoBrokerAgentSetup,
  validateGoBrokerAgentSetupInputs,
  type AgentSetupStatus
} from "../agentSetup/goBrokerAgentSetup.js";

const INSTALL_SCHEMA = "arcadia-go-broker-install-v1";

export interface GoBrokerInstallData {
  revision: string;
  releaseDirectory: string;
  executables: Record<"codex" | "claude", string>;
  manifest: string;
  codexRules: string[];
  claudePermissions: string[];
  agentSetup: {
    changed: string[];
    backups: string[];
    status: AgentSetupStatus;
  };
}

export interface GoBrokerStatusData {
  ready: boolean;
  revision: string | null;
  releaseDirectory: string | null;
  brokerIssues: string[];
  agentSetup: AgentSetupStatus;
}

export interface GoBrokerInstallOptions {
  /** Test-only destination override. */
  home?: string;
  /** Test-only repository override. */
  repository?: string;
}

export function permissionSnippets(
  executables: GoBrokerInstallData["executables"]
): Pick<GoBrokerInstallData, "codexRules" | "claudePermissions"> {
  return {
    codexRules: [`prefix_rule(pattern=[${JSON.stringify(executables.codex)}], decision="allow")`],
    claudePermissions: [`Bash(${executables.claude})`]
  };
}

export function runGoBrokerInstallCommand(
  options: GoBrokerInstallOptions = {}
): CommandSuccess<GoBrokerInstallData> {
  const requestedRepository = options.repository ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const repository = realpathSync(requestedRepository);
  assertReviewedSnapshot(repository);
  const revision = git(repository, ["rev-parse", "HEAD"]).trim();
  const installHome = path.resolve(options.home ?? homedir());
  const brokerRoot = path.join(installHome, ".local", "share", "arcadia", "go-broker");
  const releasesRoot = path.join(brokerRoot, "releases");
  const releaseDirectory = path.join(releasesRoot, revision);
  const binDirectory = path.join(installHome, ".local", "bin");
  const executables = {
    codex: path.join(binDirectory, "arcadia-go-broker-codex"),
    claude: path.join(binDirectory, "arcadia-go-broker-claude")
  };
  const skillTemplate = readSkillTemplate(repository);

  validateGoBrokerAgentSetupInputs({ home: installHome, executables, skillTemplate });

  mkdirSync(releasesRoot, { recursive: true, mode: 0o755 });
  mkdirSync(binDirectory, { recursive: true, mode: 0o755 });
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { cwd: repository, stdio: "inherit" });

  if (!existsSync(releaseDirectory)) {
    const stagingRoot = mkdtempSync(path.join(releasesRoot, ".install-"));
    const stagedRelease = path.join(stagingRoot, revision);
    try {
      execFileSync(
        "pnpm",
        ["--filter", "@pmark/arcadia", "deploy", "--prod", "--legacy", stagedRelease],
        { cwd: repository, stdio: "inherit" }
      );
      cpSync(path.join(repository, "dist", "src"), path.join(stagedRelease, "dist", "src"), {
        recursive: true,
        force: true
      });
      mkdirSync(path.join(stagedRelease, "dist", "scripts"), { recursive: true });
      copyFileSync(
        path.join(repository, "dist", "scripts", "arcadia-go-broker.js"),
        path.join(stagedRelease, "dist", "scripts", "arcadia-go-broker.js")
      );

      const brokerEntrypoint = path.join(releaseDirectory, "dist", "scripts", "arcadia-go-broker.js");
      for (const agent of ["codex", "claude"] as const) {
        const launcher = path.join(stagedRelease, `arcadia-go-broker-${agent}`);
        writeFileSync(
          launcher,
          `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(brokerEntrypoint)} ${agent} "$@"\n`,
          { mode: 0o555 }
        );
      }
      const manifest = path.join(stagedRelease, "broker-manifest.json");
      writeFileSync(manifest, `${JSON.stringify({
        schema: INSTALL_SCHEMA,
        revision,
        sourceRepository: repository,
        runtimeExecutable: process.execPath,
        brokerEntrypoint
      }, null, 2)}\n`);
      chmodSync(manifest, 0o444);
      renameSync(stagedRelease, releaseDirectory);
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  } else {
    validateExistingRelease(releaseDirectory, revision);
  }

  for (const agent of ["codex", "claude"] as const) {
    safelyUpdateLink(
      executables[agent],
      path.join(releaseDirectory, `arcadia-go-broker-${agent}`),
      brokerRoot
    );
  }
  const agentSetup = configureGoBrokerAgents({
    home: installHome,
    executables,
    skillTemplate
  });
  const installedBroker = inspectInstalledBroker(executables);
  if (installedBroker.issues.length > 0) {
    throw validationError("The protected broker did not pass its post-install verification.", {
      issues: installedBroker.issues,
      agentConfigurationReady: agentSetup.status.ready
    });
  }

  return createSuccess({
    command: "go-broker.install",
    data: {
      revision,
      releaseDirectory,
      executables,
      manifest: path.join(releaseDirectory, "broker-manifest.json"),
      ...permissionSnippets(executables),
      agentSetup
    },
    artifacts: [releaseDirectory, ...Object.values(executables)]
  });
}

export function renderGoBrokerInstallSuccess(response: CommandSuccess<GoBrokerInstallData>): string[] {
  return [
    `Installed protected broker revision ${response.data.revision}.`,
    `Codex executable: ${response.data.executables.codex}`,
    `Claude executable: ${response.data.executables.claude}`,
    `Manifest: ${response.data.manifest}`,
    `Agent configuration: ${response.data.agentSetup.status.ready ? "ready" : "incomplete"}`,
    `Configuration files changed: ${response.data.agentSetup.changed.length}`,
    `Recovery backups created: ${response.data.agentSetup.backups.length}`,
    "",
    "Codex rule:",
    ...response.data.codexRules,
    "",
    "Claude Code permissions.allow entry:",
    ...response.data.claudePermissions,
    "",
    "Run `arcadia go-broker status` at any time to verify the complete setup.",
    "Run the matching provider executable with no arguments from the completed worktree."
  ];
}

export function runGoBrokerStatusCommand(
  options: GoBrokerInstallOptions = {}
): CommandSuccess<GoBrokerStatusData> {
  const installHome = path.resolve(options.home ?? homedir());
  const binDirectory = path.join(installHome, ".local", "bin");
  const executables = {
    codex: path.join(binDirectory, "arcadia-go-broker-codex"),
    claude: path.join(binDirectory, "arcadia-go-broker-claude")
  };
  const requestedRepository = options.repository ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const repository = realpathSync(requestedRepository);
  const broker = inspectInstalledBroker(executables);
  const agentSetup = inspectGoBrokerAgentSetup({
    home: installHome,
    executables,
    skillTemplate: readSkillTemplate(repository)
  });
  if (broker.issues.length > 0 || !agentSetup.ready) {
    throw validationError("Protected broker setup is not ready.", {
      revision: broker.revision,
      releaseDirectory: broker.releaseDirectory,
      brokerIssues: broker.issues,
      agentSetupIssues: agentSetup.issues,
      checks: agentSetup.checks
    });
  }
  return createSuccess({
    command: "go-broker.status",
    data: {
      ready: true,
      revision: broker.revision,
      releaseDirectory: broker.releaseDirectory,
      brokerIssues: broker.issues,
      agentSetup
    }
  });
}

export function renderGoBrokerStatusSuccess(response: CommandSuccess<GoBrokerStatusData>): string[] {
  const data = response.data;
  return [
    `Protected broker setup: ${data.ready ? "READY" : "NOT READY"}`,
    `Revision: ${data.revision ?? "not installed"}`,
    `Release: ${data.releaseDirectory ?? "not installed"}`,
    ...(data.brokerIssues.length > 0 ? ["Broker issues:", ...data.brokerIssues.map((issue) => `- ${issue}`)] : []),
    ...(data.agentSetup.issues.length > 0
      ? ["Agent configuration issues:", ...data.agentSetup.issues.map((issue) => `- ${issue}`)]
      : [])
  ];
}

function assertReviewedSnapshot(repository: string): void {
  const topLevel = git(repository, ["rev-parse", "--show-toplevel"]).trim();
  if (realpathSync(topLevel) !== repository) {
    throw validationError("The broker must be installed from the repository root.", { repository, topLevel });
  }
  const changes = git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (changes.trim()) {
    throw validationError("The broker can only be installed from a clean, committed snapshot.", {
      repository,
      changes: changes.trim().split("\n")
    });
  }
}

function validateExistingRelease(releaseDirectory: string, revision: string): void {
  const manifestPath = path.join(releaseDirectory, "broker-manifest.json");
  const executablePaths = ["codex", "claude"].map((agent) => path.join(releaseDirectory, `arcadia-go-broker-${agent}`));
  if (!existsSync(manifestPath) || executablePaths.some((candidate) => !existsSync(candidate))) {
    throw validationError("The existing protected broker release is incomplete.", { releaseDirectory });
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { schema?: string; revision?: string };
  if (manifest.schema !== INSTALL_SCHEMA || manifest.revision !== revision) {
    throw validationError("The existing protected broker release manifest does not match its revision.", {
      releaseDirectory,
      expectedRevision: revision
    });
  }
}

function safelyUpdateLink(executable: string, target: string, brokerRoot: string): void {
  if (existsSync(executable) || isDanglingLink(executable)) {
    const stat = lstatSync(executable);
    if (!stat.isSymbolicLink()) {
      throw validationError("The broker installer will not replace a non-symlink executable.", { executable });
    }
    const currentTarget = path.resolve(path.dirname(executable), readlinkSync(executable));
    const relative = path.relative(brokerRoot, currentTarget);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw validationError("The broker installer will not replace a symlink it does not own.", {
        executable,
        currentTarget
      });
    }
  }

  const temporaryLink = path.join(path.dirname(executable), `.${path.basename(executable)}-${process.pid}`);
  rmSync(temporaryLink, { force: true });
  symlinkSync(target, temporaryLink);
  renameSync(temporaryLink, executable);
}

function isDanglingLink(candidate: string): boolean {
  try {
    return lstatSync(candidate).isSymbolicLink();
  } catch {
    return false;
  }
}

function git(repository: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function readSkillTemplate(repository: string): string {
  return readFileSync(path.join(repository, "src", "agentSetup", "arcadia-go.SKILL.md"), "utf8");
}

function inspectInstalledBroker(executables: Record<"codex" | "claude", string>): {
  revision: string | null;
  releaseDirectory: string | null;
  issues: string[];
} {
  const issues: string[] = [];
  const targets = Object.entries(executables).map(([agent, executable]) => {
    try {
      const stat = lstatSync(executable);
      if (!stat.isSymbolicLink()) {
        issues.push(`${agent} executable is not a symlink to a protected release`);
        return null;
      }
      const target = path.resolve(path.dirname(executable), readlinkSync(executable));
      if (!existsSync(target)) issues.push(`${agent} executable target is missing`);
      if (path.basename(target) !== `arcadia-go-broker-${agent}`) {
        issues.push(`${agent} executable points to the wrong provider launcher`);
      }
      return target;
    } catch {
      issues.push(`${agent} executable is missing`);
      return null;
    }
  });
  if (targets.some((target) => target === null)) return { revision: null, releaseDirectory: null, issues };
  const releaseDirectories = targets.map((target) => path.dirname(target!));
  if (new Set(releaseDirectories).size !== 1) {
    issues.push("provider executables point to different releases");
    return { revision: null, releaseDirectory: null, issues };
  }
  const releaseDirectory = releaseDirectories[0];
  const revision = path.basename(releaseDirectory);
  try {
    const manifest = JSON.parse(readFileSync(path.join(releaseDirectory, "broker-manifest.json"), "utf8")) as {
      schema?: string;
      revision?: string;
      brokerEntrypoint?: string;
    };
    if (manifest.schema !== INSTALL_SCHEMA) issues.push("broker manifest schema is invalid");
    if (manifest.revision !== revision) issues.push("broker manifest revision does not match its release directory");
    if (!manifest.brokerEntrypoint || !existsSync(manifest.brokerEntrypoint)) {
      issues.push("broker entrypoint is missing");
    } else {
      const relative = path.relative(releaseDirectory, manifest.brokerEntrypoint);
      if (relative.startsWith("..") || path.isAbsolute(relative)) issues.push("broker entrypoint escapes its release directory");
    }
  } catch {
    issues.push("broker manifest is missing or invalid");
  }
  return { revision, releaseDirectory, issues };
}
