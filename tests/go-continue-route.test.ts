import { beforeEach, describe, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => ({ loadGoContext: vi.fn(), preview: vi.fn(), launch: vi.fn() }));
vi.mock("../apps/dashboard/lib/arcadia-cli", () => ({
  loadGoContext: adapters.loadGoContext, previewGuardedSessionLaunch: adapters.preview,
  loadProjectContinuation: vi.fn(async () => ({ data: { repoRoot: "/fixture" } })),
  launchGuardedSession: adapters.launch, ArcadiaCliError: class extends Error {
    constructor(message: string, public statusCode: number, public details: unknown = null) { super(message); }
  }
}));
import { GET, POST } from "../apps/dashboard/app/api/projects/[id]/go-continue/route";
import { goResolutionIdentity } from "../apps/dashboard/lib/go-continue";
import type { ProjectContinuationResponse } from "../apps/dashboard/lib/arcadia-cli";
import { ArcadiaCliError } from "../apps/dashboard/lib/arcadia-cli";

const context = { params: Promise.resolve({ id: "project-1" }) };
const url = "http://fixture/api/projects/project-1/go-continue";
const resolution = () => ({ repoRoot: "/fixture", projectId: "project-1", dispatchable: true, blockers: [], operatorQuestion: null,
  context: { activePlan: "one-plan", action: { id: "one-action", responsibility: "agent", acceptanceCriteria: ["prove one delivery"] }, planTokenBudget: "one bounded pass" }
}) as unknown as ProjectContinuationResponse;
let current: ProjectContinuationResponse;
const post = (body: unknown, site = "same-origin") => POST(new Request(url, { method: "POST",
  headers: { "content-type": "application/json", "sec-fetch-site": site }, body: JSON.stringify(body) }), context);

beforeEach(() => {
  vi.clearAllMocks(); current = resolution();
  adapters.loadGoContext.mockImplementation(async () => ({ data: { projects: [{ resolution: current, error: null, discoveryErrors: [] }] } }));
  adapters.preview.mockImplementation(async (_repo: string, requestId: string) => ({ data: {
    requestId, previewFingerprint: "fingerprint-1", actionDocRef: "plan/one-plan#one-action", ready: true,
    prerequisites: [], selection: { provider: "codex", model: "configured", effort: "configured" }
  } }));
  adapters.launch.mockResolvedValue({ data: { reused: false, session: { id: "session-1" } } });
});

async function preview() {
  const reply = await GET(new Request(`${url}?plan=one-plan&action=one-action&resolutionId=${goResolutionIdentity("project-1", current)}`), context);
  expect(reply.status).toBe(200); return reply.json();
}

