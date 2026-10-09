import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { observeProviderCapacity, type ProviderCapacityObservation } from "../codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import type { ProviderSignInStatus } from "../codingAgents/signIn.js";
import { renderNextSuccess, runNextReadOnlyCommand } from "../commands/next.js";
import { runGoCommand, type GoCommandData, type GoCommandOptions } from "../commands/go.js";
import { withDatabase } from "../db/connection.js";
import { discoverDocs } from "../docs/discover.js";
import { runGoBroker, type GoBrokerAgent } from "../goBroker.js";
import { loadPhase3Registries, type CodingAgentProfile } from "../intent/registries.js";
import { listAdmissions, readProductionPolicySafely, type AdmissionReceipt } from "../production/policy.js";
import { loadWorkspaceConfig, unmeteredProviderSelector } from "../workspace/config.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { requireResolvedWorkspace } from "../workspace/resolve.js";
import {
  enrollGovernedSession,
  type EnrollmentAdmission,
  type EnrollmentClaim,
  type EnrollmentEffect,
  type EnrollmentMode,
  type EnrollmentPending,
  type EnrollmentReceipt,
  type EnrollmentRequest,
  type GovernedEnrollmentContext,
  type NativeRuntimeAdapter
} from "./enrollment.js";
import { canonicalPath, getActiveActionClaim, getRepositoryLease, sessionAgentForProvider, type AgentSession, type AgentWorktreeReservation, type TmuxAdapter } from "./index.js";
import { launchGuardedHostSession, type GuardedLaunchInput } from "./launch.js";
import { buildLaunchPreview, type LaunchPreview } from "./launchPreview.js";
import { requirementIdentity } from "./roleLineage.js";
import { readProjectPartners, renderDispatchIdentityBlock } from "./partners.js";
import { TIER_AGENTS, describeSessionStart, loadModelTierRegistry, sessionStartBinding, type TierAgent } from "../codingAgents/modelTiers.js";

export interface HostEnrollmentInput {
  source: string;
  agent: GoBrokerAgent;
  requestId: string;
  callerId: string;
  mode: EnrollmentMode;
  /** Test seams. Production derives every one of these on the host. */
  workspace?: string;
  registries?: { profiles: CodingAgentProfile[]; adapters: ProviderAdapterRegistry | null };
  runGo?: (options: GoCommandOptions) => CommandSuccess<GoCommandData>;
  agentWorktreeRoot?: string;
  tmux?: TmuxAdapter;
  capacityObservation?: ProviderCapacityObservation;
  providerSignIn?: (provider: string, workspace: string) => ProviderSignInStatus | null;
  /** Test-only fault injection forwarded to the guarded launcher. */
  launchTestHooks?: GuardedLaunchInput["testHooks"];
  /** Host-registered native supervision adapters. Production registers none. */
  nativeAdapters?: Partial<Record<GoBrokerAgent, NativeRuntimeAdapter>>;
  now?: () => Date;
  pendingLeaseMs?: number;
}

function claimView(claim: AgentWorktreeReservation | null): EnrollmentClaim | null {
  return claim ? { id: claim.id, worktree: claim.worktree_path, generation: claim.claim_generation ?? null } : null;
}

function admissionView(receipt: AdmissionReceipt | null | undefined): EnrollmentAdmission | null {
  return receipt ? { id: receipt.id, requestId: receipt.requestId, epoch: receipt.epoch, status: receipt.status } : null;
}

function loadRegistries(workspace: string): { profiles: CodingAgentProfile[]; adapters: ProviderAdapterRegistry | null } | null {
  try {
    const registries = loadPhase3Registries(workspace);
    return { profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters ?? null };
  } catch {
    return null;
  }
}

