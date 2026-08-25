"use client";

import { AlertTriangle, ChevronDown, ChevronRight, Flag, HelpCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "../../components/dashboard-ui";
import { MobileShell } from "../../components/mobile-shell";
import type { GateStatus } from "../../lib/now-types";
import type { PathBrief, PathGap, PathLeg, PathStep, PathStepState } from "../../lib/path-types";

/**
 * Path — the route from today to the declared target.
 *
 * Now answers "am I closer, and what do I do in the next hour?". Neither
 * question is the one asked when a target starts to feel unreachable, which is
 * "what is actually left?" A five-gate checklist cannot answer it, because
 * every checkbox hides however many Actions stand behind it.
 *
 * This is deliberately not a task list, and the layout has to keep saying so:
 *
 *   - Nothing can be added here. Every step is an Action a plan document
 *     already declares; the screen is a projection, and edits belong in the
 *     document. A surface where work can be invented is a surface where work
 *     stops matching what the agents are dispatched against.
 *   - Order comes from `depends_on`, never from dates or drag position. Plans
 *     declare which work waits on which, and that is the only ordering the
 *     path can honestly claim.
 *   - Gaps render as loudly as steps. Where nothing is planned, or an Action's
 *     next move is undecided, a checklist shows blank space and a task list
 *     shows nothing at all — but that unplanned stretch is usually the real
 *     distance to the target.
 *   - History stays, collapsed. Finished steps are what makes the remaining
 *     three look small; hiding them entirely would make a nearly-done path
 *     look identical to one that has not started.
 */

const STEP_MARK: Record<PathStepState, { glyph: string; ring: string; text: string }> = {
  done: { glyph: "✓", ring: "border-moss bg-moss text-white", text: "text-muted line-through decoration-line" },
  in_progress: { glyph: "◐", ring: "border-gold bg-gold/15 text-gold", text: "text-ink font-semibold" },
  blocked: { glyph: "!", ring: "border-clay bg-clay/10 text-clay", text: "text-clay font-semibold" },
  planned: { glyph: "", ring: "border-line bg-panel text-muted", text: "text-ink" }
};

const GATE_MARK: Record<GateStatus, string> = {
  done: "border-moss bg-moss text-white",
  in_progress: "border-gold bg-gold/15 text-gold",
  blocked: "border-clay bg-clay/10 text-clay",
  open: "border-line bg-panel text-muted",
  unknown: "border-line bg-panel text-muted"
};

export default function PathPage() {
  const [brief, setBrief] = useState<PathBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/path", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The path could not be resolved.");
      setBrief(body as PathBrief);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return <MobileShell><ErrorState title="Path" message={error} /></MobileShell>;
  }
  if (!brief) {
    return <MobileShell><p className="text-sm text-muted">Resolving the path…</p></MobileShell>;
  }
  if (!brief.target.declared) {
    return (
      <MobileShell>
        <ErrorState title="No target declared" message={brief.warnings[0] ?? "Declare a North Star before a path can exist."} />
      </MobileShell>
    );
  }

  const { totals } = brief;

  return (
    <MobileShell>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">The path to</p>
        <h1 className="mt-1 text-2xl font-bold leading-7">{brief.target.text}</h1>
        <p className="mt-2 text-sm text-muted">{brief.target.looksLike}</p>
      </header>

      {/* Remaining counts down; done is the smaller, quieter number. A count
          that grows with the project makes real progress feel like standing
          still, which is the failure mode a backlog has and a path must not. */}
      <section className="mb-6 flex items-end gap-4 rounded-md border border-line bg-panel p-4 shadow-soft">
        <div>
          <p className="text-4xl font-bold leading-none">{totals.remaining}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">steps left</p>
        </div>
        <div className="flex-1 text-right text-xs text-muted">
          <p>{totals.stepsDone} of {totals.steps} done</p>
          <p>{totals.gatesDone} of {totals.gates} gates cleared</p>
          {totals.gaps > 0 ? (
            <p className="mt-1 font-semibold text-clay">{totals.gaps} unplanned</p>
          ) : null}
        </div>
      </section>

      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={() => setShowHistory((current) => !current)}
          className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-steel"
        >
          {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {showHistory ? "Hide" : "Show"} the {totals.stepsDone} finished steps
        </button>
      </div>

      <ol className="relative grid gap-6">
        {brief.legs.map((leg) => <Leg key={leg.gateId} leg={leg} showHistory={showHistory} />)}
        <li className="relative flex items-start gap-3">
          <span className="z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-moss bg-moss text-white">
            <Flag className="h-4 w-4" />
          </span>
          <p className="pt-1 text-sm font-bold">{brief.target.text}</p>
        </li>
      </ol>

      <p className="mt-8 text-xs text-muted">
        Every step here is an Action a plan document already declares, ordered by the{" "}
        <code className="font-mono">depends_on</code> those documents carry. Nothing can be added on this screen —
        it is a projection of{" "}
        <span className="font-mono">{brief.target.documentPath?.split("/").slice(-1)[0] ?? "NORTH_STAR.md"}</span>{" "}
        and the plans behind it.
      </p>
    </MobileShell>
  );
}

