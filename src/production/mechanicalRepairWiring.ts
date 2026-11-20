import { spawnSync } from "node:child_process";
import type Database from "better-sqlite3";
import { isAncestor, tryGit } from "../git/worktrees.js";
import { systemPreservationRemote, type CandidatePreservationRemote } from "../sessions/candidatePreservation.js";
import type { AgentSession } from "../sessions/index.js";
import { independentVerdictReadiness } from "../sessions/roleLineage.js";
import { agentChangedPaths, candidateChangeGate } from "./candidateChangeGate.js";
import type { RequiredChecksFailure } from "./independentReview.js";
import {
  getMechanicalRepair,
  refreshCandidateGuidanceFingerprints,
  runMechanicalRepairRound,
  type MechanicalRepairEffects,
  type MechanicalRepairOutcome
} from "./mechanicalRepair.js";
import { runHostCommand, type QaPrReviewDependencies } from "../qa/prReview.js";
import { repairAuthority, runIdOf } from "./reviewRepair.js";

/**
 * The worker tick's call into the deterministic repair round
 * (src/production/mechanicalRepair.ts): when a preserved candidate's required
 * checks are red, run the one round for that head before the bounded repair
 * Session is considered. Generators run in the candidate's own worktree, which
 * independent verdict readiness has just shown clean and on its branch; a round
 * that does not end in a pushed production-owned head leaves it untouched.
 */

type RunCommand = NonNullable<QaPrReviewDependencies["runCommand"]>;

export interface MechanicalRepairDeps {
  /** Run a generator in the candidate worktree (default: a bounded child process). */
  run?: (command: string, args: string[], cwd: string) => { status: number; detail?: string };
  /** The push of the production-owned head; defaults to the one preservation uses. */
  remote?: CandidatePreservationRemote;
}

export type TickMechanicalRepair =
  | { kind: "repaired"; newHead: string; reason: string }
  | { kind: "handoff"; reason: string }
  | { kind: "not_applicable"; reason: string };

const CONTROLLER_IDENTITY = {
  GIT_AUTHOR_NAME: "Arcadia Controller", GIT_AUTHOR_EMAIL: "controller@arcadia.local",
  GIT_COMMITTER_NAME: "Arcadia Controller", GIT_COMMITTER_EMAIL: "controller@arcadia.local"
};

const GENERATOR_TIMEOUT_MS = 5 * 60_000;

function runGenerator(command: string, args: string[], cwd: string): { status: number; detail?: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: GENERATOR_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { status: 127, detail: result.error.message };
  return { status: result.status ?? 127, detail: (result.stderr || result.stdout || "").trim().slice(0, 300) };
}

/**
 * One deterministic repair round for the candidate whose required checks just
 * read red. Returns `not_applicable` without recording anything while the
 * round cannot start (checks still running, a log unreadable, authority off,
 * the head already had its round); `handoff` when the round decided the
 * failure is not mechanical, in which case the caller continues to the
 * bounded repair Session.
 */
