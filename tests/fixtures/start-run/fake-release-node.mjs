// A scripted stand-in for the registered release runtime running `<release>/dist/src/cli.js worker install --replace-label
// <label> --workspace <ws>`: it swaps the worker to a new pid and, per scenario, writes the heartbeat the restarted
// protected worker would (bound to the installed release), exactly as the real replacement install's restart does.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.env.FAKE_ROOT;
const args = process.argv.slice(2);
appendFileSync(path.join(root, "calls.log"), JSON.stringify({ tool: "worker-install", args, cwd: process.cwd() }) + "\n");
const statePath = path.join(root, "state.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
const dir = path.join(state.workspace, ".arcadia");
const at = (flag) => args[args.indexOf(flag) + 1];

if (!args[0]?.endsWith("/dist/src/cli.js") || args[1] !== "worker" || args[2] !== "install" || !args.includes("--replace-label") || at("--workspace") !== state.workspace) {
  process.stderr.write(`unexpected release call: ${args.join(" ")}\n`);
  process.exit(97);
}
if (state.install?.fail) {
  process.stderr.write("launchctl bootstrap failed: Input/output error. The worker may be down.\n");
  process.exit(2);
}
function writeWorker(pid, binding, beatAt) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "worker-claude-usage-heartbeat.json"), JSON.stringify({ at: beatAt, binding }));
  writeFileSync(path.join(dir, "worker.pid"), JSON.stringify({ pid, owner: `owner-${pid}` }));
}
if (!state.worker.noRestart) {
  const pid = state.worker.newPid;
  state.worker.pid = pid;
  state.worker.alive = true;
  const head = state.broker.revision;
  const bound = (release) => ({ pid, instance: `instance-${pid}`, release, handlerHash: `handler-${pid}`, repository: state.repository });
  const mode = state.worker.heartbeat;
  if (mode === "fresh") writeWorker(pid, bound(state.worker.release ?? head), Date.now());
  else if (mode === "stale") writeWorker(pid, bound(head), Date.now() - 600_000);
  else if (mode === "wrong_release") writeWorker(pid, bound("0".repeat(40)), Date.now());
  else if (mode === "unbound") writeWorker(pid, null, Date.now());
  // mode "none": no heartbeat is ever written.
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
process.stdout.write(`Protected worker installed under ${at("--replace-label")}.\n`);
