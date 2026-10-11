import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("../../../../../src/operatorActions/legacyRetirements.json"); vi.restoreAllMocks(); vi.resetModules(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("GET lists the library without reporting hash-pinned retired entries as errors (#1257)", () => {
  async function list(retire: boolean, scriptBytes = "#!/bin/sh\nexit 0\n") {
    const dir = mkdtempSync(path.join(os.tmpdir(), "arcadia-retired-route-")); roots.push(dir);
    const descriptor = JSON.stringify({ id: "legacy-entry" });
    writeFileSync(path.join(dir, "legacy-entry.json"), descriptor);
    writeFileSync(path.join(dir, "legacy-entry.sh"), scriptBytes, { mode: 0o755 });
    vi.doMock("../../../../../src/operatorActions/legacyRetirements.json", () => ({ default: {
      schema: "arcadia-operator-script-retirements-v1",
      retirements: retire ? [{ id: "legacy-entry", descriptorSha256: sha(descriptor), scriptSha256: sha("#!/bin/sh\nexit 0\n"), outcome: "never run", reason: "fixture" }] : []
    } }));
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", dir); vi.resetModules();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { GET } = await import("./route");
    const body = await (await GET()).json() as { scripts: unknown[] };
    return { body, error };
  }
  it("skips a pinned retired entry silently", async () => {
    const { body, error } = await list(true);
    expect(body.scripts).toEqual([]); expect(error).not.toHaveBeenCalled();
  });
  it("still reports an unpinned invalid entry", async () => {
    const { body, error } = await list(false);
    expect(body.scripts).toEqual([]); expect(error).toHaveBeenCalledTimes(1);
  });
  it("still reports a pinned id whose script bytes changed", async () => {
    const { body, error } = await list(true, "#!/bin/sh\nexit 1\n");
    expect(body.scripts).toEqual([]); expect(error).toHaveBeenCalledTimes(1);
  });
});
