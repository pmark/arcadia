"use client";

import { useCallback, useEffect, useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import { ErrorState } from "../../components/dashboard-ui";
import type { AttentionSlice, DriftLevel, GateStatus, NowBrief, ResolvedGate, TheOneThing } from "../../lib/now-types";

/**
 * Now — the screen the operator bookmarks.
 *
 * It answers one question, in this order, and refuses to answer any other:
 * what am I aiming at, how far away is it, what have I actually been doing,
 * and what is the single next move. Every layout choice below serves an
 * observation about how avoidance works, so the reasoning is written down
 * next to the markup rather than left for someone to reverse-engineer.
 *
 *   - One decision per screen. A screen offering three good options is a
 *     screen that gets closed, so exactly one action is rendered at full size
 *     and everything else is glanceable at a smaller one.
 *   - Distance closes, it never accumulates. The largest number is gates
 *     REMAINING, counting down. A backlog count grows as the project grows,
 *     which makes real progress feel like standing still.
 *   - Progress starts partly filled. An empty bar on a day of genuine work
 *     teaches the operator to stop believing the bar.
 *   - The uncomfortable number is stated once, plainly, without adjectives.
 *     Shame reliably increases avoidance; a fact the operator can check does
 *     not.
 *   - The escape hatch stays on target. The urge to go do something easier is
 *     not going away, so the screen aims it instead of fighting it.
 */

const DRIFT_STYLES: Record<DriftLevel, { chip: string; text: string; label: string }> = {
  on_target: { chip: "bg-moss/10 text-moss border-moss/30", text: "text-moss", label: "On target" },
  drifting: { chip: "bg-gold/10 text-gold border-gold/30", text: "text-gold", label: "Drifting" },
  off_target: { chip: "bg-clay/10 text-clay border-clay/30", text: "text-clay", label: "Off target" },
  unknown: { chip: "bg-line/40 text-muted border-line", text: "text-muted", label: "Unmeasured" }
};

const GATE_MARKS: Record<GateStatus, { glyph: string; className: string }> = {
  done: { glyph: "✓", className: "bg-moss text-white border-moss" },
  in_progress: { glyph: "◐", className: "bg-gold/15 text-gold border-gold" },
  blocked: { glyph: "!", className: "bg-clay/10 text-clay border-clay" },
  open: { glyph: "", className: "bg-panel text-muted border-line" },
  unknown: { glyph: "?", className: "bg-panel text-muted border-line" }
};

export default function NowPage() {
  const [brief, setBrief] = useState<NowBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [pendingGate, setPendingGate] = useState<string | null>(null);
  const [gateNote, setGateNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Deterministic pass first — it returns in well under a second, and the
      // operator sees the target and the distance before anything can stall.
      const fast = await fetch("/api/now", { cache: "no-store" });
      const fastBody = await fast.json();
      if (!fast.ok) {
        setError(fastBody?.error ?? "Could not read the Now brief.");
        return;
      }
      setBrief(fastBody as NowBrief);

      setNarrating(true);
      const narrated = await fetch("/api/now?narrate=1", { cache: "no-store" });
      const narratedBody = await narrated.json();
      if (narrated.ok && narratedBody?.reality) {
        setBrief(narratedBody as NowBrief);
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setNarrating(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Optimistic on purpose. The number falling is the only reward this screen
   * has to give, and it has to land on the tap rather than after a round trip
   * — a counter that lags feels like the system doubting you. The server is
   * still the authority: a refusal reverts the change and says why.
   */
  const toggleGate = useCallback(
    async (gate: ResolvedGate) => {
      const next: GateStatus = gate.status === "done" ? "open" : "done";
      setPendingGate(gate.id);
      setGateNote(null);
      setBrief((current) => (current ? applyGateStatus(current, gate.id, next) : current));

      try {
        const response = await fetch("/api/now/gate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ gateId: gate.id, status: next })
        });
        const body = await response.json();
        if (!response.ok) {
          setBrief((current) => (current ? applyGateStatus(current, gate.id, gate.status) : current));
          setGateNote(body?.error ?? "Could not mark that gate.");
          return;
        }
        // Re-read rather than trust the optimistic view: completing a gate can
        // change which single action the screen should be offering.
        const refreshed = await fetch("/api/now", { cache: "no-store" });
        const refreshedBody = await refreshed.json();
        if (refreshed.ok) {
          setBrief((current) => ({ ...(refreshedBody as NowBrief), reality: current?.reality ?? null }));
        }
      } catch (fetchError) {
        setBrief((current) => (current ? applyGateStatus(current, gate.id, gate.status) : current));
        setGateNote(fetchError instanceof Error ? fetchError.message : String(fetchError));
      } finally {
        setPendingGate(null);
      }
    },
    []
  );

  if (error) {
    return (
      <MobileShell>
        <ErrorState message={error} />
      </MobileShell>
    );
  }

  if (!brief) {
    return (
      <MobileShell>
        <p className="pt-16 text-center text-sm text-muted">Reading the week…</p>
      </MobileShell>
    );
  }

  if (!brief.target.declared) {
    return (
      <MobileShell>
        <UndeclaredTarget one={brief.theOneThing} warnings={brief.warnings} />
      </MobileShell>
    );
  }

  const drift = DRIFT_STYLES[brief.drift.level];

  return (
    <MobileShell>
      <div className="grid min-w-0 gap-7 pb-4">
        <header className="grid min-w-0 gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">North Star</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${drift.chip}`}>{drift.label}</span>
          </div>
          <h1 className="text-[34px] font-bold leading-[1.05] tracking-tight text-ink">{brief.target.text}</h1>
          {brief.target.looksLike ? (
            <p className="text-sm leading-snug text-muted">Done when {lowerFirst(brief.target.looksLike)}</p>
          ) : null}
        </header>

        <Distance brief={brief} />

        <Reality reality={brief.reality} narrating={narrating} driftLine={brief.drift.line} driftClass={drift.text} />

        <OneThing one={brief.theOneThing} />

        {brief.fifteenMinutes ? <FifteenMinutes one={brief.fifteenMinutes} /> : null}

        <Attention attention={brief.attention} />

        <Gates gates={brief.gates} onToggle={toggleGate} pending={pendingGate} />

        {gateNote ? (
          <p className="rounded-md border border-clay/30 bg-clay/5 p-3 text-sm leading-snug text-clay">{gateNote}</p>
        ) : null}

        <footer className="grid gap-2 pt-2">
          {brief.warnings.map((warning) => (
            <p key={warning} className="text-xs text-clay">
              ! {warning}
            </p>
          ))}
          <p className="text-[11px] leading-relaxed text-muted [overflow-wrap:anywhere]">
            Target declared in {brief.target.documentPath ?? "NORTH_STAR.md"}. Edit that file to change what this screen measures.
          </p>
        </footer>
      </div>
    </MobileShell>
  );
}

/**
 * The distance readout. The remaining count is the single largest element on
 * the page, because it is the number that moves when work gets done, and
 * watching it fall is the whole reward loop this screen has to offer.
 */
function Distance({ brief }: { brief: NowBrief }) {
  const { remaining, done, total, fraction } = brief.distance;

  return (
    <section className="grid min-w-0 gap-3 rounded-lg border border-line bg-panel p-5 shadow-soft">
      <div className="flex items-end gap-3">
        <span className="text-[72px] font-bold leading-[0.85] tracking-tighter text-ink">{remaining}</span>
        <span className="pb-2 text-lg font-semibold leading-tight text-muted">
          {remaining === 1 ? "gate away" : "gates away"}
        </span>
      </div>

      {/* Discrete segments, not a smooth bar: one filled square is a countable
          win, and nine of them is a finish line a person can actually picture. */}
      <div className="flex min-w-0 gap-1" aria-hidden>
        {brief.gates.map((gate) => (
          <span
            key={gate.id}
            className={`h-2.5 flex-1 rounded-sm ${
              gate.status === "done" ? "bg-moss" : gate.status === "in_progress" ? "bg-gold/60" : "bg-line"
            }`}
          />
        ))}
      </div>

      <p className="text-xs text-muted">
        {done} of {total} done{fraction > done / Math.max(total, 1) ? " · one underway" : ""}
        {brief.attention.daysSinceTargetCommit !== null
          ? ` · ${brief.target.projectName ?? "target"} last moved ${daysPhrase(brief.attention.daysSinceTargetCommit)}`
          : ""}
      </p>
    </section>
  );
}

/** What the week actually was, in specifics. Written by local Intelligence from commit subjects. */
function Reality({
  reality,
  narrating,
  driftLine,
  driftClass
}: {
  reality: NowBrief["reality"];
  narrating: boolean;
  driftLine: string;
  driftClass: string;
}) {
  return (
    <section className="grid min-w-0 gap-2">
      {reality ? (
        <>
          <h2 className="text-lg font-semibold leading-snug text-ink">{reality.headline}</h2>
          <p className="text-[15px] leading-relaxed text-ink/80">{reality.paragraph}</p>
        </>
      ) : narrating ? (
        <p className="text-sm italic text-muted">Reading what you actually did this week…</p>
      ) : null}
      <p className={`text-[15px] font-medium leading-snug ${driftClass}`}>{driftLine}</p>
    </section>
  );
}

/**
 * The one move. Rendered as the only high-contrast block on the page so that
 * a three-second glance from across the room resolves to a single sentence.
 */
function OneThing({ one }: { one: TheOneThing }) {
  return (
    <section className="grid min-w-0 gap-3 rounded-lg bg-ink p-5 text-white shadow-soft">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Do this now</span>
      <p className="text-[22px] font-semibold leading-[1.25]">{one.doThis}</p>
      <p className="text-sm leading-snug text-white/70">→ {one.unlocks}</p>
      {one.projectName ? (
        <span className="justify-self-start rounded-full border border-white/25 px-2 py-0.5 text-[11px] font-medium text-white/70">
          {one.projectName}
        </span>
      ) : null}
    </section>
  );
}

/**
 * The aimed escape hatch. Offered without apology or guilt language: on the
 * days the main move is too big, this is the version of "go do something
 * else" that still closes a gate.
 */
function FifteenMinutes({ one }: { one: TheOneThing }) {
  return (
    <section className="grid min-w-0 gap-2 rounded-lg border border-dashed border-line bg-panel p-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Only got 15 minutes?</span>
      <p className="text-[15px] font-medium leading-snug text-ink">{one.doThis}</p>
      <p className="text-xs text-muted">{one.unlocks}</p>
    </section>
  );
}

/** Where the week went, measured in commits — the number hardest to argue with. */
function Attention({ attention }: { attention: NowBrief["attention"] }) {
  const slices = attention.slices.filter((slice: AttentionSlice) => slice.commits > 0);
  if (slices.length === 0) {
    return null;
  }

  return (
    <section className="grid min-w-0 gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
        Where the last {attention.windowDays} days went
      </h2>
      <div className="grid gap-1.5">
        {slices.map((slice) => (
          <div key={slice.projectName} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className={`truncate text-sm ${slice.isTarget ? "font-semibold text-ink" : "text-muted"}`}>
                  {slice.isTarget ? "★ " : ""}
                  {slice.projectName}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-line">
                <div
                  className={`h-1.5 rounded-full ${slice.isTarget ? "bg-moss" : "bg-muted/50"}`}
                  style={{ width: `${Math.max(2, Math.round(slice.share * 100))}%` }}
                />
              </div>
            </div>
            <span className={`text-sm tabular-nums ${slice.isTarget ? "font-semibold text-ink" : "text-muted"}`}>
              {Math.round(slice.share * 100)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The finish line, itemized. Last on the page: reference, not instruction.
 *
 * Operator-owned gates are tappable; gates that track an Action are not, and
 * say so when tapped. That split is the honest one — a derived gate's status
 * belongs to the record, and letting a tap overwrite it would put the document
 * and the database into a disagreement this screen has no way to show.
 *
 * The tap is deliberately cheap and reversible. A mark that cannot be undone
 * is a mark people hesitate over, and hesitation is the exact friction this
 * removes; tapping a done gate returns it to open.
 */
function Gates({
  gates,
  onToggle,
  pending
}: {
  gates: ResolvedGate[];
  onToggle: (gate: ResolvedGate) => void;
  pending: string | null;
}) {
  return (
    <section className="grid min-w-0 gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">The finish line</h2>
      <ul className="grid gap-1.5">
        {gates.map((gate) => {
          const mark = GATE_MARKS[gate.status];
          const owned = !gate.derived;
          const busy = pending === gate.id;
          const body = (
            <>
              <span
                className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded border text-[11px] font-bold ${mark.className} ${
                  busy ? "opacity-50" : ""
                }`}
                aria-hidden
              >
                {busy ? "…" : mark.glyph}
              </span>
              <span
                className={`text-sm leading-snug ${gate.status === "done" ? "text-muted line-through" : "text-ink"}`}
              >
                {gate.title}
              </span>
            </>
          );

          if (!owned) {
            return (
              <li key={gate.id} className="flex min-w-0 items-start gap-2.5 py-1.5">
                {body}
              </li>
            );
          }

          return (
            <li key={gate.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onToggle(gate)}
                disabled={busy}
                aria-pressed={gate.status === "done"}
                className="flex w-full min-w-0 items-start gap-2.5 rounded-md py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss active:opacity-60"
              >
                {body}
                <span className="ml-auto shrink-0 self-center text-[11px] text-muted">
                  {gate.status === "done" ? "undo" : "tap"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted">
        Tappable gates are the ones only you can see. The rest follow their Action.
      </p>
    </section>
  );
}

/** Nothing to measure against yet — and saying so is the whole screen. */
function UndeclaredTarget({ one, warnings }: { one: TheOneThing; warnings: string[] }) {
  return (
    <div className="grid min-w-0 gap-6 pt-6">
      <h1 className="text-[32px] font-bold leading-[1.05] tracking-tight text-ink">No target declared.</h1>
      <p className="text-[15px] leading-relaxed text-muted">
        Distance is undefined without a finish line, so every other number on this screen would be theatre.
      </p>
      <section className="grid gap-3 rounded-lg bg-ink p-5 text-white shadow-soft">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Do this now</span>
        <p className="text-[20px] font-semibold leading-[1.25]">{one.doThis}</p>
        <p className="text-sm text-white/70">→ {one.unlocks}</p>
      </section>
      {warnings.map((warning) => (
        <p key={warning} className="text-xs text-clay">
          ! {warning}
        </p>
      ))}
    </div>
  );
}

/**
 * Apply a gate change locally and recompute the distance from it, so the
 * headline number and the segment bar move on the same frame as the tap.
 * Mirrors the arithmetic in `src/northStar/compute.ts`, including the half
 * credit for a gate already underway.
 */
function applyGateStatus(brief: NowBrief, gateId: string, status: GateStatus): NowBrief {
  const gates = brief.gates.map((gate) => (gate.id === gateId ? { ...gate, status } : gate));
  const done = gates.filter((gate) => gate.status === "done").length;
  const underway = gates.filter((gate) => gate.status === "in_progress").length;

  return {
    ...brief,
    gates,
    distance: {
      total: gates.length,
      done,
      remaining: gates.length - done,
      fraction: gates.length === 0 ? 0 : (done + underway * 0.5) / gates.length
    }
  };
}

function daysPhrase(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text[0].toLowerCase()}${text.slice(1)}`;
}
