import { beforeEach, describe, expect, it, vi } from "vitest";

const { launchGuardedSession, loadProjectContinuation, previewGuardedSessionLaunch } = vi.hoisted(() => ({
  launchGuardedSession: vi.fn(),
  loadProjectContinuation: vi.fn(),
  previewGuardedSessionLaunch: vi.fn()
}));

vi.mock("../../../../../lib/arcadia-cli", () => ({
  ArcadiaCliError: class ArcadiaCliError extends Error {
    statusCode = 500;
    details: unknown = null;
  },
  launchGuardedSession,
  loadProjectContinuation,
  previewGuardedSessionLaunch
}));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: "proj-1" }) };

function launchRequest(body: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  launchGuardedSession.mockReset();
  loadProjectContinuation.mockReset();
  previewGuardedSessionLaunch.mockReset();
  loadProjectContinuation.mockResolvedValue({ data: { repoRoot: "/repo" } });
  launchGuardedSession.mockResolvedValue({ data: { reused: false, session: { id: "session_1" } } });
});

describe("POST /api/projects/[id]/session-launch and the operator launch authorization (Decision 0096)", () => {
  it("a confirmed Launch passes the dashboard confirmation to the CLI, which mints server-side", async () => {
    const response = await POST(launchRequest({ requestId: "req-1", previewFingerprint: "abc", confirmOperatorLaunch: true }), params);
    expect(response.status).toBe(200);
    expect(launchGuardedSession).toHaveBeenCalledWith("/repo", "req-1", "abc", { operatorLaunch: true });
  });

  it.each([false, "true", 1, undefined])("a Launch without an explicit boolean confirmation (%s) carries no authorization", async (confirm) => {
    const response = await POST(launchRequest({ requestId: "req-1", previewFingerprint: "abc", confirmOperatorLaunch: confirm }), params);
    expect(response.status).toBe(200);
    expect(launchGuardedSession).toHaveBeenCalledWith("/repo", "req-1", "abc", { operatorLaunch: false });
  });

  it.each([
    ["no Sec-Fetch-Site header (an agent's curl)", {}],
    ["Sec-Fetch-Site: none", { "sec-fetch-site": "none" }],
    ["only a same-host Origin header", { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }]
  ])("a confirmed POST with %s is refused: nothing is launched and nothing is minted", async (_label, headers) => {
    const request = new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ requestId: "req-1", previewFingerprint: "abc", confirmOperatorLaunch: true })
    });
    const response = await POST(request, params);
    expect(response.status).toBe(403);
    expect((await response.json()).details).toMatchObject({ code: "operator_launch_not_from_browser" });
    expect(launchGuardedSession).not.toHaveBeenCalled();
  });

  it("an unconfirmed header-less POST still launches, carrying no authorization", async () => {
    const request = new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "req-1", previewFingerprint: "abc" })
    });
    expect((await POST(request, params)).status).toBe(200);
    expect(launchGuardedSession).toHaveBeenCalledWith("/repo", "req-1", "abc", { operatorLaunch: false });
  });

  it("a cross-origin request never reaches the launcher, confirmed or not", async () => {
    const request = new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: JSON.stringify({ requestId: "req-1", previewFingerprint: "abc", confirmOperatorLaunch: true })
    });
    expect((await POST(request, params)).status).toBe(403);
    expect(launchGuardedSession).not.toHaveBeenCalled();
  });

  it("the preview response states what confirming authorizes, before the operator confirms", async () => {
    previewGuardedSessionLaunch.mockResolvedValue({ data: { requestId: "req-1", previewFingerprint: "abc" } });
    const response = await GET(new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch?requestId=req-1"), params);
    const body = await response.json();
    expect(body.previewFingerprint).toBe("abc");
    expect(body.operatorLaunchConsequence).toContain("DRAFT pull request");
    expect(body.operatorLaunchConsequence).toContain("never merges");
    expect(body.operatorLaunchConsequence).toContain("24 hours");
  });
});
