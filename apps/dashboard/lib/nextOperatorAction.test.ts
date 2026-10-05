import { describe, expect, it } from "vitest";
import { deriveNextOperatorAction, formatCountdown, offPathConfirmation, type SequencedScript } from "./nextOperatorAction";

const G6 = "preflight-three-action-rehearsal-2026-10-05";
const G7 = "grant-production-three-action-rehearsal-2026-10-05";
const G8 = "restore-terminal-off-three-action-rehearsal-2026-10-05";
const RECOVER = "recover-arcadia-host-services";
const PASS_AT = "2026-10-05T15:07:30Z";
const passMs = Date.parse(PASS_AT);
const minutes = (n: number) => n * 60_000;
const inactive = { active: false };

function library(overrides: Partial<Record<string, Partial<SequencedScript>>> = {}): SequencedScript[] {
  const base: SequencedScript[] = [
    { id: G6, title: "G6 (run 2): Preflight the second rehearsal", repeatable: true, state: { status: "succeeded", startedAt: "2026-10-05T15:07:13.000Z", finishedAt: "2026-10-05T15:07:31.000Z" },
      failure: { effect: "Nothing changed.", next: "Fix each refused check, then rerun this preflight." },
      lastRunReceipt: { outcome: "succeeded", startedAt: "2026-10-05T15:07:13Z", finishedAt: PASS_AT } },
    { id: G7, title: "G7 (run 2): Grant the second rehearsal", repeatable: false, state: { status: "available" },
      failure: { effect: "Policy unchanged.", next: "Do not press again blindly. Read the handoff." },
      nextAfter: { id: G6, within_minutes: 30, voided_by: [G8, RECOVER], when_production: "inactive" }, lastRunReceipt: null },
    { id: G8, title: "G8 (run 2): Restore terminal Off", repeatable: true, state: { status: "succeeded", startedAt: "2026-10-05T15:02:27.964Z", finishedAt: "2026-10-05T15:05:41.052Z" },
      lastRunReceipt: { outcome: "succeeded", startedAt: "2026-10-05T15:02:28Z", finishedAt: "2026-10-05T15:05:41Z" } },
    { id: RECOVER, title: "Recover Arcadia host services", repeatable: true, state: { status: "available" }, lastRunReceipt: null },
    { id: "unrelated-action", title: "Unrelated: merge something", repeatable: false, state: { status: "available" }, lastRunReceipt: null }
  ];
  return base.map((script) => ({ ...script, ...overrides[script.id] }));
}

