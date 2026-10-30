"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { SessionObservation } from "../../lib/session-observation";
import { sessionHref } from "../../lib/session-link";

/** Reload-safe observation. An unreadable record is never treated as permission to launch. */
export function WorkspaceActionSession({ projectId, plan, action, children }: {
  projectId: string; plan: string; action: string; children?: ReactNode;
}) {
  const [read, setRead] = useState<SessionObservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    const url = `/api/projects/${encodeURIComponent(projectId)}/action-session?${new URLSearchParams({ plan, action })}`;
    fetch(url, { cache: "no-store" }).then(async response => {
      const body = await response.json() as SessionObservation & { error?: string };
      if (!response.ok || !body.known || !body.observedAt || !("session" in body)) throw new Error(body.error ?? "Session records could not be verified.");
      if (body.session && (body.session.projectId !== projectId || body.session.planSlug !== plan || body.session.actionId !== action)) throw new Error("Session scope did not match this Action.");
      if (!disposed) { setRead(body); setError(null); }
    }).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { disposed = true; };
  }, [projectId, plan, action, retry]);
  useEffect(() => {
    // Recheck on return without discarding an in-flight preview or unknown receipt.
    const onFocus = () => setRetry(n => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const failure = error && <div className="workspace-continue"><p role="alert">Session lookup unavailable: {error} Check existing Sessions before continuing.</p><button onClick={() => setRetry(n => n + 1)}>Check Sessions again</button></div>;
  if (!read) return failure || <p role="status">Checking this Action&apos;s Sessions…</p>;
  const session = read.session;
  if (!session) return <>{failure}<fieldset className="min-w-0 border-0 p-0" disabled={Boolean(error)}>{children}</fieldset></>;
  const active = session.status === "running" || session.status === "prepared";
  return <>{failure}<section className="workspace-continue-feedback" aria-label="This Action's Session">
    <h3>{active ? "This Action already has a Session" : "Latest Session for this Action"}</h3>
    <p>{plan} · {action}</p>
    <p>{session.statusLabel} · <code>{session.id}</code></p>
    <p><Link href={sessionHref(session.id)}>View Session</Link></p>
    <p className="workspace-muted">Recorded in Arcadia · checked {new Date(read.observedAt).toLocaleTimeString()}. View Session for current progress.</p>
    {!active && children && <details><summary>Continue options for this Action</summary><fieldset className="min-w-0 border-0 p-0" disabled={Boolean(error)}>{children}</fieldset></details>}
  </section></>;
}
