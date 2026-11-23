import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STRATEGY_FILE,
  citedCauses,
  isEnginePath,
  isMorningRun,
  judgePullRequest,
  judgeTrack,
  lastNight,
  parseStrategy,
  strategyChangeViolation,
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
    workerBranchPattern: "^(claude|codex|opencode)/[a-z0-9-]+-[0-9]{8}T[0-9]{9}Z$",
    extraPaths: ["mise.toml", "mise.lock", "pnpm-workspace.yaml", "schemas"]
  },
  nights: { timeZone: "America/Los_Angeles", start: "21:00", end: "08:00", minimumWorkerMerges: 1 },
  checkpoint: { at: "2026-11-25T16:00:00Z", graceHours: 4, verdict: null }
};

const body = (text: string) => () => text;
const labels = (map: Record<number, string[]> = {}) => (n: number) => map[n] ?? [];
const pr = (over: Partial<Parameters<typeof judgePullRequest>[0]>) =>
  judgePullRequest({ strategy, headRef: "rowan31/fix", files: [], body: body(""), labelsFor: labels(), ...over });
const track = (over: Partial<Parameters<typeof judgeTrack>[0]>) =>
  judgeTrack({ strategy, now: new Date("2026-11-23T16:15:00Z"), freezeViolations: [], strategyViolations: [], workerMergesLastNight: 2, audit: [], ...over });

describe("strategy guard: the checked-in strategy", () => {
  it("parses, has a full engine revision and a valid worker pattern", () => {
    const checkedIn = parseStrategy(readFileSync(path.join(root, STRATEGY_FILE), "utf8"));
    expect(checkedIn?.schema).toBe("arcadia-strategy-v1");
    if (checkedIn?.freeze) {
      expect(checkedIn.freeze.engineRevision).toMatch(/^[0-9a-f]{40}$/);
      expect(() => new RegExp(checkedIn.freeze!.workerBranchPattern)).not.toThrow();
    }
  });
});

describe("strategy guard: pull requests", () => {
  it("passes a PR that changes no engine path", () => {
    expect(pr({ files: ["docs/x.md", "tests/a.test.ts", ".github/workflows/ci.yml"] }).ok).toBe(true);
  });

  it("refuses an engine change that cites no cause, and says how to fix it", () => {
    const verdict = pr({ files: ["src/production/tick.ts"], body: body("Adds a feature") });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("Phase-cause: #<issue>");
    expect(verdict.reason).toContain("a5f041066");
  });

  it("refuses a cited Issue that does not carry the cause label", () => {
    const verdict = pr({ files: ["scripts/start-run.sh"], body: body("Phase-cause: #2977"), labelsFor: labels({ 2977: ["bug"] }) });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("none labelled phase-cause");
  });

  it("passes an engine fix that cites a labelled cause", () => {
    const verdict = pr({ files: ["src/production/successorPress.ts"], body: body("Fix.\n\n- Phase-cause: #2977\n"), labelsFor: labels({ 2977: ["phase-cause"] }) });
    expect(verdict).toMatchObject({ ok: true, route: "cause" });
  });

  it("passes the production worker's own night-lane candidate without reading the body", () => {
    const verdict = pr({ headRef: "claude/collect-timeline-events-20261123T051500123Z", files: ["src/timeline/collect.ts"], body: () => { throw new Error("must not be read"); } });
    expect(verdict).toMatchObject({ ok: true, route: "worker" });
  });

  it("does not treat a builder branch with a bare date as a worker candidate", () => {
    expect(pr({ headRef: "claude/met-criteria-proof-check-20261122", files: ["src/ask/x.ts"] }).ok).toBe(false);
  });

  it("counts the freeze's extra engine paths and both sides of a rename", () => {
    expect(pr({ files: ["mise.toml"] }).ok).toBe(false);
    expect(pr({ files: ["schemas/x.json"] }).ok).toBe(false);
    expect(pr({ files: ["docs/x.ts", "src/x.ts"] }).ok).toBe(false);
    expect(isEnginePath("srcery/a.ts", strategy)).toBe(false);
    expect(isEnginePath("docs/src/a.md", strategy)).toBe(false);
    expect(isEnginePath("package.json", strategy)).toBe(true);
  });

  it("refuses a guard file with engine paths before any short-circuit, even when the base has no freeze or the branch looks like a worker", () => {
    for (const s of [strategy, { ...strategy, phase: "pin-and-promote" }, null]) {
      for (const headRef of ["rowan31/x", "claude/x-20261123T051500123Z"]) {
        const verdict = judgePullRequest({ strategy: s, headRef, files: [STRATEGY_FILE, "src/a.ts"], body: body("Phase-cause: #1"), labelsFor: labels({ 1: ["phase-cause"] }) });
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain("in its own PR");
      }
    }
    expect(pr({ files: [".github/scripts/strategyGuard.ts", "scripts/x.sh"] }).ok).toBe(false);
  });

  it("judges by the base strategy, so a PR's own edit to the file cannot turn the freeze off", () => {
    // The CLI passes the BASE revision's strategy. A PR that only edits current.json (no engine path)
    // passes; its new phase applies to later PRs, and track flags it unless a checkpoint verdict is recorded.
    expect(pr({ files: [STRATEGY_FILE] }).ok).toBe(true);
    const before = new Date("2026-11-24T00:00:00Z");
    const after = new Date("2026-11-25T16:30:00Z");
    const verdict = (s: Strategy, v: string) => ({ ...s, checkpoint: { ...s.checkpoint!, verdict: v } });
    expect(strategyChangeViolation(strategy, { ...strategy, phase: "pin-and-promote" }, before)).toContain("no checkpoint verdict");
    expect(strategyChangeViolation(strategy, { ...strategy, freeze: { ...strategy.freeze!, workerBranchPattern: "." } }, before)).toContain("worker branch pattern");
    expect(strategyChangeViolation(strategy, null, before)).toBe("deleted the strategy");
    expect(strategyChangeViolation(null, strategy, before)).toBeNull();
    // The verdict is the way to change phase, but only on or after the checkpoint.
    expect(strategyChangeViolation(strategy, verdict({ ...strategy, phase: "pin-and-promote" }, "two clean nights"), before)).toContain("before the checkpoint");
    expect(strategyChangeViolation(strategy, verdict({ ...strategy, phase: "pin-and-promote" }, "two clean nights"), after)).toBeNull();
    // After a verdict is on record, the next change starts the next phase.
    expect(strategyChangeViolation(verdict(strategy, "two clean nights"), { ...strategy, phase: "pin-and-promote", checkpoint: { at: "2026-12-02T16:00:00Z", graceHours: 4, verdict: null } }, after)).toBeNull();
    // Other loosenings without a verdict.
    expect(strategyChangeViolation(strategy, { ...strategy, checkpoint: { ...strategy.checkpoint!, at: "2026-12-25T16:00:00Z" } }, before)).toContain("checkpoint moved");
    expect(strategyChangeViolation(strategy, { ...strategy, checkpoint: { ...strategy.checkpoint!, graceHours: 400 } }, before)).toContain("grace");
    expect(strategyChangeViolation(strategy, { ...strategy, nights: { ...strategy.nights!, minimumWorkerMerges: 0 } }, before)).toContain("night minimum");
    expect(strategyChangeViolation(strategy, { ...strategy, nights: undefined }, before)).toContain("removed the night check");
    const tightened = { ...strategy, freeze: { ...strategy.freeze!, extraPaths: [...strategy.freeze!.extraPaths!, ".nvmrc"] } };
    expect(strategyChangeViolation(strategy, tightened, before)).toBeNull();
    expect(strategyChangeViolation(tightened, strategy, before)).toContain("dropped engine path(s) .nvmrc");
  });

  it("is inactive outside a freeze phase", () => {
    expect(pr({ strategy: { ...strategy, phase: "pin-and-promote" }, files: ["src/a.ts"] })).toMatchObject({ ok: true, route: "inactive" });
  });

  it("reads cause lines strictly, allowing a list bullet", () => {
    expect(citedCauses("Phase-cause: #12\n  phase-cause: #13 \n* Phase-cause: #15\nsee Phase-cause: #14 inline")).toEqual([12, 13, 15]);
  });
});

