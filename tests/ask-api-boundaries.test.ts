import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ runAsk: vi.fn(), showAsk: vi.fn() }));
vi.mock("../apps/dashboard/lib/arcadia-cli", async () => ({
  ...await vi.importActual<typeof import("../apps/dashboard/lib/arcadia-cli")>("../apps/dashboard/lib/arcadia-cli"),
  ...boundary
}));
import { POST } from "../apps/dashboard/app/api/ask/route.js";
import { GET } from "../apps/dashboard/app/api/ask/show/route.js";
import { ArcadiaCliError } from "../apps/dashboard/lib/arcadia-cli.js";

const post = (body: unknown) => POST(new Request("http://localhost/api/ask", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

// Fault/concurrency tests deliberately replace only the subprocess boundary.
// Real success payloads and database projection are exercised in ask-api-scenarios.
describe("Ask API validation and independent reads", () => {
  it.each([{}, { request: "   " }, { request: 17 }])("rejects an empty or non-text request before starting the CLI: %j", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Ask request is required.", details: null });
    expect(boundary.runAsk).not.toHaveBeenCalled();
  });

  it.each(["", "?id=%20%20"])("requires a receipt id before starting a lookup: %s", async (query) => {
    const response = await GET(new Request(`http://localhost/api/ask/show${query}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("id is required") });
    expect(boundary.showAsk).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before intake", async () => {
    const response = await POST(new Request("http://localhost/api/ask", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Ask request must contain valid JSON.", details: null });
    expect(boundary.runAsk).not.toHaveBeenCalled();
  });

  it.each([null, [], "hello", 17])("rejects a non-object JSON body before intake: %j", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Ask request must be a JSON object.", details: null });
    expect(boundary.runAsk).not.toHaveBeenCalled();
  });

  it.each(["submit", "show"])("preserves a CLI service-unavailable error and remedy on %s", async (operation) => {
    const error = new ArcadiaCliError("WORKSPACE_NOT_FOUND: Workspace not found.", 503, { remedy: "Restore the workspace mount." });
    boundary.runAsk.mockRejectedValue(error);
    boundary.showAsk.mockRejectedValue(error);
    const response = operation === "submit" ? await post({ request: "Capture this idea" }) : await GET(new Request("http://localhost/api/ask/show?id=request-one"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: error.message, details: error.details });
  });

  it("reports an unexpected intake failure without a successful-looking receipt", async () => {
    boundary.runAsk.mockRejectedValue(new Error("subprocess unavailable"));
    const response = await post({ request: "Capture this idea" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "subprocess unavailable", details: null });
  });

  it("allows a receipt read to finish while another submission is blocked", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let started: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    boundary.runAsk.mockImplementation(async () => {
      started?.();
      await blocked;
      throw new ArcadiaCliError("Fixture submission stopped", 503);
    });
    boundary.showAsk.mockResolvedValue({ data: { capture: null, asks: [] } });
    const submitting = post({ request: "A deliberately slow submission" });
    await entered;
    try {
      const reading = GET(new Request("http://localhost/api/ask/show?id=existing-receipt"));
      // Microtask checkpoint: no wall-clock latency threshold or race with a timer.
      const outcome = await Promise.race([
        reading.then(() => "read completed"),
        new Promise<string>((resolve) => { setImmediate(() => resolve("read blocked")); })
      ]);
      expect(outcome).toBe("read completed");
      expect((await reading).status).toBe(200);
      expect(boundary.showAsk).toHaveBeenCalledWith({ id: "existing-receipt" });
    } finally {
      release?.();
      await submitting;
    }
  });
});
