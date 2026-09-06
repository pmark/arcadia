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

const INSTALL_SCHEMA = "arcadia-go-broker-install-v1";

export interface GoBrokerInstallData {
  revision: string;
  releaseDirectory: string;
  executables: Record<"codex" | "claude", string>;
  manifest: string;
  codexRules: string[];
  claudePermissions: string[];
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

  return createSuccess({
    command: "go-broker.install",
    data: {
      revision,
      releaseDirectory,
      executables,
      manifest: path.join(releaseDirectory, "broker-manifest.json"),
      ...permissionSnippets(executables)
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
    "",
    "Codex rule:",
    ...response.data.codexRules,
    "",
    "Claude Code permissions.allow entry:",
    ...response.data.claudePermissions,
    "",
    "Run the matching provider executable with no arguments from the completed worktree."
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
