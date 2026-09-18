import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Whether an installed launch agent actually runs Arcadia under the pinned
 * runtime.
 *
 * This exists because the failure it detects is silent and total. On
 * 2026-08-20 the iCloud ingress agent had been dying on every single run for
 * weeks with a better-sqlite3 ABI mismatch, because its plist ran
 * `node_modules/.bin/tsx` directly with Homebrew's Node 25 first on PATH while
 * the repository pins 22.23.1. Nothing surfaced it: `ingress activity` reported
 * `Pending: 0`, `ingress service doctor` reported `healthy`, and the files the
 * agent had already moved out of the inbox sat in Processing where no command
 * looks.
 *
 * A plist is a snapshot of whatever environment the installer happened to run
 * in. `mise.toml` is the version that is actually enforced. Those drift apart
 * the moment either one changes, and nothing rechecks them -- so this does.
 */
export type LaunchAgentVerdict = "pinned" | "unpinned" | "unreadable";

/**
 * Which Arcadia installer, if any, owns this agent.
 *
 * This decides the remedy, and getting it wrong is worse than saying nothing.
 * launchd keys agents by label, so `arcadia worker install` only replaces an
 * agent already labelled `com.arcadia.worker`. Told to run it against, say,
 * `com.arcadia.local.<uid>.worker`, the operator ends up with a second worker
 * running beside the first rather than a fixed one.
 */
export type LaunchAgentOwner = "ingress-service" | "worker" | "unmanaged";

export function launchAgentOwner(label: string): LaunchAgentOwner {
  if (label.startsWith("com.arcadia.ingress.")) return "ingress-service";
  if (label === "com.arcadia.worker") return "worker";
  return "unmanaged";
}

export function launchAgentRemedy(label: string): string {
  switch (launchAgentOwner(label)) {
    case "ingress-service":
      return "arcadia ingress service install";
    case "worker":
      return "arcadia worker install";
    case "unmanaged":
      return "No Arcadia installer owns this label, so reinstalling would add a second agent beside it. "
        + "Repoint its ProgramArguments at `mise -C <repo> exec -- node`, or unload and remove it.";
  }
}

/**
 * What an installed agent actually runs, read from its ProgramArguments.
 *
 * Only a worker competes for a workspace's pidfile, and only a worker is the
 * agent issue #303 found crash-looping. An ingress service shares a workspace
 * by design -- one per source -- so the role is part of the duplicate test
 * rather than an assumption that one workspace means one agent.
 */
export type LaunchAgentRole = "worker" | "ingress-service" | "other";

export function launchAgentRole(label: string, argv: string[]): LaunchAgentRole {
  if (argv.includes("worker") && argv.includes("start")) return "worker";
  // A label ending in `.worker` is the naming convention every worker installer
  // follows, including ones no Arcadia installer owns. It catches an agent
  // whose argv cannot be classified by command tokens alone.
  if (label.endsWith(".worker")) return "worker";
  if (argv.includes("ingress") && argv.includes("service") && argv.includes("run")) return "ingress-service";
  return "other";
}

/**
 * The workspace an agent serves, from its `--workspace <path>` argument.
 *
 * Both installer families pass it explicitly. A plist that omits it cannot be
 * grouped, so it is left alone rather than guessed at from its label.
 */
export function launchAgentWorkspace(argv: string[]): string | null {
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] !== "--workspace") continue;
    const value = argv[index + 1];
    if (value && !value.startsWith("-")) return value;
  }
  return null;
}

/**
 * The filesystem identity of a workspace, so two plists naming one workspace
 * through different symlink aliases still collapse to a single group.
 *
 * The worker's pidfile lives at the workspace's real path and workspace
 * resolution only calls `path.resolve`, which preserves symlink aliases
 * (`src/workspace/paths.ts`). Grouping the raw `--workspace` strings would
 * therefore miss exactly the duplicate that matters: two agents installed
 * through different aliases of one workspace still fight over one pidfile.
 *
 * `realpathSync` collapses the aliases. When the path does not exist there is
 * nothing to collapse and realpath throws, so the resolved-but-uncanonicalized
 * path is the documented fallback -- deterministic, and never a crash.
 */
export function canonicalWorkspaceIdentity(workspacePath: string): string {
  try {
    return realpathSync(workspacePath);
  } catch {
    return path.resolve(workspacePath);
  }
}

/**
 * The recovery an operator actually has after a duplicate exits cleanly.
 *
 * `KeepAlive { SuccessfulExit: false }` deliberately leaves a cleanly-exited
 * job stopped, so a duplicate that lost the pidfile race does not quietly
 * become failover: launchd will not bring it back when the surviving worker
 * disappears. Reloading it is a deliberate `kickstart`, not an automatic
 * restart, and the honest remedy says so.
 */
