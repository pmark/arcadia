import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { getProject, getProjectMetadata } from "../db/repositories.js";
import { discoverDocs, isAuthoritativeControlPath } from "../docs/discover.js";
import { captureAskEnvelope } from "./captureEnvelope.js";

export interface DirectionTarget { projectId: string; plan?: string; action?: string }
export interface AcceptedDirectionTarget extends DirectionTarget { projectSlug: string; repository: string }
export interface DirectionReceipt {
  schema: "arcadia-direction-v1";
  id: string;
  requestId: string;
  captureId: string;
  fingerprint: string;
  content: string;
  requestedTarget: unknown;
  target: AcceptedDirectionTarget | null;
  disposition: "accepted" | "refused";
  reason: string | null;
  source: "ask.capture-direction";
  observedAt: string;
  authority: "no-execution-authority";
}
export interface DirectionCorrelation {
  requestId: string;
  fingerprint: string;
  messageId: string;
  consumptionReceiptId: string;
  acknowledgmentReceiptId: string;
}

export function parseDirectionTarget(value: unknown): DirectionTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validationError("Direction target must be an object.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["projectId", "plan", "action"].includes(key)) ||
    typeof v.projectId !== "string" || !v.projectId.trim() ||
    [v.plan, v.action].some(item => item !== undefined && (typeof item !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(item))) ||
    (v.action !== undefined && v.plan === undefined)) throw validationError("Direction target requires an explicit Project and, for an Action, its Plan.");
  return { projectId: v.projectId.trim(), ...(v.plan !== undefined ? { plan: v.plan as string } : {}), ...(v.action !== undefined ? { action: v.action as string } : {}) };
}

export function parseDirectionCorrelation(value: unknown): DirectionCorrelation {
  const keys = ["requestId", "fingerprint", "messageId", "consumptionReceiptId", "acknowledgmentReceiptId"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    keys.some(key => typeof (value as Record<string, unknown>)[key] !== "string" || !(value as Record<string, string>)[key].trim()) ||
    !/^[a-f0-9]{64}$/.test((value as Record<string, string>).fingerprint)) throw validationError("Direction correlation must pin request, fingerprint, message and receiver receipt IDs.");
  return Object.fromEntries(keys.map(key => [key, (value as Record<string, string>)[key]])) as unknown as DirectionCorrelation;
}

/** Captures acceptance of this exact target/content only; never routing or execution approval. */
export function captureDirection(db: Database.Database, input: { requestId: string; content: string; target: unknown }): DirectionReceipt {
  if (!input.requestId.trim() || !input.content.trim()) throw validationError("Direction request ID and content are required.");
  // Stable request/content with a bad target is still a durable refused
  // submission. Only unusable transport identity/content fails before capture.
  let requestedTarget: unknown = input.target;
  let parsedTarget: DirectionTarget | undefined;
  let targetError: string | null = null;
  try { parsedTarget = parseDirectionTarget(input.target); requestedTarget = parsedTarget; }
  catch (error) { targetError = error instanceof Error ? error.message : String(error); }
  return writeTransaction(db, () => {
    const envelope = captureAskEnvelope(db, { requestId: input.requestId, originalText: input.content,
      ingressSource: "operator-direction", routingIdentity: { kind: "direction", target: requestedTarget } });
    const prior = readDirection(db, input.requestId);
    if (prior) return prior;
    let target: AcceptedDirectionTarget | null = null;
    let reason: string | null = null;
    try {
      if (!parsedTarget) throw new Error(targetError ?? "Direction target is invalid.");
      const targetInput = parsedTarget;
      const project = getProject(db, targetInput.projectId);
      if (!project) throw new Error("Direction Project was not found.");
      const metadata = getProjectMetadata(db, project.id);
      if (!metadata?.repo_path) throw new Error("Direction Project has no configured repository.");
      const found = discoverDocs(metadata.repo_path);
      if (found.ioErrors?.length) throw new Error(found.ioErrors[0].message);
      const invalid = found.errors.find(error => isAuthoritativeControlPath(error.relativePath));
      if (invalid) throw new Error(`${invalid.relativePath}: ${invalid.message}`);
      const projectDocs = found.docs.filter(doc => doc.type === "project" && doc.slug === project.slug);
      if (projectDocs.length !== 1) throw new Error("Direction Project control identity is missing or ambiguous.");
      if (targetInput.plan) {
        const plans = found.docs.filter(doc => doc.type === "plan" && doc.project === project.slug && doc.slug === targetInput.plan);
        if (plans.length !== 1 || plans[0].type !== "plan") throw new Error("Direction Plan identity is missing or ambiguous in this Project.");
        if (targetInput.action && plans[0].actions.filter(action => action.id === targetInput.action).length !== 1) throw new Error("Direction Action identity is missing or ambiguous in this Plan.");
      }
      target = { ...targetInput, projectSlug: project.slug, repository: metadata.repo_path };
    } catch (error) { reason = error instanceof Error ? error.message : String(error); }
    const receipt: DirectionReceipt = { schema: "arcadia-direction-v1", id: `${envelope.id}:direction`, requestId: envelope.requestId,
      captureId: envelope.id, fingerprint: createHash("sha256").update(JSON.stringify({ requestId: envelope.requestId, content: input.content, target: requestedTarget })).digest("hex"),
      content: input.content, requestedTarget, target, disposition: target ? "accepted" : "refused", reason,
      source: "ask.capture-direction", observedAt: envelope.capturedAt, authority: "no-execution-authority" };
    db.prepare("UPDATE ask_capture_envelopes SET envelope_json = ?, status = ? WHERE id = ?")
      .run(JSON.stringify({ ...envelope, direction: receipt }), target ? "completed" : "failed", envelope.id);
    return receipt;
  });
}

export function readDirection(db: Database.Database, requestId: string): DirectionReceipt | null {
  const row = db.prepare("SELECT envelope_json FROM ask_capture_envelopes WHERE request_id = ? OR id = ?").get(requestId, requestId) as { envelope_json: string } | undefined;
  if (!row) return null;
  const envelope = JSON.parse(row.envelope_json) as { direction?: DirectionReceipt };
  return envelope.direction?.schema === "arcadia-direction-v1" ? envelope.direction : null;
}

export function requireAcceptedDirection(db: Database.Database, requestId: string, fingerprint: string): DirectionReceipt & { target: AcceptedDirectionTarget } {
  const receipt = readDirection(db, requestId);
  if (!receipt || receipt.disposition !== "accepted" || !receipt.target || receipt.fingerprint !== fingerprint) {
    throw validationError("Direction has no matching durable accepted target/content receipt.");
  }
  return receipt as DirectionReceipt & { target: AcceptedDirectionTarget };
}
