import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { markOperatorPingSent } from "../src/ping/operatorPing.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * Attended CLI rehearsal of the worker → Rowan → operator loop through the
 * real `arcadia native-mail` commands, in a disposable test workspace. The
 * Discord adapter's presentation is simulated by `markOperatorPingSent`; no
 * message reaches any real operator surface. Set ARCADIA_ATTENTION_RECEIPT to
 * write the timing receipt.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CLI = path.resolve("src/cli.ts");
const PLAN = "prove-the-rowan-supervisor-attention-loop";

function arcadia(workspace: string, args: string[]): Record<string, any> {
  const out = execFileSync(process.execPath, ["--import", "tsx", CLI, ...args, "--workspace", workspace, "--json"], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  return JSON.parse(out.slice(out.indexOf("{")));
}

function send(workspace: string, requestId: string, worker: string, body: Record<string, unknown>): string {
  const result = arcadia(workspace, ["native-mail", "send", "--request-id", requestId, "--kind", "request",
    "--repository", "/repo/fixture-ppn", "--project-slug", "fixture-ppn", "--plan-slug", PLAN,
    "--sender-incarnation", worker, "--sender-generation", "gen-1",
    "--recipient-incarnation", "rowan-1", "--recipient-generation", "gen-1",
    "--assignment-evidence", `fixture-ppn/${worker}`, "--receiver-checkpoint-capability", "attention-roundtrip",
    "--actor", worker, "--body-json", JSON.stringify(body)]);
  return result.data.message.id;
}

const ROWAN = ["--project-slug", "fixture-ppn", "--plan-slug", PLAN, "--recipient-incarnation", "rowan-1", "--recipient-generation", "gen-1", "--actor", "rowan"];

describe("attended CLI rehearsal", () => {
  it("relays one blocker through the CLI within the 60-second target and suppresses the replay", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-rowan-attention-cli-"));
    roots.push(workspace);
    initWorkspace(workspace);
    const started = Date.now();

    const resultId = send(workspace, "w1-result", "worker-nagel", { significance: "result", summary: "Lighthouse 97/97/97", evidence: "fixture report" });
    const blockerId = send(workspace, "w2-blocker", "worker-ellis", {
      significance: "blocker", summary: "Preview deploy needs approval", readyAction: "Choose A to approve",
      consequence: "Release Action stays held", evidence: "fixture CI run 42"
    });

    const inbox = arcadia(workspace, ["native-mail", "inbox", "--project-slug", "fixture-ppn", "--plan-slug", PLAN,
      "--recipient-incarnation", "rowan-1", "--recipient-generation", "gen-1", "--actor", "rowan"]);
    expect(inbox.data.messages.map((m: { id: string }) => m.id)).toEqual([resultId, blockerId]);
    for (const id of [resultId, blockerId]) arcadia(workspace, ["native-mail", "ack", "--message-id", id, ...ROWAN]);

    const resultRelay = arcadia(workspace, ["native-mail", "relay", "--message-id", resultId, ...ROWAN]);
    const blockerRelay = arcadia(workspace, ["native-mail", "relay", "--message-id", blockerId, ...ROWAN]);
    const replay = arcadia(workspace, ["native-mail", "relay", "--message-id", blockerId, ...ROWAN]);
    expect(resultRelay.data.outcome).toBe("digest");
    expect(blockerRelay.data.outcome).toBe("relayed");
    expect(replay.data.outcome).toBe("duplicate");
    expect(replay.data.ping.id).toBe(blockerRelay.data.ping.id);

    withDatabase(workspace, (db) => markOperatorPingSent(db, blockerRelay.data.ping.id, "discord-simulated"));
    const timing = arcadia(workspace, ["native-mail", "timing", "--message-id", blockerId]).data;
    const overdue = arcadia(workspace, ["native-mail", "overdue", "--ack-within-seconds", "0"]).data.overdue;
    const pings = withDatabase(workspace, (db) => (db.prepare("SELECT COUNT(*) AS n FROM operator_pings").get() as { n: number }).n);

    expect(pings).toBe(1);
    expect(overdue).toEqual([]);
    expect(timing.emittedToPresentedMs).toBeLessThan(60_000);

    const receipt = {
      schema: "arcadia-rowan-attention-rehearsal-v1",
      mode: "attended CLI rehearsal; synthetic workers; presentation simulated (no real operator surface)",
      wallClockMs: Date.now() - started,
      blockerTiming: timing,
      operatorPingsQueued: pings,
      replayOutcome: replay.data.outcome,
      resultOutcome: resultRelay.data.outcome,
      targetMs: 60_000
    };
    if (process.env.ARCADIA_ATTENTION_RECEIPT) writeFileSync(process.env.ARCADIA_ATTENTION_RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  }, 120_000);
});
