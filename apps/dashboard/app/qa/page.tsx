"use client";

import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "../../components/dashboard-ui";
import { initialTargetStateLabel, reachabilityFromCheck, type QaReachability } from "../../lib/qa";
import type { ProofTargetCheckResponse, QaCandidate, QaRefreshResult } from "../../lib/types";

type CardStatus = {
  tone: "success" | "warning" | "error";
  message: string;
};

export default function QaPage() {
  const [candidates, setCandidates] = useState<QaCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [cardStatus, setCardStatus] = useState<Record<string, CardStatus>>({});
  const [reachability, setReachability] = useState<Record<string, QaReachability>>({});
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/qa", { cache: "no-store" });
      const body = await response.json() as { candidates?: QaCandidate[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "QA queue could not be loaded.");
      setCandidates(body.candidates ?? []);
      setLoadedAt(new Date());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function record(candidate: QaCandidate, decision: "pass" | "fail" | "needs-follow-up") {
    setPending(`${candidate.id}:${decision}`);
    setMessage(null);
    try {
      const response = await fetch("/api/qa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: candidate.id, decision, note: notes[candidate.id] ?? "" }) });
      const body = await response.json() as { error?: string; review?: { slug?: string } };
      if (!response.ok) throw new Error(body.error ?? "QA Decision could not be recorded.");
      setMessage(`Recorded ${decision} for ${candidate.label}${body.review?.slug ? ` as ${body.review.slug}` : ""}. This does not merge, deploy, or release it.`);
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : String(recordError));
    } finally {
      setPending(null);
    }
  }

  async function check(candidate: QaCandidate) {
    setPending(`${candidate.id}:check`);
    setCardStatus((current) => omit(current, candidate.id));
    try {
      const response = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", candidateId: candidate.id })
      });
      const body = await response.json() as ProofTargetCheckResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The configured target could not be checked.");
      const checked = reachabilityFromCheck(candidate, body);
      setReachability((current) => ({ ...current, [candidate.id]: checked }));
      setCardStatus((current) => ({
        ...current,
        [candidate.id]: {
          tone: checked.state === "ready" ? "success" : checked.state === "access-protected" ? "warning" : "error",
          message: checked.label
        }
      }));
    } catch (checkError) {
      setCardStatus((current) => ({ ...current, [candidate.id]: { tone: "error", message: errorMessage(checkError) } }));
    } finally {
      setPending(null);
    }
  }

  async function pullAndRestart(candidate: QaCandidate) {
    setPending(`${candidate.id}:refresh`);
    setCardStatus((current) => omit(current, candidate.id));
    try {
      const response = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", candidateId: candidate.id })
      });
      const body = await response.json() as { result?: QaRefreshResult; error?: string };
      if (!response.ok) throw new Error(body.error ?? "The Candidate could not be refreshed.");
      if (!body.result) throw new Error("The refresh returned no result.");
      const result = body.result;

      if (result.refused) {
        setCardStatus((current) => ({ ...current, [candidate.id]: { tone: "error", message: result.message } }));
        return;
      }

      setNotes((current) => omit(current, candidate.id));
      setReachability((current) => omit(current, candidate.id));
      setMessage(null);
      await refresh();
      setCardStatus((current) => ({
        ...current,
        [candidate.id]: {
          tone: "success",
          message: `${result.message} QA note and review state reset; Check and test this Candidate again before recording a Decision.`
        }
      }));
    } catch (refreshError) {
      setCardStatus((current) => ({ ...current, [candidate.id]: { tone: "error", message: errorMessage(refreshError) } }));
    } finally {
      setPending(null);
    }
  }

  return (
    <DashboardChrome title="QA queue" subtitle={candidates.length ? `${candidates.length} configured Candidates` : undefined} refreshing={refreshing} lastLoadedAt={loadedAt} onRefresh={() => void refresh()}>
      <p className="mb-5 text-sm text-muted">Configured proof targets only. Test opens no inferred or unchecked destination; a Decision records operator QA against the displayed revision.</p>
      {error ? <ErrorState title="QA queue" message={error} /> : null}
      {message ? <div className="mb-4 rounded-md border border-moss/30 bg-moss/10 p-3 text-sm font-medium text-moss">{message}</div> : null}
      {loading ? <LoadingState /> : candidates.length === 0 ? <EmptyState text="No active QA Candidates are configured." /> : (
        <div className="grid gap-4">
          {candidates.map((candidate) => (
            <section key={candidate.id} className="rounded-md border border-line bg-panel p-4 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-moss">{candidate.project}</p><h2 className="text-lg font-semibold">{candidate.label}</h2></div>
                <StatusBadge status={candidate.environment === "Candidate" ? "active" : "completed"} label={candidate.environment} />
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <Fact label="Revision" value={candidate.revision ?? "Unknown revision"} />
                  {(candidate.environmentKind === "local" || candidate.environmentKind === "lan") && candidate.refreshable ? <button disabled={pending !== null} onClick={() => void pullAndRestart(candidate)} className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-3 text-xs font-semibold text-steel disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${pending === `${candidate.id}:refresh` ? "animate-spin" : ""}`} />{pending === `${candidate.id}:refresh` ? "Pulling & restarting..." : "Pull & restart"}</button> : null}
                  {(candidate.environmentKind === "local" || candidate.environmentKind === "lan") && !candidate.refreshable ? <p className="mt-2 text-xs text-muted">This Project does not ship <code>scripts/services.sh</code>, so Arcadia cannot restart it from here.</p> : null}
                </div>
                <Fact label="Validation" value={candidate.validation} />
                <Fact label="Evidence" value={candidate.evidenceFreshness} />
                <Fact label="Target state" value={reachability[candidate.id]?.label ?? initialTargetStateLabel(candidate)} />
              </dl>
              {cardStatus[candidate.id] ? <CardMessage status={cardStatus[candidate.id]} /> : null}
              <p className="mt-4 rounded-md bg-canvas p-3 text-sm text-ink"><span className="font-semibold">Test procedure: </span>{candidate.testProcedure}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {candidate.targetUrl && candidate.targetState !== "missing" && reachability[candidate.id]?.state !== "unreachable" ? <a href={candidate.targetUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white"><ExternalLink className="h-4 w-4" />Test Candidate</a> : <span className="rounded-md border border-clay/30 bg-clay/10 px-3 py-2 text-sm font-medium text-clay">No reachable configured test target</span>}
                {candidate.pullRequestUrl ? <a href={candidate.pullRequestUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-md border border-line px-3 text-sm font-semibold">Open pull request</a> : <span className="px-3 py-2 text-sm text-muted">No pull request configured</span>}
                {candidate.targetUrl ? <button disabled={pending !== null} onClick={() => void check(candidate)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${pending === `${candidate.id}:check` ? "animate-spin" : ""}`} />{pending === `${candidate.id}:check` ? "Checking..." : "Check"}</button> : null}
              </div>
              {candidate.environmentKind === "remote" ? <p className="mt-3 text-sm text-muted">Remote targets deploy through their own workflow. Check re-probes this target; Arcadia will not deploy or restart it here.</p> : null}
              <label className="mt-4 block text-sm font-semibold">Optional QA note<textarea value={notes[candidate.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [candidate.id]: event.target.value }))} className="mt-1 min-h-20 w-full rounded-md border border-line bg-canvas p-2 font-normal" maxLength={500} /></label>
              <div className="mt-3 flex flex-wrap gap-2"><button disabled={pending !== null} onClick={() => void record(candidate, "pass")} className="rounded-md bg-moss px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Pass</button><button disabled={pending !== null} onClick={() => void record(candidate, "fail")} className="rounded-md bg-clay px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Fail</button><button disabled={pending !== null} onClick={() => void record(candidate, "needs-follow-up")} className="rounded-md border border-line px-3 py-2 text-sm font-semibold disabled:opacity-60"><ShieldCheck className="mr-1 inline h-4 w-4" />Needs follow-up</button></div>
            </section>
          ))}
        </div>
      )}
    </DashboardChrome>
  );
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1 break-words text-ink">{value}</dd></div>; }

function CardMessage({ status }: { status: CardStatus }) {
  const style = status.tone === "success"
    ? "border-moss/30 bg-moss/10 text-moss"
    : status.tone === "warning"
      ? "border-steel/30 bg-steel/10 text-steel"
      : "border-clay/30 bg-clay/10 text-clay";
  return <p className={`mt-4 whitespace-pre-wrap rounded-md border p-3 text-sm font-medium ${style}`}>{status.message}</p>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...remaining } = record;
  return remaining;
}
