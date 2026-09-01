import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AgentAskProposal } from "./agentAsk.js";
import { validationError } from "../cli/errors.js";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import { resolveActionReadiness } from "../docs/dispatch.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { syncProjectDocs } from "../docs/sync.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";
import { buildAgentQueue } from "../dispatch/queue.js";
import { arrangeActionOrder } from "../dispatch/order.js";
import { assertClean } from "../git/worktrees.js";
import { slugify } from "../utils/slug.js";

export type AgentAskDisposition = "accepted" | "rejected";
export type AgentAskResponsibility = "autonomous" | "codex";
export type AgentAskPlacement = "top" | "before" | "after";

export interface AgentAskSettlementReceipt {
  id: string;
  proposalId: string;
  proposalRequestId: string;
  settlementRequestId: string;
  disposition: AgentAskDisposition;
  projectSlug: string;
  intent: string;
  effects: string[];
  queueActionKey: string | null;
  queuePosition: number | null;
  nextActionKey: string | null;
  previewFingerprint: string;
  applied: boolean;
  notificationStatus: "withheld_until_apply" | "pending" | "sent";
  createdAt: string;
}

export interface PendingAgentAskNotification {
  settlementId: string;
  projectSlug: string;
  disposition: AgentAskDisposition;
  intent: string;
  effects: string[];
  queueActionKey: string | null;
  queuePosition: number | null;
  nextActionKey: string | null;
  createdAt: string;
}

