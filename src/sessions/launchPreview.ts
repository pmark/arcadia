import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getProjectBySlug, getWorkItemByDocRef, listCodexInvocationsForWorkItem } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";
import { buildAgentQueue } from "../dispatch/queue.js";
import { observeCodingAgentAvailability } from "../codingAgents/availability.js";
import {
  selectCompliantCodingAgent,
  ExecutionProfileUnsatisfiedError,
  type ProviderAdapterRegistry,
  type SelectedCodingAgentConfiguration
} from "../codingAgents/providerAdapters.js";
import { parseExecutionRequirement } from "../execution/profiles.js";
import { packetSha256 } from "../execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { resolveProjectTransition, type TmuxAdapter } from "./index.js";

/**
 * Providers the canonical Session subsystem can actually spawn today. Mirrors
 * the hardcoded check in prepareSession (sessions/index.ts) — kept as an
 * explicit, named table here so this preview's "launch-adapter availability"
 * filter and prepareSession's launch-time refusal can never silently drift
 * apart from being the same fact stated twice with different wording.
 */
export const LAUNCH_ADAPTER_SUPPORT: Record<string, boolean> = {
  "claude-code-cli": true
};

export interface LaunchPreviewPacket {
  invocationId: string;
  path: string;
  sha256: string;
}

export interface LaunchPreview {
  requestId: string;
  previewFingerprint: string;
  projectSlug: string;
  projectName: string | null;
  planPath: string | null;
  planSlug: string | null;
  actionId: string | null;
  actionDocRef: string | null;
  queueRevision: number;
  documentRevisions: { projectSha256: string | null; planSha256: string | null };
  repoRoot: string;
  baseRevision: string | null;
  packet: LaunchPreviewPacket | null;
  authorizingDecisions: string[];
  selection: SelectedCodingAgentConfiguration | null;
  selectionRationale: string | null;
  prerequisites: string[];
  ready: boolean;
  createdAt: string;
}

