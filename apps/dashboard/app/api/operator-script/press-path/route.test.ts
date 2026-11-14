import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  const wrap = <T extends (...a: never[]) => unknown>(name: string, fn: T) => ((...a: never[]) => { calls.names.push(name); return fn(...a); }) as T;
  return { ...real, spawn: wrap("spawn", real.spawn), exec: wrap("exec", real.exec), execFile: wrap("execFile", real.execFile), spawnSync: wrap("spawnSync", real.spawnSync), execSync: wrap("execSync", real.execSync) };
});
vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  const wrap = <T extends (...a: never[]) => unknown>(name: string, fn: T) => ((...a: never[]) => { calls.names.push(name); return fn(...a); }) as T;
  return { ...real, writeFileSync: wrap("writeFileSync", real.writeFileSync), mkdirSync: wrap("mkdirSync", real.mkdirSync), appendFileSync: wrap("appendFileSync", real.appendFileSync) };
});

const URL_ = "http://arcadia-1.example.ts.net:3020/api/operator-script/press-path";
const get = async (headers: Record<string, string>) => {
  const { GET } = await import("./route");
  const response = await GET(new Request(URL_, { method: "GET", headers }));
  return { response, body: await response.json() as { accepted: boolean; host: string | null; origin: string | null; reason: string | null } };
};
afterEach(() => { vi.restoreAllMocks(); });

describe("read-only press-path probe route", () => {
  it("accepts the header set a browser sends at the Tailnet URL", async () => {
    const { response, body } = await get({ origin: "http://arcadia-1.example.ts.net:3020", host: "arcadia-1.example.ts.net:3020" });
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ accepted: true, host: "arcadia-1.example.ts.net:3020", reason: null });
  });
  it("refuses a Host that a serve rewrote to loopback and names it", async () => {
    const { body } = await get({ origin: "http://arcadia-1.example.ts.net:3020", host: "127.0.0.1:3020" });
    expect(body.accepted).toBe(false);
    expect(body.host).toBe("127.0.0.1:3020");
    expect(body.reason).toMatch(/loopback/i);
    expect(body.reason).toContain("127.0.0.1:3020");
  });
  it("refuses a request without Origin", async () => {
    const { body } = await get({ host: "arcadia-1.example.ts.net:3020" });
    expect(body).toMatchObject({ accepted: false });
    expect(body.reason).toMatch(/origin/i);
  });
  it("starts no process and writes no file", async () => {
    calls.names.length = 0;
    const dir = mkdtempSync(path.join(os.tmpdir(), "press-path-"));
    const before = readdirSync(dir);
    calls.names.length = 0;
    await get({ origin: "http://arcadia-1.example.ts.net:3020", host: "arcadia-1.example.ts.net:3020" });
    await get({ host: "127.0.0.1:3020" });
    expect(calls.names).toEqual([]);
    expect(readdirSync(dir)).toEqual(before);
    expect(existsSync(dir)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