const NOT_FAILOVER_REMEDY = " A cleanly-exited duplicate is not failover: launchd leaves it stopped, so"
  + " reload it with launchctl kickstart -k gui/$(id -u)/<label> once the surviving worker is gone.";

/**
 * The fix for two worker agents on one workspace.
 *
 * It must not be a reinstall: launchd keys agents by label, so `arcadia worker
 * install` only ever replaces `com.arcadia.worker` and adds a third agent
 * beside any other. Removing one by label is the only remediation that shrinks
 * the set.
 */
export function duplicateWorkerRemedy(label: string, others: string[]): string {
  const listed = others.join(", ");
  if (launchAgentOwner(label) === "worker") {
    const remove = others[0] ?? "<other-label>";
    return `This is the Arcadia-installed worker, but ${listed} also serves the same workspace. `
      + `Keep this one and remove ${remove}: launchctl bootout gui/$(id -u)/${remove}, then delete its plist.`
      + NOT_FAILOVER_REMEDY;
  }
  return `No Arcadia installer owns this label, and ${listed} already serves the same workspace. `
    + `Remove this one: launchctl bootout gui/$(id -u)/${label}, then delete its plist.`
    + " Reinstalling would only add a third agent."
    + NOT_FAILOVER_REMEDY;
}

export interface LaunchAgentAudit {
  label: string;
  plistPath: string;
  owner: LaunchAgentOwner;
  /** What will actually fix this one. */
  remedy: string;
  verdict: LaunchAgentVerdict;
  /** argv[0], which is what decides the runtime. */
  program: string | null;
  /** The first PATH entry, which decides what a bare `node` resolves to. */
  pathHead: string | null;
  detail: string;
  /** The workspace named by `--workspace`, when the plist has one. */
  workspace: string | null;
  role: LaunchAgentRole;
  /**
   * Labels of other installed worker agents that serve the same workspace.
   * Issue #303: this is the condition that made one agent spam the log forever
   * because nothing checked for it before starting.
   */
  duplicateLabels: string[];
}

export interface LaunchAgentAuditResult {
  directory: string;
  agents: LaunchAgentAudit[];
  counts: { pinned: number; unpinned: number; unreadable: number; duplicate: number };
}

export function auditArcadiaLaunchAgents(home = homedir()): LaunchAgentAuditResult {
  const directory = path.join(home, "Library", "LaunchAgents");

  const entries = existsSync(directory)
    ? readdirSync(directory).filter((name) => name.startsWith("com.arcadia.") && name.endsWith(".plist")).sort()
    : [];

  const agents = flagDuplicateWorkspaces(entries.map((name) => auditOne(path.join(directory, name))));

  return {
    directory,
    agents,
    counts: {
      pinned: agents.filter((agent) => agent.verdict === "pinned").length,
      unpinned: agents.filter((agent) => agent.verdict === "unpinned").length,
      unreadable: agents.filter((agent) => agent.verdict === "unreadable").length,
      duplicate: agents.filter((agent) => agent.duplicateLabels.length > 0).length
    }
  };
}

/**
 * Mark every worker agent that shares its workspace with another worker.
 *
 * Pure so the rule can be tested without `plutil` or a real LaunchAgents
 * directory, and so `arcadia worker install` can reuse it to notice a duplicate
 * at the moment it is created.
 */
export function flagDuplicateWorkspaces(agents: LaunchAgentAudit[]): LaunchAgentAudit[] {
  const byWorkspace = new Map<string, LaunchAgentAudit[]>();
  for (const agent of agents) {
    if (agent.role !== "worker" || agent.workspace === null) continue;
    // Group on the canonical identity, not the raw argument: two agents can
    // name one workspace through different symlink aliases.
    const identity = canonicalWorkspaceIdentity(agent.workspace);
    const group = byWorkspace.get(identity) ?? [];
    group.push(agent);
    byWorkspace.set(identity, group);
  }

  const duplicates = new Map<string, { identity: string; others: string[] }>();
  for (const [identity, group] of byWorkspace) {
    if (group.length < 2) continue;
    for (const agent of group) {
      duplicates.set(agent.label, {
        identity,
        others: group.filter((other) => other.label !== agent.label).map((other) => other.label)
      });
    }
  }
  if (duplicates.size === 0) return agents;

  return agents.map((agent) => {
    const duplicate = duplicates.get(agent.label);
    if (!duplicate) return agent;
    return {
      ...agent,
      duplicateLabels: duplicate.others,
      remedy: duplicateWorkerRemedy(agent.label, duplicate.others),
      detail: `${duplicate.others.length + 1} installed worker agents serve ${duplicate.identity}. ${agent.detail}`
    };
  });
}

/**
 * A one-line warning for `arcadia worker install` when the workspace it just
 * installed for already has another worker agent. Null on the ordinary,
 * unambiguous machine.
 */
