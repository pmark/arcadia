import { beforeEach, describe, expect, it, vi } from "vitest";

// The CLI is stubbed; the real Next route handlers run, so this proves the
// page's Launch flow against the same routes and guards the browser uses.
const cli = vi.hoisted(() => ({
  loadProjectContinuation: vi.fn(),
  previewGuardedSessionLaunch: vi.fn(),
  launchGuardedSession: vi.fn(),
  makeWorkQueueActionNext: vi.fn(),
  loadWorkQueue: vi.fn(),
  mutateWorkQueue: vi.fn()
}));

vi.mock("./arcadia-cli", () => ({
  ArcadiaCliError: class ArcadiaCliError extends Error {
    statusCode: number;
    details: unknown;
    constructor(message: string, statusCode: number, details: unknown = null) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
    }
  },
  ...cli
}));

import { GET as launchPreviewRoute, POST as launchRoute } from "../app/api/projects/[id]/session-launch/route";
import { POST as workQueueRoute } from "../app/api/work-queue/route";
import { beginLaunch, confirmLaunch, confirmMakeNext, newRequestId, type LaunchStep, type LaunchTarget } from "./launch-flow";

const ORIGIN = "http://arcadia.test";

/** A browser-like fetch that dispatches same-origin requests to the real route handlers. */
const routeFetch = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
  const url = new URL(input, ORIGIN);
  const request = new Request(url, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), "sec-fetch-site": "same-origin" }
  });
  const launch = url.pathname.match(/^\/api\/projects\/([^/]+)\/session-launch$/);
  if (launch) {
    const context = { params: Promise.resolve({ id: decodeURIComponent(launch[1]) }) };
    return request.method === "POST" ? launchRoute(request, context) : launchPreviewRoute(request, context);
  }
  if (url.pathname === "/api/work-queue" && request.method === "POST") return workQueueRoute(request);
  throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
});

const target: LaunchTarget = {
  projectId: "proj-arcadia",
  planSlug: "plan-a",
  actionId: "build-thing",
  actionKey: "arcadia/build-thing",
  title: "Build the thing",
  needsMakeNext: false,
  queueRevision: 12
};

let counter = 0;
const ids = (prefix: string) => `${prefix}-${++counter}`;

function readyPreview(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      requestId: "ignored",
      previewFingerprint: "fp-123",
      actionDocRef: "plan/plan-a#build-thing",
      ready: true,
      prerequisites: [],
      selection: { provider: "claude", model: "sonnet", effort: "high" },
      ...overrides
    }
  };
}

beforeEach(() => {
  counter = 0;
  routeFetch.mockClear();
  for (const fn of Object.values(cli)) fn.mockReset();
  cli.loadProjectContinuation.mockResolvedValue({ data: { repoRoot: "/repos/arcadia" } });
});

