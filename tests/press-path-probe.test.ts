import { describe, expect, it, vi } from "vitest";
import { probePressPath } from "../src/operatorActions/pressPathProbe.js";

const URL_ = "http://arcadia-1.example.ts.net:3020/api/operator-script/press-path";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("probePressPath", () => {
  it("sends one GET with Origin set to the URL's own origin and reports accept", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json({ accepted: true, host: "arcadia-1.example.ts.net:3020", origin: "http://arcadia-1.example.ts.net:3020", reason: null }));
    const result = await probePressPath({ url: URL_, fetch });
    expect(result).toMatchObject({ outcome: "accept", host: "arcadia-1.example.ts.net:3020" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetch.mock.calls[0];
    expect(calledUrl).toBe(URL_);
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).origin).toBe("http://arcadia-1.example.ts.net:3020");
    expect(init?.body).toBeUndefined();
  });
  it("reports refuse with the host the server saw", async () => {
    const fetch = vi.fn(async () => json({ accepted: false, host: "127.0.0.1:3020", origin: "http://arcadia-1.example.ts.net:3020", reason: "loopback" }));
    expect(await probePressPath({ url: URL_, fetch })).toMatchObject({ outcome: "refuse", host: "127.0.0.1:3020" });
  });
  it("reports unreachable and never throws on a network error", async () => {
    const fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const result = await probePressPath({ url: URL_, fetch });
    expect(result.outcome).toBe("unreachable");
    expect(result.detail).toContain("ECONNREFUSED");
  });
  it("reports unreachable for a non-JSON or error reply and for a malformed URL", async () => {
    expect((await probePressPath({ url: URL_, fetch: async () => new Response("<html>", { status: 502 }) })).outcome).toBe("unreachable");
    const fetch = vi.fn();
    expect((await probePressPath({ url: "not a url", fetch })).outcome).toBe("unreachable");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never sends anything but GET", async () => {
    const methods: string[] = [];
    await probePressPath({ url: URL_, fetch: async (_u, init) => { methods.push(String(init?.method)); return json({ accepted: true, host: "h", origin: "o", reason: null }); } });
    expect(methods).toEqual(["GET"]);
  });
});
