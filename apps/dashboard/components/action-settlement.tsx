"use client";

import { useState } from "react";
import type { ActionSettlementPlan } from "../lib/arcadia-cli";
import type { DashboardProject } from "../lib/types";

interface ActionSettlementPanelProps {
  projects: DashboardProject[];
  onSettled: () => void | Promise<void>;
}

interface SettleResult {
  message: string;
  nextActionKey: string | null;
}

/**
 * Settle (complete) the current governed Action from the Needs You board.
 *
 * The operator picks a Project, the panel loads that Project's current Action
 * with its declared acceptance criteria and the exact candidate revision
 * (a dry run — nothing is written), and one button completes it with operator
 * authority. It wraps the same `arcadia action settle` command the CLI exposes,
 * so the board and the terminal cannot disagree about what settlement does.
 */
export function ActionSettlementPanel({ projects, onSettled }: ActionSettlementPanelProps) {
  const settleable = projects.filter((project) => project.status === "active" && project.repoPath);
  const [projectId, setProjectId] = useState<string>(settleable[0]?.id ?? "");
  const [plan, setPlan] = useState<ActionSettlementPlan | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SettleResult | null>(null);

  if (settleable.length === 0) return null;

  async function loadPlan() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setPlan(null);
    try {
      const response = await fetch(`/api/action-settlement?project=${encodeURIComponent(projectId)}`);
      const body = (await response.json()) as { plan?: ActionSettlementPlan; error?: string };
      if (!response.ok || !body.plan) throw new Error(body.error ?? "Could not load the Action.");
      setPlan(body.plan);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function settle() {
    if (!plan) return;
    setSettling(true);
    setError(null);
    try {
      const response = await fetch("/api/action-settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, note: note.trim() || undefined })
      });
      const body = (await response.json()) as { message?: string; nextActionKey?: string | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Settlement failed.");
      setResult({ message: body.message ?? "Action settled.", nextActionKey: body.nextActionKey ?? null });
      setPlan(null);
      setNote("");
      await onSettled();
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : String(settleError));
    } finally {
      setSettling(false);
    }
  }

  return (
    <details className="mb-4 rounded-md border border-line bg-panel p-3 text-sm shadow-soft">
      <summary className="cursor-pointer font-semibold text-ink">Settle a completed Action</summary>
      <div className="mt-3 grid gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-muted">
            Project
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setPlan(null);
                setResult(null);
                setError(null);
              }}
              className="min-w-0 rounded-md border border-line bg-panel px-3 py-2 text-sm font-normal text-ink shadow-soft"
            >
              {settleable.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadPlan()}
            disabled={loading || !projectId}
            className="rounded-md border border-line bg-panel px-3 py-2 text-sm font-semibold text-ink shadow-soft transition hover:border-steel disabled:opacity-50"
          >
            {loading ? "Loading…" : "Review current Action"}
          </button>
        </div>

        {error ? (
          <div className="rounded-md border border-clay/40 bg-clay/10 p-3 text-xs text-clay">{error}</div>
        ) : null}

        {result ? (
          <div className="rounded-md border border-moss/30 bg-moss/10 p-3 text-sm text-moss">
            <p className="font-medium leading-5">{result.message}</p>
            <p className="mt-1 text-xs leading-5 text-moss/80">
              Next action: {result.nextActionKey ?? "none — the Plan may be complete"}
            </p>
          </div>
        ) : null}

        {plan ? (
          <div className="grid gap-3 rounded-md border border-line bg-canvas p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-steel">
                {plan.projectSlug}/{plan.actionId}
              </p>
              <p className="mt-1 break-words font-semibold leading-5 text-ink">{plan.actionTitle}</p>
              <p className="mt-1 break-words text-xs text-muted">
                Candidate revision {plan.candidateRevision.slice(0, 12)} · repo HEAD must match to settle
              </p>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Acceptance criteria ({plan.criteria.length}) — all recorded as met on settle
              </p>
              <ul className="grid gap-1">
                {plan.criteria.map((criterion, index) => (
                  <li key={index} className="flex gap-2 break-words text-xs leading-5 text-ink">
                    <span aria-hidden className="text-moss">✓</span>
                    <span>{criterion.criterion}</span>
                  </li>
                ))}
              </ul>
            </div>

            <label className="grid gap-1 text-xs font-semibold text-muted">
              Evidence note (applied to every criterion, optional)
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="e.g. Reviewed the diff and ran the suite locally."
                className="min-w-0 rounded-md border border-line bg-panel px-3 py-2 text-sm font-normal text-ink shadow-soft"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void settle()}
                disabled={settling}
                className="rounded-md border border-moss/40 bg-moss/10 px-3 py-2 text-sm font-semibold text-moss shadow-soft transition hover:border-moss disabled:opacity-50"
              >
                {settling ? "Settling…" : "Settle as operator"}
              </button>
              <button
                type="button"
                onClick={() => setPlan(null)}
                disabled={settling}
                className="rounded-md border border-line bg-panel px-3 py-2 text-sm font-semibold text-muted shadow-soft transition hover:border-steel disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs leading-5 text-muted">
              Completion refuses unless every criterion is met and the candidate revision equals the Project
              repository’s current HEAD. Merge, deployment, and publication remain separate gates.
            </p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
