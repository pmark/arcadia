"use client";

import { useRead } from "../use-read";
import "./plan-picker.css";
import type { PlanAskRow, PlanAsksResponse } from "../../../lib/plan-picker-actions";

/** A previewed picker Ask is not inert: it waits in the operator's pending Asks until accepted (kept as evidence) or rejected. */
const STATE_WORD: Record<PlanAskRow["state"], string> = { previewed: "Previewed · in your pending Asks, evidence only", pending: "Pending", settled: "Settled" };

function kindWord(ask: PlanAskRow): string {
  if (ask.requestId.startsWith("workspace-annotate-")) return "Annotation";
  if (ask.requestId.startsWith("workspace-request-change-")) return "Change request";
  return ask.intent === "proposal" ? "Note" : `${ask.intent} Ask`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A Plan's annotations and change history: every Ask whose Project and target are this Plan, newest first. Read-only. */
export function PlanAsks({ project, plan, revision }: { project: string; plan: string; revision: number }) {
  const read = useRead<PlanAsksResponse>(`/api/plans/${encodeURIComponent(project)}/${encodeURIComponent(plan)}/asks`, revision);
  return <section className="plan-asks" aria-labelledby="plan-asks-title">
    <h2 id="plan-asks-title" className="plan-asks-title">Annotations and change history</h2>
    {read.kind === "loading" && <p className="route-note" role="status">Reading this Plan&apos;s Asks…</p>}
    {read.kind === "error" && <p className="route-note" role="alert">Couldn&apos;t read this Plan&apos;s Asks: {read.message}</p>}
    {read.kind === "ready" && read.data.asks.length === 0 && <p className="route-empty">No Ask targets this Plan yet.</p>}
    {read.kind === "ready" && read.data.asks.length > 0 && <ol className="plan-asks-list">
      {read.data.asks.map(ask => <li key={ask.proposalId} className="plan-asks-item" data-state={ask.state}>
        <p className="plan-asks-meta">
          <span className="plan-asks-state">{STATE_WORD[ask.state]}{ask.disposition ? ` · ${ask.disposition}` : ""}</span>
          <span>{kindWord(ask)}</span>
          <time dateTime={ask.createdAt}>{when(ask.createdAt)}</time>
          {ask.targetRef && ask.targetRef !== `plan/${plan}` && <span>{ask.targetRef}</span>}
        </p>
        <p className="plan-asks-text">{ask.desiredResult}</p>
      </li>)}
    </ol>}
  </section>;
}
