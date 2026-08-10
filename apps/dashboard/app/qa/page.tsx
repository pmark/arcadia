"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "../../components/dashboard-ui";
import type { QaCandidate } from "../../lib/types";

export default function QaPage() {
  const [candidates, setCandidates] = useState<QaCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
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
                <Fact label="Revision" value={candidate.revision ?? "Unknown revision"} />
                <Fact label="Validation" value={candidate.validation} />
                <Fact label="Evidence" value={candidate.evidenceFreshness} />
                <Fact label="Target state" value={candidate.targetState} />
              </dl>
              <p className="mt-4 rounded-md bg-canvas p-3 text-sm text-ink"><span className="font-semibold">Test procedure: </span>{candidate.testProcedure}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {candidate.targetUrl && candidate.targetState !== "missing" && candidate.targetState !== "unreachable" ? <a href={candidate.targetUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white"><ExternalLink className="h-4 w-4" />Test Candidate</a> : <span className="rounded-md border border-clay/30 bg-clay/10 px-3 py-2 text-sm font-medium text-clay">No reachable configured test target</span>}
                {candidate.pullRequestUrl ? <a href={candidate.pullRequestUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-md border border-line px-3 text-sm font-semibold">Open pull request</a> : <span className="px-3 py-2 text-sm text-muted">No pull request configured</span>}
              </div>
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
