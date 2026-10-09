import { preservationStage, preservationStageFailure } from "./preservationStages.js";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { getProjectMetadata } from "../db/repositories.js";
import { resolveActionReadiness } from "../docs/dispatch.js";
import { readProductionPolicy } from "../production/policy.js";
import { findPromotionDecision, type AgentSession } from "./index.js";
import { materializeCandidateTree, snapshotCandidate } from "./candidateSnapshot.js";
import { dependencyRequiringPreservationCheck } from "./preservationChecks.js";
import { bindCheckDefinitions } from "./preservationCheckBinding.js";
import { findAcceptedTerminalCompletion } from "./reconciliation.js";
import { operatorLaunchAuthorityFor } from "./operatorLaunch.js";

/**
 * An operator launch authorization (Decision 0096) standing in for the
 * production policy's validation delegation: the caller names the row and the
 * time it is checked at, and the binding records only the row's id.
 */
export interface OperatorLaunchGrant { authorizationId: string; at: Date }

export function preservationAuthority(db: Database.Database, workspace: string, lease: AgentSession, terminalRecovery = false, operatorLaunch?: OperatorLaunchGrant) {
  const current = db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(lease.id) as AgentSession | undefined;
  const fields = ["project_id", "project_slug", "repository_path", "worktree_path", "branch", "base_revision", "action_id", "plan_slug", "packet_id", "packet_path", "packet_sha256", "authorizing_decisions_json"] as const;
  const terminal = terminalRecovery ? findAcceptedTerminalCompletion(db, lease) : null;
  if (!current || (terminalRecovery ? !terminal : !["prepared", "running"].includes(current.status))
    || fields.some(field => current[field] !== lease[field])) {
    throw validationError("Preservation Session binding is stale.");
  }
  const packet = readFileSync(path.join(workspace, lease.packet_path), "utf8");
  const packetHash = createHash("sha256").update(packet).digest("hex");
  if (packetHash !== lease.packet_sha256) throw validationError("Preservation packet is stale.");
  const decision = findPromotionDecision(db, {
    projectId: lease.project_id, invocationId: lease.packet_id, actionId: lease.action_id,
    actionDocRef: `plan/${lease.plan_slug}#${lease.action_id}`, repoRoot: lease.repository_path,
    packetPath: lease.packet_path, packetSha256: packetHash, providerProfile: lease.provider_profile
  });
  const readiness = resolveActionReadiness(lease.repository_path, lease.project_slug, lease.action_id);
  if (!readiness.found || readiness.blockers.length || readiness.operatorQuestion) {
    throw validationError("Preservation Action authority is no longer ready.", { blockers: readiness.blockers });
  }
  const commands: unknown = JSON.parse(getProjectMetadata(db, lease.project_id)?.validation_commands ?? "[]");
  if (!Array.isArray(commands) || !commands.length || commands.length > 10 || commands.some(c => typeof c !== "string" || !c.trim() || /[\r\n]/.test(c))) {
    throw validationError("Preservation requires 1–10 declared objective validation_commands in host-managed Project metadata.");
  }
  const dependency = dependencyRequiringPreservationCheck(commands as string[]);
  if (dependency) throw validationError(dependency.remedy);
  const frozen = [...packet.matchAll(/^- Run validation command: (.+)$/gm)].map(m => m[1]);
  if (JSON.stringify(frozen) !== JSON.stringify(commands)) throw validationError("Validation check definitions differ from the authorized immutable packet; prepare and authorize a fresh packet.");
  const policy = readProductionPolicy(db);
  const scope = policy.scope;
  // The Session's own operator launch authorization replaces the production
  // validation delegation, for this exact Session and Action only.
  const operator = operatorLaunch ? operatorLaunchAuthorityFor(db, lease, operatorLaunch.at, operatorLaunch.authorizationId) : null;
  if (operator && !operator.ok) throw validationError(`Preservation validation: ${operator.reason}`);
  if (!operator && (policy.desiredState !== "active" || !policy.authority || !scope?.projects.includes(lease.project_slug) ||
      !scope.plans.includes(`${lease.project_slug}/${lease.plan_slug}`) || !scope.actions.includes(`${lease.project_slug}/${lease.action_id}`) ||
      !scope.mechanicalTransitions.includes("validation"))) {
    throw validationError("Preservation validation requires current scoped production validation authority.");
  }
  return { ...(operator?.ok ? { operatorLaunch: operator.authorization.id } : {}), session: lease.id, terminalExit: terminal?.exitId ?? null, settlement: terminal?.settlementId ?? null,
    candidateHead: terminal?.candidateHead ?? null, repository: lease.repository_path, worktree: lease.worktree_path, branch: lease.branch,
    base: lease.base_revision, project: lease.project_slug, action: lease.action_id, packetHash, decision,
    commands: commands as string[], actionDefinition: readiness.action, policy };
}

