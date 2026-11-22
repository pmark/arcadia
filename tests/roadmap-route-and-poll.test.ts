import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/dashboard/lib/roadmap-server", () => {
  class RoadmapProjectNotFound extends Error {}
  return { RoadmapProjectNotFound, loadRoadmap: vi.fn() };
});

import { GET } from "../apps/dashboard/app/api/roadmap/[project]/route";
import { loadRoadmap, RoadmapProjectNotFound } from "../apps/dashboard/lib/roadmap-server";
import { REFRESH_SECONDS, singleFlight, startPolling } from "../apps/dashboard/components/workspace/roadmap/roadmap-poll";

const load = vi.mocked(loadRoadmap);
const call = (project: string, query = "") => GET(new Request(`http://127.0.0.1/api/roadmap/${project}${query}`), { params: Promise.resolve({ project }) });

afterEach(() => { vi.useRealTimers(); load.mockReset(); });

describe("GET /api/roadmap/[project]", () => {
  it("returns the derived view, and passes ?fresh through", async () => {
    load.mockResolvedValue({ schema: "arcadia-roadmap-v1" } as Awaited<ReturnType<typeof loadRoadmap>>);
    const response = await call("demo", "?fresh=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schema: "arcadia-roadmap-v1" });
    expect(load).toHaveBeenCalledWith("demo", { fresh: true });
    await call("demo");
    expect(load).toHaveBeenLastCalledWith("demo", { fresh: false });
  });

  it("answers 404 for an unknown Project, naming it", async () => {
    load.mockRejectedValue(new RoadmapProjectNotFound('No Project "nope" is in this workspace.'));
    const response = await call("nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No Project "nope" is in this workspace.', details: { project: "nope" } });
  });

  it("answers 500 with the message for any other failure", async () => {
    load.mockRejectedValue(new Error("workspace unreadable"));
    const response = await call("demo");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "workspace unreadable", details: { project: "demo" } });
  });
});

import type { VisibilitySource } from "../apps/dashboard/components/workspace/roadmap/roadmap-poll";

interface FakeDocument extends VisibilitySource { set(next: string): void; count(): number }

function fakeDocument(state = "visible") {
  const listeners = new Set<() => void>();
  const source: FakeDocument = {
    visibilityState: state,
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
    set(next) { source.visibilityState = next; listeners.forEach((listener) => listener()); },
    count: () => listeners.size
  };
  return source;
}

describe("Roadmap poll", () => {
  it("reads on the interval while visible, pauses while hidden, catches up when shown, and cleans up", () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => {});
    const doc = fakeDocument();
    const stop = startPolling(read, doc);
    vi.advanceTimersByTime(REFRESH_SECONDS * 1000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenLastCalledWith(false);

    doc.set("hidden");
    vi.advanceTimersByTime(REFRESH_SECONDS * 1000 * 5);
    expect(read).toHaveBeenCalledTimes(1);

    doc.set("visible");
    expect(read).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(REFRESH_SECONDS * 1000);
    expect(read).toHaveBeenCalledTimes(3);

    stop();
    expect(doc.count()).toBe(0);
    vi.advanceTimersByTime(REFRESH_SECONDS * 1000 * 5);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("does not start polling for a page that is already hidden", () => {
    vi.useFakeTimers();
    const read = vi.fn();
    startPolling(read, fakeDocument("hidden"));
    vi.advanceTimersByTime(REFRESH_SECONDS * 1000 * 3);
    expect(read).not.toHaveBeenCalled();
  });

  it("never stacks reads: a call while one is in flight is ignored, and the next one runs after it ends", async () => {
    let release!: () => void;
    const inner = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const read = singleFlight(inner);
    const first = read(false);
    await read(true);
    expect(inner).toHaveBeenCalledTimes(1);
    release();
    await first;
    const second = read(false);
    expect(inner).toHaveBeenCalledTimes(2);
    release();
    await second;
  });

  it("frees the guard when a read throws", async () => {
    const inner = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const read = singleFlight(inner);
    await expect(read(false)).rejects.toThrow("boom");
    await read(false);
    expect(inner).toHaveBeenCalledTimes(2);
  });
});
