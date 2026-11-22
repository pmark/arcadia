import { describe, expect, it } from "vitest";
import { classifyAuthorityPaths } from "../src/decisions/batchMerge.js";
import {
  NIGHT_SILENCE_HOURS_DEFAULT,
  buildOvernightReport,
  decideNightSilence,
  ghPrReader,
  nightSilencePage,
  releaseClassifierLoader,
  type GithubPrFacts,
  type MergedPr,
  type OvernightInput
} from "../src/production/overnightVerify.js";

const RELEASE = "d5c60155b511b0360804190c1cdb67892408dfc2";
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 22, 16, 0, 0);

const prA: MergedPr = { url: "https://github.com/pmark/arcadia/pull/101", number: 101, claimedHead: HEAD_A, claimedClasses: [], mergedAt: "2026-11-22T03:10Z" };
const prB: MergedPr = { url: "https://github.com/pmark/arcadia/pull/102", number: 102, claimedHead: HEAD_B, claimedClasses: [], mergedAt: "2026-11-22T05:40Z" };

const facts: Record<number, GithubPrFacts> = {
  101: { headSha: HEAD_A, checks: [{ name: "ci", conclusion: "SUCCESS" }, { name: "lint", conclusion: "SUCCESS" }], reviewMarker: { url: "https://x/c1" }, files: ["docs/notes.md"] },
  // The head moved after the receipt, and the diff touches a decision.
  102: { headSha: "c".repeat(40), checks: [{ name: "ci", conclusion: "FAILURE" }], reviewMarker: { error: "no review marker" }, files: ["docs/decisions/0281-x.md"] }
};

const input: OvernightInput = {
  now: NOW,
  heartbeatAt: NOW - 90 * 60_000,
  firstAdmissionReleaseSha: RELEASE,
  merges: [prA, prB],
  parks: [{ actionKey: "plan/park-me", reason: "C4: touches the gate set", options: ["Merge it by hand", "Re-scope the Action"] }],
  idle: [{ hours: 2, cause: "waiting on a parked Action" }],
  tokenBurn: 1234567
};

const loadClassifier = async (sha: string) => (sha === RELEASE ? classifyAuthorityPaths : null);
const reader = (pr: MergedPr) => facts[pr.number];

describe("overnight report", () => {
  it("reproduces the recorded night's hand report", async () => {
    const { text } = await buildOvernightReport(input, { reader, loadClassifier });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Heartbeat age: 1 h 30 min. Host death is detected only at 8 AM, by this report.");
    expect(text).toContain(`Release pinned at first admission: ${RELEASE}`);
    expect(text).toContain("- #101 VERIFIED head aaaaaaaaaaaa, checks 2/2 green, classes none, merged 2026-11-22T03:10Z");
    expect(text).toContain("- #102 MISMATCH head cccccccccccc");
    expect(text).toContain("head on GitHub is cccccccccccc, the receipt says bbbbbbbbbbbb");
    expect(text).toContain("check ci is FAILURE");
    expect(text).toContain("no review marker");
    expect(text).toContain("  A) Merge it by hand\n  B) Re-scope the Action");
    expect(text).toContain("Idle: 2 h\n- 2 h: waiting on a parked Action");
    expect(text).toContain("Token burn: 1,234,567");
  });

  it("classifies with the pinned release, and an unloadable release is unverifiable, never a pass", async () => {
    const { merges } = await buildOvernightReport({ ...input, firstAdmissionReleaseSha: "f".repeat(40) }, { reader, loadClassifier });
    expect(merges[0].verdict).toBe("unverifiable");
    expect(merges[0].problems).toContain("the classifier of the first-admission release could not be loaded");
    const none = await buildOvernightReport({ ...input, firstAdmissionReleaseSha: null, heartbeatAt: null }, { reader, loadClassifier });
    expect(none.text.split("\n")[0]).toContain("Heartbeat age: unreadable.");
    expect(none.text).toContain("none recorded");
  });

  it("an unreadable PR is unverifiable", async () => {
    const { merges } = await buildOvernightReport(input, { reader: () => ({ error: "gh failed" }), loadClassifier });
    expect(merges.map((m) => m.verdict)).toEqual(["unverifiable", "unverifiable"]);
  });

  it("reads the PR through gh, not the local receipt", () => {
    const calls: string[][] = [];
    const run = (c: { args: string[] }) => {
      calls.push(c.args);
      if (c.args.includes("headRefOid,statusCheckRollup,files")) {
        return { status: 0, stderr: "", stdout: JSON.stringify({ headRefOid: HEAD_A, statusCheckRollup: [{ name: "ci", conclusion: "SUCCESS" }], files: [{ path: "src/a.ts" }] }) };
      }
      return { status: 0, stderr: "", stdout: JSON.stringify({ comments: [{ url: "https://x/m", body: `Independent review, head ${HEAD_A.slice(0, 12)}\nLoosens a gate: no` }] }) };
    };
    const got = ghPrReader(run as never, "/repo")(prA);
    expect(got).toMatchObject({ headSha: HEAD_A, files: ["src/a.ts"], reviewMarker: { url: "https://x/m" } });
    expect(calls).toHaveLength(2);
  });

  it("loads a release classifier by sha and refuses a malformed sha", async () => {
    const loader = releaseClassifierLoader("/r", async (s) => {
      expect(s).toBe(`/r/${RELEASE}/dist/src/decisions/batchMerge.js`);
      return { classifyAuthorityPaths };
    });
    expect(await loader(RELEASE)).toBe(classifyAuthorityPaths);
    expect(await loader("../x")).toBeNull();
  });
});

describe("night silence liveness timer", () => {
  const start = NOW - 10 * HOUR;
  const state = { activeSince: start, lastMergeAt: null, lastParkAt: null, pagedAt: null };

  it("sends none before N hours and exactly one at N hours", () => {
    const n = NIGHT_SILENCE_HOURS_DEFAULT;
    expect(decideNightSilence(state, start + n * HOUR - 1).page).toBeNull();
    const first = decideNightSilence(state, start + n * HOUR);
    expect(first.page).toBe(nightSilencePage(n));
    expect(first.pagedAt).toBe(start + n * HOUR);
    // Later ticks carry the recorded page and send nothing more.
    const later = decideNightSilence({ ...state, pagedAt: first.pagedAt }, start + 9 * HOUR);
    expect(later.page).toBeNull();
  });

  it("a merge or a park restarts the clock", () => {
    const n = NIGHT_SILENCE_HOURS_DEFAULT;
    expect(decideNightSilence({ ...state, lastMergeAt: start + 2 * HOUR }, start + n * HOUR).page).toBeNull();
    expect(decideNightSilence({ ...state, lastParkAt: start + 2 * HOUR }, start + 2 * HOUR + n * HOUR).page).not.toBeNull();
  });

  it("honours a custom N", () => {
    expect(decideNightSilence(state, start + 2 * HOUR - 1, 2).page).toBeNull();
    expect(decideNightSilence(state, start + 2 * HOUR, 2).page).toBe(nightSilencePage(2));
  });
});
