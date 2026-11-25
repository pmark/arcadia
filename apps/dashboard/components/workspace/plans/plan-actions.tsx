"use client";

import { useState } from "react";
import {
  PLAN_ACTIONS, planActionConsequence, planAskRequestId,
  type PlanAskCheckResponse, type PlanAskKind, type PlanAskSubmitResponse
} from "../../../lib/plan-picker-actions";

type Step =
  | { kind: "idle" }
  | { kind: "write"; ask: PlanAskKind; requestId: string }
  | { kind: "checking" | "submitting"; ask: PlanAskKind; requestId: string }
  | { kind: "review"; ask: PlanAskKind; requestId: string; check: PlanAskCheckResponse }
  | { kind: "done"; ask: PlanAskKind; result: PlanAskSubmitResponse };

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(json.error ?? `The request failed (${response.status}).`);
  return json as T;
}

/** Why Queue next and Archive are withheld, said once above the list. */
export function WithheldPlanActions() {
  return <ul className="plan-actions-withheld" aria-label="Withheld actions">{PLAN_ACTIONS.filter(a => a.unavailable).map(a => <li key={a.kind}><strong>{a.label}:</strong> {a.unavailable}</li>)}</ul>;
}

/**
 * One Plan's picker actions. Each states its consequence before it runs; Annotate and Request change compose a governed
 * Agent Ask, show its effects without recording it, and record it only on Submit. Nothing here settles an Ask.
 */
export function PlanActions({ project, plan, planName, initial }: { project: string; plan: string; planName: string; initial?: Step }) {
  const [step, setStep] = useState<Step>(initial ?? { kind: "idle" });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const url = `/api/plans/${encodeURIComponent(project)}/${encodeURIComponent(plan)}/asks`;
  const open = (ask: PlanAskKind) => { setError(null); setText(""); setStep({ kind: "write", ask, requestId: planAskRequestId(ask, plan) }); };
  const check = async (ask: PlanAskKind, requestId: string) => {
    setError(null); setStep({ kind: "checking", ask, requestId });
    try { setStep({ kind: "review", ask, requestId, check: await post<PlanAskCheckResponse>(url, { mode: "check", kind: ask, text, requestId }) }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setStep({ kind: "write", ask, requestId }); }
  };
  const submit = async (ask: PlanAskKind, requestId: string, prior: PlanAskCheckResponse) => {
    setError(null); setStep({ kind: "submitting", ask, requestId });
    try { setStep({ kind: "done", ask, result: await post<PlanAskSubmitResponse>(url, { mode: "submit", kind: ask, text, requestId }) }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setStep({ kind: "review", ask, requestId, check: prior }); }
  };
  const active = step.kind === "idle" ? null : step.ask;

  return <div className="plan-actions">
    <div className="plan-actions-row" role="group" aria-label={`Actions for ${planName}`}>
      {PLAN_ACTIONS.map(a => <button key={a.kind} type="button" className="plan-actions-button" data-kind={a.kind}
        disabled={a.unavailable !== null || step.kind === "checking" || step.kind === "submitting"} aria-pressed={active === a.kind}
        title={planActionConsequence(a.kind, planName)} onClick={() => a.unavailable === null && open(a.kind as PlanAskKind)}>{a.label}</button>)}
    </div>
    {step.kind !== "idle" && <div className="plan-actions-panel" role="region" aria-label={step.ask === "annotate" ? "Annotate" : "Request change"}>
      <p className="plan-actions-consequence"><strong>What happens:</strong> {planActionConsequence(step.ask, planName)}</p>
      {(step.kind === "write" || step.kind === "checking") && <form onSubmit={e => { e.preventDefault(); void check(step.ask, step.requestId); }}>
        <label className="plan-actions-label">{step.ask === "annotate" ? "Note" : "What should change"}
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={4000} required /></label>
        <div className="plan-actions-row">
          <button type="submit" className="plan-actions-button" disabled={!text.trim() || step.kind === "checking"}>{step.kind === "checking" ? "Previewing…" : "Preview"}</button>
          <button type="button" className="plan-actions-button quiet" onClick={() => setStep({ kind: "idle" })}>Cancel</button>
        </div>
      </form>}
      {(step.kind === "review" || step.kind === "submitting") && <>
        <p className="plan-actions-label">Effects if settled</p>
        <ul className="plan-actions-effects">{(step.kind === "review" ? step.check.effects : []).map(e => <li key={e}>{e}</li>)}</ul>
        {step.kind === "review" && step.check.requiredDecisions.length > 0 && <p className="plan-actions-note">{step.check.requiredDecisions.join(" ")}</p>}
        <p className="plan-actions-note">Nothing is recorded yet. Submit records this Ask as a preview receipt; the operator settles it.</p>
        <div className="plan-actions-row">
          <button type="button" className="plan-actions-button" disabled={step.kind === "submitting"} onClick={() => step.kind === "review" && void submit(step.ask, step.requestId, step.check)}>{step.kind === "submitting" ? "Submitting…" : "Submit"}</button>
          <button type="button" className="plan-actions-button quiet" disabled={step.kind === "submitting"} onClick={() => setStep({ kind: "write", ask: step.ask, requestId: step.requestId })}>Edit</button>
        </div>
      </>}
      {step.kind === "done" && <p className="plan-actions-receipt" role="status">Recorded as {step.result.proposalId}{step.result.replayed ? " (already recorded)" : ""}. {step.ask === "annotate" ? "It shows on the Plan page as a note." : "It waits for the operator's settlement and shows on the Plan page."}</p>}
      {error && <p className="plan-actions-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
