import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { writeTransaction } from "../db/connection.js";

export type DerivationStatus = "completed" | "unavailable" | "not_applicable";

export interface CaptureAttachmentInput {
  path: string;
  originalFilename?: string;
  storageReference?: string;
}

export interface CaptureAttachmentReceipt {
  id: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  storageReference: string;
  proposedRole: "project_text" | "reference_attachment";
  derivationStatus: DerivationStatus;
}

export interface CaptureDerivation {
  processor: "metadata_extraction" | "text_extraction" | "transcription" | "ocr" | "media_analysis";
  source: string;
  processedAt: string;
  status: DerivationStatus;
  confidence: number | null;
  result: Record<string, unknown> | null;
}

export interface AskCaptureEnvelope {
  id: string;
  requestId: string;
  originalText: string;
  ingressSource: string;
  capturedAt: string;
  submittedUrls: string[];
  canonicalLinkCandidates: Array<{ submittedUrl: string; canonicalCandidate: string; reason: string }>;
  attachments: CaptureAttachmentReceipt[];
  derivations: CaptureDerivation[];
  status: "captured";
  authority: "untrusted_input";
  /**
   * Who authenticated as the sender, when the calling surface knows. Stored in
   * envelope_json only and never part of the fingerprint, so a replay returns
   * the first stored envelope. Absent on envelopes captured before this field.
   */
  actor?: CaptureActor | null;
  /** Project slug, only where the call site already held it. Same storage rule as `actor`. */
  project?: string | null;
}

export interface CaptureActor {
  id: string;
}

export type AskCaptureProcessingClaim = "claimed" | "complete" | "partial" | "failed";

/**
 * Own the safe, read-only preparation phase. A replacement token fences an
 * older process that was still preparing; durable effects require the owner
 * to transition the capture to `partial` first.
 */
export function claimAskCaptureProcessing(db: Database.Database, captureId: string, owner: string): AskCaptureProcessingClaim {
  return writeTransaction(db, () => {
    const row = db.prepare("SELECT status, processing_owner FROM ask_capture_envelopes WHERE id = ?").get(captureId) as
      | { status: string; processing_owner: string | null } | undefined;
    if (!row) throw new Error(`Ask capture ${captureId} disappeared before processing.`);
    const priorAsk = db.prepare("SELECT id FROM ask_requests WHERE capture_id = ? ORDER BY created_at LIMIT 1")
      .get(captureId) as { id: string } | undefined;
    if (row.status === "completed" && priorAsk) return "complete";
    if (row.status === "captured") {
      db.prepare("UPDATE ask_capture_envelopes SET status = 'processing', processing_owner = ? WHERE id = ? AND status = 'captured'")
        .run(owner, captureId);
      return "claimed";
    }
    if (row.status === "processing" && row.processing_owner) {
      // Rotating the fence is safe only in this pre-effect phase. A previous
      // owner must prove the token again before its first durable write.
      db.prepare("UPDATE ask_capture_envelopes SET processing_owner = ? WHERE id = ? AND status = 'processing' AND processing_owner = ?")
        .run(owner, captureId, row.processing_owner);
      return "claimed";
    }
    if (row.status === "processing") {
      db.prepare("UPDATE ask_capture_envelopes SET status = 'partial' WHERE id = ? AND status = 'processing'").run(captureId);
      return "partial";
    }
    return row.status === "partial" ? "partial" : row.status === "failed" ? "failed" : "complete";
  });
}

/** Mark that the fenced owner is about to commit a route effect. */
export function markAskCaptureEffectsStarted(db: Database.Database, captureId: string, owner: string): void {
  const row = db.prepare("SELECT status, processing_owner FROM ask_capture_envelopes WHERE id = ?").get(captureId) as
    | { status: string; processing_owner: string | null } | undefined;
  if (row?.status === "partial" && row.processing_owner === owner) return;
  const changed = db.prepare(
    "UPDATE ask_capture_envelopes SET status = 'partial' WHERE id = ? AND status = 'processing' AND processing_owner = ?"
  ).run(captureId, owner);
  if (changed.changes !== 1) throw new Error(`Ask capture ${captureId} processing ownership was superseded before route effects.`);
}

/** Fence a public Review-reply Ask and preserve its exact Decision for recovery inspection. */
export function markAskCaptureReviewEffectsStarted(
  db: Database.Database,
  captureId: string,
  owner: string,
  reviewId: string
): void {
  writeTransaction(db, () => {
    const existing = db.prepare("SELECT related_review_id FROM ask_capture_envelopes WHERE id = ? AND status = 'processing' AND processing_owner = ?")
      .get(captureId, owner) as { related_review_id: string | null } | undefined;
    if (!existing) throw new Error(`Ask capture ${captureId} processing ownership was superseded before Review effects.`);
    if (existing.related_review_id && existing.related_review_id !== reviewId) {
      throw new Error(`Ask capture ${captureId} is already linked to a different Review Decision.`);
    }
    db.prepare("UPDATE ask_capture_envelopes SET status = 'partial', related_review_id = ? WHERE id = ? AND status = 'processing' AND processing_owner = ?")
      .run(reviewId, captureId, owner);
  });
}

