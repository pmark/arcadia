"use client";

import Link from "next/link";
import { sessionHref } from "../../lib/session-link";
import { useEffect, useRef, useState } from "react";
import { SessionLog } from "../production-console";
import type { GuardedSessionLaunchResponse, SessionLaunchPreviewResponse } from "../../lib/arcadia-cli";
import { OPERATOR_LAUNCH_CONSEQUENCE } from "../../lib/operator-launch-consequence";

interface ContinuePreview extends SessionLaunchPreviewResponse {
  resolutionId: string;
  target: { projectId: string; plan: string; action: string };
  owner: string;
  selectionRationale?: string | null;
  limits: { actions: number; sessions: number; automaticNextAction: boolean; authorizationHours: number; timeLimit: string; tokenBudget: string };
}

export function WorkspaceContinue({ projectId, plan, action, resolutionId, readAgain }: {
  projectId: string; plan: string; action: string; resolutionId: string; readAgain: () => void;
}) {
  const [preview, setPreview] = useState<ContinuePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<"preview" | "launch" | null>(null);
  const [receipt, setReceipt] = useState<(GuardedSessionLaunchResponse & { requestId: string }) | null>(null);
  const [unknown, setUnknown] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const busy = phase !== null;
  useEffect(() => {
    if (!phase && !preview && !message && !receipt) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [phase, preview, message, receipt]);
  const pending = useRef(false);
  const send = async (commit: boolean) => {
    if (pending.current || unknown || receipt || (commit && !preview?.ready)) return;
    pending.current = true; setPhase(commit ? "launch" : "preview"); setMessage(null);
    try {
      const url = `/api/projects/${encodeURIComponent(projectId)}/go-continue`;
      const response = await fetch(commit ? url : `${url}?${new URLSearchParams({ plan, action, resolutionId })}`, commit ? {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, action, resolutionId: preview?.resolutionId, requestId: preview?.requestId,
          previewFingerprint: preview?.previewFingerprint, confirmOperatorLaunch: true })
      } : { cache: "no-store" });
      const body = await response.json() as ContinuePreview & { error?: string; message?: string; result?: GuardedSessionLaunchResponse; details?: { changedFacts?: unknown } };
      if (!response.ok) {
        if (commit && response.status >= 500) throw new Error(body.error ?? "The launch server could not confirm the outcome.");
        setPreview(null);
        setMessage(`${body.error ?? "Continue was refused."}${body.details?.changedFacts ? ` Changed facts: ${JSON.stringify(body.details.changedFacts)}` : ""} Read again before retrying.`);
        return;
      }
      if (commit) {
        if (!body.result?.session?.id || typeof body.result.reused !== "boolean") throw new Error("The reply contained no confirmed Session receipt.");
        setReceipt({ ...body.result, requestId: preview?.requestId ?? "" }); setPreview(null);
        setMessage(body.result.reused ? "Reused existing Session" : "Session launched");
      } else setPreview(body);
    } catch (error) {
      if (commit) {
        setUnknown(true);
        setMessage(`Continue's outcome is unknown: ${error instanceof Error ? error.message : String(error)}. Check Sessions and runs for this Action and reconcile the request below before trying Continue again.`);
      } else {
        setMessage(`The preview could not be read: ${error instanceof Error ? error.message : String(error)}. No launch was requested. Read Go again to retry.`);
      }
    } finally { pending.current = false; setPhase(null); }
  };
  return <div className="workspace-continue">
    {!preview && !receipt && !unknown && <button type="button" disabled={busy} onClick={() => void send(false)}>{busy ? "Reading preview…" : "Continue"}</button>}
    <p className="workspace-sr" role="status">{phase === "preview" ? "Reading the protected preview…" : phase === "launch" ? "Requesting this Action…" : message ?? (preview ? "Continue preview ready" : "")}</p>
    {(busy || preview || message || receipt) && <div className="workspace-continue-feedback" aria-busy={busy}>
    <h3 ref={heading} tabIndex={-1}>{phase === "preview" ? "Reading the protected preview…" : phase === "launch" ? "Requesting this Action…" : unknown ? "Launch outcome unknown" : receipt ? message : preview ? "Continue this one Action" : "Continue needs attention"}</h3>
    {preview && !busy && !unknown && <section aria-label="Continue preview">
      <dl className="workspace-facts">
        <dt>Target</dt><dd>{preview.target.plan} · {preview.target.action}</dd>
        <dt>Owner</dt><dd>{preview.owner}</dd>
        <dt>Provider</dt><dd>{preview.selection ? `${preview.selection.provider} · ${preview.selection.model} · ${preview.selection.effort}` : "Unresolved"}</dd>
        <dt>Limits</dt><dd>One Action and at most one Session. No automatic next Action. {preview.limits.timeLimit} Plan budget: {preview.limits.tokenBudget}</dd>
        <dt>Request receipt identity</dt><dd>{preview.requestId}</dd>
      </dl>
      {preview.selectionRationale && <p>{preview.selectionRationale}</p>}
      <p>{OPERATOR_LAUNCH_CONSEQUENCE}</p>
      {!preview.ready && <><p>Continue is gated:</p><ul>{preview.prerequisites.map(p => <li key={p}>{p}</li>)}</ul></>}
      <button type="button" disabled={busy || !preview.ready} onClick={() => void send(true)}>Confirm Continue for this Action</button>
      <button type="button" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
    </section>}
    {receipt && <section aria-label="Session receipt">
      <p>{receipt.reused ? "This request reused the already recorded Session; it did not create another." : "The protected launch returned this Session receipt. Launch does not mean the Action is complete."}</p>
      <dl className="workspace-facts"><dt>Request receipt identity</dt><dd>{receipt.requestId}</dd><dt>Session</dt><dd>{receipt.session.id}</dd><dt>Launch receipt status</dt><dd>{receipt.session.observedStatus}</dd></dl>
      <p><Link href={sessionHref(receipt.session.id)}>View Session</Link> for its current status, log and resulting pull request.</p>
      <SessionLog sessionId={receipt.session.id} live={receipt.session.observedStatus === "running" || receipt.session.observedStatus === "prepared"} />
    </section>}
    {message && !receipt && <p>{message}</p>}
    {unknown && <><p>Request receipt identity: <code>{preview?.requestId}</code></p><p><Link href="/production">Check Sessions and runs</Link>. Keep this request identity when reconciling; do not start a fresh request while its outcome is unknown.</p></>}
    {message && !unknown && <button type="button" disabled={busy} onClick={readAgain}>Read Go again</button>}
    </div>}
  </div>;
}
