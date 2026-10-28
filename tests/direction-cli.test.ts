import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { POST } from "../apps/dashboard/app/api/ask/route.js";
import { GET } from "../apps/dashboard/app/api/ask/show/route.js";
import { withDatabase } from "../src/db/connection.js";
import { createDirectionFixture } from "./helpers/directionFixture.js";

describe("direction CLI and HTTP boundaries", () => {
  it("runs capture, checkpoint, compact ack and held projection through the actual CLI", async () => {
    const f = createDirectionFixture();
    const cli = (...args: string[]) => {
      const result = spawnSync(process.execPath, ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), path.resolve("src/cli.ts"), ...args, "--workspace", f.workspace, "--json"], {
        cwd: f.repo, env: { ...process.env, ARCADIA_WORKSPACE: f.workspace, ARCADIA_CONFIG_PATH: path.join(f.root, "user-config.json") }, encoding: "utf8"
      });
      const output = result.stdout.trim() || result.stderr.trim();
      if (!output) throw new Error(`CLI produced no JSON: ${result.error?.message ?? "empty output"}`);
      return { status: result.status, value: JSON.parse(output) };
    };
    const target = { projectId: f.project.id, plan: "work", action: "first" };
    const captured = cli("ask", "Complete the first proof", "--request-id", "cli-direction", "--direction-target", JSON.stringify(target));
    expect(captured.status).toBe(0);
    const direction = captured.value.data.direction;
    expect(direction).toMatchObject({ state: "held", disposition: "accepted" });
    const conflict = cli("ask", "Complete the first proof", "--request-id", "cli-direction", "--direction-target", JSON.stringify(target), "--project", f.project.id);
    expect(conflict.status).not.toBe(0);
    expect(conflict.value.error).toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("ordinary routing") });
    const offered = cli("native-mail", "send", "--request-id", "cli-offer", "--kind", "request", "--repository", f.repo, "--project-slug", "demo", "--plan-slug", "work",
      "--sender-incarnation", "sender", "--sender-generation", "1", "--recipient-incarnation", "recipient", "--recipient-generation", "2",
      "--assignment-evidence", "action/first", "--receiver-checkpoint-capability", "checkpoint", "--actor", "sender",
      "--direction-request-id", direction.requestId, "--direction-fingerprint", direction.fingerprint);
    expect(offered.status).toBe(0);
    const messageId = offered.value.data.message.id;
    const scope = ["--project-slug", "demo", "--plan-slug", "work", "--recipient-incarnation", "recipient", "--recipient-generation", "2", "--actor", "recipient"];
    const consume = ["native-mail", "consume", "--message-id", messageId, "--request-id", "cli-consume", "--fingerprint", direction.fingerprint, ...scope];
    expect(cli(...consume).status).not.toBe(0);
    expect(cli("native-mail", "inbox", ...scope).status).toBe(0);
    expect(cli(...consume).status).toBe(0);
    expect(cli("native-mail", "ack", "--message-id", messageId, ...scope).status).not.toBe(0);
    expect(cli("native-mail", "ack", "--message-id", messageId, "--compact-acknowledgment", "I consumed this checkpoint.", ...scope).status).toBe(0);
    expect(cli("native-mail", "record-recipient-state", "--message-id", messageId, "--request-id", "cli-stopped", "--state", "stopped", "--evidence-reference", "fixture:terminal-stopped", ...scope).status).toBe(0);
    expect(cli("ask", "show", direction.requestId).value.data.direction).toMatchObject({ state: "held", lastSupportedState: "acknowledged" });
    const snapshot = () => withDatabase(f.workspace, db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row: unknown) => {
      const name = (row as { name: string }).name; return [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()];
    })));
    const before = snapshot();
    expect(cli("ask", "show", direction.requestId).status).toBe(0);
    expect(cli("ask", "show", "missing").status).not.toBe(0);
    expect(snapshot()).toBe(before);
    vi.stubEnv("ARCADIA_WORKSPACE", f.workspace); vi.stubEnv("ARCADIA_DASHBOARD_CLI", "source");
    try {
      const response = await POST(new Request("http://localhost/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "  Preserve exact whitespace  ", requestId: "api-direction", directionTarget: target }) }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ direction: { requestId: "api-direction", content: "  Preserve exact whitespace  ", disposition: "accepted", target } });
      expect((await GET(new Request("http://localhost/api/ask/show?id=api-direction"))).status).toBe(200);
    } finally { vi.unstubAllEnvs(); }
  }, 60_000);
});
