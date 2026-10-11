import { beforeEach, expect, it, vi } from "vitest";
const cli = vi.hoisted(() => ({ loadRecurringSchedules: vi.fn(), changeRecurringSchedule: vi.fn() }));
vi.mock("../../../lib/arcadia-cli", () => ({ ...cli, ArcadiaCliError: class extends Error { statusCode = 409; details = { conflict: true }; } }));
import { GET, POST } from "./route";
const expected = "a".repeat(64);
const status = { available: true, schedules: [] };
beforeEach(() => { vi.clearAllMocks(); cli.loadRecurringSchedules.mockResolvedValue({ data: status }); cli.changeRecurringSchedule.mockResolvedValue({ data: {} }); });
function request(body: unknown, site = "same-origin") { return new Request("http://arcadia.test/api/clock", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": site }, body: JSON.stringify(body) }); }
it("reads without writes", async () => { expect(await (await GET()).json()).toEqual(status); expect(cli.changeRecurringSchedule).not.toHaveBeenCalled(); });
it("rejects cross-origin changes before invoking CLI", async () => { expect((await POST(request({ action: "enable", id: "notes", expected }, "cross-site"))).status).toBe(403); expect(cli.changeRecurringSchedule).not.toHaveBeenCalled(); });
it.each([null, [], { action: "tick", id: "notes", expected }, { action: "pause", id: "notes" }, { action: "enable", id: "--workspace", expected }, { action: "edit", id: "notes", expected }, { action: "pause", id: "notes", expected, workspace: "other" }])("refuses invalid request %j", async (body) => { expect((await POST(request(body))).status).toBe(400); expect(cli.changeRecurringSchedule).not.toHaveBeenCalled(); });
it.each(["enable", "pause", "edit"])("routes %s through CLI with exact fingerprint and reloads", async (action) => { const timing = { cadence: "daily", time: "09:00", timezone: "UTC" }; expect((await POST(request({ action, id: "notes", expected, ...(action === "edit" ? { timing } : {}) }))).status).toBe(200); expect(cli.changeRecurringSchedule).toHaveBeenCalledWith({ action, id: "notes", expected, timing: action === "edit" ? timing : undefined }); });
it("does not turn CLI errors into success", async () => { cli.changeRecurringSchedule.mockRejectedValue(new Error("Unavailable")); expect((await POST(request({ action: "pause", id: "notes", expected }))).status).toBe(500); });
