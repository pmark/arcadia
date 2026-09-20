import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { operatorScriptRunnerSource } from "../../../lib/operatorScriptRunner";
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

  it("records the terminal result of a detached script runner", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-operator-state-"));
    const script = path.join(root, "example.sh");
    const state = path.join(root, "state.json");
    writeFileSync(script, "#!/usr/bin/env bash\nexit 7\n");
    chmodSync(script, 0o755);

    const result = spawnSync(process.execPath, ["-e", operatorScriptRunnerSource, script, state]);

    expect(result.status).toBe(7);
    expect(JSON.parse(readFileSync(state, "utf8"))).toMatchObject({ status: "failed", exitCode: 7 });
  });

  it("does not leak dashboard runtime markers into operator scripts", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-operator-env-"));
    const script = path.join(root, "example.sh");
    const state = path.join(root, "state.json");
    writeFileSync(script, "#!/usr/bin/env bash\n[[ -z \"${NODE_ENV:-}\" && -z \"${NEXT_RUNTIME:-}\" && -z \"${__NEXT_PRIVATE_TEST:-}\" ]]\n");
    chmodSync(script, 0o755);

    const result = spawnSync(process.execPath, ["-e", operatorScriptRunnerSource, script, state], {
      env: { ...process.env, NODE_ENV: "dashboard-runtime", NEXT_RUNTIME: "nodejs", __NEXT_PRIVATE_TEST: "present" }
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(state, "utf8"))).toMatchObject({ status: "succeeded", exitCode: 0 });
  });

});
