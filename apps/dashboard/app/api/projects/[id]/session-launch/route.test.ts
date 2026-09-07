import { describe, expect, it } from "vitest";
import { POST } from "./route";

function crossOriginRequest(): Request {
  return new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
    body: JSON.stringify({ requestId: "req-1", previewFingerprint: "abc" })
  });
}

describe("POST /api/projects/[id]/session-launch", () => {
  it("refuses a cross-origin launch request before it ever reaches the CLI", async () => {
    const response = await POST(crossOriginRequest(), { params: Promise.resolve({ id: "proj-1" }) });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("Cross-origin");
    expect(body.details).toEqual({ conflict: true });
  });

  it("refuses a malformed request body even when same-origin", async () => {
    const request = new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const response = await POST(request, { params: Promise.resolve({ id: "proj-1" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("required");
  });

  it("returns a client error for malformed JSON instead of attempting a launch", async () => {
    const request = new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: "{not-json"
    });
    const response = await POST(request, { params: Promise.resolve({ id: "proj-1" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("valid JSON");
  });
});
