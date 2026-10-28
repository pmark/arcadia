import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { POST } from "../apps/dashboard/app/api/ask/route.js";
import { GET } from "../apps/dashboard/app/api/ask/show/route.js";
import { withDatabase } from "../src/db/connection.js";
import { acknowledgeMailMessage, consumeDirectionCheckpoint, listMailInbox, recordDirectionRecipientState, sendMailMessage } from "../src/nativeMail/store.js";
import { createDirectionFixture } from "./helpers/directionFixture.js";

describe("direction CLI and HTTP boundaries", () => {
  it("runs capture, checkpoint, compact ack and held projection through the actual CLI", () => {
    const f = createDirectionFixture();
    const cli = fixtureCli(f);
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
  }, 60_000);

  it("keeps successful and missing CLI reads free of database writes", () => {
    const f = createDirectionFixture();
    const cli = fixtureCli(f);
    const captured = cli("ask", "Complete the first proof", "--request-id", "cli-direction", "--direction-target", JSON.stringify({ projectId: f.project.id, plan: "work", action: "first" }));
    expect(captured.status).toBe(0);
    const direction = captured.value.data.direction;
    const snapshot = () => withDatabase(f.workspace, db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row: unknown) => {
      const name = (row as { name: string }).name; return [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()];
    })));
    // Keep the original snapshot's populated native receipt history and held
    // state. The lifecycle scenario above retains actual CLI adapter coverage.
    withDatabase(f.workspace, db => {
      const offered = sendMailMessage(db, { requestId: "read-offer", kind: "request",
        sender: { repository: f.repo, projectSlug: "demo", planSlug: "work", sessionIncarnation: "sender", generation: "1" },
        recipient: { sessionIncarnation: "recipient", generation: "2" }, assignmentEvidence: "action/first", receiverCheckpointCapability: "checkpoint",
        actor: "sender", body: {}, direction: { requestId: direction.requestId, fingerprint: direction.fingerprint } });
      const scope = { projectSlug: "demo", planSlug: "work", recipientSessionIncarnation: "recipient", recipientGeneration: "2", actor: "recipient", messageId: offered.message.id };
      listMailInbox(db, scope);
      consumeDirectionCheckpoint(db, { ...scope, requestId: "read-consume", fingerprint: direction.fingerprint });
      acknowledgeMailMessage(db, { ...scope, compactAcknowledgment: "I consumed this checkpoint." });
      recordDirectionRecipientState(db, { ...scope, requestId: "read-stopped", state: "stopped", evidenceReference: "fixture:terminal-stopped" });
    });
    const before = snapshot();
    const shown = cli("ask", "show", direction.requestId);
    expect(shown.status).toBe(0);
    expect(shown.value.data.direction).toMatchObject({ state: "held", lastSupportedState: "acknowledged" });
    expect(cli("ask", "show", "missing").status).not.toBe(0);
    expect(snapshot()).toBe(before);
  }, 60_000);

  it("captures exact direction bytes and reads them through the real HTTP to CLI adapter", async () => {
    const f = createDirectionFixture();
    const target = { projectId: f.project.id, plan: "work", action: "first" };
    vi.stubEnv("ARCADIA_WORKSPACE", f.workspace); vi.stubEnv("ARCADIA_DASHBOARD_CLI", "source");
    try {
      const response = await POST(new Request("http://localhost/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "  Preserve exact whitespace  ", requestId: "api-direction", directionTarget: target }) }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ direction: { requestId: "api-direction", content: "  Preserve exact whitespace  ", disposition: "accepted", target } });
      expect((await GET(new Request("http://localhost/api/ask/show?id=api-direction"))).status).toBe(200);
    } finally { vi.unstubAllEnvs(); }
  }, 60_000);
});

function fixtureCli(f: ReturnType<typeof createDirectionFixture>) {
  return (...args: string[]) => {
    const result = spawnSync(process.execPath, ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), path.resolve("src/cli.ts"), ...args, "--workspace", f.workspace, "--json"], {
      cwd: f.repo, env: { ...process.env, ARCADIA_WORKSPACE: f.workspace, ARCADIA_CONFIG_PATH: path.join(f.root, "user-config.json") }, encoding: "utf8"
    });
    const output = result.stdout.trim() || result.stderr.trim();
    if (!output) throw new Error(`CLI produced no JSON: ${result.error?.message ?? "empty output"}`);
    return { status: result.status, value: JSON.parse(output) };
  };
}