describe("Launch flow against a stubbed CLI", () => {
  it("previews, shows the preview, and launches only on confirmation with the preview's fingerprint", async () => {
    cli.previewGuardedSessionLaunch.mockResolvedValue(readyPreview());
    cli.launchGuardedSession.mockResolvedValue({ data: { reused: false, session: { id: "sess-9", observedStatus: "running", reattachCommand: "x", worktree_path: "/wt" } } });

    const step = await beginLaunch(target, routeFetch, ids);
    expect(step).toMatchObject({ kind: "preview", refusal: null, requestId: "console-launch-1" });
    expect(cli.previewGuardedSessionLaunch).toHaveBeenCalledWith("/repos/arcadia", "console-launch-1");
    expect(cli.launchGuardedSession).not.toHaveBeenCalled();

    const launched = await confirmLaunch(target, step as Extract<LaunchStep, { kind: "preview" }>, routeFetch);
    expect(launched).toEqual({ kind: "launched", message: "Session sess-9 launched.", sessionId: "sess-9" });
    expect(cli.launchGuardedSession).toHaveBeenCalledWith("/repos/arcadia", "console-launch-1", "fp-123", { operatorLaunch: true });
  });

  it("the console's confirmed Launch mints the post-exit authorization (Decision 0096); a launch POSTed without that confirmation, or never confirmed, does not", async () => {
    cli.previewGuardedSessionLaunch.mockResolvedValue(readyPreview());
    cli.launchGuardedSession.mockResolvedValue({ data: { reused: false, session: { id: "sess-9", observedStatus: "running", reattachCommand: "x", worktree_path: "/wt" } } });
    const step = (await beginLaunch(target, routeFetch, ids)) as Extract<LaunchStep, { kind: "preview" }>;

    // Previewing alone mints nothing, and the preview states what confirming authorizes.
    expect(cli.launchGuardedSession).not.toHaveBeenCalled();
    expect((step.preview as unknown as { operatorLaunchConsequence: string }).operatorLaunchConsequence).toMatch(/DRAFT pull request.*never merges/);

    // A POST without the explicit confirmation field launches with no authorization.
    await routeFetch("/api/projects/proj-arcadia/session-launch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: step.requestId, previewFingerprint: step.preview.previewFingerprint })
    });
    expect(cli.launchGuardedSession).toHaveBeenLastCalledWith("/repos/arcadia", "console-launch-1", "fp-123", { operatorLaunch: false });

    // The console's Launch Session confirmation sends it.
    await confirmLaunch(target, step, routeFetch);
    expect(cli.launchGuardedSession).toHaveBeenLastCalledWith("/repos/arcadia", "console-launch-1", "fp-123", { operatorLaunch: true });
  });

  it("withholds Launch when the preview names a different Action", async () => {
    cli.previewGuardedSessionLaunch.mockResolvedValue(readyPreview({ actionDocRef: "plan/plan-a#something-else" }));
    const step = await beginLaunch(target, routeFetch, ids);
    expect(step.kind).toBe("preview");
    expect((step as Extract<LaunchStep, { kind: "preview" }>).refusal).toMatch(/names plan\/plan-a#something-else, not plan\/plan-a#build-thing/);
    const result = await confirmLaunch(target, step as Extract<LaunchStep, { kind: "preview" }>, routeFetch);
    expect(result.kind).toBe("error");
    expect(cli.launchGuardedSession).not.toHaveBeenCalled();
  });

  it("withholds Launch when the preview is not ready, naming the prerequisites", async () => {
    cli.previewGuardedSessionLaunch.mockResolvedValue(readyPreview({ ready: false, prerequisites: ["Claude Code is not signed in"] }));
    const step = (await beginLaunch(target, routeFetch, ids)) as Extract<LaunchStep, { kind: "preview" }>;
    expect(step.refusal).toBe("Not ready to launch: Claude Code is not signed in");
    await confirmLaunch(target, step, routeFetch);
    expect(cli.launchGuardedSession).not.toHaveBeenCalled();
  });

  it("previews the pointer move first for a non-current Action and applies exactly that preview before the launch preview", async () => {
    cli.makeWorkQueueActionNext
      .mockResolvedValueOnce({ data: { receipt: { previewFingerprint: "ptr-fp", previousAction: "older-thing", nextAction: "build-thing", applied: false }, nextActionKey: null } })
      .mockResolvedValueOnce({ data: { receipt: { previewFingerprint: "ptr-fp", previousAction: "older-thing", nextAction: "build-thing", applied: true }, nextActionKey: "arcadia/build-thing" } });
    cli.previewGuardedSessionLaunch.mockResolvedValue(readyPreview());
    const moving = { ...target, needsMakeNext: true };

    const first = await beginLaunch(moving, routeFetch, ids);
    expect(first).toMatchObject({ kind: "make-next", fingerprint: "ptr-fp", previousAction: "older-thing", nextAction: "build-thing" });
    expect(cli.makeWorkQueueActionNext).toHaveBeenCalledWith(expect.objectContaining({ actionKey: "arcadia/build-thing", revision: 12, apply: false }));
    expect(cli.previewGuardedSessionLaunch).not.toHaveBeenCalled();

    const second = await confirmMakeNext(moving, first as Extract<LaunchStep, { kind: "make-next" }>, routeFetch, ids);
    expect(cli.makeWorkQueueActionNext).toHaveBeenLastCalledWith(
      expect.objectContaining({ apply: true, previewFingerprint: "ptr-fp", requestId: "console-make-next-1" })
    );
    expect(second).toMatchObject({ kind: "preview", refusal: null });
    expect(cli.launchGuardedSession).not.toHaveBeenCalled();
  });

  it("stops with the CLI's reason when the pointer move is refused", async () => {
    cli.makeWorkQueueActionNext.mockRejectedValue(new Error("revision changed; refresh"));
    const step = await beginLaunch({ ...target, needsMakeNext: true }, routeFetch, ids);
    expect(step).toEqual({ kind: "error", message: "revision changed; refresh" });
    expect(cli.previewGuardedSessionLaunch).not.toHaveBeenCalled();
  });

  it("makes request ids without a secure context", () => {
    expect(newRequestId("console-launch")).toMatch(/^console-launch-/);
  });
});