/**
 * Canonical fixed host enrollment used by the protected transport. The request
 * carries only its semantic identity, mode and the launcher-fixed provider; the
 * workspace, Project, Plan, Action, brief, gates, packet, execution binding,
 * policy epoch, capacity and claim are all derived here. Preparation runs the
 * ordinary strict `arcadia go`; a managed launch runs the ordinary
 * `launchGuardedHostSession` under the standing policy, so issueAdmission,
 * commitAdmission, the Off recheck and claim fencing stay authoritative.
 */
export function executeHostEnrollment(input: HostEnrollmentInput): EnrollmentReceipt {
  if (process.env.CODEX_SANDBOX) throw validationError("Enrollment must run on the host.");
  const { source, agent, requestId, callerId, mode } = input;
  const workspace = input.workspace ?? requireResolvedWorkspace({ cwd: source });
  const project = discoverDocs(source).docs.find(doc => doc.type === "project");
  if (!project || project.type !== "project") throw validationError("Enrollment source has no managed Project document.");
  const next = runNextReadOnlyCommand({ workspace, project: project.slug });
  const repoRoot = next.data.repoRoot;
  // An unleased helper enrolls from the Project's repository root. A leased
  // worktree already has its one principal, and running `go` from it would
  // finish that candidate instead of preparing a governed one.
  if (canonicalPath(source) !== canonicalPath(repoRoot)) {
    throw validationError("Enrollment must be requested from the configured Project repository root.", {
      code: "enrollment_source_not_repository", source, repoRoot,
      remedy: "Run the fixed enroll launcher from the Project repository root; a prepared or leased worktree already has its principal."
    });
  }
  const dispatch = next.data.context;
  if (!next.data.dispatchable || !dispatch) {
    throw validationError("The configured Project has no dispatchable Action to enroll.", {
      code: "enrollment_not_dispatchable", blockers: next.data.blockers
    });
  }
  // The same requirement identity the guarded launcher's development attempt
  // and every verdict bind, so a receipt and its attempt lineage always agree.
  const { requirementId, inputRevision } = requirementIdentity({ projectSlug: dispatch.projectSlug, planSlug: dispatch.activePlan, action: dispatch.action });

  const request: EnrollmentRequest = {
    requestId,
    source: canonicalPath(source),
    agent,
    callerId,
    mode,
    projectSlug: dispatch.projectSlug,
    planSlug: dispatch.activePlan,
    actionId: dispatch.action.id,
    requirementId,
    inputRevision,
    ...(mode === "native-adopt" ? { nativeRuntimeId: callerId } : {})
  };
  const now = input.now ?? (() => new Date());

  return withDatabase(workspace, db => {
    const registries = input.registries ?? loadRegistries(workspace);
    let preview: LaunchPreview | null = null;
    let capacityObservation: ProviderCapacityObservation | null = null;
    const currentClaim = () => getActiveActionClaim(db, repoRoot, dispatch.projectSlug, dispatch.action.id, now());
    const ownAdmission = `${requestId}:admission`;
    /** The claim id `go` recorded on this request's row atomically with the claim, if any. */
    const recordedClaimId = () => (db.prepare("SELECT effect_claim_id FROM session_enrollments WHERE request_id = ?")
      .get(requestId) as { effect_claim_id: string | null } | undefined)?.effect_claim_id ?? null;

    const resolve = (): GovernedEnrollmentContext => {
      const policy = readProductionPolicySafely(db);
      preview = registries?.adapters ? buildLaunchPreview({
        db, workspace, repoRoot, projectSlug: dispatch.projectSlug, requestId,
        profiles: registries.profiles, adapters: registries.adapters, tmux: input.tmux, now: now()
      }) : null;
      const selection = preview?.selection ?? null;
      let capacityAvailable = true;
      if (mode === "managed-launch") {
        if (!registries?.adapters) {
          throw validationError("Managed enrollment requires the configured provider-adapters registry.", { code: "provider_adapters_unconfigured" });
        }
        if (selection) {
          const config = loadWorkspaceConfig(getWorkspacePaths(workspace).configFile).codingAgent;
          capacityObservation = input.capacityObservation ??
            observeProviderCapacity(registries.profiles, { now: now(), unmeteredProvider: unmeteredProviderSelector(config) });
          capacityAvailable = capacityObservation.providers.find(entry => entry.providerId === selection.provider)?.admitted === true;
        } else {
          capacityAvailable = false;
        }
      }
      // Smallest model first: the launched Session starts on the start-tier
      // model for its provider; the packet-bound selection is its escalation target.
      const tierRegistry = (() => { try { return loadModelTierRegistry(workspace); } catch { return undefined; } })();
      const selectedAgent = selection ? sessionAgentForProvider(selection.provider) : null;
      const tierAgent = selectedAgent && (TIER_AGENTS as readonly string[]).includes(selectedAgent) ? (selectedAgent as TierAgent) : null;
      const startBinding = tierAgent ? sessionStartBinding(tierAgent, tierRegistry) : null;
      const startNote = selection && tierAgent ? describeSessionStart(tierAgent, selection.model, tierRegistry) : null;
      return {
        projectSlug: dispatch.projectSlug,
        planSlug: dispatch.activePlan,
        actionId: dispatch.action.id,
        // The dispatch brief, then the enrolling agent's Identity block for the
        // model the launched Session starts on (or the Plan's recommendation).
        canonicalBrief: [...renderNextSuccess(next), "", ...(startNote ? [startNote, ""] : []), ...renderDispatchIdentityBlock({
          agent: selectedAgent ?? agent,
          model: startBinding?.model ?? selection?.model ?? null,
          effort: startBinding ? startBinding.effort : (selection?.effort ?? null),
          recommendedModel: dispatch.planRecommendedModel ?? null,
          recommendedEffort: dispatch.planRecommendedReasoningEffort ?? null,
          registry: tierRegistry,
          partners: readProjectPartners(db, { projectSlug: dispatch.projectSlug, excludeWorktree: source })
        })].join("\n"),
        operatorGates: next.data.operatorAlerts.map(item => `${item.kind}:${item.id}`),
        packet: preview?.packet ? { invocationId: preview.packet.invocationId, sha256: preview.packet.sha256 } : null,
        provider: selection?.provider ?? agent,
        model: selection?.model ?? dispatch.planRecommendedModel ?? null,
        effort: selection?.effort ?? dispatch.planRecommendedReasoningEffort ?? null,
        policyState: policy.status === "ok" && policy.policy.desiredState === "active" ? "active" : "off",
        policyEpoch: policy.status === "ok" ? policy.policy.epoch : 0,
        packetApproved: preview?.packet != null && preview.packetLifecycle?.kind === "build_packet_ready",
        capacityAvailable,
        // Only what this request positively owns is excluded: the claim `go`
        // recorded on its own row, or the lease bound to its own admission
        // (and that lease's claim). Everything else is another owner's.
        ...(() => {
          const lease = getRepositoryLease(db, repoRoot);
          const ownLease = lease?.admission_request_id === ownAdmission ? lease : null;
          const claim = currentClaim();
          const ownClaim = claim && (claim.id === recordedClaimId() ||
            (ownLease !== null && canonicalPath(claim.worktree_path) === canonicalPath(ownLease.worktree_path)));
          return {
            existingClaim: claim && !ownClaim ? claimView(claim) : null,
            existingSession: lease && !ownLease ? { id: lease.id, worktree: lease.worktree_path, actionId: lease.action_id } : null
          };
        })()
      };
    };

    const prepare = (): EnrollmentEffect => {
      const runner = input.runGo ?? runGoCommand;
      const response = runGoBroker(
        { source: request.source, agent, operation: "go" },
        options => runner({
          ...options,
          workspace,
          strictAction: true,
          enrollment: { requestId, actionId: dispatch.action.id },
          ...(input.agentWorktreeRoot ? { agentWorktreeRoot: input.agentWorktreeRoot } : {})
        })
      );
      const data = response.data as { nextWorktree?: { path: string } | null };
      if (!data.nextWorktree) throw validationError("Protected enrollment did not produce a candidate.", { code: "enrollment_no_candidate" });
      const claim = currentClaim();
      if (!claim || canonicalPath(claim.worktree_path) !== canonicalPath(data.nextWorktree.path)) {
        throw validationError("Protected enrollment could not verify the candidate's fenced Action claim.", { code: "enrollment_claim_unverified" });
      }
      return { id: claim.id, worktree: claim.worktree_path, claim: claimView(claim), admission: null };
    };

    const sessionEffect = (session: AgentSession, admission: AdmissionReceipt | null | undefined): EnrollmentEffect => ({
      id: session.id, worktree: session.worktree_path, claim: claimView(currentClaim()), admission: admissionView(admission)
    });

    const launch = ({ context }: { context: GovernedEnrollmentContext }): EnrollmentEffect => {
      const result = launchGuardedHostSession({
        db, workspace, repoRoot, projectSlug: dispatch.projectSlug, requestId,
        standingPolicy: true,
        expectedPolicyEpoch: context.policyEpoch,
        reuseOwnLeaseOnly: true,
        profiles: registries!.profiles,
        adapters: registries!.adapters!,
        ...(capacityObservation ? { capacityObservation } : {}),
        ...(input.tmux ? { tmux: input.tmux } : {}),
        ...(input.agentWorktreeRoot ? { agentWorktreeRoot: input.agentWorktreeRoot } : {}),
        ...(input.providerSignIn ? { providerSignIn: input.providerSignIn } : {}),
        ...(input.launchTestHooks ? { testHooks: input.launchTestHooks } : {}),
        now: now()
      });
      if (result.session.action_id !== context.actionId) {
        throw validationError("The guarded launch reconciled onto a different Action.", { code: "enrollment_launch_identity_changed" });
      }
      return sessionEffect(result.session, result.admission ?? findAdmission(db, ownAdmission));
    };

    /** Positive evidence only: never a claim or Session another caller created. */
    const recover = ({ pending }: { pending: EnrollmentPending }): EnrollmentEffect | null => {
      // The row being recovered may be another request's (a stale blocker),
      // so its own mode and request id decide the evidence, not this caller's.
      if (pending.mode === "prepare") {
        // `go` recorded this claim's id and generation on our own pending row
        // inside the claim's transaction; adopt exactly that live claim.
        if (!pending.effectClaimId) return null;
        const claim = currentClaim();
        return claim && claim.id === pending.effectClaimId && claim.claim_generation === pending.effectClaimGeneration
          ? { id: claim.id, worktree: claim.worktree_path, claim: claimView(claim), admission: null }
          : null;
      }
      if (pending.mode === "managed-launch") {
        const rowAdmission = `${pending.requestId}:admission`;
        // Only a started Session bound to that request's own admission. A
        // prepared-but-unstarted own lease is resumed by the guarded launcher
        // (with its epoch check) on the takeover path instead.
        const session = db.prepare(`SELECT * FROM agent_sessions WHERE admission_request_id = ?
          AND status = 'running' ORDER BY prepared_at DESC LIMIT 1`).get(rowAdmission) as AgentSession | undefined;
        return session ? sessionEffect(session, findAdmission(db, rowAdmission)) : null;
      }
      return null;
    };

    return enrollGovernedSession(db, request, {
      resolve,
      prepare,
      launch,
      recover,
      nativeAdapter: input.nativeAdapters?.[agent] ?? null,
      now,
      ...(input.pendingLeaseMs !== undefined ? { pendingLeaseMs: input.pendingLeaseMs } : {})
    });
  });
}

function findAdmission(db: Database.Database, requestId: string): AdmissionReceipt | null {
  return listAdmissions(db).find(row => row.requestId === requestId) ?? null;
}