const CHECK_TIMEOUT_MS = 120_000;

/** Whether spawnSync stopped a check at its timeout (Node reports ETIMEDOUT and kills it). */
export function checkTimedOut(error: Error | undefined): boolean {
  return error !== undefined && "code" in error && error.code === "ETIMEDOUT";
}

/** Host-owned producer. Candidate checks execute under Seatbelt with an immutable
 * source tree, private scratch, no network and no writes to Git/workspace/source.
 * Unsupported hosts fail closed; this is not a general command execution API. */
export function validatePreservationCandidate(db: Database.Database, workspace: string, lease: AgentSession, terminalRecovery = false, operatorLaunch?: OperatorLaunchGrant) {
  const binding = preservationAuthority(db, workspace, lease, terminalRecovery, operatorLaunch);
  return validateBoundCandidate(workspace, { id: lease.id, repository: lease.repository_path, worktree: lease.worktree_path, base: lease.base_revision, commands: binding.commands }, binding, () => {
    if (JSON.stringify(preservationAuthority(db, workspace, lease, terminalRecovery, operatorLaunch)) !== JSON.stringify(binding)) throw validationError("Preservation authority changed.");
  });
}

export function validateBoundCandidate<T>(workspace: string, candidate: { id: string; repository: string; worktree: string; base: string; commands: string[] }, binding: T, assertBinding: () => void, onStage?: (stage: string) => void) {
  onStage?.("validation-authority-check");
  preservationStage("validation.binding");
  assertBinding();
  onStage?.("validation-candidate-capture");
  preservationStage("validation.snapshot");
  const tree = snapshotCandidate(candidate.worktree, candidate.base);
  // Refuse before executing anything: a check the candidate rewrote cannot judge it.
  preservationStage("validation.check-definitions");
  const checkDefinition = bindCheckDefinitions(candidate.repository, candidate.base, tree, candidate.commands);
  if (process.platform !== "darwin") throw validationError("Protected preservation validation currently requires the macOS Seatbelt host.");
  const evidenceRoot = path.join(workspace, "artifacts", "preservation", candidate.id);
  mkdirSync(evidenceRoot, { recursive: true });
  const evidenceDirectory = mkdtempSync(path.join(evidenceRoot, "check-"));
  // Checks such as the anchored Python capture helper open every ancestor of
  // their fixture path. Nesting scratch in the denied workspace prevents that
  // traversal even though scratch itself is allowed. Keep execution disposable
  // and outside the workspace; only the host writes durable evidence there.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-preservation-")));
  const source = path.join(root, "source");
  const scratch = path.join(root, "scratch");
  mkdirSync(source); mkdirSync(scratch);
  const evidenceRef = path.join(evidenceDirectory, "validation.json");
  try {
    onStage?.("seatbelt-validation");
    preservationStage("validation.materialize", { evidenceRef, executionRoot: root });
    materializeCandidateTree(candidate.worktree, tree, source);
    const quote = (s: string) => JSON.stringify(s);
    // Default read visibility matches the coding sandbox; write/process/network
    // capabilities are restricted separately. Secrets are not passed in env.
    const profile = `(version 1) (deny default) (allow file-read-metadata) (allow file-read* (subpath ${quote(source)}) (subpath ${quote(scratch)}) (require-all (require-not (subpath ${quote(realpathSync(workspace))})) (require-not (subpath ${quote(realpathSync(candidate.repository))})) (require-not (subpath ${quote(realpathSync(candidate.worktree))})))) (allow process-exec) (allow process-fork) (allow sysctl-read) (allow signal (target self)) (allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null"))`;
    // cwd, durationMs, timedOut and timeoutMs are rendered into the preserved
    // pull request's Validation evidence (validationEvidence.ts); readers of
    // earlier records treat them as optional.
    type CheckResult = { command: string; exitStatus: number | null; signal: NodeJS.Signals | null; error: string | null; stdout: string | null; stderr: string | null;
      cwd: string; durationMs: number; timedOut: boolean; timeoutMs: number };
    const results: CheckResult[] = [];
    const writeEvidence = (runningCommand?: string) => writeFileSync(evidenceRef, JSON.stringify({
      producer: "arcadia-host-seatbelt-v1", binding, tree, checkDefinition, results, sandboxProfile: profile,
      runtime: process.execPath, node: process.version, createdAt: new Date().toISOString(),
      complete: runningCommand === undefined, runningCommand
    }, null, 2), { mode: 0o600 });
    for (const command of candidate.commands) {
      writeEvidence(command);
      preservationStage("validation.check", { command, evidenceRef });
      const startedAt = performance.now();
      const run = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/sh", "-c", command], {
        cwd: source, env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch, TMPDIR: scratch, NODE_ENV: process.env.NODE_ENV ?? "" },
        encoding: "utf8", timeout: CHECK_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 1024 * 1024
      });
      const durationMs = Math.round(performance.now() - startedAt);
      results.push({ command, exitStatus: run.status, signal: run.signal, error: run.error?.message ?? null,
        stdout: run.stdout, stderr: run.stderr, cwd: source, durationMs,
        timedOut: checkTimedOut(run.error), timeoutMs: CHECK_TIMEOUT_MS });
      writeEvidence(command);
    }
    preservationStage("validation.evidence", { evidenceRef });
    writeEvidence();
    // "Skipped" means the check never produced its own exit status -- it
    // errored before running (e.g. ENOENT) or was terminated by a signal
    // (e.g. the 120s timeout's SIGKILL) -- as distinct from "failed", which
    // ran to completion and returned nonzero. Both name the offending
    // command so a caller (and a bounded retry budget keyed on this shape)
    // can tell an unrelated new failure from the same one repeating.
    const checks = results
      .filter(r => r.exitStatus !== 0 || r.error || r.signal)
      .map(r => r.error || r.signal
        ? { command: r.command, status: "skipped" as const, skipReason: r.error ?? `terminated by signal ${r.signal}` }
        : { command: r.command, status: "failed" as const, exitStatus: r.exitStatus });
    if (checks.length) throw validationError("Declared preservation validation failed or was skipped.", { evidenceRef, checks });
    onStage?.("seatbelt-checks-passed");
    onStage?.("post-validation-authority-recheck");
    preservationStage("validation.recheck-binding", { evidenceRef });
    assertBinding();
    onStage?.("post-validation-candidate-recapture");
    preservationStage("validation.recheck-snapshot", { evidenceRef });
    if (snapshotCandidate(candidate.worktree, candidate.base) !== tree) throw validationError("Candidate changed during validation; passing evidence cannot authorize altered content.", { evidenceRef });
    return { passed: true, evidenceRef, candidateFingerprint: tree, checkDefinition, binding };
  } catch (error) {
    throw preservationStageFailure(error);
  } finally {
    // Retain proof, remove only the producer's own disposable execution paths.
    preservationStage("validation.cleanup", { evidenceRef });
    rmSync(root, { recursive: true, force: true });
  }
}
