"use client";

import { ChevronDown, CloudDownload, GitBranch, RefreshCw, RotateCw } from "lucide-react";
import { useState } from "react";
import { needsRestart, stripState, type StripPhase } from "../lib/qa-project-state";
import type { ProjectVerdict, QaProjectRow } from "../lib/types";

/**
 * One row per project, above the target cards.
 *
 * Pull and restart are project operations, but they used to render on every
 * target card — so Private Practice Now showed seven identical buttons, each
 * restarting all seven of its dev servers. This is the same operation on the
 * noun it actually belongs to, at the top of the page where a phone can reach
 * it without scrolling past eight cards.
 */

type Note = { tone: "success" | "warning" | "error"; message: string } | null;

interface Props {
  rows: QaProjectRow[];
  loading: boolean;
  onProjectsChanged: () => Promise<void> | void;
}

export function QaProjectStrip({ rows, loading, onProjectsChanged }: Props) {
  const [phases, setPhases] = useState<Record<string, StripPhase>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function act(project: string, action: "fetch" | "pull" | "restart" | "switch") {
    setPending(`${project}:${action}`);
    setNotes((current) => ({ ...current, [project]: null }));
    try {
      const response = await fetch("/api/qa/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, project })
      });
      const body = await response.json() as { result?: { message: string; refused: string | null }; error?: string };
      if (!response.ok) throw new Error(body.error ?? `The ${action} could not be completed.`);
      const result = body.result;
      if (!result) throw new Error(`The ${action} returned no result.`);

      if (result.refused) {
        setNotes((current) => ({ ...current, [project]: { tone: "error", message: result.message } }));
      } else {
        setPhases((current) => ({
          ...current,
          // A switch lands on a different branch entirely, so whatever was
          // pulled or restarted before says nothing about where we now are.
          [project]:
            action === "pull" ? "pulled"
              : action === "restart" ? "restarted"
                : action === "switch" ? "idle"
                  : (current[project] ?? "idle")
        }));
        setNotes((current) => ({
          ...current,
          [project]: { tone: "success", message: result.message }
        }));
      }
      await onProjectsChanged();
    } catch (error) {
      setNotes((current) => ({
        ...current,
        [project]: { tone: "error", message: error instanceof Error ? error.message : String(error) }
      }));
    } finally {
      setPending(null);
    }
  }

  if (loading && rows.length === 0) {
    return <div className="mb-5 rounded-md border border-line bg-panel p-4 text-sm text-muted shadow-soft">Reading project checkouts…</div>;
  }
  if (rows.length === 0) return null;

  return (
    <section className="mb-6 grid gap-3" aria-label="Project checkouts">
      {rows.map((row) => {
        const state = stripState(row, phases[row.project] ?? "idle");
        const note = notes[row.project] ?? null;
        const busy = pending !== null;
        const isOpen = expanded[row.project] ?? false;

        return (
          <article key={row.project} className="rounded-md border border-line bg-panel p-4 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{row.project}</h2>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-1 font-mono text-xs">
                <GitBranch className="h-3.5 w-3.5 text-muted" />
                <span className={row.onBaseBranch ? "" : "font-semibold text-clay"}>{row.branch ?? "unknown"}</span>
                {row.head ? <span className="text-muted">· {row.head}</span> : null}
              </span>
            </div>

            <p className={`mt-2 text-sm ${state.tone === "stop" ? "text-clay" : "text-muted"}`}>{state.detail}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {state.action !== "none" ? (
                <button
                  disabled={busy}
                  onClick={() => void act(row.project, state.action as "fetch" | "pull" | "restart" | "switch")}
                  className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-60 sm:flex-none ${
                    state.tone === "act" ? "bg-moss" : "bg-steel"
                  }`}
                >
                  <ActionIcon action={state.action} spinning={pending === `${row.project}:${state.action}`} />
                  {pending === `${row.project}:${state.action}` ? `${verbing(state.action)}…` : state.label}
                </button>
              ) : (
                <span
                  className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-semibold ${
                    state.tone === "go"
                      ? "border-moss/30 bg-moss/10 text-moss"
                      : state.tone === "stop"
                        ? "border-clay/30 bg-clay/10 text-clay"
                        : "border-line bg-canvas text-muted"
                  }`}
                >
                  {state.label}
                </span>
              )}

              {state.offerFetch ? (
                <button
                  disabled={busy}
                  onClick={() => void act(row.project, "fetch")}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold disabled:opacity-60"
                >
                  <CloudDownload className={`h-4 w-4 ${pending === `${row.project}:fetch` ? "animate-pulse" : ""}`} />
                  {pending === `${row.project}:fetch` ? "Checking…" : "Check"}
                </button>
              ) : null}

              {state.offerRestartAnyway && row.controllable ? (
                <button
                  disabled={busy}
                  onClick={() => void act(row.project, "restart")}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-muted disabled:opacity-60"
                >
                  <RotateCw className={`h-4 w-4 ${pending === `${row.project}:restart` ? "animate-spin" : ""}`} />
                  {pending === `${row.project}:restart` ? "Restarting…" : "Restart anyway"}
                </button>
              ) : null}
            </div>

            {!row.controllable ? (
              <p className="mt-2 text-xs text-muted">
                No <code>scripts/services.sh</code>, so Arcadia cannot restart this project from here.
              </p>
            ) : null}

            {note ? (
              <p
                className={`mt-3 whitespace-pre-wrap rounded-md border p-3 text-sm font-medium ${
                  note.tone === "success"
                    ? "border-moss/30 bg-moss/10 text-moss"
                    : note.tone === "warning"
                      ? "border-steel/30 bg-steel/10 text-steel"
                      : "border-clay/30 bg-clay/10 text-clay"
                }`}
              >
                {note.message}
              </p>
            ) : null}

            {row.verdict && row.verdict.reasons.length > 0 ? (
              <VerdictDetail
                verdict={row.verdict}
                open={isOpen}
                onToggle={() => setExpanded((current) => ({ ...current, [row.project]: !isOpen }))}
              />
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

/**
 * The files behind the verdict, one tap away.
 *
 * Collapsed by default because the phone case is "just tell me what to press",
 * but never absent: a verdict whose evidence you cannot see is the same
 * unfalsifiable claim as a hand-typed freshness string.
 */
function VerdictDetail({
  verdict,
  open,
  onToggle
}: {
  verdict: ProjectVerdict;
  open: boolean;
  onToggle: () => void;
}) {
  const count = verdict.changedPaths.length;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-steel"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide" : "Show"} the {count}{verdict.truncated ? "+" : ""} file{count === 1 ? "" : "s"} behind this
      </button>

      {open ? (
        <div className="mt-2 grid gap-3">
          {verdict.apps.length > 0 ? (
            <p className="text-xs text-muted">
              Apps touched: <span className="font-mono">{verdict.apps.join(", ")}</span>
              {needsRestart(verdict) ? " — restart bounces every service in this project, not only these." : ""}
            </p>
          ) : null}
          {verdict.reasons.map((reason) => (
            <div key={reason.rule}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{reason.label}</p>
              <ul className="mt-1 grid gap-0.5">
                {reason.paths.map((filePath) => (
                  <li key={filePath} className="break-all font-mono text-xs text-ink">{filePath}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionIcon({ action, spinning }: { action: string; spinning: boolean }) {
  const className = `h-4 w-4 ${spinning ? "animate-spin" : ""}`;
  if (action === "fetch") return <CloudDownload className={className} />;
  if (action === "restart") return <RotateCw className={className} />;
  if (action === "switch") return <GitBranch className={className} />;
  return <RefreshCw className={className} />;
}

function verbing(action: string): string {
  if (action === "fetch") return "Checking";
  if (action === "pull") return "Pulling";
  if (action === "switch") return "Switching";
  return "Restarting";
}