describe("strategy guard: tracking", () => {
  it("converts Pacific wall-clock times across the DST boundary", () => {
    expect(zonedToUtc(2026, 11, 23, "08:00", "America/Los_Angeles").toISOString()).toBe("2026-11-23T16:00:00.000Z");
    expect(zonedToUtc(2026, 7, 1, "21:00", "America/Los_Angeles").toISOString()).toBe("2026-07-02T04:00:00.000Z");
  });

  it("picks the night that has fully ended, using calendar days across a DST change", () => {
    const morning = lastNight(new Date("2026-11-23T16:15:00Z"), strategy.nights!);
    expect(morning.start.toISOString()).toBe("2026-11-23T05:00:00.000Z");
    expect(morning.end.toISOString()).toBe("2026-11-23T16:00:00.000Z");
    expect(lastNight(new Date("2026-11-23T15:00:00Z"), strategy.nights!).end.toISOString()).toBe("2026-11-22T16:00:00.000Z");
    // 2026-11-01 is the fall-back day: Oct 31 9 PM PDT to Nov 1 8 AM PST.
    const fallBack = lastNight(new Date("2026-11-01T17:00:00Z"), strategy.nights!);
    expect(fallBack.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(fallBack.end.toISOString()).toBe("2026-11-01T16:00:00.000Z");
  });

  it("runs the night check only in the morning", () => {
    expect(isMorningRun(new Date("2026-11-23T16:15:00Z"), strategy.nights!)).toBe(true);
    expect(isMorningRun(new Date("2026-11-24T05:15:00Z"), strategy.nights!)).toBe(false);
  });

  it("is on track with a held freeze, a delivered night and a future checkpoint, and prints the audit", () => {
    const result = track({ audit: ["#2979: cites #2977, labelled phase-cause"] });
    expect(result.offTrack).toBe(false);
    expect(result.lines.join("\n")).toContain("Checkpoint in about 48 h");
    expect(result.lines.join("\n")).toContain("#2979: cites #2977");
  });

  it("goes off track on a freeze violation, a strategy violation, an empty night or an overdue checkpoint", () => {
    expect(track({ freezeViolations: ["#1: x"] }).offTrack).toBe(true);
    expect(track({ strategyViolations: ["abc changed the phase"] }).offTrack).toBe(true);
    expect(track({ workerMergesLastNight: 0 }).offTrack).toBe(true);
    expect(track({ workerMergesLastNight: null }).offTrack).toBe(false);
    expect(track({ strategy: null }).offTrack).toBe(true);
    const overdue = track({ now: new Date("2026-11-25T20:30:00Z") });
    expect(overdue.offTrack).toBe(true);
    expect(overdue.lines.join("\n")).toContain("no verdict");
    expect(track({ strategy: { ...strategy, checkpoint: { ...strategy.checkpoint!, verdict: "pin-and-promote" } }, now: new Date("2026-11-25T20:30:00Z") }).offTrack).toBe(false);
  });
});
