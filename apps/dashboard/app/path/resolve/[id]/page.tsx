"use client";

import { ArrowLeft, CheckCircle2, HelpCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "../../../../components/dashboard-ui";
import { MobileShell } from "../../../../components/mobile-shell";
import type { WorkQuestionContext } from "../../../../lib/arcadia-cli";

/**
 * Resolve — the screen Path's gaps link to.
 *
 * Path's job is to show the route and say where it is unplanned or blocked.
 * It was deliberately never given a way to act, because a projection that can
 * also be edited stops matching what agents are dispatched against. This page
 * is the other half of that split: one Action, its exact blocking question,
 * and a single answer box, reached by tapping the gap rather than guessing
 * which of several unrelated Decisions might cover it.
 *
 * Submitting does not just record an answer. It also opens the Decision if
 * one was never created — the exact failure that produced the wrong-question
 * confusion this screen exists to prevent — and immediately asks Arcadia to
 * continue clarifying the Action, so answering here is the whole loop rather
 * than the first half of one.
 */
export default function ResolveQuestionPage() {
  const params = useParams<{ id: string }>();
  const [context, setContext] = useState<WorkQuestionContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/work-question/${encodeURIComponent(params.id)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "This Action could not be loaded.");
      setContext(body as WorkQuestionContext);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!answer.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/work-question/${encodeURIComponent(params.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The answer could not be recorded.");
      setOutcome(body.message as string);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <MobileShell>
        <BackToPath />
        <ErrorState title="Resolve" message={error} />
      </MobileShell>
    );
  }
  if (!context) {
    return (
      <MobileShell>
        <BackToPath />
        <p className="text-sm text-muted">Loading…</p>
      </MobileShell>
    );
  }

  const { workItem } = context;

  return (
    <MobileShell>
      <BackToPath />

      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{workItem.project ?? "Unknown project"}</p>
        <h1 className="mt-1 text-xl font-bold leading-6">{workItem.title}</h1>
        {context.blockedGate ? (
          <p className="mt-2 text-sm text-muted">
            Blocks <span className="font-semibold text-ink">{context.blockedGate.gateTitle}</span> on the path — this is
            the only thing standing in the way there.
          </p>
        ) : null}
        {context.reviewItem ? (
          <p className="mt-1 text-xs text-muted">Decision {context.reviewItem.slug} · {context.reviewItem.status}</p>
        ) : null}
      </header>

      {!context.resolvable ? (
        <div className="rounded-md border border-line bg-panel p-4 text-sm text-muted shadow-soft">
          Nothing here is waiting on an answer. This Action's clarification status is{" "}
          <span className="font-mono">{workItem.clarificationStatus ?? "none"}</span>.
        </div>
      ) : outcome ? (
        <div className="rounded-md border border-moss/30 bg-moss/10 p-4 shadow-soft">
          <p className="flex items-start gap-2 text-sm font-medium text-moss">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {outcome}
          </p>
          <Link
            href="/path"
            className="mt-4 inline-flex min-h-10 items-center rounded-md bg-moss px-4 text-sm font-semibold text-white"
          >
            Back to Path
          </Link>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-clay/30 bg-clay/5 p-4 shadow-soft">
            <p className="flex items-start gap-2 text-sm font-medium text-clay">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {workItem.openQuestion}
            </p>
            {workItem.gapType ? <p className="mt-2 text-xs text-muted">Gap type: {workItem.gapType}</p> : null}
            {workItem.expectedArtifact ? (
              <p className="mt-2 text-xs text-muted">Expected artifact: {workItem.expectedArtifact}</p>
            ) : null}
            {workItem.docRef ? <p className="mt-2 font-mono text-xs text-muted">{workItem.docRef}</p> : null}
          </div>

          <label className="mt-4 block text-sm font-semibold">
            Your answer
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              className="mt-1 min-h-28 w-full rounded-md border border-line bg-canvas p-3 text-sm font-normal"
              placeholder="Answer plainly — this becomes the Decision's record and is what unblocks the Action."
              autoFocus
            />
          </label>

          <button
            disabled={submitting || !answer.trim()}
            onClick={() => void submit()}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-moss px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Recording…" : "Answer and continue"}
          </button>
        </>
      )}
    </MobileShell>
  );
}

function BackToPath() {
  return (
    <Link href="/path" className="mb-5 inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-steel">
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to Path
    </Link>
  );
}
