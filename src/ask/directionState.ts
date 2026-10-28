import type Database from "better-sqlite3";
import { readDirection } from "./directions.js";
import { assertDirectionMailTarget, directionForMail, getMailMessage, listMailReceipts } from "../nativeMail/store.js";
import { checkDirectionQa, directionEffects } from "./directionVerification.js";

import type { DirectionView } from "./directionTypes.js";
export type { DirectionState, DirectionEvidence, DirectionView } from "./directionTypes.js";

export function unknownDirection(requestId: string, observedAt: string, reason: string): DirectionView {
  return { fingerprint: null, requestId, content: "", target: null, disposition: "unknown", state: "unknown", lastSupportedState: null, reason,
    evidence: [{ state: "unknown", artifact: `${requestId}:submission-attempt`, source: "workspace.submission", observedAt, provenance: "browser-transport-observation" }] };
}

/** Pure read projection: no inbox exposure, verification execution, models or status writes. */
export function projectDirection(db: Database.Database, workspace: string, requestId: string, now = new Date()): DirectionView | null {
  const direction = readDirection(db, requestId);
  if (!direction) return null;
  const view: DirectionView = { fingerprint: direction.fingerprint, requestId: direction.requestId, content: direction.content,
    target: direction.target ?? direction.requestedTarget, disposition: direction.disposition,
    state: direction.disposition === "accepted" ? "submitted" : "refused", lastSupportedState: direction.disposition === "accepted" ? "submitted" : null,
    reason: direction.reason, evidence: [{ state: direction.disposition === "accepted" ? "submitted" : "refused", artifact: direction.id,
      source: direction.source, observedAt: direction.observedAt, provenance: "canonical-target-acceptance-no-execution-authority" }] };
  if (!direction.target) return view;
  const columns = db.prepare("PRAGMA table_info(native_mail_messages)").all() as Array<{ name: string }>;
  const row = columns.some(column => column.name === "direction_json")
    ? db.prepare("SELECT id FROM native_mail_messages WHERE direction_json IS NOT NULL AND json_extract(direction_json,'$.requestId')=?")
      .get(direction.requestId) as { id: string } | undefined : undefined;
  const message = row && getMailMessage(db, row.id);
  if (!message) {
    view.state = "held"; view.reason = "Not addressed to an explicit native recipient; no delivery or launch is inferred.";
    view.evidence.push({ state: "held", artifact: direction.id, source: "direction.addressing", observedAt: direction.observedAt, provenance: "canonical-unaddressed-capture" });
    return view;
  }
  try { assertDirectionMailTarget(message, direction.target); }
  catch (error) { view.state = "held"; view.reason = error instanceof Error ? error.message : String(error); return view; }
  if (directionForMail(message)?.fingerprint !== direction.fingerprint) { view.state = "held"; view.reason = "Addressed offer content does not match this direction."; return view; }
  const receipts = listMailReceipts(db, message.id);
  const consumption = receipts.find(receipt => receipt.kind === "consumption" && receipt.effectEvidence?.schema === "arcadia-direction-consumption-v1" &&
    receipt.effectEvidence.fingerprint === direction.fingerprint && receipt.effectEvidence.recipient === message.recipientSessionIncarnation &&
    receipt.effectEvidence.generation === message.recipientGeneration && receipt.createdAt >= direction.observedAt);
  if (consumption) {
    view.state = "delivered"; view.lastSupportedState = "delivered";
    view.evidence.push({ state: "delivered", artifact: consumption.id, source: "native-mail.consume", observedAt: consumption.createdAt, provenance: "recipient-attestation" });
  }
  const ack = receipts.find(receipt => receipt.kind === "acknowledgment" && receipt.effectEvidence?.schema === "arcadia-direction-ack-v1" &&
    receipt.effectEvidence.fingerprint === direction.fingerprint && typeof receipt.effectEvidence.text === "string" && receipt.effectEvidence.text.trim() &&
    consumption && receipt.createdAt >= consumption.createdAt);
  if (ack) {
    view.state = "acknowledged"; view.lastSupportedState = "acknowledged";
    view.evidence.push({ state: "acknowledged", artifact: ack.id, source: "native-mail.ack", observedAt: ack.createdAt, provenance: "recipient-attestation" });
  }
  const effects = directionEffects(db, direction).filter(effect => effect.messageId === message.id);
  const effect = effects.at(-1);
  if (effect && ack && effect.observedAt >= ack.createdAt) {
    view.state = "continued"; view.lastSupportedState = "continued";
    view.evidence.push({ state: "continued", artifact: effect.id, source: effect.source, observedAt: effect.observedAt, provenance: "canonical-applied-writer", revision: effect.revision });
  }
  for (const receipt of receipts.filter(receipt => receipt.kind === "effect_receipt" && receipt.effectEvidence?.schema === "arcadia-direction-verification-v1")) {
    const evidence = receipt.effectEvidence!;
    const observedEffect = effects.find(candidate => candidate.id === evidence.settlementId && candidate.revision === evidence.revision);
    let valid = false; let reason: string | null = null;
    try {
      if (!observedEffect || evidence.fingerprint !== direction.fingerprint || typeof evidence.decisionId !== "string" || receipt.createdAt < observedEffect.observedAt) throw new Error("Verification does not match a supported direction result.");
      const proof = checkDirectionQa(db, workspace, direction, observedEffect, evidence.decisionId);
      if (proof.artifactId !== evidence.artifactId || proof.evidenceFingerprint !== evidence.evidenceFingerprint) throw new Error("Verification provenance no longer matches its canonical evidence.");
      valid = true;
    } catch (error) { reason = error instanceof Error ? error.message : String(error); }
    const current = valid && effect?.id === observedEffect?.id;
    view.evidence.push({ state: "verified", artifact: receipt.id, source: "native-mail.verify-direction", observedAt: receipt.createdAt,
      provenance: "canonical-independent-qa-observation", revision: typeof evidence.revision === "string" ? evidence.revision : undefined,
      result: valid ? "passed" : "currently unsupported", current });
    if (current && view.lastSupportedState === "continued") { view.state = "verified"; view.lastSupportedState = "verified"; view.reason = null; }
    else if (reason || (valid && !current)) view.reason = reason ?? "Historical verification belongs to an earlier explicitly bound result.";
  }
  if (effect && view.lastSupportedState !== "verified" && !view.reason) view.reason = "No separately observed positive QA acceptance evidence is verified for this exact result.";
  const recipientState = receipts.filter(receipt => receipt.kind === "recipient_state" && receipt.selfReportedResult?.schema === "arcadia-direction-recipient-state-v1" &&
    receipt.selfReportedResult.fingerprint === direction.fingerprint).at(-1);
  if (recipientState && ["paused", "stopped"].includes(String(recipientState.selfReportedResult!.state))) {
    view.state = "held"; view.reason = `Recipient ${String(recipientState.selfReportedResult!.state)} (observer attestation; no automatic resend or readdress).`;
    view.evidence.push({ state: "held", artifact: recipientState.id, source: "native-mail.record-recipient-state", observedAt: recipientState.createdAt, provenance: "observer-attestation" });
  }
  if (message.status === "disposed" || (message.expiresAt && message.expiresAt <= now.toISOString())) {
    view.state = "held"; view.reason = message.status === "disposed" ? "Addressed message was explicitly disposed; no automatic reoffer." : "Addressed message expired; no automatic reoffer.";
    view.evidence.push({ state: "held", artifact: message.id, source: "native-mail.inert-message", observedAt: message.disposedAt ?? message.expiresAt!, provenance: "canonical-message-state" });
  }
  return view;
}
