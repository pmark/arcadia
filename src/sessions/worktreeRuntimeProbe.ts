import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";

const PROBE_WRAPPER_PREFIX = ".arcadia-host-probe-";

export type WorktreeRuntimeProbeStep =
  | "candidate-worktree"
  | "candidate-root-write"
  | "source-write"
  | "dependency-preparation"
  | "temporary-sqlite"
  | "candidate-build"
  | "dashboard-build"
  | "vitest"
  | "compiled-broker";

export interface WorktreeRuntimeProbeResult {
  candidatePath: string;
  checked: WorktreeRuntimeProbeStep[];
}

export interface WorktreeRuntimeProbeOptions {
  repository: string;
  /** The installed, revision-pinned entrypoint that must parse before launch. */
  brokerEntrypoint: string;
  home?: string;
  now?: Date;
  run?: (command: string, args: string[], cwd: string) => void;
}

/**
 * Exercise the exact kind of disposable Codex worktree Arcadia will later
 * prepare for production work.  This deliberately uses compiled Node output
 * and ordinary package commands: `tsx` is never a lifecycle dependency here.
 *
 * The worktree is always created below the configured Codex worktree root and
 * forcibly retired only after it has been identified as this probe's own
 * timestamped directory.  A failed cleanup leaves that directory in place and
 * reports the one command that can recover it.
 *
 * Retiring the worktree leaves behind the timestamped wrapper directory this
 * probe created to hold it, so cleanup removes that too -- but only when it is
 * empty and named with this probe's own prefix, never as a broader sweep.
 */
export function runWorktreeRuntimeProbe(options: WorktreeRuntimeProbeOptions): WorktreeRuntimeProbeResult {
  const repository = path.resolve(options.repository);
  const home = path.resolve(options.home ?? homedir());
  const run = options.run ?? runCommand;
  const stamp = (options.now ?? new Date()).toISOString().replaceAll(/[-:.]/g, "").replace("Z", "Z");
  const root = path.join(home, ".codex", "worktrees");
  const wrapperPath = path.join(root, `${PROBE_WRAPPER_PREFIX}${stamp}-${process.pid}`);
  const candidatePath = path.join(wrapperPath, path.basename(repository));
  const checked: WorktreeRuntimeProbeStep[] = [];
  let created = false;

  try {
    probe("candidate-worktree", () => mkdirSync(path.dirname(candidatePath), { recursive: true }));
    probe("candidate-worktree", () => run("git", ["worktree", "add", "--detach", candidatePath, "HEAD"], repository));
    created = true;
    checked.push("candidate-worktree");

    writeProbeFile(candidatePath, ".arcadia-worktree-runtime-probe", "candidate-root-write", checked);
    writeProbeFile(candidatePath, path.join("src", ".arcadia-worktree-runtime-probe.ts"), "source-write", checked);

    probe("dependency-preparation", () => run("pnpm", ["bridge:worktree"], candidatePath));
    checked.push("dependency-preparation");

    const sqlitePath = path.join(candidatePath, ".arcadia-worktree-runtime-probe.sqlite");
    probe("temporary-sqlite", () => run(process.execPath, [
      "--input-type=module",
      "--eval",
      "import Database from 'better-sqlite3'; const db = new Database(process.argv[1]); db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY)'); db.close();",
      sqlitePath
    ], candidatePath));
    rmSync(sqlitePath, { force: true });
    checked.push("temporary-sqlite");

    probe("candidate-build", () => run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], candidatePath));
    checked.push("candidate-build");
    probe("dashboard-build", () => run("pnpm", ["dashboard:build"], candidatePath));
    checked.push("dashboard-build");
    probe("vitest", () => run("pnpm", ["vitest", "run", "tests/bridge-worktree-deps.test.ts"], candidatePath));
    checked.push("vitest");
    probe("compiled-broker", () => run(process.execPath, ["--check", options.brokerEntrypoint], candidatePath));
    checked.push("compiled-broker");

    return { candidatePath, checked };
  } finally {
    if (created) {
      try {
        run("git", ["worktree", "remove", "--force", candidatePath], repository);
      } catch (error) {
        throw runtimeProbeError("candidate-worktree", error, {
          candidatePath,
          remedy: `Run git worktree remove --force ${JSON.stringify(candidatePath)} from ${JSON.stringify(repository)} after preserving any probe evidence.`
        });
      }
    }
    removeProbeWrapper(wrapperPath, root);
  }
}

/**
 * Remove the timestamped directory this probe created to wrap its candidate
 * worktree.  `rmdirSync` refuses a non-empty directory, so anything the probe
 * failed to retire stays exactly where the reported remedy expects it; the
 * prefix and parent checks keep this from ever touching a directory the probe
 * did not create.
 */
function removeProbeWrapper(wrapperPath: string, root: string): void {
  if (path.dirname(wrapperPath) !== root) return;
  if (!path.basename(wrapperPath).startsWith(PROBE_WRAPPER_PREFIX)) return;
  if (!existsSync(wrapperPath)) return;
  try {
    rmdirSync(wrapperPath);
  } catch {
    // A wrapper that still holds evidence is recoverable state, not a failure:
    // the candidate-worktree remedy already names the one command that clears it.
  }
}

function writeProbeFile(
  candidatePath: string,
  relativePath: string,
  step: Extract<WorktreeRuntimeProbeStep, "candidate-root-write" | "source-write">,
  checked: WorktreeRuntimeProbeStep[]
): void {
  const target = path.join(candidatePath, relativePath);
  probe(step, () => {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "Arcadia worktree runtime probe.\n");
    if (!existsSync(target)) throw new Error(`write did not create ${target}`);
    rmSync(target, { force: true });
  });
  checked.push(step);
}

function probe(step: WorktreeRuntimeProbeStep, operation: () => void): void {
  try {
    operation();
  } catch (error) {
    throw runtimeProbeError(step, error);
  }
}

function runtimeProbeError(step: WorktreeRuntimeProbeStep, error: unknown, extra: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : null;
  const operation = /listen|bind/i.test(message) ? "local IPC listener" : "filesystem or process operation";
  const denial = code === "EPERM" || code === "EACCES" || /\b(?:EPERM|EACCES)\b/.test(message);
  const remedy = denial
    ? `Codex denied ${operation} during ${step}. Keep the candidate below ~/.codex/worktrees with workspace-write sandbox roots configured, then rerun arcadia go-broker install.`
    : `Fix the ${step} failure and rerun arcadia go-broker install; the disposable candidate is recoverable at the reported path.`;
  return validationError("Worktree runtime host probe failed before Arcadia could launch production work.", {
    step,
    code,
    operation,
    denial,
    message,
    remedy,
    ...extra
  });
}

function runCommand(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}
