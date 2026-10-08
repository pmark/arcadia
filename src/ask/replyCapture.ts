import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import { captureAskEnvelope, type CaptureActor } from "./captureEnvelope.js";

/**
 * Ingress source vocabulary for Ask capture envelopes.
 *
 * Every classified source is one of:
 * - `intake`: the operator handed Arcadia new work or information through
 *   Ingress or Discord. Only these count toward "operator input that passed
 *   through Ask or Ingress" in the coverage report's numerator.
 * - `provenance`: the envelope only records the exact words behind a canonical
 *   write that already happened; it is never counted as intake and never
 *   creates work. Operator replies to a Decision or review are provenance-only:
 *   the canonical record is the review item or Decision document.
 * - `agent`: written by a coding agent (`agent.ask`, `codex.*`), never operator
 *   input; the coverage report excludes and reports these separately.
 *
 * Sources outside this vocabulary (`ask`, `cli.ask`, ...) answer `null` rather
 * than a guess: nothing recorded says whether an operator or an agent typed them.
 */
export const OPERATOR_REPLY_INGRESS_SOURCES = {
  /** `arcadia review resolve-reply`: Discord, dashboard and CLI replies to a Requires Review Decision. */
  "operator.reply.review": "provenance",
  /** `arcadia decision approve` with a free-text answer (no offered option was chosen). */
  "operator.reply.decision": "provenance",
  /** `arcadia work resolve-question`, the dashboard work-question route. */
  "operator.reply.work-question": "provenance"
} as const;

export type OperatorReplyIngressSource = keyof typeof OPERATOR_REPLY_INGRESS_SOURCES;
export type IngressSourceKind = "intake" | "provenance" | "agent";

/** Exact sources. Discord free text and `/request` are operator intake. */
const CLASSIFIED_INGRESS_SOURCES: Record<string, IngressSourceKind> = {
  ...OPERATOR_REPLY_INGRESS_SOURCES,
  "discord.message": "intake",
  "discord.request": "intake",
  "agent.ask": "agent"
};

/** Prefix families: every Ingress inbox is `ingress:<source>`; Codex-written envelopes are `codex.*`. */
const CLASSIFIED_INGRESS_PREFIXES: Array<[string, IngressSourceKind]> = [
  ["ingress:", "intake"],
  ["codex.", "agent"]
];

export function ingressSourceKind(source: string): IngressSourceKind | null {
  if (Object.prototype.hasOwnProperty.call(CLASSIFIED_INGRESS_SOURCES, source)) return CLASSIFIED_INGRESS_SOURCES[source] ?? null;
  return CLASSIFIED_INGRESS_PREFIXES.find(([prefix]) => source.startsWith(prefix))?.[1] ?? null;
}

export interface CaptureOperatorReplyInput {
  /** Calling surface, for example `review.resolve-reply`. Part of the requestId. */
  surface: string;
  /** Canonical entity the reply answers (review item id, Decision id, Action id). Part of the requestId. */
  entityId: string;
  /** The operator's exact words. */
  text: string;
  ingressSource: OperatorReplyIngressSource;
  /** Set only when the calling surface authenticated a principal. Never invented; absent is recorded as null. */
  actor?: CaptureActor | null;
  /** Project slug, only where the call site already holds it. */
  project?: string | null;
  /** The caller already holds a capture id (the `arcadia ask reply` path): capture nothing. */
  heldCaptureId?: string | null;
  /** Optional links so the event row joins to the canonical record. */
  links?: { projectId?: string | null; workItemId?: string | null; reviewItemId?: string | null };
  /** Extra non-secret fields for the event payload (for example a receipt id). */
  payload?: Record<string, unknown>;
}

export type OperatorReplyCapture =
  | { status: "captured" | "replayed"; captureId: string; requestId: string }
  | { status: "skipped"; captureId: string }
  | { status: "failed"; error: string };

export function operatorReplyRequestId(surface: string, entityId: string, text: string): string {
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return `${surface}:${entityId}:${digest}`;
}

/**
 * Preserve an operator's free-text reply as an Ask capture envelope.
 *
 * Fail-open: this never throws. A failure is logged to stderr and returned as
 * `{ status: "failed" }`; callers run it after the canonical write and ignore
 * the result. One distinct reply yields one envelope: the requestId is
 * `<surface>:<entity-id>:<first 12 hex of sha256(text)>`, so a replay returns
 * the first stored envelope (actor and project are not in the fingerprint, so
 * a different actor on replay changes nothing). The capture id is written to
 * an `events` row (`operator.reply.captured`) once per envelope; the existing
 * `capture_id` columns on review items, Actions and Ask requests are never
 * touched.
 */
export function captureOperatorReply(
  db: Database.Database,
  input: CaptureOperatorReplyInput
): OperatorReplyCapture {
  if (input.heldCaptureId) return { status: "skipped", captureId: input.heldCaptureId };
  try {
    const outcome = db.transaction(() => {
      const requestId = operatorReplyRequestId(input.surface, input.entityId, input.text);
      const existed = db.prepare("SELECT 1 FROM ask_capture_envelopes WHERE request_id = ?").get(requestId) !== undefined;
      const envelope = captureAskEnvelope(db, {
        requestId,
        originalText: input.text,
        ingressSource: input.ingressSource,
        actor: input.actor ?? null,
        ...(input.project !== undefined ? { project: input.project } : {}),
        reuseExisting: true
      });
      if (!existed) {
        db.prepare(
          `INSERT INTO events (id, event_type, source_module, project_id, work_item_id, artifact_id, review_item_id, payload_json, created_at)
           VALUES (@id, 'operator.reply.captured', 'reply-capture', @project_id, @work_item_id, NULL, @review_item_id, @payload_json, @created_at)`
        ).run({
          id: createId("event"),
          project_id: input.links?.projectId ?? null,
          work_item_id: input.links?.workItemId ?? null,
          review_item_id: input.links?.reviewItemId ?? null,
          payload_json: JSON.stringify({
            captureId: envelope.id,
            requestId,
            surface: input.surface,
            entityId: input.entityId,
            ingressSource: input.ingressSource,
            ingressKind: ingressSourceKind(input.ingressSource),
            ...(input.payload ?? {})
          }),
          created_at: nowIso()
        });
      }
      return { existed, envelopeId: envelope.id, requestId };
    })();
    return { status: outcome.existed ? "replayed" : "captured", captureId: outcome.envelopeId, requestId: outcome.requestId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`warning: operator reply capture failed (${input.surface} ${input.entityId}): ${message}\n`);
    return { status: "failed", error: message };
  }
}
