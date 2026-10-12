"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadAloudSource } from "../lib/pull-request-audio";
import { ReadAloud } from "./read-aloud";
import { MarkdownBody } from "./markdown-body";

export function PullRequestAudio({ repository, number, showDescription = false }: { repository: string; number: number; showDescription?: boolean }) {
  const prepared = useRef(false);
  const [source, setSource] = useState<ReadAloudSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!showDescription) return;
    const abort = new AbortController();
    void fetch(`/api/pull-requests/audio?repository=${encodeURIComponent(repository)}&number=${number}`, { cache: "no-store", signal: abort.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the PR body.");
      if (!prepared.current) setSource(body.source);
    }).catch(failure => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => abort.abort();
  }, [repository, number, showDescription]);
  return (
    <div className="mt-3 min-w-0">
      <ReadAloud endpoint="/api/pull-requests/audio" request={{ repository, number }} label="Play body" filename={`${repository.replace("/", "-")}-pr-${number}.mp3`} onSource={next => { prepared.current = true; setSource(next); setError(null); }} />
      {error ? <p role="alert" className="mt-2 text-xs text-clay">{error}</p> : null}
      {source ? <div className="mt-4 grid min-w-0 gap-4">
        <section aria-label="TLDR" className="rounded-md border border-steel/20 bg-steel/5 p-3"><h4 className="font-semibold">TLDR</h4>
          {source.summary ? <><p className="mt-2 text-sm leading-6">{source.summary}</p><p className="mt-2 text-xs text-muted">Generated summary. The original description is below.</p></> : <p className="mt-2 text-sm text-muted">{source.summaryError ?? "Press Play body to prepare a TLDR and audio."}</p>}
        </section>
        <section aria-label="Pull request body" className="min-w-0 rounded-md border border-line p-3"><h4 className="font-semibold">Pull request body</h4><MarkdownBody text={source.body} /><details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Source Markdown</summary><pre className="mt-2 whitespace-pre-wrap break-words">{source.body}</pre></details></section>
      </div> : null}
    </div>
  );
}
