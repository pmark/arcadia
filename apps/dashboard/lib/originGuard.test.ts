import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "./originGuard";

function request(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/projects/proj-1/session-launch", { method: "POST", headers });
}

describe("isSameOriginRequest", () => {
  it("accepts a same-origin fetch reported by Sec-Fetch-Site", () => {
    expect(isSameOriginRequest(request({ "sec-fetch-site": "same-origin", host: "127.0.0.1:3000" }))).toBe(true);
  });

  it("accepts a non-browser navigation reported by Sec-Fetch-Site: none", () => {
    expect(isSameOriginRequest(request({ "sec-fetch-site": "none", host: "127.0.0.1:3000" }))).toBe(true);
  });

  it("rejects a cross-site fetch reported by Sec-Fetch-Site", () => {
    expect(isSameOriginRequest(request({ "sec-fetch-site": "cross-site", host: "127.0.0.1:3000" }))).toBe(false);
  });

  it("rejects a same-site (but not same-origin) fetch reported by Sec-Fetch-Site", () => {
    expect(isSameOriginRequest(request({ "sec-fetch-site": "same-site", host: "127.0.0.1:3000" }))).toBe(false);
  });

  it("falls back to comparing Origin against Host when Sec-Fetch-Site is absent", () => {
    expect(isSameOriginRequest(request({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(true);
    expect(isSameOriginRequest(request({ origin: "https://evil.example", host: "127.0.0.1:3000" }))).toBe(false);
  });

  it("rejects an Origin header with no Host to compare against", () => {
    expect(isSameOriginRequest(request({ origin: "http://127.0.0.1:3000" }))).toBe(false);
  });

  it("rejects a malformed Origin header rather than failing open", () => {
    expect(isSameOriginRequest(request({ origin: "not-a-url", host: "127.0.0.1:3000" }))).toBe(false);
  });

  it("lets through a request with neither header, matching this deployment's no-identity model", () => {
    expect(isSameOriginRequest(request({}))).toBe(true);
  });
});
