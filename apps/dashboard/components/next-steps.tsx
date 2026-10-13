import type { NextStep, NextStepsSource } from "../../../src/decisions/nextSteps";
import type { NextStepsResponse } from "../lib/next-steps-server";

export interface NextStepsProps {
  data: NextStepsResponse | null;
  /** The last read failed; the list shown (if any) may be out of date. */
  failed?: boolean;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const SOURCE_LABEL: Record<NextStepsSource, string> = {
  prs: "the pull-request list",
  queue: "the work queue",
  cards: "the decision cards",
  checks: "pull-request reviews and checks"
};

function Click({ step }: { step: NextStep }) {
  if (step.kind === "wait" || step.click === null || step.href === null) return null;
  const external = /^https:\/\//i.test(step.href);
  return (
    <a
      href={step.href}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      className="mt-2 inline-flex min-h-[44px] items-center break-words rounded-md border border-line bg-ink px-3 text-sm font-semibold text-white"
      data-testid="next-step-click"
    >
      {step.click}
    </a>
  );
}

function Head({ step }: { step: NextStep }) {
  if (step.pinnedHeadSha === null || !SHA_RE.test(step.pinnedHeadSha)) return null;
  return (
    <p className="mt-1 text-xs text-muted">
      Pinned head <code className="text-ink">{step.pinnedHeadSha.slice(0, 7)}</code>
    </p>
  );
}

/**
 * Every operator touch in the order that unblocks the queue. Read-only: the one click a step names is a plain link
 * (to the pull request on GitHub, or to the card below); a step that cannot be taken yet shows what it waits on
 * and has no link and no button. All text is rendered as text. Production is only said to be moving in state
 * `moving`; every other state says what it knows.
 */
export function NextSteps({ data, failed = false }: NextStepsProps) {
  if (data === null) {
    return (
      <section aria-label="Next steps" className="mb-6" data-testid="next-steps">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Next steps</h2>
        <p className="text-sm text-muted">{failed ? "Next steps could not be read right now." : "Reading next steps…"}</p>
      </section>
    );
  }
  const now = data.nowStep;
  const rest = data.steps.filter((step) => now === null || step.id !== now.id);
  return (
    <section aria-label="Next steps" className="mb-6" data-testid="next-steps" data-state={data.state}>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Next steps</h2>
      {failed ? <p role="alert" className="mb-2 text-sm text-red-700">The latest read failed; this list may be out of date.</p> : null}
      {data.inventoryStale ? (
        <p className="mb-2 text-sm text-muted" data-testid="next-steps-stale">
          PR list may be out of date: last read {data.inventoryCheckedAt ?? "at an unknown time"}.
        </p>
      ) : null}
      {data.unavailable.length > 0 ? (
        <p role="alert" className="mb-2 text-sm text-red-700" data-testid="next-steps-unavailable">
          Could not read: {data.unavailable.map((source) => SOURCE_LABEL[source] ?? source).join(", ")}. Steps may be missing, so nothing can be said about what is next beyond what is listed.
        </p>
      ) : null}
      {data.state === "now" && now !== null ? (
        <article className="rounded-md border-2 border-ink bg-panel p-4 shadow-soft" data-testid="next-step-now">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink">Do this now</span>
          <h3 className="mt-1 break-words font-semibold">{now.title}</h3>
          <Click step={now} />
          <Head step={now} />
          <p className="mt-2 break-words text-sm"><strong>Unblocks:</strong> {now.unblocks}</p>
          <p className="mt-1 break-words text-xs text-muted">{now.reason}</p>
          {data.waitingAhead.length > 0 ? (
            <ul className="mt-2 grid gap-1 text-sm" aria-label="Higher priority, waiting" data-testid="next-step-waiting-ahead">
              {data.waitingAhead.map((line) => (
                <li key={line} className="break-words">{line}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ) : data.state === "waiting" ? (
        <p className="rounded-md border border-line bg-panel p-4 text-sm font-semibold" role="status" data-testid="next-steps-waiting">
          {data.waitingSummary}
        </p>
      ) : data.state === "moving" ? (
        <p className="rounded-md border border-line bg-panel p-4 text-sm font-semibold" role="status" data-testid="next-steps-moving">
          Production is moving. Nothing needs you right now.
        </p>
      ) : null}
      {rest.length > 0 ? (
        <ol className="mt-3 grid gap-2" aria-label="Then, in this order" data-testid="next-steps-rest">
          {rest.map((step) => (
            <li key={step.id} className="min-w-0 rounded-md border border-line bg-panel p-3 text-sm" data-testid="next-step" data-step-id={step.id} data-kind={step.kind}>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                {step.order}. {step.kind === "wait" ? "Waiting" : step.kind}
              </span>
              <p className="mt-1 break-words font-semibold">{step.title}</p>
              {step.kind === "wait" ? (
                <p className="mt-1 break-words text-muted" data-testid="next-step-waiting">
                  Waiting on: {step.waitingFor}
                </p>
              ) : (
                <Click step={step} />
              )}
              <Head step={step} />
              <p className="mt-1 break-words text-xs text-muted">Unblocks: {step.unblocks}</p>
              {step.kind === "wait" ? <p className="mt-1 break-words text-xs text-muted">{step.reason}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {data.hidden > 0 ? <p className="mt-2 text-sm text-muted" data-testid="next-steps-hidden">{data.hidden} more not shown.</p> : null}
      {data.ignored > 0 ? <p className="mt-1 text-xs text-muted">{data.ignored} unreadable item{data.ignored === 1 ? "" : "s"} ignored.</p> : null}
      {data.otherRepositories > 0 ? <p className="mt-1 text-xs text-muted">{data.otherRepositories} pull request{data.otherRepositories === 1 ? "" : "s"} in other repositories are not listed here.</p> : null}
    </section>
  );
}
