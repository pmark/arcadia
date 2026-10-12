import { execFile } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

// scripts/lib/ready-probe.sh: the restart's readiness probe waits for a slow
// service instead of failing on one 2 s probe and rolling every service back
// (Issue #430; again on 2026-10-11).

const lib = path.resolve(__dirname, "..", "scripts", "lib", "ready-probe.sh");
const run = promisify(execFile);
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

async function probe(url: string, deadline: number, env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await run("bash", ["-c", `source "${lib}"; probe_until_ready "$1" "$2"`, "probe", url, String(deadline)], {
      env: { ...process.env, ...env }
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

describe("restart readiness probe", () => {
  it("waits for a service that takes longer than the old 2 s to answer", async () => {
    const url = await serve((_request, response) => setTimeout(() => response.end("ok"), 3_000));
    const result = await probe(url, 10, { ARCADIA_READY_PROBE_TIMEOUT: "6" });
    expect(result.code).toBe(0);
  }, 20_000);

  it("keeps retrying a service that fails at first and then answers", async () => {
    const readyAt = Date.now() + 2_000;
    const url = await serve((_request, response) => {
      response.statusCode = Date.now() < readyAt ? 503 : 200;
      response.end();
    });
    const result = await probe(url, 10, { ARCADIA_READY_PROBE_TIMEOUT: "2" });
    expect(result.code).toBe(0);
  }, 20_000);

  it("fails once the deadline passes for a service that never answers", async () => {
    const url = await serve((_request, response) => {
      response.statusCode = 500;
      response.end();
    });
    const started = Date.now();
    const result = await probe(url, 2, { ARCADIA_READY_PROBE_TIMEOUT: "1" });
    expect(result.code).toBe(1);
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 20_000);

  it("refuses a setting that is not a whole number of seconds", async () => {
    const result = await probe("http://127.0.0.1:9/", 1, { ARCADIA_READY_PROBE_TIMEOUT: "0" });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("ARCADIA_READY_PROBE_TIMEOUT");
  });
});