export function settleAgentAsk(db: Database.Database, input: {
  proposalRef: string;
  settlementRequestId: string;
  disposition: AgentAskDisposition;
  responsibility?: AgentAskResponsibility;
  placement?: AgentAskPlacement;
  anchor?: string;
  expectedQueueRevision?: number;
  previewFingerprint?: string;
  apply?: boolean;
}): AgentAskSettlementReceipt {
  const operation = {
    proposalRef: input.proposalRef,
    disposition: input.disposition,
    responsibility: input.responsibility ?? null,
    placement: input.placement ?? null,
    anchor: input.anchor ?? null
  };
  const existingByRequest = db.prepare("SELECT operation_json, receipt_json FROM agent_ask_settlements WHERE request_id = ?")
    .get(input.settlementRequestId) as { operation_json: string; receipt_json: string } | undefined;
  if (existingByRequest) {
    if (existingByRequest.operation_json !== JSON.stringify(operation)) {
      throw validationError("Agent Ask settlement request id was already used for a different operation.");
    }
    return JSON.parse(existingByRequest.receipt_json) as AgentAskSettlementReceipt;
  }

  const proposalRow = db.prepare(`SELECT proposal_json FROM agent_ask_proposals
    WHERE id = ? OR request_id = ?`).get(input.proposalRef, input.proposalRef) as { proposal_json: string } | undefined;
  if (!proposalRow) throw validationError("Agent Ask proposal was not found.", { proposal: input.proposalRef });
  const proposal = JSON.parse(proposalRow.proposal_json) as AgentAskProposal;
  const existingSettlement = db.prepare("SELECT receipt_json FROM agent_ask_settlements WHERE proposal_id = ?").get(proposal.id) as { receipt_json: string } | undefined;
  if (existingSettlement) {
    throw validationError("Agent Ask proposal is already settled.", {
      settlement: (JSON.parse(existingSettlement.receipt_json) as AgentAskSettlementReceipt).id
    });
  }
  if (proposal.normalized.project === "unknown") {
    throw validationError("Agent Ask must resolve an explicit Project before settlement.");
  }
  const project = getProjectBySlug(db, proposal.normalized.project);
  const metadata = project ? getProjectMetadata(db, project.id) : null;
  if (!project || !metadata?.repo_path) throw validationError("Agent Ask Project repository is not configured.");
  const repoRoot = path.resolve(metadata.repo_path);
  const queue = buildAgentQueue(db);
  if (input.expectedQueueRevision !== undefined && queue.revision !== input.expectedQueueRevision) {
    throw validationError("Action queue revision changed; refresh the Agent Ask settlement preview.", {
      expectedRevision: input.expectedQueueRevision,
      actualRevision: queue.revision
    });
  }

  let planPath: string | null = null;
  let planBefore: string | null = null;
  let planAfter: string | null = null;
  let queueActionKey: string | null = null;
  let queueAfter = queue.ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []);
  const effects: string[] = [];

  if (input.disposition === "rejected") {
    effects.push("Preserved the proposal and created no Project or queue changes.");
  } else {
    if (proposal.normalized.intent !== "action" || proposal.normalized.targetRef) {
      throw validationError("This settlement slice accepts new Action proposals only; amend or non-Action effects remain proposed.", {
        intent: proposal.normalized.intent,
        targetRef: proposal.normalized.targetRef
      });
    }
    if (!input.responsibility) throw validationError("Accepted Action settlement requires --responsibility autonomous or codex.");
    if (proposal.normalized.acceptance.length === 0) {
      throw validationError("Accepted Action settlement requires at least one observable acceptance criterion in the proposal.");
    }
    if (!queue.orderValid) {
      throw validationError("Position every existing approved Action before accepting another into the queue.", {
        unpositionedCount: queue.unpositionedCount
      });
    }
    if (!input.placement) throw validationError("Accepted Action settlement requires --top, --before, or --after.");
    const discovered = discoverDocs(repoRoot);
    const projectDoc = discovered.docs.find((doc): doc is ProjectDoc => doc.type === "project" && doc.slug === project.slug);
    const plan = discovered.docs.find(
      (doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug && doc.slug === projectDoc?.activePlan
    );
    if (!projectDoc || !plan) throw validationError("Agent Ask Project has no resolvable active managed Plan.");
    const actionId = uniqueActionId(plan, slugify(proposal.normalized.desiredResult));
    queueActionKey = `${project.slug}/${actionId}`;
    const dependencies = proposal.normalized.dependencies.map((dependency) => dependency.split("/").at(-1)!).filter(Boolean);
    const unknownDependencies = dependencies.filter((dependency) => !plan.actions.some((action) => action.id === dependency));
    if (unknownDependencies.length > 0) throw validationError("Agent Ask names dependencies outside the active Plan.", { dependencies: unknownDependencies });
    planPath = path.join(repoRoot, plan.relativePath);
    planBefore = readFileSync(planPath, "utf8");
    planAfter = appendAction(planBefore, {
      id: actionId,
      title: proposal.normalized.desiredResult,
      responsibility: input.responsibility,
      acceptance: proposal.normalized.acceptance,
      dependencies,
      source: `Agent Ask ${proposal.normalized.requestId}`
    });
    queueAfter = insertQueueKey(queueAfter, queueActionKey, input.placement, input.anchor);
    effects.push(`Created Action ${queueActionKey} in active Plan ${plan.slug}.`);
    effects.push(`Assigned Responsibility ${input.responsibility}.`);
    effects.push(`Inserted the Action at queue position ${queueAfter.indexOf(queueActionKey) + 1}.`);
  }

  const previewFingerprint = sha256(JSON.stringify({
    proposalFingerprint: proposal.fingerprint,
    operation,
    queueRevision: queue.revision,
    planBefore: planBefore ? sha256(planBefore) : null,
    planAfter: planAfter ? sha256(planAfter) : null,
    queueAfter
  }));
  if (input.apply && input.previewFingerprint !== previewFingerprint) {
    throw validationError("Agent Ask settlement apply does not match the current preview.", {
      expectedPreviewFingerprint: previewFingerprint,
      receivedPreviewFingerprint: input.previewFingerprint ?? null
    });
  }

  const now = new Date().toISOString();
  const baseReceipt: AgentAskSettlementReceipt = {
    id: `asksettle_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    proposalId: proposal.id,
    proposalRequestId: proposal.normalized.requestId,
    settlementRequestId: input.settlementRequestId,
    disposition: input.disposition,
    projectSlug: project.slug,
    intent: proposal.normalized.intent,
    effects,
    queueActionKey,
    queuePosition: queueActionKey ? queueAfter.indexOf(queueActionKey) : null,
    nextActionKey: input.disposition === "accepted" ? queue.nextActionKey : queue.nextActionKey,
    previewFingerprint,
    applied: input.apply === true,
    notificationStatus: input.apply ? "pending" : "withheld_until_apply",
    createdAt: now
  };
  if (!input.apply) return baseReceipt;

  if (planPath && planBefore !== null && planAfter !== null) assertClean(repoRoot, "Agent Ask Project repository");
  try {
    return db.transaction(() => {
      if (planPath && planBefore !== null && planAfter !== null && queueActionKey) {
        writeAtomically(planPath, planAfter);
        const readiness = resolveActionReadiness(repoRoot, project.slug, queueActionKey.split("/").at(-1)!);
        if (!readiness.found || readiness.blockers.length > 0 || readiness.operatorQuestion) {
          throw validationError("Accepted Agent Ask did not produce a ready canonical Action.", {
            blockers: readiness.blockers,
            operatorQuestion: readiness.operatorQuestion
          });
        }
        const sync = syncProjectDocs(db, project, { apply: true });
        if (sync.errors.length > 0) throw validationError("Accepted Agent Ask managed documents failed operational sync.", { errors: sync.errors });
        const currentKeys = buildAgentQueue(db).ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []);
        arrangeActionOrder(db, {
          currentKeys,
          order: queueAfter,
          requestId: `agent-ask:${input.settlementRequestId}`,
          expectedRevision: queue.revision,
          apply: true
        });
      }
      const nextActionKey = buildAgentQueue(db).nextActionKey;
      const receipt: AgentAskSettlementReceipt = { ...baseReceipt, nextActionKey };
      db.prepare(`INSERT INTO agent_ask_settlements
        (id, proposal_id, request_id, operation_json, fingerprint, disposition, project_slug,
         effects_json, queue_action_key, queue_position, next_action_key, notification_status,
         receipt_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
        .run(receipt.id, proposal.id, input.settlementRequestId, JSON.stringify(operation), previewFingerprint,
          input.disposition, project.slug, JSON.stringify(effects), queueActionKey, receipt.queuePosition,
          nextActionKey, JSON.stringify(receipt), now);
      return receipt;
    })();
  } catch (error) {
    if (planPath && planBefore !== null) writeAtomically(planPath, planBefore);
    throw error;
  }
}