describe("workspace Continue reuses the protected one-Action launch", () => {
  it("previews owner/provider/limits with a stable identity across tabs and timestamps, without launching", async () => {
    const [a, b] = await Promise.all([preview(), preview()]);
    expect(a.requestId).toBe(b.requestId);
    expect(a).toMatchObject({ owner: "agent", target: { projectId: "project-1", plan: "one-plan", action: "one-action" },
      selection: { provider: "codex" }, limits: { actions: 1, sessions: 1, authorizationHours: 24, automaticNextAction: false } });
    expect(adapters.launch).not.toHaveBeenCalled();
  });
  it("refuses changed Go facts even when the Plan and Action ids stayed the same", async () => {
    const shown = await preview();
    current.context!.action.acceptanceCriteria = ["changed acceptance"];
    const reply = await post({ ...shown, plan: "one-plan", action: "one-action", confirmOperatorLaunch: true });
    expect(reply.status).toBe(409);
    expect(await reply.json()).toMatchObject({ details: { conflict: true, freshRead: true, changedFacts: { expected: { resolutionId: shown.resolutionId } } } });
    expect(adapters.launch).not.toHaveBeenCalled();
  });
  it.each(["owner", "limit", "pointer"])("refuses a changed %s between the shown Go read and preview", async kind => {
    const shownId = goResolutionIdentity("project-1", current);
    if (kind === "owner") current.context!.action.responsibility = "autonomous";
    if (kind === "limit") current.context!.planTokenBudget = "changed limit";
    if (kind === "pointer") current.context!.action.id = "different-action";
    const reply = await GET(new Request(`${url}?plan=one-plan&action=one-action&resolutionId=${shownId}`), context);
    expect(reply.status).toBe(409);
    expect(await reply.json()).toMatchObject({ details: { freshRead: true, changedFacts: { actual: expect.any(Object) } } });
    expect(adapters.preview).not.toHaveBeenCalled(); expect(adapters.launch).not.toHaveBeenCalled();
  });
  it("refuses changed launch facts and reports the current preview", async () => {
    const shown = await preview(); adapters.preview.mockResolvedValueOnce({ data: { ...shown, previewFingerprint: "changed-provider-or-packet", selection: { provider: "changed-provider", model: "configured", effort: "configured" } } });
    const reply = await post({ ...shown, plan: "one-plan", action: "one-action", confirmOperatorLaunch: true });
    expect(reply.status).toBe(409);
    expect(await reply.json()).toMatchObject({ details: { changedFacts: { actual: { previewFingerprint: "changed-provider-or-packet", selection: { provider: "changed-provider" } } } } });
    expect(adapters.launch).not.toHaveBeenCalled();
  });
  it("never replaces a refused or unreadable Go resolution with a launch", async () => {
    current.dispatchable = false; current.blockers = [{ relativePath: "Decision", field: "status", message: "Approval required", remedy: "Answer Decision" }];
    const reply = await GET(new Request(`${url}?plan=one-plan&action=one-action&resolutionId=old`), context);
    expect(reply.status).toBe(409); expect(adapters.preview).not.toHaveBeenCalled();
    expect(adapters.launch).not.toHaveBeenCalled();
  });
  it("carries the stable request to the existing launch and never synthesizes browser confirmation", async () => {
    const shown = await preview();
    const body = { ...shown, plan: "one-plan", action: "one-action", confirmOperatorLaunch: true };
    const forbidden = await post(body, "none");
    expect(forbidden.status).toBe(403); expect(adapters.launch).not.toHaveBeenCalled();
    expect((await post(body)).status).toBe(200);
    expect(adapters.launch).toHaveBeenCalledWith("/fixture", shown.requestId, shown.previewFingerprint, { operatorLaunch: true });
  });
  it("refuses cross-origin and incomplete requests before protected launch", async () => {
    expect((await post({}, "cross-site")).status).toBe(403);
    expect((await post({})).status).toBe(400);
    expect(adapters.launch).not.toHaveBeenCalled();
  });
  it("requires the workspace's explicit confirmation instead of falling back to an unconfirmed launch", async () => {
    const shown = await preview();
    expect((await post({ ...shown, plan: "one-plan", action: "one-action", confirmOperatorLaunch: false })).status).toBe(400);
    expect(adapters.launch).not.toHaveBeenCalled();
  });
  it("retains a last-boundary launch refusal with fresh facts instead of automatically retrying", async () => {
    const shown = await preview();
    // The existing launcher performs another fingerprint/gate check after
    // this wrapper. A refusal at that boundary is never retried here.
    adapters.launch.mockRejectedValueOnce(new ArcadiaCliError("The launch preview is stale", 409, { conflict: true }));
    const reply = await post({ ...shown, plan: "one-plan", action: "one-action", confirmOperatorLaunch: true });
    expect(reply.status).toBe(409);
    expect(await reply.json()).toMatchObject({ details: { launch: { conflict: true }, freshRead: true, changedFacts: { requestId: shown.requestId } } });
    expect(adapters.launch).toHaveBeenCalledTimes(1);
  });
  it("binds every governed fact, while ignoring observer timestamps outside the resolution", () => {
    const a = goResolutionIdentity("project-1", current);
    expect(goResolutionIdentity("project-2", current)).not.toBe(a);
    current.context!.planTokenBudget = "changed limit";
    expect(goResolutionIdentity("project-1", current)).not.toBe(a);
  });
});
