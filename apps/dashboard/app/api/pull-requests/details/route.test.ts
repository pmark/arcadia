import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../../../lib/arcadia-cli", () => ({ loadPullRequestDetails: mocks.load, ArcadiaCliError: class extends Error { statusCode = 404; } }));
import { GET } from "./route";
beforeEach(() => vi.resetAllMocks());
describe("requested PR details", () => {
  it("validates before making a source read", async () => {
    expect((await GET(new Request("http://localhost/api/pull-requests/details?repository=outside&number=0"))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("reads just the selected configured PR", async () => {
    mocks.load.mockResolvedValue({ body: "Details", files: ["fix.ts"] });
    const response = await GET(new Request("http://localhost/api/pull-requests/details?repository=owner/repo&number=2"));
    expect(await response.json()).toMatchObject({ body: "Details", files: ["fix.ts"] });
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("owner/repo", 2);
  });
});
