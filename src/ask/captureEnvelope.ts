import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

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
}

export function captureAskEnvelope(db: Database.Database, input: {
  requestId?: string;
  originalText: string;
  ingressSource: string;
  attachments?: CaptureAttachmentInput[];
  reuseExisting?: boolean;
}): AskCaptureEnvelope {
  const requestId = input.requestId?.trim() || `request_${randomUUID()}`;
  const existing = db.prepare("SELECT envelope_json, fingerprint FROM ask_capture_envelopes WHERE request_id = ?")
    .get(requestId) as { envelope_json: string; fingerprint: string } | undefined;
  if (existing && input.reuseExisting) return JSON.parse(existing.envelope_json) as AskCaptureEnvelope;
  const prepared = prepareInput(input);
  if (existing) {
    if (existing.fingerprint !== prepared.fingerprint) {
      throw new Error(`Capture request ${requestId} was already submitted with different content.`);
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
    authority: "untrusted_input"
  };

  db.transaction(() => {
    db.prepare(`INSERT INTO ask_capture_envelopes
      (id, request_id, fingerprint, original_text, ingress_source, captured_at, status, envelope_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(envelope.id, requestId, prepared.fingerprint, input.originalText, input.ingressSource, capturedAt, envelope.status, JSON.stringify(envelope));
    const insertAttachment = db.prepare(`INSERT INTO ask_capture_attachments
      (id, capture_id, original_filename, media_type, byte_size, sha256, storage_reference, proposed_role, derivation_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const attachment of envelope.attachments) {
      insertAttachment.run(attachment.id, envelope.id, attachment.originalFilename, attachment.mediaType,
        attachment.byteSize, attachment.sha256, attachment.storageReference, attachment.proposedRole, attachment.derivationStatus);
    }
  })();
  return envelope;
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
