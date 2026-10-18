"use client";

import { AlertTriangle, CheckCircle2, Clock3, Loader2, Play, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { shortName, type NextAfterRule } from "../lib/nextOperatorAction";

export type ScriptStatus = "available" | "running" | "succeeded" | "failed";

export interface OperatorScript {
  id: string;
  kind?: "grant";
  title: string;
  problem: string;
  desiredEffect: string;
  authority: { does: string[]; never_does: string[] };
  repeatable: boolean;
  receipt?: { reason: string; message: string; next: string; runDirectory: string; settlement?: unknown } | null;
  state: { status: ScriptStatus; startedAt?: string; finishedAt?: string; exitCode?: number | null; message?: string; runId?: string };
  failure?: { effect: string; next: string };
  nextAfter?: NextAfterRule | null;
  lastRunReceipt?: { outcome: string; startedAt: string | null; finishedAt: string | null; succeededAt?: string | null } | null;
  modifiedAt: string;
}

export interface CardProps {
  script: OperatorScript;
  launching: boolean;
  onLaunch: () => void;
  /** De-emphasize: another action is the operator's next action. */
  muted?: boolean;
  /** Shown before launch when this press is off the next-action path. */
  confirmation?: string | null;
  /**
   * For a page that did not load the whole library: resolved at press time, it returns the same
   * off-path confirmation text (or null) and rejects when the next action cannot be determined, in
   * which case nothing is launched.
   */
  resolveConfirmation?: () => Promise<string | null>;
  nextTitle?: string | null;
  /** Rendered inside the "Do this next" panel, or alone on the single-action page. */
  primary?: boolean;
}

export function OperatorActionCard({ script, launching, onLaunch, muted = false, confirmation = null, resolveConfirmation, nextTitle = null, primary = false }: CardProps) {
  const [confirming, setConfirming] = useState(false);
  const [resolved, setResolved] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const shownConfirmation = confirmation ?? resolved;
  const terminal = script.state.status === "succeeded" || script.state.status === "failed";
  const canRun = script.state.status !== "running" && !(script.state.status === "succeeded" && !script.repeatable);
  const press = async () => {
    setCheckError(null);
    if (confirmation) { setConfirming(true); return; }
    if (!resolveConfirmation) { onLaunch(); return; }
    setChecking(true);
    try {
      const text = await resolveConfirmation();
      if (text) { setResolved(text); setConfirming(true); } else onLaunch();
    } catch (cause) {
      setCheckError(`Could not confirm this is your next action, so nothing was started: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setChecking(false);
    }
  };
  const frame = primary ? "rounded-md border border-line bg-panel p-4" : muted ? "rounded-md border border-line/70 bg-panel/60 p-4 text-ink/80" : "rounded-md border border-line bg-panel p-4 shadow-soft";
  const runStyle = muted ? "border border-line bg-panel text-ink hover:border-steel hover:text-steel" : "bg-steel text-white hover:brightness-110";
  const busy = launching || checking;
  return (
    <article className={frame} data-testid={primary ? "next-action-card" : `operator-action-${script.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={primary ? "text-lg font-semibold" : "font-semibold"}>{script.title}</h3>
            {script.kind === "grant" ? <span className="rounded-full bg-gold/10 px-2 py-1 text-xs font-semibold text-gold">Grant</span> : null}
          </div>
          <p className="mt-1 break-all text-xs text-muted">{script.id}</p>
        </div>
        <StatusPill status={script.state.status} />
      </div>

      <p className="mt-4 text-sm text-muted">{script.desiredEffect}</p>
      <details className="mt-4 rounded-md border border-line/70 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-semibold">What this action does</summary>
        <p className="mt-3 text-muted">{script.problem}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <AuthorityList title="Does" items={script.authority.does} tone="text-moss" />
          <AuthorityList title="Never does" items={script.authority.never_does} tone="text-clay" />
        </div>
      </details>

      {script.state.message ? <p className={`mt-3 text-sm ${script.state.status === "failed" ? "text-clay" : "text-muted"}`}>{script.state.message}</p> : null}
      {script.receipt ? <div className="mt-3 text-sm"><p>{script.receipt.message}</p><p className="mt-1 text-muted">Next: {script.receipt.next}</p><details className="mt-2"><summary className="cursor-pointer font-semibold">Receipt: {script.receipt.reason}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(script.receipt, null, 2)}</pre></details></div> : null}
      {checkError ? <p className="mt-3 rounded-md border border-clay/30 bg-clay/5 p-3 text-sm text-clay" role="alert">{checkError}</p> : null}
      {confirming && shownConfirmation ? (
        <div role="alertdialog" aria-label="Not your next action" className="mt-4 rounded-md border-2 border-clay/60 bg-clay/5 p-3 text-sm">
          <p className="font-semibold text-clay">This is not your next action.</p>
          <p className="mt-1">{shownConfirmation}</p>
          {nextTitle ? <p className="mt-2 text-xs text-muted">Next action card: {nextTitle}</p> : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => setConfirming(false)} className="min-h-12 rounded-md bg-steel px-4 font-semibold text-white">Keep my place</button>
            <button type="button" onClick={() => { setConfirming(false); onLaunch(); }} className="min-h-12 rounded-md border border-clay/60 px-4 font-semibold text-clay">Run {shortName(script.title)} anyway</button>
          </div>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canRun && !confirming ? (
          <button type="button" onClick={() => void press()} disabled={busy} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${primary ? "min-h-12 w-full bg-steel text-base text-white hover:brightness-110 sm:w-auto" : runStyle}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {launching ? "Starting…" : checking ? "Checking…" : script.state.status === "failed" ? "Retry" : "Run"}
          </button>
        ) : null}
        {script.state.runId ? (
          <Link href={`/actions/${encodeURIComponent(script.id)}/runs/${encodeURIComponent(script.state.runId)}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm font-semibold hover:border-steel hover:text-steel">
            <TerminalSquare className="h-4 w-4" aria-hidden="true" />
            {script.state.status === "running" ? "View live result" : "View result"}
          </Link>
        ) : terminal ? <span className="text-xs text-muted">Legacy result; no live run page is available.</span> : null}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted" title={`Modified ${new Date(script.modifiedAt).toLocaleString()}`}>
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          {formatRelativeDate(script.modifiedAt)}
        </span>
      </div>
    </article>
  );
}

function AuthorityList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return <div><p className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function StatusPill({ status }: { status: ScriptStatus }) {
  const config = {
    available: ["Ready", "bg-line text-muted", TerminalSquare],
    running: ["Running", "bg-steel/10 text-steel", Loader2],
    succeeded: ["Completed", "bg-moss/10 text-moss", CheckCircle2],
    failed: ["Failed", "bg-clay/10 text-clay", AlertTriangle]
  }[status] as [string, string, typeof TerminalSquare];
  const Icon = config[2];
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${config[1]}`}><Icon className={`h-3.5 w-3.5 ${status === "running" ? "animate-spin" : ""}`} aria-hidden="true" />{config[0]}</span>;
}

function formatRelativeDate(value: string): string { const age = Date.now() - Date.parse(value); if (age < 60_000) return "just now"; if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`; if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`; return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
