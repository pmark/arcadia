#!/usr/bin/env node
// The deterministic, zero-token fixture coding-agent process.
//
// `buildFixtureSessionLaunch` (src/sessions/index.ts) invokes this directly
// through the same tmux/admission path a real provider's launch command goes
// through -- it just runs this instead of `codex`/`claude`/`opencode`. It
// sleeps for a configured duration, then behaves exactly as `--outcome`
// declares:
//
//   completed -- writes and commits `--file` under a fixed, visibly-fake Git
//     identity, then exits 0. The evidence probe reads this as a candidate
//     with real changes and no self-declared failure: `incomplete_resumable`.
//   failed    -- makes NO git changes (a real edit here would be
//     indistinguishable from "completed" to the generic evidence probe, which
//     reads git state before it ever looks at exit status), self-reports its
//     configured exit status through the narrowly gated
//     `applyFixtureExitStatus` write, then exits 1: `failed_execution`.
//   crashed   -- makes no changes and never self-reports anything, simulating
//     a process that died without a trace: `missing_evidence`.
//   stalled   -- makes no changes and then hangs forever, producing no further
//     tmux pane output and no further Run/receipt activity, so the existing
//     stall-detection machinery (`observeSessionActivity`) is what notices it,
//     not `reconcileSessionExit`.
//
// See docs/plans/bootstrap-managed-production-to-build-flight-deck.md,
// Action add-fixture-coding-agent-provider.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Expected a --flag, got "${key}".`);
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

function requireArg(args, name) {
  const value = args[name];
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const worktree = requireArg(args, "worktree");
  const file = requireArg(args, "file");
  const outcome = requireArg(args, "outcome");
  const sessionId = requireArg(args, "session-id");
  const duration = Number(args.duration ?? "1");
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`--duration must be a non-negative number of seconds; got "${args.duration}".`);
  }

  await sleep(duration * 1000);

  switch (outcome) {
    case "completed": {
      appendFileSync(path.join(worktree, file), `fixture session ${sessionId} completed\n`);
      execFileSync("git", ["add", "--", file], { cwd: worktree, stdio: "ignore" });
      execFileSync(
        "git",
        [
          "-c", "user.name=Arcadia Fixture",
          "-c", "user.email=fixture@agents.arcadia.local",
          "commit", "-m", `fixture: simulated completion for Session ${sessionId}`
        ],
        { cwd: worktree, stdio: "ignore" }
      );
      process.exit(0);
      break;
    }
    case "failed": {
      const db = requireArg(args, "db");
      reportExitStatus(db, sessionId, 1);
      process.exit(1);
      break;
    }
    case "crashed": {
      // No self-report: a genuine crash never gets the chance to record
      // anything about itself.
      process.exit(1);
      break;
    }
    case "stalled": {
      // Never resolves: no further output, no further file or DB activity.
      await new Promise(() => {});
      break;
    }
    default:
      throw new Error(`Unknown fixture outcome "${outcome}".`);
  }
}

function reportExitStatus(dbPath, sessionId, exitStatus) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    const result = db
      .prepare(`UPDATE agent_sessions SET exit_status = ?, updated_at = ? WHERE id = ? AND provider = 'fixture-cli' AND is_simulated = 1`)
      .run(exitStatus, new Date().toISOString(), sessionId);
    if (result.changes !== 1) {
      throw new Error(`Refused to report exit status for Session ${sessionId}: it is not a simulated fixture-cli Session.`);
    }
  } finally {
    db.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
