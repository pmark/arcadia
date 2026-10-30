"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SessionObservation } from "../lib/session-observation";
import { PAUSE_CAPABILITY } from "../lib/production-console";
import { workspaceHref } from "../lib/workspace-scope";
import { SessionRow } from "./production-console";

export function SessionDetail({ id }: { id: string }) {
  const [read, setRead] = useState<SessionObservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
        const body = await response.json() as SessionObservation & { error?: string };
        if (!response.ok || !body.known || !("session" in body)) throw new Error(body.error ?? "Session records could not be verified.");
        if (body.session && body.session.id !== id) throw new Error("The returned Session does not match this link.");
        if (!disposed) { setRead(body); setError(null); }
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); }
      if (!disposed) timer = setTimeout(() => { void load(); }, 4000);
    };
    void load();
    return () => { disposed = true; clearTimeout(timer); };
  }, [id, retry]);
  const session = read?.session;
  return <main data-theme-scope="auto" className="min-h-dvh bg-canvas p-4 text-ink">
    <div className="mx-auto max-w-3xl space-y-4">
      <nav><Link href="/production">All Sessions and runs</Link></nav>
      <h1 ref={heading} tabIndex={-1} className="break-words text-xl font-semibold">Session {id}</h1>
      {error && <p role="alert">Session lookup unavailable: {error}{read ? " Showing the last successful read." : ""} <button onClick={() => setRetry(n => n + 1)}>Check again</button></p>}
      {!read && !error && <p role="status">Reading this Session…</p>}
      {read && !session && <p>No recorded Session matches this link. Check the Session identity or return to Sessions and runs.</p>}
      {session && <>
        <p>Recorded Session · checked {new Date(read.observedAt).toLocaleTimeString()}</p>
        <p>{read?.projectSlug ? <Link href={workspaceHref({ project: read.projectSlug, plan: session.planSlug, action: session.actionId })}>Back to this Action</Link> : <Link href={`/projects/${encodeURIComponent(session.projectId)}`}>Back to Project</Link>}</p>
        <section aria-label="Selected Session" className="rounded-lg ring-2 ring-steel">
          <SessionRow session={session} now={new Date()} pause={PAUSE_CAPABILITY} defaultOpen />
        </section>
      </>}
    </div>
  </main>;
}