export function duplicateWorkerWarning(agents: LaunchAgentAudit[], workspace: string): string | null {
  const identity = canonicalWorkspaceIdentity(workspace);
  const duplicates = agents.filter((agent) =>
    agent.workspace !== null
    && canonicalWorkspaceIdentity(agent.workspace) === identity
    && agent.duplicateLabels.length > 0);
  if (duplicates.length === 0) return null;
  const labels = [...new Set(duplicates.flatMap((agent) => [agent.label, ...agent.duplicateLabels]))].sort();
  return `Warning: ${labels.length} worker launch agents serve ${identity} (${labels.join(", ")}). `
    + "Only one can hold the workspace pidfile; the others return without work. "
    + "Remove the extras: launchctl bootout gui/$(id -u)/<label>, then delete their plists. "
    + "Reinstalling cannot replace an agent with a different label."
    + NOT_FAILOVER_REMEDY;
}

/**
 * What a plist says about how it launches: argv, and the PATH it exports.
 *
 * Kept separate from the verdict so the rules below can be tested on any
 * platform. Reading the file needs `plutil`, which exists only on macOS -- and
 * launchd only exists there either, so that is the right place for the boundary
 * rather than a reason to leave the rules untested on CI.
 */
export interface LaunchAgentInvocation {
  argv: string[];
  pathValue: string | null;
}

export function evaluateLaunchAgent(
  label: string,
  plistPath: string,
  invocation: LaunchAgentInvocation | null
): LaunchAgentAudit {
  const base = {
    label,
    plistPath,
    owner: launchAgentOwner(label),
    remedy: launchAgentRemedy(label),
    workspace: invocation === null ? null : launchAgentWorkspace(invocation.argv),
    role: invocation === null ? ("other" as LaunchAgentRole) : launchAgentRole(label, invocation.argv),
    duplicateLabels: [] as string[]
  };

  if (invocation === null) {
    return { ...base, verdict: "unreadable", program: null, pathHead: null, detail: "Could not be parsed." };
  }

  const program = invocation.argv[0] ?? null;
  const pathHead = invocation.pathValue ? (invocation.pathValue.split(":")[0] ?? null) : null;

  if (program === null) {
    return { ...base, verdict: "unreadable", program, pathHead, detail: "No ProgramArguments." };
  }

  if (!isMiseExecutable(program)) {
    return {
      ...base,
      verdict: "unpinned",
      program,
      pathHead,
      detail: `Runs ${program} directly instead of through mise, so it uses whatever Node that path resolves to rather than the version mise.toml pins.`
    };
  }

  // argv[0] is mise, but `mise exec -- node` still resolves `node` through
  // PATH. A PATH led by some other runtime's bin directory defeats the point.
  if (pathHead !== null && looksLikeNodeBin(pathHead)) {
    return {
      ...base,
      verdict: "unpinned",
      program,
      pathHead,
      detail: `Invokes mise, but PATH begins with ${pathHead}, which shadows the runtime mise would select.`
    };
  }

  return { ...base, verdict: "pinned", program, pathHead, detail: "Runs through mise, so it follows mise.toml." };
}

/**
 * Read one plist via `plutil`, the only parser guaranteed present on macOS and
 * the only one that handles binary plists as well as XML. Returns null when the
 * file cannot be read at all, including on a platform without `plutil`.
 */
export function readLaunchAgentInvocation(plistPath: string): LaunchAgentInvocation | null {
  let parsed: { ProgramArguments?: unknown; EnvironmentVariables?: unknown };
  try {
    parsed = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })) as { ProgramArguments?: unknown; EnvironmentVariables?: unknown };
  } catch {
    return null;
  }

  const argv = Array.isArray(parsed.ProgramArguments)
    ? parsed.ProgramArguments.filter((value): value is string => typeof value === "string")
    : [];
  const environment = isRecord(parsed.EnvironmentVariables) ? parsed.EnvironmentVariables : {};

  return {
    argv,
    pathValue: typeof environment["PATH"] === "string" ? environment["PATH"] : null
  };
}

function auditOne(plistPath: string): LaunchAgentAudit {
  const label = path.basename(plistPath).replace(/\.plist$/, "");
  return evaluateLaunchAgent(label, plistPath, readLaunchAgentInvocation(plistPath));
}

function isMiseExecutable(program: string): boolean {
  return path.basename(program) === "mise";
}

/**
 * A PATH entry that plausibly supplies its own `node`. Version-manager and
 * package-manager prefixes are the ones that actually cause this in practice.
 */
function looksLikeNodeBin(entry: string): boolean {
  return /(^|\/)(\.nvm|\.fnm|\.volta|\.asdf|n|nodenv)(\/|$)/.test(entry)
    || /node[@/-]?\d/.test(entry)
    || entry.includes("/Cellar/node");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
