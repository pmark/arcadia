"use client";

import { useEffect, useState } from "react";
import { PullRequestAudio } from "./pull-request-audio";

export function PullRequestLinkAudio({ refreshToken = 0 }: { refreshToken?: number }) {
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<{ repository: string; number: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("pr");
    const target = url ? parsePullRequestUrl(url) : null;
    if (target && url) { setInput(url); setSelected(target); }
  }, []);

  return (
    <section className="rounded-md border border-line bg-panel p-4" aria-label="Listen to a PR by link">
      <h2 className="text-base font-semibold">Listen to a PR by link</h2>
      <p className="mt-1 text-xs text-muted">Includes merged PRs in configured repositories. Only the description is read.</p>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => {
        event.preventDefault();
        const target = parsePullRequestUrl(input);
        setError(target ? null : "Enter a GitHub pull-request URL, such as https://github.com/pmark/arcadia/pull/1308.");
        setSelected(target);
        setSelectionRevision(value => value + 1);
      }}>
        <input type="url" required value={input} onChange={event => setInput(event.target.value)} aria-label="GitHub pull-request URL" placeholder="https://github.com/owner/repo/pull/123" className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel">Select PR</button>
      </form>
      {error ? <p role="alert" className="mt-2 text-xs text-clay">{error}</p> : null}
      {selected ? <div className="mt-3"><p className="text-sm font-semibold">{selected.repository} #{selected.number}</p><PullRequestAudio showDescription key={`${selected.repository}:${selected.number}:${refreshToken}:${selectionRevision}`} {...selected} /></div> : null}
    </section>
  );
}

export function parsePullRequestUrl(input: string): { repository: string; number: number } | null {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[?#].*)?$/.exec(input.trim());
  if (!match) return null;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) && number > 0 ? { repository: match[1], number } : null;
}
