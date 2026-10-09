/**
 * The Production console's Launch flow, as plain functions over an injected
 * `fetch`, so its confirmation rules are testable against a stubbed CLI.
 *
 * It only sequences routes that already exist and never decides on its own:
 *
 *   1. If the Action is not its Project's current pointer, preview the
 *      governed pointer move (`POST /api/work-queue` make-next, apply false)
 *      and stop for confirmation. Confirming applies that exact preview.
 *   2. Read the Session launch preview (`GET .../session-launch`), which starts
 *      nothing. It must name this very Action and say it is ready; otherwise
 *      the flow stops with the reason and offers no Launch button.
 *   3. Only an explicit confirmation POSTs the launch with the preview's
 *      fingerprint. Nothing here launches without that step. That same
 *      confirmation (`confirmOperatorLaunch`) mints the Session's one-shot
 *      post-exit authorization: validate, commit, push and one DRAFT PR, never
 *      a merge (Decision 0096). The dialog lists this before the button.
 */
import type { SessionLaunchPreviewResponse } from "./arcadia-cli";

export interface LaunchTarget {
  projectId: string;
  planSlug: string;
  actionId: string;
  /** `<projectSlug>/<actionId>`, the work queue's key. */
  actionKey: string;
  title: string;
  needsMakeNext: boolean;
  queueRevision: number;
}

export type LaunchStep =
  | { kind: "make-next"; requestId: string; fingerprint: string | null; previousAction: string | null; nextAction: string }
  | {
      kind: "preview";
      requestId: string;
      preview: SessionLaunchPreviewResponse;
      /** Why Launch is withheld; null when it may be confirmed. */
      refusal: string | null;
    }
  | { kind: "launched"; message: string; sessionId: string | null }
  | { kind: "error"; message: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function expectedActionDocRef(target: Pick<LaunchTarget, "planSlug" | "actionId">): string {
  return `plan/${target.planSlug}#${target.actionId}`;
}

/** `crypto.randomUUID` needs a secure context, which a plain-http tailnet origin is not. */
export function newRequestId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    try {
      return `${prefix}-${cryptoApi.randomUUID()}`;
    } catch {
      // Fall through: insecure context.
    }
  }
  const bytes = new Uint8Array(12);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `${prefix}-${Date.now().toString(36)}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorOf(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

/** First step: either the pointer-move preview or, for the current pointer, the launch preview. */
export async function beginLaunch(target: LaunchTarget, fetchImpl: Fetch, ids = newRequestId): Promise<LaunchStep> {
  if (!target.needsMakeNext) return previewLaunch(target, fetchImpl, ids);
  const requestId = ids("console-make-next");
  const response = await fetchImpl("/api/work-queue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "make-next", requestId, revision: target.queueRevision, apply: false, actionKey: target.actionKey })
  });
  const body = await readJson(response);
  if (!response.ok) return { kind: "error", message: errorOf(body, "Could not preview making this Action next.") };
  const receipt = (body.receipt ?? {}) as { previewFingerprint?: unknown; previousAction?: unknown; nextAction?: unknown };
  return {
    kind: "make-next",
    requestId,
    fingerprint: typeof receipt.previewFingerprint === "string" ? receipt.previewFingerprint : null,
    previousAction: typeof receipt.previousAction === "string" ? receipt.previousAction : null,
    nextAction: typeof receipt.nextAction === "string" ? receipt.nextAction : target.actionId
  };
}

/** Apply exactly the pointer move the operator saw, then read the launch preview. */
export async function confirmMakeNext(
  target: LaunchTarget,
  step: Extract<LaunchStep, { kind: "make-next" }>,
  fetchImpl: Fetch,
  ids = newRequestId
): Promise<LaunchStep> {
  const response = await fetchImpl("/api/work-queue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "make-next",
      requestId: step.requestId,
      revision: target.queueRevision,
      apply: true,
      actionKey: target.actionKey,
      ...(step.fingerprint ? { previewFingerprint: step.fingerprint } : {})
    })
  });
  const body = await readJson(response);
  if (!response.ok) return { kind: "error", message: errorOf(body, "The pointer move was refused; nothing was launched.") };
  return previewLaunch(target, fetchImpl, ids);
}

export async function previewLaunch(target: LaunchTarget, fetchImpl: Fetch, ids = newRequestId): Promise<LaunchStep> {
  const requestId = ids("console-launch");
  const response = await fetchImpl(
    `/api/projects/${encodeURIComponent(target.projectId)}/session-launch?requestId=${encodeURIComponent(requestId)}`,
    { cache: "no-store" }
  );
  const body = await readJson(response);
  if (!response.ok) return { kind: "error", message: errorOf(body, "Could not preview the launch.") };
  const preview = body as unknown as SessionLaunchPreviewResponse;
  return { kind: "preview", requestId, preview, refusal: refusalFor(target, preview) };
}

export function refusalFor(target: LaunchTarget, preview: SessionLaunchPreviewResponse): string | null {
  const expected = expectedActionDocRef(target);
  if (preview.actionDocRef !== expected) {
    return `The launch preview names ${preview.actionDocRef ?? "no Action"}, not ${expected}. Nothing was launched; refresh and try again.`;
  }
  if (!preview.ready) {
    return preview.prerequisites.length > 0
      ? `Not ready to launch: ${preview.prerequisites.join("; ")}`
      : "The launch preview is not ready.";
  }
  if (!preview.previewFingerprint) return "The launch preview carries no fingerprint to confirm.";
  return null;
}

/** The only call that starts a process, and only from a refusal-free preview. */
export async function confirmLaunch(
  target: LaunchTarget,
  step: Extract<LaunchStep, { kind: "preview" }>,
  fetchImpl: Fetch
): Promise<LaunchStep> {
  if (step.refusal) return { kind: "error", message: step.refusal };
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(target.projectId)}/session-launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The dialog listed what Launch also authorizes (Decision 0096); pressing it is the confirmation.
    body: JSON.stringify({ requestId: step.requestId, previewFingerprint: step.preview.previewFingerprint, confirmOperatorLaunch: true })
  });
  const body = await readJson(response);
  if (!response.ok) return { kind: "error", message: errorOf(body, "The launch was refused.") };
  const result = (body.result ?? {}) as { session?: { id?: unknown } };
  return {
    kind: "launched",
    message: typeof body.message === "string" ? body.message : "Session launched.",
    sessionId: typeof result.session?.id === "string" ? result.session.id : null
  };
}
