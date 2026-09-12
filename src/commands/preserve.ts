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
import { preservationAuthority, validatePreservationCandidate } from "../sessions/preservationValidation.js";
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
      throw validationError("No prepared or running Session lease names this repository; nothing to preserve.", {
        repository: controlWorktree,
        remedy: "Preserve within the Session that produced this candidate."
      });
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

    const validation = validatePreservationCandidate(db, options.workspace, lease);
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