export function listPendingAgentAskNotifications(db: Database.Database): PendingAgentAskNotification[] {
  return db.prepare(`SELECT id, project_slug, disposition, effects_json, queue_action_key,
      queue_position, next_action_key, receipt_json, created_at
    FROM agent_ask_settlements WHERE notification_status = 'pending' ORDER BY created_at, id`)
    .all()
    .map((row) => {
      const value = row as Record<string, unknown>;
      const receipt = JSON.parse(String(value.receipt_json)) as AgentAskSettlementReceipt;
      return {
        settlementId: String(value.id),
        projectSlug: String(value.project_slug),
        disposition: value.disposition as AgentAskDisposition,
        intent: receipt.intent,
        effects: JSON.parse(String(value.effects_json)) as string[],
        queueActionKey: value.queue_action_key === null ? null : String(value.queue_action_key),
        queuePosition: value.queue_position === null ? null : Number(value.queue_position),
        nextActionKey: value.next_action_key === null ? null : String(value.next_action_key),
        createdAt: String(value.created_at)
      };
    });
}

export function markAgentAskNotificationSent(db: Database.Database, settlementId: string, messageId: string): void {
  const result = db.prepare(`UPDATE agent_ask_settlements
    SET notification_status = 'sent', discord_message_id = ?, notified_at = ?
    WHERE id = ? AND notification_status = 'pending'`).run(messageId, new Date().toISOString(), settlementId);
  if (result.changes === 0) {
    const existing = db.prepare("SELECT notification_status, discord_message_id FROM agent_ask_settlements WHERE id = ?")
      .get(settlementId) as { notification_status: string; discord_message_id: string | null } | undefined;
    if (!existing) throw validationError("Agent Ask settlement was not found.", { settlementId });
    if (existing.notification_status === "sent" && existing.discord_message_id === messageId) return;
    throw validationError("Agent Ask settlement notification is already resolved with different evidence.", { settlementId });
  }
}

function appendAction(content: string, action: {
  id: string; title: string; responsibility: AgentAskResponsibility; acceptance: string[]; dependencies: string[]; source: string;
}): string {
  const end = content.indexOf("\n---", 4);
  if (end < 0) throw validationError("Managed Plan has no closing frontmatter marker.");
  const lines = [
    `  - id: ${action.id}`,
    `    title: ${yamlScalar(action.title)}`,
    "    status: open",
    `    responsibility: ${action.responsibility}`,
    "    effort: session",
    `    next_action: ${yamlScalar(action.title)}`,
    `    expected_artifact: ${yamlScalar(`Evidence satisfying Agent Ask ${action.id}`)}`,
    "    clarification: clarified",
    "    confidence: high",
    `    source: ${yamlScalar(action.source)}`,
    "    acceptance_criteria:",
    ...action.acceptance.map((criterion) => `      - ${yamlScalar(criterion)}`),
    `    depends_on: [${action.dependencies.join(", ")}]`,
    "    decisions: []",
    "    references: []"
  ];
  return `${content.slice(0, end)}\n${lines.join("\n")}${content.slice(end)}`;
}

function uniqueActionId(plan: PlanDoc, base: string): string {
  const stem = base || "agent-ask-action";
  if (!plan.actions.some((action) => action.id === stem)) return stem;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}`;
    if (!plan.actions.some((action) => action.id === candidate)) return candidate;
  }
  throw validationError("Agent Ask could not allocate a unique Action id.");
}

function insertQueueKey(current: string[], key: string, placement: AgentAskPlacement, anchor?: string): string[] {
  const next = current.filter((item) => item !== key);
  if (placement === "top") return [key, ...next];
  if (!anchor || !next.includes(anchor)) throw validationError("Agent Ask queue anchor was not found.", { anchor: anchor ?? null });
  const index = next.indexOf(anchor) + (placement === "after" ? 1 : 0);
  next.splice(index, 0, key);
  return next;
}

function writeAtomically(filePath: string, content: string): void {
  const temporary = `${filePath}.arcadia-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, content, "utf8");
  try { renameSync(temporary, filePath); } finally { try { unlinkSync(temporary); } catch {} }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