export function finishAskCaptureProcessing(db: Database.Database, captureId: string, owner: string): boolean {
  return writeTransaction(db, () => db.prepare(
    "UPDATE ask_capture_envelopes SET status = 'completed', processing_owner = NULL WHERE id = ? AND processing_owner = ? AND status IN ('processing', 'partial')"
  ).run(captureId, owner).changes === 1);
}

export function resetAskCaptureBeforeEffects(db: Database.Database, captureId: string, owner: string): boolean {
  return writeTransaction(db, () => db.prepare(
    "UPDATE ask_capture_envelopes SET status = 'captured', processing_owner = NULL WHERE id = ? AND processing_owner = ? AND status = 'processing'"
  ).run(captureId, owner).changes === 1);
}

export function captureAskEnvelope(db: Database.Database, input: {
  requestId?: string;
  originalText: string;
  ingressSource: string;
  attachments?: CaptureAttachmentInput[];
  reuseExisting?: boolean;
  /** Provenance metadata kept out of the fingerprint; see AskCaptureEnvelope. */
  actor?: CaptureActor | null;
  project?: string | null;
  /** Routing choices are idempotency identity, never evidence of approval or authority. */
  routingIdentity?: Record<string, unknown> | null;
}): AskCaptureEnvelope {
  const requestId = input.requestId?.trim() || `request_${randomUUID()}`;
  return writeTransaction(db, () => {
    const existing = db.prepare("SELECT id, status, envelope_json, fingerprint, routing_identity FROM ask_capture_envelopes WHERE request_id = ?")
      .get(requestId) as { id: string; status: string; envelope_json: string; fingerprint: string; routing_identity: string | null } | undefined;
    if (existing && input.reuseExisting) return JSON.parse(existing.envelope_json) as AskCaptureEnvelope;
    const prepared = prepareInput(input);
    if (existing) {
      if (existing.fingerprint !== prepared.fingerprint) {
        throw new Error(`Capture request ${requestId} was already submitted with different content.`);
      }
      const routingIdentity = input.routingIdentity === undefined || input.routingIdentity === null
        ? null
        : JSON.stringify(input.routingIdentity);
      if (existing.routing_identity !== null && existing.routing_identity !== routingIdentity) {
        throw new Error(`Capture request ${requestId} was already submitted with different routing choices.`);
      }
      if (existing.routing_identity === null && routingIdentity !== null && !legacyRoutingReplayIsProven(db, existing.id, existing.status, input.routingIdentity ?? {})) {
        throw new Error(`Capture request ${requestId} has no pinned routing identity; use a new request id to avoid changing its route.`);
      }
      return JSON.parse(existing.envelope_json) as AskCaptureEnvelope;
    }
    const capturedAt = new Date().toISOString();
    const attachmentReceipts = prepared.attachments.map((attachment) => ({
      id: `capture_attachment_${randomUUID()}`,
      ...attachment.receipt
    }));
    const derivations = attachmentReceipts.flatMap((attachment, index) =>
      buildDerivations(attachment, capturedAt, prepared.attachments[index]?.extractedText ?? null)
    );
    const envelope: AskCaptureEnvelope = {
      id: `capture_${randomUUID()}`,
      requestId,
      originalText: input.originalText,
      ingressSource: input.ingressSource,
      capturedAt,
      submittedUrls: extractUrls(input.originalText),
      canonicalLinkCandidates: canonicalCandidates(extractUrls(input.originalText)),
      attachments: attachmentReceipts,
      derivations,
      status: "captured",
      authority: "untrusted_input",
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      ...(input.project !== undefined ? { project: input.project } : {})
    };
    db.prepare(`INSERT INTO ask_capture_envelopes
      (id, request_id, fingerprint, original_text, ingress_source, captured_at, status, envelope_json, routing_identity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(envelope.id, requestId, prepared.fingerprint, input.originalText, input.ingressSource, capturedAt, envelope.status, JSON.stringify(envelope),
        input.routingIdentity === undefined || input.routingIdentity === null ? null : JSON.stringify(input.routingIdentity));
    const insertAttachment = db.prepare(`INSERT INTO ask_capture_attachments
      (id, capture_id, original_filename, media_type, byte_size, sha256, storage_reference, proposed_role, derivation_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const attachment of envelope.attachments) {
      insertAttachment.run(attachment.id, envelope.id, attachment.originalFilename, attachment.mediaType,
        attachment.byteSize, attachment.sha256, attachment.storageReference, attachment.proposedRole, attachment.derivationStatus);
    }
    return envelope;
  });
}

function legacyRoutingReplayIsProven(
  db: Database.Database,
  captureId: string,
  status: string,
  identity: Record<string, unknown>
): boolean {
  // A prior capture with no route pin is replayable only after completion and
  // only when its canonical Ask proves the selected Project and all other
  // consequential routing controls are at their legacy defaults.
  if (status !== "completed" || identity.executeReview === true || identity.correctionRoute != null ||
      identity.approvedReviewItemId != null || identity.captureAsIdea === true || identity.milestone != null ||
      identity.reviewReference != null || identity.runSafe === true || identity.agentProfile != null ||
      identity.reviewExecutor != null || identity.sourceRef != null || identity.facetTags != null) return false;
  const ask = db.prepare(`
    SELECT COALESCE(work.project_id, review.project_id) AS project_id
    FROM ask_requests ask
    LEFT JOIN execution_plans plan ON plan.id = ask.plan_id
    LEFT JOIN work_items work ON work.id = COALESCE(ask.work_item_id, plan.work_item_id)
    LEFT JOIN review_items review ON review.capture_id = ask.capture_id
    WHERE ask.capture_id = ? ORDER BY ask.created_at LIMIT 1
  `)
    .get(captureId) as { project_id: string | null } | undefined;
  if (!ask) return false;
  return identity.explicitProjectId == null || identity.explicitProjectId === ask.project_id;
}

export function findCaptureRequestIdByStorageReferences(
  db: Database.Database,
  storageReferences: string[]
): string | null {
  if (storageReferences.length === 0) return null;
  const placeholders = storageReferences.map(() => "?").join(", ");
  const row = db.prepare(`
    SELECT envelope.request_id
    FROM ask_capture_envelopes envelope
    JOIN ask_capture_attachments attachment ON attachment.capture_id = envelope.id
    WHERE attachment.storage_reference IN (${placeholders})
    GROUP BY envelope.id
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `).get(...storageReferences) as { request_id: string } | undefined;
  return row?.request_id ?? null;
}

function prepareInput(input: { originalText: string; ingressSource: string; attachments?: CaptureAttachmentInput[] }) {
  const attachments = (input.attachments ?? []).map((attachment) => {
    const bytes = readFileSync(attachment.path);
    const originalFilename = attachment.originalFilename || path.basename(attachment.path);
    const declaredMediaType = mediaTypeFor(originalFilename);
    const safeText = ["text/plain", "text/markdown"].includes(declaredMediaType) && !bytes.includes(0);
    const mediaType = safeText ? declaredMediaType : declaredMediaType.startsWith("text/") ? "application/octet-stream" : declaredMediaType;
    return {
      receipt: {
        originalFilename,
        mediaType,
        byteSize: statSync(attachment.path).size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        storageReference: attachment.storageReference || attachment.path,
        proposedRole: safeText ? "project_text" as const : "reference_attachment" as const,
        derivationStatus: safeText ? "completed" as const : "unavailable" as const
      },
      extractedText: safeText ? bytes.toString("utf8") : null
    };
  });
  const fingerprint = createHash("sha256").update(JSON.stringify({
    originalText: input.originalText,
    ingressSource: input.ingressSource,
    attachments: attachments.map(({ receipt }) => receipt)
  })).digest("hex");
  return { attachments, fingerprint };
}

function buildDerivations(attachment: CaptureAttachmentReceipt, processedAt: string, extractedText: string | null): CaptureDerivation[] {
  const text = ["text/plain", "text/markdown"].includes(attachment.mediaType);
  const source = attachment.storageReference;
  return [
    { processor: "metadata_extraction", source, processedAt, status: "completed", confidence: 1, result: { mediaType: attachment.mediaType, byteSize: attachment.byteSize, sha256: attachment.sha256 } },
    { processor: "text_extraction", source, processedAt, status: text ? "completed" : "unavailable", confidence: text ? 1 : null, result: text ? { text: extractedText } : null },
    { processor: "transcription", source, processedAt, status: "not_applicable", confidence: null, result: null },
    { processor: "ocr", source, processedAt, status: "not_applicable", confidence: null, result: null },
    { processor: "media_analysis", source, processedAt, status: "not_applicable", confidence: null, result: null }
  ];
}

function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>()]+/g)?.map((url) => url.replace(/[.,;!?]+$/, "")) ?? [];
}

function canonicalCandidates(urls: string[]): AskCaptureEnvelope["canonicalLinkCandidates"] {
  return urls.flatMap((submittedUrl) => {
    try {
      const parsed = new URL(submittedUrl);
      if (!/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname) || parsed.pathname !== "/url") return [];
      const candidate = parsed.searchParams.get("q") || parsed.searchParams.get("url");
      return candidate?.startsWith("http")
        ? [{ submittedUrl, canonicalCandidate: candidate, reason: "Known Google URL wrapper parameter; not fetched or verified." }]
        : [];
    } catch {
      return [];
    }
  });
}

function mediaTypeFor(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return ({
    ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown",
    ".json": "application/json", ".pdf": "application/pdf", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4"
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}
