import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("../apps/dashboard/lib/session-observation", () => ({ readSessionObservation: read }));
import { GET as exact } from "../apps/dashboard/app/api/sessions/[id]/route";
import { GET as scoped } from "../apps/dashboard/app/api/projects/[id]/action-session/route";
beforeEach(() => { read.mockReset(); read.mockResolvedValue({ known: true, observedAt: "2030-01-01T00:00:00Z", session: null }); });
it("reads only the exact supplied Session and disables caching", async () => {
  const response = await exact(new Request("http://localhost/api/sessions/s_1"), { params: Promise.resolve({ id: "s_1" }) });
  expect(read).toHaveBeenCalledWith({ id: "s_1" }); expect(response.headers.get("cache-control")).toBe("no-store");
});
it.each(["../bad", "", "a/b", "a".repeat(129)])("rejects malformed Session id %s", async id => {
  expect((await exact(new Request("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
it("requires all three Action scope identities and carries them unchanged", async () => {
  const context = { params: Promise.resolve({ id: "project_1" }) };
  expect((await scoped(new Request("http://localhost?plan=p"), context)).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
  expect((await scoped(new Request("http://localhost?plan=p&action=a"), context)).status).toBe(200);
  expect(read).toHaveBeenCalledWith({ projectId: "project_1", plan: "p", action: "a" });
});
it("an unavailable observer returns a failure rather than an empty Session", async () => {
  read.mockRejectedValue(new Error("Workspace unreadable"));
  const response = await exact(new Request("http://localhost"), { params: Promise.resolve({ id: "s_1" }) });
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Workspace unreadable" });
});