export function attemptMechanicalRepair(db: Database.Database, input: {
  repoRoot: string;
  session: AgentSession;
  failure: RequiredChecksFailure;
  now: Date;
  log: (message: string) => void;
  runCommand?: RunCommand;
  deps?: MechanicalRepairDeps;
}): TickMechanicalRepair {
  const { repoRoot, session, failure, now } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const skip = (reason: string): TickMechanicalRepair => ({ kind: "not_applicable", reason });
  const readiness = independentVerdictReadiness(db, { session, repoRoot });
  if (!readiness.ready) return skip(`The candidate is not ready for verdicts: ${readiness.reasons.join(" ")}`);
  const head = readiness.binding.targetHead;
  if (head !== failure.head) return skip(`The failed checks were read on ${failure.head.slice(0, 12)}, not the candidate's current head ${head.slice(0, 12)}.`);
  const prior = getMechanicalRepair(db, actionKey, head);
  if (prior) return skip(`Head ${head.slice(0, 12)} already had its deterministic round (${prior.outcome}).`);
  if (failure.checks.some((check) => !check.unknown && check.status?.toUpperCase() !== "COMPLETED")) return skip("Required checks are still running beside a failure.");
  // The same shape the bounded repair judges: every non-success check is a FAILURE, or a CANCELLED check of a failed run.
  // A timeout, startup failure or unreadable check is CI infrastructure: no generator, no log read.
  const failed = failure.checks.filter((check) => !check.unknown && check.conclusion?.toUpperCase() === "FAILURE");
  const failedRuns = new Set(failed.map((check) => runIdOf(check.url)).filter((id): id is string => id !== null));
  const infrastructure = failure.checks.filter((check) => !failed.includes(check)
    && !(check.conclusion?.toUpperCase() === "CANCELLED" && failedRuns.has(runIdOf(check.url) ?? "")));
  if (failed.length === 0 || infrastructure.length > 0) return skip("A required check did not fail on its own; that is CI infrastructure, never repaired.");
  const authority = repairAuthority(db, session, now);
  if ("notApplicable" in authority) return skip(authority.notApplicable);
  // Decision 0098's gate list stops at the operator whatever generator would run.
  const start = tryGit(repoRoot, ["rev-parse", "--verify", `${head}^1`]) ?? head;
  const gate = candidateChangeGate(repoRoot, session.base_revision, start);
  if (gate) return skip(`The candidate is on Decision 0098's gate list (${gate}); no generator touches it.`);

  const repository = /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(failure.pullRequestUrl)?.[1];
  const runIds = [...new Set(failure.checks.filter((check) => check.conclusion?.toUpperCase() === "FAILURE").map((check) => runIdOf(check.url)).filter((id): id is string => id !== null))];
  if (!repository || runIds.length === 0) return skip("No failed CI run to read.");
  const runCommand = input.runCommand ?? runHostCommand;
  const logs: string[] = [];
  for (const runId of runIds) {
    const read = runCommand({ command: "gh", args: ["run", "view", runId, "-R", repository, "--log-failed"], cwd: repoRoot, timeoutMs: 60_000 });
    if (read.status !== 0) return skip(`The failed log of CI run ${runId} could not be read; retried next tick.`);
    logs.push(read.stdout);
  }
  const changedPaths = agentChangedPaths(repoRoot, session.base_revision, head);
  if (changedPaths === null) return skip("The candidate's changed paths could not be read.");
  const fenced = authority.authorizedNow();
  if (fenced) return skip(`Withheld the deterministic repair: ${fenced}.`);

  const cwd = session.worktree_path;
  const run = input.deps?.run ?? runGenerator;
  const effects: MechanicalRepairEffects = {
    run: (command, args) => run(command, args, cwd),
    dirty: () => (tryGit(cwd, ["status", "--porcelain", "--untracked-files=all"]) ?? "").trim() !== "",
    commit: (message) => {
      if (tryGit(cwd, ["add", "-A"]) === null) return null;
      if (tryGit(cwd, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", message], { ...process.env, ...CONTROLLER_IDENTITY }) === null) return null;
      const newHead = tryGit(cwd, ["rev-parse", "HEAD"]);
      return newHead && tryGit(repoRoot, ["rev-parse", `refs/heads/${session.branch}`]) === newHead ? newHead : null;
    },
    // No governed pointer advance is wired into the tick: a stale pointer is handed off.
    advancePointer: () => false,
    refreshFingerprints: (stale, changed) => refreshCandidateGuidanceFingerprints(cwd, stale, changed)
  };
  const outcome: MechanicalRepairOutcome = runMechanicalRepairRound({ db, actionKey, head, logs, changedPaths, effects, now });
  if (outcome.kind === "already_attempted") return skip(`Head ${head.slice(0, 12)} already had its deterministic round (${outcome.outcome}).`);
  if (outcome.kind === "handoff") {
    // A generator may have changed files before refusing: the worktree goes back to the verified-clean head.
    if (tryGit(cwd, ["rev-parse", "HEAD"]) === head) tryGit(cwd, ["reset", "--hard", "-q", head]);
    tryGit(cwd, ["clean", "-fdq"]);
    input.log(`Mechanical repair of ${actionKey} at ${head.slice(0, 12)} handed off to the bounded repair: ${outcome.reason}`);
    return { kind: "handoff", reason: outcome.reason };
  }
  const reason = `Deterministic repair (${outcome.classes.join(", ")}) of ${actionKey}: ${outcome.generators.join("; ")}; production-owned head ${outcome.newHead.slice(0, 12)} replaces ${head.slice(0, 12)}.`;
  input.log(reason);
  if (!isAncestor(repoRoot, head, outcome.newHead)) return { kind: "repaired", newHead: outcome.newHead, reason };
  try {
    (input.deps?.remote ?? systemPreservationRemote).push({ repositoryPath: repoRoot, branch: session.branch, commitSha: outcome.newHead });
  } catch (error) {
    // The review step publishes the settled head of the branch on its next poll.
    input.log(`Pushing the repaired head of ${session.branch} failed (${error instanceof Error ? error.message : String(error)}); the review step retries the push.`);
  }
  return { kind: "repaired", newHead: outcome.newHead, reason };
}