export function buildLaunchPreview(input: {
  db: Database.Database;
  workspace: string;
  repoRoot: string;
  projectSlug: string;
  requestId: string;
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  tmux?: Pick<TmuxAdapter, "hasSession">;
  now?: Date;
}): LaunchPreview {
  const prerequisites: string[] = [];
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.now ?? new Date();

  const transition = resolveProjectTransition({ repoRoot, projectSlug: input.projectSlug, db: input.db, tmux: input.tmux });
  if (transition.kind === "wait" || transition.kind === "reconcile") {
    prerequisites.push(`conflicting execution: ${transition.reason}`);
  } else if (transition.kind !== "launch") {
    prerequisites.push(`Action is not dispatchable for launch: ${transition.reason}`);
  }

  const context = transition.dispatch.context;
  const actionId = context?.action.id ?? null;
  const actionDocRef = context ? `plan/${context.activePlan}#${context.action.id}` : null;
  const queueRevision = buildAgentQueue(input.db).revision;
  const baseRevision = resolveHead(repoRoot);
  const documentRevisions = resolveDocumentRevisions(repoRoot, input.projectSlug, context?.activePlan ?? null);

  let packet: LaunchPreviewPacket | null = null;
  let selection: SelectedCodingAgentConfiguration | null = null;
  let selectionRationale: string | null = null;
  let authorizingDecisions: string[] = [];

  if (context) {
    const project = getProjectBySlug(input.db, context.projectSlug);
    const workItem = project ? getWorkItemByDocRef(input.db, actionDocRef!) : null;
    if (!project || !workItem || workItem.project_id !== project.id) {
      prerequisites.push("stale pointer: the workspace is stale relative to the authoritative Action; run arcadia docs sync --apply.");
    } else {
      const launchRefusals = launchAdapterRefusals(input.adapters);

      if (workItem.execution_requirement_json) {
        try {
          const raw = JSON.parse(workItem.execution_requirement_json);
          const parsed = parseExecutionRequirement(raw, workItem.work_classification);
          if (!parsed.resolved) {
            prerequisites.push(
              `Action has an invalid execution requirement: ${parsed.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`
            );
          } else {
            selection = selectCompliantCodingAgent({
              profiles: input.profiles,
              adapters: input.adapters,
              requirement: parsed.resolved,
              phase: "implementation",
              purpose: "build",
              availability: observeCodingAgentAvailability(input.profiles),
              capacityRefusals: launchRefusals
            });
            selectionRationale =
              `Selected ${selection.provider}/${selection.model} (capability ${selection.capability}, effort ${selection.effort}) ` +
              `via binding ${selection.mappingId}/${selection.bindingId}: the lowest-cost configured binding that meets the ` +
              "Action's required capability, effort, tools, context scope and data locality, has a supported launch adapter, " +
              "and reports availability — chosen automatically, with no operator provider choice.";
          }
        } catch (error) {
          if (error instanceof ExecutionProfileUnsatisfiedError) {
            prerequisites.push(`unavailable provider: ${error.message}`);
          } else {
            prerequisites.push(`Action has an invalid execution requirement: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      const invocation = listCodexInvocationsForWorkItem(input.db, workItem.id)
        .filter((candidate) => candidate.purpose === "build" && candidate.status === "packet_created")
        .at(-1);
      if (!invocation) {
        prerequisites.push("missing packet: the Action has no prepared immutable build packet.");
      } else {
        const absolutePacket = path.join(input.workspace, invocation.prompt_path);
        if (!existsSync(absolutePacket)) {
          prerequisites.push("missing packet: the prepared build packet file is missing.");
        } else {
          const metadataPath = path.join(path.dirname(absolutePacket), "metadata.json");
          if (!existsSync(metadataPath)) {
            prerequisites.push("missing packet: the prepared build packet metadata is missing.");
          } else {
            const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as any;
            if (metadata.invocationId !== invocation.id || metadata.workItemId !== workItem.id || metadata.promptPath !== invocation.prompt_path) {
              prerequisites.push("stale pointer: the prepared build packet metadata is stale or belongs to another Action.");
            } else {
              const hash = packetSha256(absolutePacket);
              packet = { invocationId: invocation.id, path: invocation.prompt_path, sha256: hash };
              const stored = metadata.providerSelection as SelectedCodingAgentConfiguration | null | undefined;
              if (!stored) {
                prerequisites.push("missing packet: the prepared build packet has no recorded provider selection.");
              } else if (launchRefusals[stored.provider]) {
                prerequisites.push(`unavailable provider: ${launchRefusals[stored.provider]}`);
              } else if (
                selection &&
                (selection.provider !== stored.provider ||
                  selection.model !== stored.model ||
                  selection.mappingId !== stored.mappingId ||
                  selection.bindingId !== stored.bindingId)
              ) {
                prerequisites.push(
                  "stale pointer: the current configuration would select a different provider binding than the one bound in " +
                    "the immutable packet; prepare a new packet rather than silently changing its provider."
                );
              } else if (!selection) {
                // No live execution-requirement selection was possible (e.g. no
                // requirement recorded); trust the packet's own immutable binding
                // rather than leaving selection empty.
                selection = {
                  mappingId: stored.mappingId,
                  bindingId: stored.bindingId,
                  provider: stored.provider,
                  model: stored.model,
                  capability: stored.capability,
                  effort: stored.effort,
                  args: [],
                  costRank: 0,
                  profile: undefined as unknown as CodingAgentProfile
                };
                selectionRationale = `Selection reused verbatim from the immutable build packet ${invocation.id} (no re-selection performed).`;
              }

              const promotion = findPromotionDecisionOrProblem(input.db, {
                projectId: project.id,
                invocationId: invocation.id,
                actionId: context.action.id,
                actionDocRef: actionDocRef!,
                repoRoot,
                packetPath: invocation.prompt_path,
                packetSha256: hash,
                providerProfile: invocation.agent_profile
              });
              if (promotion.problem) prerequisites.push(promotion.problem);
              authorizingDecisions = context.requiredDecisions
                .filter((decision) => decision.resolved)
                .map((decision) => decision.id)
                .concat(promotion.decisionId ? [promotion.decisionId] : [])
                .sort();
            }
          }
        }
      }
    }
  }

  const previewFingerprint = sha256(
    JSON.stringify({
      requestId: input.requestId,
      projectSlug: input.projectSlug,
      actionDocRef,
      queueRevision,
      documentRevisions,
      baseRevision,
      packet,
      selection,
      prerequisites
    })
  );

  return {
    requestId: input.requestId,
    previewFingerprint,
    projectSlug: input.projectSlug,
    projectName: context?.projectName ?? null,
    planPath: context?.planPath ?? null,
    planSlug: context?.activePlan ?? null,
    actionId,
    actionDocRef,
    queueRevision,
    documentRevisions,
    repoRoot,
    baseRevision,
    packet,
    authorizingDecisions,
    selection,
    selectionRationale,
    prerequisites,
    ready: prerequisites.length === 0,
    createdAt: now.toISOString()
  };
}

function launchAdapterRefusals(adapters: ProviderAdapterRegistry): Record<string, string> {
  const refusals: Record<string, string> = {};
  for (const provider of adapters.providers) {
    if (!LAUNCH_ADAPTER_SUPPORT[provider.id]) {
      refusals[provider.id] = `provider ${provider.id} has no supported Session launch adapter yet`;
    }
  }
  return refusals;
}

function findPromotionDecisionOrProblem(
  db: Database.Database,
  expected: {
    projectId: string;
    invocationId: string;
    actionId: string;
    actionDocRef: string;
    repoRoot: string;
    packetPath: string;
    packetSha256: string;
    providerProfile: string;
  }
): { decisionId: string | null; problem: string | null } {
  const rows = db
    .prepare("SELECT id, status, context_json FROM review_items WHERE project_id = ? ORDER BY created_at DESC")
    .all(expected.projectId) as Array<{ id: string; status: string; context_json: string }>;
  for (const row of rows) {
    let context: any;
    try {
      context = JSON.parse(row.context_json);
    } catch {
      continue;
    }
    const promotion = context?.planningPromotion;
    if (promotion?.buildInvocationId !== expected.invocationId) continue;
    if (row.status !== "approved") {
      return { decisionId: null, problem: `stale pointer: the build packet's authorizing Decision ${row.id} is no longer approved (${row.status}).` };
    }
    const pairs: Record<string, [unknown, unknown]> = {
      actionId: [promotion.actionId, expected.actionId],
      actionDocRef: [promotion.actionDocRef, expected.actionDocRef],
      repoPath: [promotion.repoPath ?? "", expected.repoRoot],
      buildProfile: [promotion.buildProfile, expected.providerProfile],
      buildPacketPath: [promotion.buildPacketPath, expected.packetPath],
      buildPacketSha256: [promotion.buildPacketSha256, expected.packetSha256]
    };
    const stale = Object.entries(pairs).filter(([, [actual, wanted]]) => actual !== wanted);
    if (stale.length > 0) {
      return {
        decisionId: null,
        problem: `stale pointer: the promoted build packet or its authority set is stale (${stale.map(([field]) => field).join(", ")}).`
      };
    }
    return { decisionId: row.id, problem: null };
  }
  return { decisionId: null, problem: "missing packet: the build packet has no approved planning-promotion Decision." };
}

function resolveDocumentRevisions(
  repoRoot: string,
  projectSlug: string,
  planSlug: string | null
): { projectSha256: string | null; planSha256: string | null } {
  const discovered = discoverDocs(repoRoot);
  const projectDoc = discovered.docs.find((doc): doc is ProjectDoc => doc.type === "project" && doc.slug === projectSlug);
  const planDoc = planSlug
    ? discovered.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.project === projectSlug && doc.slug === planSlug)
    : undefined;
  return {
    projectSha256: projectDoc ? sha256(readFileSync(path.join(repoRoot, projectDoc.relativePath), "utf8")) : null,
    planSha256: planDoc ? sha256(readFileSync(path.join(repoRoot, planDoc.relativePath), "utf8")) : null
  };
}

function resolveHead(repoRoot: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
