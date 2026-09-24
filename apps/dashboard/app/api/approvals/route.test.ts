import { describe, expect, it } from "vitest";
import { POST } from "./route";

function request(body: unknown, site: "same-origin" | "cross-site" = "same-origin"): Request {
  return new Request("http://arcadia.test/api/approvals", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": site },
    body: JSON.stringify(body)
  });
}

describe("POST /api/approvals", () => {
  it("refuses a cross-origin approval request", async () => {
    const response = await POST(request({ kind: "agent_ask", id: "a", project: "demo" }, "cross-site"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Cross-origin") });
  });

  it("refuses malformed JSON", async () => {
    const response = await POST(new Request("http://arcadia.test/api/approvals", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: "not json"
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("JSON") });
  });

  it("refuses a body missing kind, id, or project", async () => {
    const response = await POST(request({ kind: "agent_ask" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("required") });
  });

  it("refuses an unrecognized kind", async () => {
    const response = await POST(request({ kind: "review", id: "a", project: "demo" }));
    expect(response.status).toBe(400);
  });
});
