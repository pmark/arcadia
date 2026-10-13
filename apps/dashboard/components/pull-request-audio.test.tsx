const initialResults = vi.hoisted(() => [] as unknown[]);
const effects = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react,
    useEffect: (effect: () => unknown) => { effects.push(effect); },
    useState: (initial: unknown) => react.useState(initialResults.length ? initialResults.shift() : initial)
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptRefreshedSummary, fetchJsonBounded, observeSummaryJob, PullRequestAudio, SummaryObservationTimeoutError, summaryActionForStage } from "./pull-request-audio";

describe("PullRequestAudio", () => {
  it("offers an actionable summary/listen load without remote reads or disabled playback", () => {
    const html = renderToStaticMarkup(<PullRequestAudio repository="owner/repo" number={2} />);
    expect(html).toContain("Load TLDR / Listen");
    expect(html).not.toContain("Generate TLDR");
    expect(html).not.toContain("Play TLDR");
  });

  it("shows matching cached TLDR text and enabled playback without a loading click", () => {
    initialResults.push({
      source: {}, sourceRevision: "revision", job: null,
      summary: { text: "A cached description summary.", sourceRevision: "revision", jobId: "summary-job", generatedAt: "2026-10-13T12:00:00Z" }
    }, "ready");
    const html = renderToStaticMarkup(<PullRequestAudio repository="owner/repo" number={2} />);
    expect(html).toContain("A cached description summary.");
    expect(html).toContain("Play TLDR");
    expect(html).not.toContain("A completed TLDR is required for playback");
    expect(html).not.toContain("Generate TLDR");
  });

  it("does not read any PR source automatically on ordinary card mount", async () => {
    effects.length = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderToStaticMarkup(<PullRequestAudio repository="owner/repo" number={2} />);
    for (const effect of effects) effect();
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("loads only the explicitly selected link summary with GET and no synthesis", async () => {
    effects.length = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, json: async () => ({ source: {}, sourceRevision: "rev", job: null, summary: null })
    } as Response);
    renderToStaticMarkup(<PullRequestAudio repository="owner/repo" number={2} showDescription />);
    for (const effect of effects) effect();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/pull-requests/summary?repository=owner%2Frepo&number=2");
    expect(fetchSpy.mock.calls[0][1]?.method).toBeUndefined();
    fetchSpy.mockRestore();
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
