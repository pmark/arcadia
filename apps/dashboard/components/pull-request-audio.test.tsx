import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptRefreshedSummary, observeSummaryJob, PullRequestAudio, SummaryObservationTimeoutError, summaryActionForStage } from "./pull-request-audio";

describe("PullRequestAudio", () => {
  it("offers independent TLDR loading before any speech action", () => {
    const html = renderToStaticMarkup(<PullRequestAudio repository="owner/repo" number={2} />);
    expect(html).toContain("Load TLDR");
    expect(html).not.toContain("Play body");
    expect(html).not.toContain("Play TLDR");
  });

  it("rejects a completed TLDR when the PR source changed during generation", () => {
    const initial = { source: {} as never, sourceRevision: "old", job: null, summary: null };
    const refreshed = { source: {} as never, sourceRevision: "new", job: null, summary: null };
    expect(() => acceptRefreshedSummary(initial, refreshed)).toThrow("source changed");
  });

  it("bounds a never-settling running-job observation and preserves its durable identity", async () => {
    vi.useFakeTimers();
    const running = { id: "summary-running", status: "running" } as never;
    const observed = observeSummaryJob(running, { fetchJob: () => new Promise(() => {}), timeoutMs: 100, pollIntervalMs: 10 });
    const assertion = expect(observed).rejects.toMatchObject<SummaryObservationTimeoutError>({ job: running });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("reconnects timed-out observation with GET and never starts inference", () => {
    expect(summaryActionForStage("observation_timeout")).toBe("GET");
    expect(summaryActionForStage("failed")).toBe("POST");
  });
});

afterEach(() => vi.useRealTimers());
