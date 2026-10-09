#!/usr/bin/env node
// Stand-in for the `codex` and `opencode` CLIs in the headless-provider test. It never reaches a model.
// FAKE_PROVIDER_MODE (or FAKE_PROVIDER_MODE_codex / _opencode): success | no-ask | bad-marker | uncommitted | fail | timeout | not-logged-in | partial-ask
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const mode = process.env[`FAKE_PROVIDER_MODE_${name}`] ?? process.env.FAKE_PROVIDER_MODE ?? "success";
if (process.env.FAKE_PROVIDER_CALLS) appendFileSync(process.env.FAKE_PROVIDER_CALLS, JSON.stringify({ name, args: args.map((a) => (a.length > 80 ? a.slice(0, 80) + "..." : a)), cwd: process.cwd(), arcadiaWorkspace: process.env.ARCADIA_WORKSPACE ?? null, operatorId: process.env.ARCADIA_OPERATOR_SCRIPT_ID ?? null, author: process.env.GIT_AUTHOR_NAME ?? null }) + "\n");

if ((name === "codex" && args[0] === "login") || (name === "opencode" && args[0] === "auth")) {
  if (mode === "not-logged-in") { console.error("Not logged in"); process.exit(1); }
  console.log(name === "opencode" ? "1 credentials" : "Logged in using ChatGPT");
  process.exit(0);
}

// Arcadia's own capacity probe also spawns `codex app-server`; anything but a headless run must do nothing, quietly.
// A headless run only ever acts inside the experiment workspace the test names.
if (!["exec", "run"].includes(args[0]) || !process.env.ARCADIA_WORKSPACE) process.exit(0);

const cdIndex = args.indexOf("--cd");
const cwd = cdIndex >= 0 ? args[cdIndex + 1] : process.cwd();
const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();

console.log(`[fake ${name}] mode=${mode} cwd=${cwd}`);
if (mode === "fail") { console.error("[fake] simulated provider failure"); process.exit(3); }
if (mode === "timeout") {
  spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); // an orphan the runner must also stop
  setInterval(() => {}, 1000);
} else {
  const line = mode === "bad-marker" ? "wrong marker" : "headless provider marker";
  writeFileSync(path.join(cwd, "MARKER.md"), line + "\n");
  if (mode !== "uncommitted") {
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
  }
  console.log("[fake] done");
}
