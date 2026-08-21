import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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
}

export interface LaunchAgentAuditResult {
  directory: string;
  agents: LaunchAgentAudit[];
  counts: { pinned: number; unpinned: number; unreadable: number };
}

export function auditArcadiaLaunchAgents(home = homedir()): LaunchAgentAuditResult {
  const directory = path.join(home, "Library", "LaunchAgents");
  const agents: LaunchAgentAudit[] = [];

  const entries = existsSync(directory)
    ? readdirSync(directory).filter((name) => name.startsWith("com.arcadia.") && name.endsWith(".plist")).sort()
    : [];

  for (const name of entries) {
    agents.push(auditOne(path.join(directory, name)));
  }

  return {
    directory,
    agents,
    counts: {
      pinned: agents.filter((agent) => agent.verdict === "pinned").length,
      unpinned: agents.filter((agent) => agent.verdict === "unpinned").length,
      unreadable: agents.filter((agent) => agent.verdict === "unreadable").length
    }
  };
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
    remedy: launchAgentRemedy(label)
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
