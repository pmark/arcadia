"use client";

import { useRef, useState } from "react";
import type { SessionLaunchPreviewResponse } from "../../lib/arcadia-cli";
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
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const send = async (commit: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage(null);
    try {
      const url = `/api/projects/${encodeURIComponent(projectId)}/go-continue`;
      const response = await fetch(commit ? url : `${url}?${new URLSearchParams({ plan, action, resolutionId })}`, commit ? {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, action, resolutionId: preview?.resolutionId, requestId: preview?.requestId,
          previewFingerprint: preview?.previewFingerprint, confirmOperatorLaunch: true })
      } : { cache: "no-store" });
      const body = await response.json() as ContinuePreview & { error?: string; message?: string; details?: { changedFacts?: unknown } };
      if (!response.ok) {
        setPreview(null);
        setMessage(`${body.error ?? "Continue was refused."}${body.details?.changedFacts ? ` Changed facts: ${JSON.stringify(body.details.changedFacts)}` : ""} Read again before retrying.`);
        return;
      }
      if (commit) { setPreview(null); setMessage(body.message ?? "Continue returned a receipt."); }
      else setPreview(body);
    } catch (error) {
      setMessage(`Continue's outcome is unknown: ${error instanceof Error ? error.message : String(error)}. Read again; the same preview retains its request identity.`);
    } finally { pending.current = false; setBusy(false); }
  };
  return <div className="workspace-continue">
    <button type="button" disabled={busy} onClick={() => void send(false)}>Continue</button>
    {busy && <p role="status">{preview ? "Requesting this Action…" : "Reading the protected preview…"}</p>}
    {preview && <section aria-label="Continue preview">
      <h3>Continue this one Action</h3>
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
    {message && <><p role="status">{message}</p><button type="button" disabled={busy} onClick={readAgain}>Read Go again</button></>}
  </div>;
}
