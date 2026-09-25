import type Database from "better-sqlite3";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { withDatabase } from "../db/connection.js";
import {
  existingDirectory,
  git,
  parseWorktrees,
  resolveBaseBranch,
  samePath
} from "../git/worktrees.js";
import { assertManualPreservationBinding, bindManualPreservation, manualBindingFingerprint } from "../sessions/manualPreservation.js";
import { resolveDispatch } from "../docs/dispatch.js";
import { preservationAuthority, validateBoundCandidate, validatePreservationCandidate } from "../sessions/preservationValidation.js";
import { guardPreservationRefusal } from "../sessions/preservationRefusalBudget.js";
import { readProductionPolicy } from "../production/policy.js";
import { getRepositoryLease } from "../sessions/index.js";
import {
  preserveCandidate,
  systemPreservationRemote,
  type CandidatePreservationDeps,
  type CandidatePreservationReceipt,
  type RemotePreservationAuthorization
} from "../sessions/candidatePreservation.js";

export interface PreserveCommandData {
  receipt: CandidatePreservationReceipt;
}

export interface PreserveCommandOptions {
  /** The completed candidate worktree the launcher was run from. */
  source: string;
  workspace: string;
  db?: Database.Database;
  deps?: CandidatePreservationDeps;
  now?: Date;
}

/**
 * Preserve the completed candidate worktree the caller is standing in, deriving
 * every binding from the repository, its Session lease, and the standing
 * production policy — never from a public argument. This runs on the host
 * controller, outside the coding-agent sandbox, which is the whole point: the
 * agent never needs write access to shared Git metadata.
 */
