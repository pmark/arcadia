import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STRATEGY_FILE,
  citedCauses,
  isRuntimePath,
  judgePullRequest,
  judgeTrack,
  lastNight,
  loadStrategy,
  type Strategy,
  zonedToUtc
} from "../.github/scripts/strategyGuard.ts";

const root = path.resolve(import.meta.dirname, "..");

const strategy: Strategy = {
  schema: "arcadia-strategy-v1",
  name: "Run what works, prove what's next",
  phase: "freeze-and-prove",
  freeze: {
    engineRevision: "a5f041066b1d50b4cfc1c4cad82290eb101d7b68",
    causeLabel: "phase-cause",
    workerBranchPattern: "^(claude|codex|opencode)/[a-z0-9-]+-[0-9]{8}T[0-9]{9}Z$"
  },
  nights: { timeZone: "America/Los_Angeles", start: "21:00", end: "08:00", minimumWorkerMerges: 1 },
  checkpoint: { at: "2026-11-25T16:00:00Z", graceHours: 4, verdict: null }
};

const noLabels = new Map<number, string[]>();

describe("strategy guard: the checked-in strategy", () => {
  it("is the freeze-and-prove phase with a full engine revision and a valid worker pattern", () => {
    const checkedIn = loadStrategy(root);
    expect(checkedIn?.phase).toBe("freeze-and-prove");
    expect(checkedIn?.freeze?.engineRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(() => new RegExp(checkedIn!.freeze!.workerBranchPattern)).not.toThrow();
    expect(JSON.parse(readFileSync(path.join(root, STRATEGY_FILE), "utf8")).schema).toBe("arcadia-strategy-v1");
  });
});

describe("strategy guard: pull requests", () => {
  it("passes a PR that changes no runtime path", () => {
    const verdict = judgePullRequest({ strategy, headRef: "rowan31/docs", files: ["docs/x.md", "tests/a.test.ts", ".github/workflows/ci.yml"], body: "", labelsByIssue: noLabels });
    expect(verdict.ok).toBe(true);
  });

  it("refuses a runtime change that cites no cause, and says how to fix it", () => {
    const verdict = judgePullRequest({ strategy, headRef: "rowan31/feature", files: ["src/production/tick.ts"], body: "Adds a feature", labelsByIssue: noLabels });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("Phase-cause: #<issue>");
    expect(verdict.reason).toContain("a5f041066");
  });

  it("refuses a cited Issue that does not carry the cause label", () => {
    const verdict = judgePullRequest({ strategy, headRef: "rowan31/fix", files: ["scripts/start-run.sh"], body: "Phase-cause: #2977", labelsByIssue: new Map([[2977, ["bug"]]]) });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("none labelled phase-cause");
  });

  it("passes a runtime fix that cites a labelled cause", () => {
    const verdict = judgePullRequest({ strategy, headRef: "rowan31/fix", files: ["src/production/successorPress.ts"], body: "Fix.\n\nPhase-cause: #2977\n", labelsByIssue: new Map([[2977, ["phase-cause"]]]) });
    expect(verdict).toEqual({ ok: true, reason: "cites #2977, labelled phase-cause" });
  });

  it("passes the production worker's own night-lane candidate", () => {
    const verdict = judgePullRequest({ strategy, headRef: "claude/collect-timeline-events-20261123T051500123Z", files: ["src/timeline/collect.ts"], body: "", labelsByIssue: noLabels });
    expect(verdict.ok).toBe(true);
  });

  it("does not treat a builder branch with a date as a worker candidate", () => {
    const verdict = judgePullRequest({ strategy, headRef: "claude/met-criteria-proof-check-20261122", files: ["src/ask/x.ts"], body: "", labelsByIssue: noLabels });
    expect(verdict.ok).toBe(false);
  });

  it("refuses changing the strategy and runtime paths in one PR", () => {
    const verdict = judgePullRequest({ strategy, headRef: "rowan31/x", files: [STRATEGY_FILE, "src/a.ts"], body: "Phase-cause: #1", labelsByIssue: new Map([[1, ["phase-cause"]]]) });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("in its own PR");
  });

  it("is inactive outside a freeze phase", () => {
    const verdict = judgePullRequest({ strategy: { ...strategy, phase: "pin-and-promote" }, headRef: "x", files: ["src/a.ts"], body: "", labelsByIssue: noLabels });
    expect(verdict.ok).toBe(true);
  });

  it("matches runtime paths by whole segment and reads cause lines strictly", () => {
    expect(isRuntimePath("src/a.ts")).toBe(true);
    expect(isRuntimePath("package.json")).toBe(true);
    expect(isRuntimePath("srcery/a.ts")).toBe(false);
    expect(isRuntimePath("docs/src/a.md")).toBe(false);
    expect(citedCauses("Phase-cause: #12\n  phase-cause: #13 \nsee Phase-cause: #14 inline")).toEqual([12, 13]);
  });
});

describe("strategy guard: tracking", () => {
  it("converts Pacific wall-clock times across the DST boundary", () => {
    expect(zonedToUtc(2026, 11, 23, "08:00", "America/Los_Angeles").toISOString()).toBe("2026-11-23T16:00:00.000Z");
    expect(zonedToUtc(2026, 7, 1, "21:00", "America/Los_Angeles").toISOString()).toBe("2026-07-02T04:00:00.000Z");
  });

  it("picks the night that has fully ended", () => {
    const morning = lastNight(new Date("2026-11-23T16:15:00Z"), strategy.nights!);
    expect(morning.start.toISOString()).toBe("2026-11-23T05:00:00.000Z");
    expect(morning.end.toISOString()).toBe("2026-11-23T16:00:00.000Z");
    const beforeEnd = lastNight(new Date("2026-11-23T15:00:00Z"), strategy.nights!);
    expect(beforeEnd.end.toISOString()).toBe("2026-11-22T16:00:00.000Z");
  });

  it("is on track with a held freeze, a delivered night and a future checkpoint", () => {
    const result = judgeTrack({ strategy, now: new Date("2026-11-23T16:15:00Z"), freezeViolations: [], workerMergesLastNight: 3 });
    expect(result.offTrack).toBe(false);
    expect(result.lines.join("\n")).toContain("Checkpoint in about 48 h");
  });

  it("goes off track on a freeze violation, an empty night or an overdue checkpoint", () => {
    expect(judgeTrack({ strategy, now: new Date("2026-11-23T16:15:00Z"), freezeViolations: ["#1: x"], workerMergesLastNight: 2 }).offTrack).toBe(true);
    expect(judgeTrack({ strategy, now: new Date("2026-11-23T16:15:00Z"), freezeViolations: [], workerMergesLastNight: 0 }).offTrack).toBe(true);
    const overdue = judgeTrack({ strategy, now: new Date("2026-11-25T20:30:00Z"), freezeViolations: [], workerMergesLastNight: 1 });
    expect(overdue.offTrack).toBe(true);
    expect(overdue.lines.join("\n")).toContain("no verdict");
    const recorded = judgeTrack({ strategy: { ...strategy, checkpoint: { ...strategy.checkpoint!, verdict: "pin-and-promote" } }, now: new Date("2026-11-25T20:30:00Z"), freezeViolations: [], workerMergesLastNight: 1 });
    expect(recorded.offTrack).toBe(false);
  });
});