describe("deriveNextOperatorAction", () => {
  it("offers G7 with its deadline while a fresh G6 pass is inside the 30-minute window", () => {
    const next = deriveNextOperatorAction(library(), inactive, passMs + minutes(3));
    expect(next).toMatchObject({ status: "next", reason: "window_open", scriptId: G7, title: "G7 (run 2): Grant the second rehearsal", deadline: new Date(passMs + minutes(30)).toISOString() });
    if (next.status !== "next") throw new Error("expected a next action");
    expect(next.instruction).toMatch(/^Read this card, then run G7 \(run 2\) before .+, while its G6 \(run 2\) pass is still valid\.$/);
    expect(formatCountdown(next.deadline!, passMs + minutes(3))).toBe("27:00");
  });

  it("falls back to G6 once the window has expired", () => {
    const next = deriveNextOperatorAction(library(), inactive, passMs + minutes(30));
    expect(next).toMatchObject({ status: "next", reason: "prerequisite_expired", scriptId: G6, deadline: null });
    if (next.status !== "next") throw new Error("expected a next action");
    expect(next.instruction).toMatch(/^Run G6 \(run 2\) again: its last pass expired at .+, so G7 \(run 2\) would refuse it\.$/);
  });

  it("falls back to G6 when a declared voiding action (G8 or a host restart) ran after the pass", () => {
    for (const [id, startedAt] of [[G8, "2026-10-05T15:10:00Z"], [RECOVER, "2026-10-05T15:11:00.000Z"]] as const) {
      const scripts = library({ [id]: { state: { status: "succeeded", startedAt, finishedAt: startedAt }, lastRunReceipt: null } });
      const next = deriveNextOperatorAction(scripts, inactive, passMs + minutes(5));
      expect(next).toMatchObject({ status: "next", reason: "prerequisite_voided", scriptId: G6 });
      if (next.status !== "next") throw new Error("expected a next action");
      expect(next.instruction).toContain(id === G8 ? "G8 (run 2) ran at" : "Recover Arcadia host services ran at");
    }
  });

  it("says nothing needs the operator when no chain has started, after G7 is consumed, or while production is Active", () => {
    const fresh = library({ [G6]: { lastRunReceipt: null, state: { status: "available" } } });
    expect(deriveNextOperatorAction(fresh, inactive, passMs)).toEqual({ status: "none", message: "Nothing needs you right now.", note: null });
    const consumed = library({ [G7]: { state: { status: "succeeded", startedAt: "2026-10-05T15:10:00Z", finishedAt: "2026-10-05T15:12:00Z" } } });
    expect(deriveNextOperatorAction(consumed, inactive, passMs + minutes(5))).toMatchObject({ status: "none", note: null });
    expect(deriveNextOperatorAction(library(), { active: true }, passMs + minutes(5))).toMatchObject({ status: "none", note: expect.stringContaining("Production is Active") });
  });

  it("points at the failed run: a refused G6 asks for a fixed rerun, a failed G7 asks to read its handoff first", () => {
    const refused = library({ [G6]: { lastRunReceipt: { outcome: "refused", startedAt: "2026-10-05T15:07:13Z", finishedAt: PASS_AT }, state: { status: "succeeded", startedAt: "2026-10-05T15:07:13.000Z" } } });
    expect(deriveNextOperatorAction(refused, inactive, passMs + minutes(1))).toMatchObject({
      status: "next", reason: "prerequisite_failed", scriptId: G6, note: "Fix each refused check, then rerun this preflight.",
      instruction: "G6 (run 2) did not pass: open its result, fix what it names, then run G6 (run 2) again."
    });
    const failedGrant = library({ [G7]: { state: { status: "failed", startedAt: "2026-10-05T15:20:00.000Z", finishedAt: "2026-10-05T15:21:00.000Z" },
      lastRunReceipt: { outcome: "refused", startedAt: "2026-10-05T15:20:01Z", finishedAt: "2026-10-05T15:21:00Z" } } });
    // Even with production Active (an activation that could not turn itself Off), the failed Grant's handoff comes first.
    expect(deriveNextOperatorAction(failedGrant, { active: true }, passMs + minutes(14))).toMatchObject({
      status: "next", reason: "dependent_failed", scriptId: G7, note: "Do not press again blindly. Read the handoff.",
      instruction: "Open G7 (run 2)'s failed result and follow its handoff before pressing anything else."
    });
  });

  it("waits quietly while a chain member is running and notes an unreadable production status", () => {
    const running = library({ [G7]: { state: { status: "running", startedAt: "2026-10-05T15:10:00.000Z" } } });
    expect(deriveNextOperatorAction(running, inactive, passMs + minutes(3))).toMatchObject({ status: "none", note: expect.stringContaining("G7 (run 2) is running") });
    expect(deriveNextOperatorAction(library(), null, passMs + minutes(3))).toMatchObject({ status: "next", scriptId: G7, note: expect.stringContaining("could not be read") });
  });
});

describe("offPathConfirmation", () => {
  const scripts = library();
  const byId = (id: string) => scripts.find((script) => script.id === id)!;
  const window = deriveNextOperatorAction(scripts, inactive, passMs + minutes(3));

  it("lets the next action run without a confirmation", () => {
    expect(offPathConfirmation(window, byId(G7), scripts)).toBeNull();
  });

  it("names the next action and what G8 would undo while G6 awaits its G7", () => {
    const text = offPathConfirmation(window, byId(G8), scripts);
    expect(text).toMatch(/^G8 \(run 2\) is not your next action\. Your next action is G7 \(run 2\), before .+\./);
    expect(text).toContain("Running G8 (run 2) now undoes G6 (run 2)'s pass that G7 (run 2) needs, so you would have to run G6 (run 2) again before G7 (run 2).");
  });

  it("warns that rerunning the prerequisite replaces the pass, and that other actions are still off-path", () => {
    expect(offPathConfirmation(window, byId(G6), scripts)).toContain("replaces the pass G7 (run 2) relies on");
    expect(offPathConfirmation(window, byId("unrelated-action"), scripts)).toContain("Unrelated is not declared to undo G7 (run 2)");
  });

  it("asks nothing when nothing is next", () => {
    expect(offPathConfirmation({ status: "none", message: "Nothing needs you right now.", note: null }, byId(G8), scripts)).toBeNull();
  });
});
