#!/usr/bin/env node
// Stand-in for the `codex`, `opencode` and `claude` CLIs in the headless-provider test. It never reaches a model.
// FAKE_ORPHAN=1 additionally leaves a descendant holding the output pipes.
// FAKE_PROVIDER_MODE (or FAKE_PROVIDER_MODE_codex / _opencode / _claude): success | settle | sandboxed | no-ask | bad-marker | uncommitted | fail | timeout | not-logged-in | partial-ask
// claude only: `success` behaves as Claude does under Arcadia's headless allow list (it cannot commit: its commit and broker calls are
// denied, so it leaves an uncommitted candidate and a drafted Ask and exits 0 with stream-json); `commit` also commits;
// `claude-error` ends with an is_error result event and exit 1; `fail` ends with an error_max_turns result event and exit 1.
// A claude launch whose --settings allow list lacks the fixture check or the Ask draft (or whose --setting-sources is not empty) is denied.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const mode = process.env[`FAKE_PROVIDER_MODE_${name}`] ?? process.env.FAKE_PROVIDER_MODE ?? "success";
if (process.env.FAKE_PROVIDER_CALLS) appendFileSync(process.env.FAKE_PROVIDER_CALLS, JSON.stringify({ name, args: args.map((a) => (a.length > 400 ? a.slice(0, 400) + "..." : a)), cwd: process.cwd(), arcadiaWorkspace: process.env.ARCADIA_WORKSPACE ?? null, operatorId: process.env.ARCADIA_OPERATOR_SCRIPT_ID ?? null, author: process.env.GIT_AUTHOR_NAME ?? null, pwd: process.env.PWD ?? null, opencodeConfig: process.env.OPENCODE_CONFIG_CONTENT ?? null }) + "\n");

// Arcadia checks the installed provider's help text for the headless flags before it launches (src/sessions/launchPreflight.ts).
if (name === "claude" && args.includes("--help")) { console.log("Usage: claude [options]\n  --print\n  --output-format <format>\n  --permission-mode <mode>\n  --settings <file>\n  --setting-sources <sources>\n  --verbose\n  --model <model>"); process.exit(0); }
if (name === "codex" && args[0] === "exec" && args.includes("--help")) { console.log("Usage: codex exec [OPTIONS]\n  --json\n  --sandbox <MODE>\n  --model <MODEL>\n  --cd <DIR>"); process.exit(0); }

if (name === "claude" && args[0] === "auth") {
  if (mode === "not-logged-in") { console.log(JSON.stringify({ loggedIn: false })); process.exit(1); }
  if (mode === "auth-broken") { console.error("error: unknown command"); process.exit(1); }
  console.log(JSON.stringify({ loggedIn: true, authMethod: "stub" }));
  process.exit(0);
}

if ((name === "codex" && args[0] === "login") || (name === "opencode" && args[0] === "auth")) {
  if (mode === "not-logged-in") { console.error("Not logged in"); process.exit(1); }
  // An uncertain credential listing (unknown subcommand, changed format): the runs that follow behave like "success".
  if (mode === "auth-broken") { console.error("error: unknown command 'auth'"); process.exit(1); }
  // OpenCode's one clear "not signed in" signal.
  if (mode === "no-credentials") { console.log("0 credentials"); process.exit(0); }
  console.log(name === "opencode" ? "1 credentials" : "Logged in using ChatGPT");
  process.exit(0);
}

// Arcadia's own capacity probe also spawns `codex app-server`; anything but a headless run must do nothing, quietly.
if (!(name === "claude" ? args.includes("--print") : ["exec", "run"].includes(args[0]))) process.exit(0);
// A headless run only ever acts inside the experiment workspace the test names; without it, fail loudly rather than act.
if (!process.env.ARCADIA_WORKSPACE) { console.error("[fake] ARCADIA_WORKSPACE is not set: refusing to act where the live workspace could be reached"); process.exit(97); }

const cdIndex = args.indexOf("--cd");
const cwd = cdIndex >= 0 ? args[cdIndex + 1] : process.cwd();
const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();

const emit = (event) => console.log(JSON.stringify(event));
/** Claude's stream-json ends with exactly one result event. */
function claudeResult(isError, subtype, text, denials = []) {
  emit({ type: "result", subtype, is_error: isError, duration_ms: 1200, num_turns: 4, result: text, total_cost_usd: 0.002, permission_denials: denials });
}

if (name === "claude") {
  const settingsIndex = args.indexOf("--settings");
  const sourcesIndex = args.indexOf("--setting-sources");
  emit({ type: "system", subtype: "init", model: args[args.indexOf("--model") + 1] ?? "unknown", cwd, tools: ["Bash", "Edit", "Write"] });
  const allow = settingsIndex >= 0 ? JSON.parse(readFileSync(args[settingsIndex + 1], "utf8")).permissions?.allow ?? [] : [];
  if (process.env.FAKE_PROVIDER_CALLS) appendFileSync(process.env.FAKE_PROVIDER_CALLS, JSON.stringify({ name: "claude-posture", settingSources: sourcesIndex >= 0 ? args[sourcesIndex + 1] : null, allow }) + "\n");
  const postureOk = settingsIndex >= 0 && sourcesIndex >= 0 && args[sourcesIndex + 1] === "" && allow.includes("Bash(node scripts/check-fixture.mjs)") && allow.includes("Bash(arcadia agent-ask draft:*)");
  if (!postureOk) {
    emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t0", is_error: true, content: "Claude requested permissions to use Bash, but you haven't granted it yet." }] } });
    claudeResult(true, "success", "I could not run the fixture check or draft the Ask: permission denied.", [{ tool_name: "Bash", tool_use_id: "t0", tool_input: { command: "node scripts/check-fixture.mjs" } }]);
    process.exit(1);
  }
  if (mode === "claude-error") { claudeResult(true, "error_during_execution", "API Error: 401 Invalid authentication credentials"); process.exit(1); }
  if (mode === "fail") { console.error("[fake] simulated provider failure"); claudeResult(true, "error_max_turns", "Reached max turns (4)"); process.exit(1); }
} else {
  console.log(`[fake ${name}] started in ${cwd}`);
  if (mode === "fail") { console.error("[fake] simulated provider failure"); process.exit(3); }
}

if (mode === "timeout") {
  spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); // an orphan the runner must also stop
  setInterval(() => {}, 1000);
} else {
  // A descendant that outlives the provider and keeps its output pipes open (same process group, so the runner can sweep it).
  if (process.env.FAKE_ORPHAN) spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }).unref();
  const line = mode === "bad-marker" ? "wrong marker" : "headless provider marker";
  writeFileSync(path.join(cwd, "MARKER.md"), line + "\n");
  // Claude's headless allow list has no git commit: its default behaviour leaves the candidate uncommitted.
  const cannotCommit = mode === "uncommitted" || mode === "sandboxed" || (name === "claude" && mode === "success");
  if (!cannotCommit) {
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
  if (name === "claude") {
    // The permission posture refused the brief's step 2 (the broker) and a commit: Claude's result event lists the denials.
    const denials = cannotCommit
      ? [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "arcadia-preserve-broker-claude" } }, { tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "git commit -m 'Write MARKER.md'" } }]
      : [];
    claudeResult(false, "success", "Wrote MARKER.md, ran the fixture check and drafted the completion Ask.", denials);
  } else {
    console.log("[fake] done");
  }
}
