#!/usr/bin/env node
// Stand-in for the `codex` and `opencode` CLIs in the headless-provider test. It never reaches a model.
// FAKE_ORPHAN=1 additionally leaves a descendant holding the output pipes.
// FAKE_PROVIDER_MODE (or FAKE_PROVIDER_MODE_codex / _opencode): success | settle | sandboxed | no-ask | bad-marker | uncommitted | fail | timeout | not-logged-in | partial-ask
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const mode = process.env[`FAKE_PROVIDER_MODE_${name}`] ?? process.env.FAKE_PROVIDER_MODE ?? "success";
if (process.env.FAKE_PROVIDER_CALLS) appendFileSync(process.env.FAKE_PROVIDER_CALLS, JSON.stringify({ name, args: args.map((a) => (a.length > 400 ? a.slice(0, 400) + "..." : a)), cwd: process.cwd(), arcadiaWorkspace: process.env.ARCADIA_WORKSPACE ?? null, operatorId: process.env.ARCADIA_OPERATOR_SCRIPT_ID ?? null, author: process.env.GIT_AUTHOR_NAME ?? null, pwd: process.env.PWD ?? null, opencodeConfig: process.env.OPENCODE_CONFIG_CONTENT ?? null }) + "\n");

// Arcadia checks the installed provider's help text for the headless flags before it launches (src/sessions/launchPreflight.ts).
if (name === "codex" && args[0] === "exec" && args.includes("--help")) { console.log("Usage: codex exec [OPTIONS]\n  --json\n  --sandbox <MODE>\n  --model <MODEL>\n  --cd <DIR>"); process.exit(0); }

if ((name === "codex" && args[0] === "login") || (name === "opencode" && args[0] === "auth")) {
  if (mode === "not-logged-in") { console.error("Not logged in"); process.exit(1); }
  // An uncertain credential listing (unknown subcommand, changed format): the runs that follow behave like "success".
  if (mode === "auth-broken") { console.error("error: unknown command 'auth'"); process.exit(1); }
  console.log(name === "opencode" ? "1 credentials" : "Logged in using ChatGPT");
  process.exit(0);
}

// Arcadia's own capacity probe also spawns `codex app-server`; anything but a headless run must do nothing, quietly.
if (!["exec", "run"].includes(args[0])) process.exit(0);
// A headless run only ever acts inside the experiment workspace the test names; without it, fail loudly rather than act.
if (!process.env.ARCADIA_WORKSPACE) { console.error("[fake] ARCADIA_WORKSPACE is not set: refusing to act where the live workspace could be reached"); process.exit(97); }

const cdIndex = args.indexOf("--cd");
const cwd = cdIndex >= 0 ? args[cdIndex + 1] : process.cwd();
const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();

console.log(`[fake ${name}] mode=${mode} cwd=${cwd}`);
if (mode === "fail") { console.error("[fake] simulated provider failure"); process.exit(3); }
if (mode === "timeout") {
  spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); // an orphan the runner must also stop
  setInterval(() => {}, 1000);
} else {
  // A descendant that outlives the provider and keeps its output pipes open (same process group, so the runner can sweep it).
  if (process.env.FAKE_ORPHAN) spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }).unref();
  const line = mode === "bad-marker" ? "wrong marker" : "headless provider marker";
  writeFileSync(path.join(cwd, "MARKER.md"), line + "\n");
  if (mode !== "uncommitted" && mode !== "sandboxed") {
    run("git", ["add", "MARKER.md"]);
    run("git", ["-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "Write MARKER.md"]);
  }
  if (mode !== "no-ask") {
    const head = run("git", ["rev-parse", "HEAD"]);
    const criteria = [
      'MARKER.md exists and contains exactly the line "headless provider marker" followed by a trailing newline, with no other content.',
      "The genesis check node scripts/check-fixture.mjs passes."
    ];
    const ask = {
      agent_ask: "v1", request_id: "complete-write-headless-marker-fake", project: "headless-fixture", intent: "complete",
      target_ref: "action/write-headless-marker", candidate_revision: head,
      evidence: (mode === "partial-ask" ? criteria.slice(0, 1) : criteria).map((criterion) => ({ criterion, status: "met" })),
      desired_result: "Mark write-headless-marker complete."
    };
    // The same fixed launcher shape the brief names: draft it and leave it for the host.
    run("arcadia", ["agent-ask", "draft", JSON.stringify(ask)]);
    if (mode === "sandboxed") {
      // Codex's workspace-write sandbox cannot create Git's index.lock, so the agent follows the brief's step 2 and the broker has no worker.
      // The shape of codex --json's command_execution event, with the broker's real refusal text.
      console.log(JSON.stringify({ type: "item.completed", item: { id: "item_14", type: "command_execution", command: "/bin/zsh -lc /Users/x/.local/bin/arcadia-preserve-broker-codex",
        aggregated_output: JSON.stringify({ ok: false, command: "go-broker", error: { code: "VALIDATION_ERROR", message: "Protected preservation request path is unavailable. The preservation route heartbeat is stale (84s old, limit 15s)" } }), exit_code: 1, status: "failed" } }));
    }
    if (mode === "settle") {
      // What the shipped brief asks for first: settle the Ask (preview, then apply the exact fingerprint).
      const settleArgs = ["agent-ask", "settle", "--proposal", ask.request_id, "--request-id", `settle-${ask.request_id}`, "--disposition", "accepted", "--json"];
      const preview = JSON.parse(run("arcadia", settleArgs));
      const fingerprint = preview.data.receipt.previewFingerprint;
      console.log("[fake] settle preview fingerprint", fingerprint);
      console.log(run("arcadia", [...settleArgs, "--apply", "--preview", fingerprint]).slice(0, 2000));
    }
  }
  console.log("[fake] done");
}
