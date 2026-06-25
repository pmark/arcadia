"use client";

import { useState } from "react";
import { Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { MobileShell } from "../../components/mobile-shell";
import { ErrorState } from "../../components/dashboard-ui";
import type { AskResponse } from "../../lib/types";

type FeedbackDecision = "up" | "down";

export default function CapturePage() {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [note, setNote] = useState("");
  const [feedbackGiven, setFeedbackGiven] = useState<FeedbackDecision | null>(null);
  const [feedbackPending, setFeedbackPending] = useState<FeedbackDecision | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = text.trim();
    if (!request) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(errorMessageFromBody(body, "Ask request failed."));
      }

      setText("");
      setNote("");
      setFeedbackGiven(null);
      setFeedbackError(null);
      setResponse(body.result as AskResponse);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setPending(false);
    }
  }

  async function submitFeedback(decision: FeedbackDecision) {
    const askRequestId = response?.ask?.id;
    if (!askRequestId) {
      return;
    }

    setFeedbackPending(decision);
    setFeedbackError(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ askRequestId, decision, note: note.trim() || undefined })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(errorMessageFromBody(body, "Feedback failed."));
      }
      setFeedbackGiven(decision);
    } catch (submitError) {
      setFeedbackError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setFeedbackPending(null);
    }
  }

  return (
    <MobileShell>
      <h1 className="mb-4 text-lg font-semibold">Capture</h1>

      <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Say anything — Arcadia will route it."
          rows={4}
          className="min-w-0 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted focus:border-steel"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-4 text-sm font-semibold text-steel transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {pending ? "Working..." : "Send"}
        </button>
      </form>

      {error ? (
        <div className="mt-4">
          <ErrorState title="Ask failed" message={error} />
        </div>
      ) : null}

      {response ? (
        <div className="mt-4 grid min-w-0 gap-3 rounded-md border border-line bg-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            {response.result.status.replace(/_/g, " ")}
          </div>
          <p className="min-w-0 break-words text-sm text-ink">{response.result.summary}</p>
          {response.intake.proposedAction ? (
            <p className="min-w-0 break-words text-sm text-muted">{response.intake.proposedAction}</p>
          ) : null}

          {response.ask?.id ? (
            <div className="grid min-w-0 gap-2 border-t border-line pt-3">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional note"
                disabled={feedbackGiven !== null}
                className="min-h-9 min-w-0 rounded-md border border-line bg-canvas px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-steel disabled:opacity-60"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void submitFeedback("up")}
                  disabled={feedbackPending !== null || feedbackGiven !== null}
                  className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition disabled:cursor-not-allowed ${
                    feedbackGiven === "up"
                      ? "border-moss bg-moss/10 text-moss"
                      : "border-line text-muted hover:border-moss hover:text-moss disabled:opacity-60"
                  }`}
                >
                  <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                  {feedbackPending === "up" ? "Saving..." : "Up"}
                </button>
                <button
                  type="button"
                  onClick={() => void submitFeedback("down")}
                  disabled={feedbackPending !== null || feedbackGiven !== null}
                  className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition disabled:cursor-not-allowed ${
                    feedbackGiven === "down"
                      ? "border-clay bg-clay/10 text-clay"
                      : "border-line text-muted hover:border-clay hover:text-clay disabled:opacity-60"
                  }`}
                >
                  <ThumbsDown className="h-4 w-4" aria-hidden="true" />
                  {feedbackPending === "down" ? "Saving..." : "Down"}
                </button>
              </div>
              {feedbackGiven ? (
                <p className="text-xs font-medium text-muted">Recorded. Thanks.</p>
              ) : null}
              {feedbackError ? <ErrorState title="Feedback failed" message={feedbackError} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </MobileShell>
  );
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const error = "error" in body && typeof body.error === "string" ? body.error : fallback;
  const details = "details" in body ? body.details : null;
  if (!details) {
    return error;
  }

  return `${error}\n${JSON.stringify(details, null, 2)}`;
}
