import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/operator-script", () => {
  it("refuses cross-origin execution", async () => {
    const response = await POST(new Request("http://arcadia.test/api/operator-script", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ id: "request-arcadia-go-handoff" })
    }));
    expect(response.status).toBe(403);
  });

  it("refuses ids outside the library naming contract", async () => {
    const response = await POST(new Request("http://arcadia.test/api/operator-script", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ id: "../anything-else" })
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("valid operator-script id") });
  });

  it("refuses malformed JSON", async () => {
    const response = await POST(new Request("http://arcadia.test/api/operator-script", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: "{not-json"
    }));
    expect(response.status).toBe(400);
  });

});
