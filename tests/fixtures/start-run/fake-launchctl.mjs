// A scripted stand-in for launchctl: `list LABEL` prints the pid; `kickstart -k` swaps to a new pid and, per scenario,
// writes the worker heartbeat the real restarted worker would.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.env.FAKE_ROOT;
const args = process.argv.slice(2);
appendFileSync(path.join(root, "calls.log"), JSON.stringify({ tool: "launchctl", args }) + "\n");
const statePath = path.join(root, "state.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
const dir = path.join(state.workspace, ".arcadia");

function writeWorker(pid, release, at) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "worker-claude-usage-heartbeat.json"), JSON.stringify({ at, binding: { pid, instance: `instance-${pid}`, release, handlerHash: `handler-${pid}`, repository: state.repository } }));
  writeFileSync(path.join(dir, "worker.pid"), JSON.stringify({ pid, owner: `owner-${pid}` }));
}

if (args[0] === "list") {
  if (state.worker.pid) process.stdout.write(`{\n\t"Label" = "${args[1]}";\n\t"PID" = ${state.worker.pid};\n};\n`);
  else process.exit(113);
} else if (args[0] === "kickstart") {
  if (!state.worker.noRestart) {
    state.worker.pid = state.worker.newPid;
    state.worker.alive = true;
    const head = state.broker.revision;
    const mode = state.worker.heartbeat;
    if (mode === "fresh") writeWorker(state.worker.newPid, state.worker.release ?? head, Date.now());
    else if (mode === "stale") writeWorker(state.worker.newPid, head, Date.now() - 600_000);
    else if (mode === "wrong_release") writeWorker(state.worker.newPid, "0".repeat(40), Date.now());
    // mode "none": no heartbeat is ever written.
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
} else {
  process.stderr.write(`unexpected launchctl call: ${args.join(" ")}\n`);
  process.exit(97);
}