export function runPreserveCommand(options: PreserveCommandOptions): CommandSuccess<PreserveCommandData> {
  const source = existingDirectory(options.source, "candidate worktree");
  const worktrees = parseWorktrees(git(source, ["worktree", "list", "--porcelain"]));
  const controlWorktree = worktrees[0].path;
  const record = worktrees.find((candidate) => samePath(candidate.path, source));
  if (!record) {
    throw validationError("The candidate path is not a registered worktree for this repository.", { source });
  }
  if (!record.branch) {
    throw validationError("Arcadia will not preserve a detached candidate worktree.", { source });
  }
  const branch = record.branch.replace(/^refs\/heads\//, "");
  const baseBranch = resolveBaseBranch(controlWorktree);

  const preserve = (db: Database.Database) => {
    const lease = getRepositoryLease(db, controlWorktree);
    if (!lease) {
      const projectSlug = resolveDispatch(controlWorktree).context?.projectSlug;
      if (!projectSlug) throw validationError("Manual preservation cannot resolve its Project.");
      const binding = bindManualPreservation(db, { repository: controlWorktree, worktree: source, baseBranch, projectSlug });
      const assertBinding = () => assertManualPreservationBinding(db, binding);
      // No managed Session exists for a manual handoff (Decision: `arcadia go`'s
      // manual path never creates an agent_sessions row), so an exhausted
      // budget here has nothing to reconcile -- the augmented refusal message
      // is the whole remedy: stop retrying and get the operator or a fresh
      // repair attempt.
      const validation = guardPreservationRefusal(db, binding.reservationId, options.now ?? new Date(), () =>
        validateBoundCandidate(options.workspace, {
          id: binding.reservationId, repository: controlWorktree, worktree: source, base: binding.baseRevision, commands: binding.commands
        }, binding, assertBinding));
      return preserveCandidate(db, {
        requestId: `preserve:${binding.reservationId}`, repositoryPath: controlWorktree,
        candidateWorktreePath: source, branch, baseBranch, baseRevision: binding.baseRevision,
        actionId: binding.actionId, packetSha256: manualBindingFingerprint(binding),
        authorityKind: "manual_handoff", policyEpoch: 0, policyRevision: 0, validation,
        remotePreservation: { authorized: false, reason: "Manual Go authorizes local candidate preservation only; remote preservation requires separate authority." },
        now: options.now
      }, { ...options.deps, hooks: { ...options.deps?.hooks, beforeCommit: () => {
        options.deps?.hooks?.beforeCommit?.(); assertBinding();
      } } });
    }
    if (!samePath(lease.worktree_path, source)) {
      throw validationError("The repository's Session lease is for a different worktree.", {
        leaseWorktree: lease.worktree_path,
        candidateWorktree: source
      });
    }

    const policy = readProductionPolicy(db);
    const actionKey = `${lease.project_slug}/${lease.action_id}`;
    const remotePreservation: RemotePreservationAuthorization =
      policy.desiredState === "active" &&
      policy.scope?.remotePreservation === true &&
      policy.scope.actions.includes(actionKey)
        ? {
            authorized: true,
            qaPlan: buildQaPlan({ actionId: lease.action_id, branch, baseBranch })
          }
        : {
            authorized: false,
            reason:
              policy.desiredState !== "active"
                ? "production policy is not Active"
                : policy.scope?.remotePreservation === true
                  ? "this Action is outside the Active policy's remote-preservation scope"
                  : "the Active policy does not include remote preservation"
          };

    // This CLI call can run while the Session's own agent process is still
    // alive (it is exactly what a live agent invokes to preserve its own
    // candidate), so exhausting the budget here must never reconcile the
    // Session itself -- that would terminate a `running` lease out from
    // under a worker that has not actually died, letting a competing launch
    // treat the repository as unleased. Only record the refusal (shared with
    // the tick's own budget, keyed on the same Session id) and refuse; the
    // managed-production tick reconciles the Session as a non-resumable
    // incomplete exit itself, only once it has independently confirmed the
    // worker's tmux session is actually dead (see `preserveSessionCandidate`
    // in sessionHandoff.ts).
    const validation = guardPreservationRefusal(db, lease.id, options.now ?? new Date(), () =>
      validatePreservationCandidate(db, options.workspace, lease));
    const current = preservationAuthority(db, options.workspace, lease);
    if (JSON.stringify(current) !== JSON.stringify(validation.binding) || JSON.stringify(policy) !== JSON.stringify(current.policy)) {
      throw validationError("Preservation authority changed after validation.");
    }

    return preserveCandidate(
      db,
      {
        requestId: `preserve:${lease.id}`,
        repositoryPath: controlWorktree,
        candidateWorktreePath: source,
        branch,
        baseBranch,
        baseRevision: lease.base_revision,
        actionId: lease.action_id,
        packetSha256: lease.packet_sha256,
        policyEpoch: policy.epoch,
        policyRevision: policy.revision,
        validation,
        remotePreservation,
        now: options.now
      },
      { ...options.deps, remote: options.deps?.remote ?? systemPreservationRemote, hooks: {
        ...options.deps?.hooks,
        beforeCommit: () => {
          options.deps?.hooks?.beforeCommit?.();
          if (JSON.stringify(preservationAuthority(db, options.workspace, lease)) !== JSON.stringify(validation.binding)) {
            throw validationError("Preservation authority changed before commit.");
          }
        }
      } }
    );
  };
  const receipt = options.db ? preserve(options.db) : withDatabase(options.workspace, preserve);

  return createSuccess({ command: "preserve", data: { receipt } });
}

function buildQaPlan(input: { actionId: string; branch: string; baseBranch: string }): string {
  return [
    `## QA plan for candidate ${input.actionId}`,
    "",
    `This draft PR preserves branch \`${input.branch}\` against \`${input.baseBranch}\`.`,
    "",
    "- Surface: this repository's test and build commands run from the candidate worktree.",
    "- Reachability: local/host only until reviewed; no service is implied as running.",
    "- Expected change: the acceptance criteria of the named Action.",
    "",
    "1. Check out the branch. Expected: the candidate content is present.",
    "2. Run the repository's tests. Expected: they pass at the preserved revision.",
    "",
    "Merge, deployment, and publication remain separate operator gates."
  ].join("\n");
}

export function renderPreserveSuccess(response: CommandSuccess<PreserveCommandData>): string[] {
  const r = response.data.receipt;
  const lines = [
    `Preserved candidate for action ${r.actionId}`,
    `Branch: ${r.branch} — commit ${r.commitSha.slice(0, 12)}`,
    `State: ${r.preservationState}${r.replayed ? " (replayed — no duplicate commit)" : ""}`
  ];
  if (r.preservationState === "IN PR") {
    lines.push(`Pull request: ${r.pullRequestUrl ?? `#${r.pullRequestNumber}`}`);
  } else if (r.retryAction) {
    lines.push(`Next: ${r.retryAction}`);
  }
  return lines;
}