function Leg({ leg, showHistory }: { leg: PathLeg; showHistory: boolean }) {
  const visible = leg.nodes.filter((node) => node.kind === "gap" || node.state !== "done" || showHistory);
  const hidden = leg.nodes.length - visible.length;

  return (
    <li className="relative">
      {/* The connector is the whole point of a path: it says these steps are
          one route, not four independent piles. */}
      <span aria-hidden className="absolute left-3.5 top-8 bottom-0 w-px bg-line" />

      <div className="relative flex items-start gap-3">
        <span className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${GATE_MARK[leg.gateStatus]}`}>
          {leg.gateStatus === "done" ? "✓" : leg.gateStatus === "in_progress" ? "◐" : leg.gateStatus === "blocked" ? "!" : ""}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className={`text-base font-semibold leading-6 ${leg.gateStatus === "done" ? "text-muted" : "text-ink"}`}>
            {leg.gateTitle}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {leg.remaining === 0 ? "Nothing left here" : `${leg.remaining} step${leg.remaining === 1 ? "" : "s"} left`}
            {!leg.derived ? " · operator-owned" : null}
          </p>
        </div>
      </div>

      <ul className="mt-3 grid gap-2 pl-10">
        {visible.map((node, index) =>
          node.kind === "gap"
            ? <GapRow key={`gap-${index}`} gap={node} />
            : <StepRow key={node.workItemId} step={node} />
        )}
        {hidden > 0 && !showHistory ? (
          <li className="text-xs text-muted">{hidden} finished step{hidden === 1 ? "" : "s"} hidden</li>
        ) : null}
      </ul>
    </li>
  );
}

function StepRow({ step }: { step: PathStep }) {
  const mark = STEP_MARK[step.state];
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${mark.ring}`}>
        {mark.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-5 ${mark.text}`}>{step.title}</p>
        {/* The next move is shown only where it can be acted on. Printing it
            under finished work turns the path back into a wall of text. */}
        {step.state !== "done" && step.nextAction ? (
          <p className="mt-1 text-xs leading-4 text-muted">{step.nextAction}</p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * A gap is rendered at full weight, not as an absence.
 *
 * Where nothing is planned is normally the largest unknown between here and
 * the target, and every surface that showed it as blank space taught the
 * operator to read a short list as a short distance.
 */
function GapRow({ gap }: { gap: PathGap }) {
  const operatorOwned = gap.reason === "operator_owned" || gap.reason === "no_declared_work";
  return (
    <li className="flex items-start gap-2.5 rounded-md border border-dashed border-clay/40 bg-clay/5 p-2.5">
      <span className="mt-0.5 shrink-0 text-clay">
        {operatorOwned ? <HelpCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      </span>
      <p className="text-xs leading-4 text-clay">{gap.detail}</p>
    </li>
  );
}
