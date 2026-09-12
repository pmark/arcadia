import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { getProjectMetadata } from "../db/repositories.js";
import { resolveActionReadiness } from "../docs/dispatch.js";
import { readProductionPolicy } from "../production/policy.js";
import { findPromotionDecision, type AgentSession } from "./index.js";
import { materializeCandidateTree, snapshotCandidate } from "./candidateSnapshot.js";

export function preservationAuthority(db: Database.Database, workspace: string, lease: AgentSession) {
  const current = db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(lease.id) as AgentSession | undefined;
  const fields = ["project_id", "project_slug", "repository_path", "worktree_path", "branch", "base_revision", "action_id", "plan_slug", "packet_id", "packet_path", "packet_sha256", "authorizing_decisions_json"] as const;
  if (!current || !["prepared", "running"].includes(current.status) || fields.some(field => current[field] !== lease[field])) {
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
  const frozen = [...packet.matchAll(/^- Run validation command: (.+)$/gm)].map(m => m[1]);
  if (JSON.stringify(frozen) !== JSON.stringify(commands)) throw validationError("Validation check definitions differ from the authorized immutable packet; prepare and authorize a fresh packet.");
  const policy = readProductionPolicy(db);
  const scope = policy.scope;
  if (policy.desiredState !== "active" || !policy.authority || !scope?.projects.includes(lease.project_slug) ||
      !scope.plans.includes(`${lease.project_slug}/${lease.plan_slug}`) || !scope.actions.includes(`${lease.project_slug}/${lease.action_id}`) ||
      !scope.mechanicalTransitions.includes("validation")) {
    throw validationError("Preservation validation requires current scoped production validation authority.");
  }
  return { session: lease.id, repository: lease.repository_path, worktree: lease.worktree_path, branch: lease.branch,
    base: lease.base_revision, project: lease.project_slug, action: lease.action_id, packetHash, decision,
    commands: commands as string[], actionDefinition: readiness.action, policy };
}

/** Host-owned producer. Candidate checks execute under Seatbelt with an immutable
 * source tree, private scratch, no network and no writes to Git/workspace/source.
 * Unsupported hosts fail closed; this is not a general command execution API. */
export function validatePreservationCandidate(db: Database.Database, workspace: string, lease: AgentSession) {
  const binding = preservationAuthority(db, workspace, lease);
  const tree = snapshotCandidate(lease.worktree_path);
  if (process.platform !== "darwin") throw validationError("Protected preservation validation currently requires the macOS Seatbelt host.");
  const evidenceRoot = path.join(workspace, "artifacts", "preservation", lease.id);
  mkdirSync(evidenceRoot, { recursive: true });
  const root = realpathSync(mkdtempSync(path.join(evidenceRoot, "check-")));
  const source = path.join(root, "source");
  const scratch = path.join(root, "scratch");
  mkdirSync(source); mkdirSync(scratch);
  const evidenceRef = path.join(root, "validation.json");
  try {
    materializeCandidateTree(lease.worktree_path, tree, source);
    const quote = (s: string) => JSON.stringify(s);
    // Default read visibility matches the coding sandbox; write/process/network
    // capabilities are restricted separately. Secrets are not passed in env.
    const profile = `(version 1) (deny default) (allow file-read-metadata) (allow file-read* (subpath ${quote(source)}) (subpath ${quote(scratch)}) (require-all (require-not (subpath ${quote(realpathSync(workspace))})) (require-not (subpath ${quote(realpathSync(lease.repository_path))})) (require-not (subpath ${quote(realpathSync(lease.worktree_path))})))) (allow process-exec) (allow process-fork) (allow sysctl-read) (allow signal (target self)) (allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null"))`;
    const results = binding.commands.map(command => {
      const run = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/sh", "-c", command], {
        cwd: source, env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: scratch, TMPDIR: scratch },
        encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024
      });
      return { command, exitStatus: run.status, signal: run.signal, error: run.error?.message ?? null,
        stdout: run.stdout, stderr: run.stderr };
    });
    const evidence = { producer: "arcadia-host-seatbelt-v1", binding, tree, results, sandboxProfile: profile, runtime: process.execPath, node: process.version, createdAt: new Date().toISOString() };
    writeFileSync(evidenceRef, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    if (results.some(r => r.exitStatus !== 0 || r.error || r.signal)) throw validationError("Declared preservation validation failed or was skipped.", { evidenceRef });
    if (JSON.stringify(preservationAuthority(db, workspace, lease)) !== JSON.stringify(binding)) throw validationError("Preservation authority changed during validation.", { evidenceRef });
    if (snapshotCandidate(lease.worktree_path) !== tree) throw validationError("Candidate changed during validation; passing evidence cannot authorize altered content.", { evidenceRef });
    return { passed: true, evidenceRef, candidateFingerprint: tree, binding };
  } finally {
    // Retain proof, remove only the producer's own disposable execution paths.
    rmSync(source, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true });
  }
}
