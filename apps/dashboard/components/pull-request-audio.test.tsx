import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptRefreshedSummary, fetchJsonBounded, observeSummaryJob, PullRequestAudio, SummaryObservationTimeoutError, summaryActionForStage } from "./pull-request-audio";

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

  it("cancels observation during poll sleep before another fetch or state update", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchJob = vi.fn();
    const onJob = vi.fn();
    const observed = observeSummaryJob({ id: "summary-running", status: "running" } as never, { fetchJob, onJob, signal: controller.signal });
    const assertion = expect(observed).rejects.toMatchObject({ name: "AbortError" });
    expect(onJob).toHaveBeenCalledTimes(1);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchJob).not.toHaveBeenCalled();
    expect(onJob).toHaveBeenCalledTimes(1);
  });

  it("refuses a pre-aborted parent before starting a child fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(fetchJsonBounded("/never", { signal: controller.signal }, 20_000)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

afterEach(() => vi.useRealTimers());
