import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("node:fs/promises"); vi.resetModules(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function library(ids: string[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-one-action-")); roots.push(root);
  for (const id of ids) {
    writeFileSync(path.join(root, `${id}.sh`), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(path.join(root, `${id}.json`), JSON.stringify({ schema: "arcadia-operator-script-v1", id, script: `${id}.sh`, title: `Title ${id}`, problem: "Problem", desired_effect: "Effect", authority: { does: ["One"], never_does: ["Two"] }, success: { effect: "Done", next: "Keep" }, failure: { effect: "Refused", next: "Retry" }, repeatable: true }));
  }
  return root;
}
const call = async (id: string) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://arcadia.test/api/operator-script/${id}`), { params: Promise.resolve({ id }) });
};

describe("GET /api/operator-script/<id>", () => {
  it("returns exactly one descriptor with its state and latest receipt, without listing the library", async () => {
    const root = library(["alpha", "beta", "gamma"]);
    mkdirSync(path.join(root, "runs/20261018T010101Z-1"), { recursive: true });
    writeFileSync(path.join(root, "runs/20261018T010101Z-1/receipt.json"), JSON.stringify({ id: "beta", outcome: "succeeded", startedAt: "2026-10-18T01:00:00Z", finishedAt: "2026-10-18T01:01:00Z" }));
    writeFileSync(path.join(root, "runs/20261018T010101Z-1/other.json"), "{}");
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", root);
    const listed: string[] = [];
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return { ...actual, readdir: ((target: string, ...rest: unknown[]) => { listed.push(String(target)); return (actual.readdir as (...args: unknown[]) => unknown)(target, ...rest); }) as typeof actual.readdir };
    });
    vi.resetModules();

    const response = await call("beta");

    expect(response.status).toBe(200);
    const body = await response.json() as { script: { id: string; title: string; state: { status: string }; lastRunReceipt: { outcome: string; succeededAt: string } } };
    expect(body).not.toHaveProperty("scripts");
    expect(body.script).toMatchObject({ id: "beta", title: "Title beta", state: { status: "available" }, lastRunReceipt: { outcome: "succeeded", succeededAt: "2026-10-18T01:01:00Z" } });
    expect(listed).not.toContain(root); // the library directory itself is never listed
  });

  it("answers 404 for an unknown id and 400 for one outside the naming contract", async () => {
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", library(["alpha"]));
    vi.resetModules();
    expect((await call("missing")).status).toBe(404);
    expect((await call("..%2Fetc")).status).toBe(400);
  });
});
