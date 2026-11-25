// A scripted stand-in for `sleep` in a slow-tick scenario (Issue #3030): the executor's wait is when the slow worker's next
// tick lands, so a worker that `recovers` writes a fresh beat (same binding) here. The wait itself takes no real time.
// `slowTick.during` changes the world once, at the first sleep of the named wait, the way something else on the host might
// while the card waits: `sign-in` (after the restart, before the sign-in), `start` (after the sign-in, before the previews) or
// `activation` (after both previews). It can admit a production Session, start a tmux session, move the queue revision or
// jump the executor's `node -e` clock (fake-clock-offset.mjs).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.env.FAKE_ROOT;
const statePath = path.join(root, "state.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
const heartbeatFile = path.join(state.workspace, ".arcadia", "worker-claude-usage-heartbeat.json");

const during = state.worker.slowTick?.during;
if (during && !during.applied) {
  const callsLog = path.join(root, "calls.log");
  const previews = existsSync(callsLog)
    ? readFileSync(callsLog, "utf8").split("\n").filter((line) => line.includes('"args":["production","preview"')).length
    : 0;
  const stage = state.worker.signedIn === true ? (previews >= 2 ? "activation" : "start")
    : state.worker.pid === state.worker.newPid ? "sign-in" : "pre";
  if (stage === during.stage) {
    during.applied = true;
    appendFileSync(path.join(root, "calls.log"), JSON.stringify({ tool: "sleep-during", args: [stage] }) + "\n");
    if (during.liveAdmissions !== undefined) state.production.liveAdmissions = during.liveAdmissions;
    if (during.queueRevision !== undefined) state.queue.revision = during.queueRevision;
    if (during.tmuxSession !== undefined) writeFileSync(path.join(root, "tmux-live"), `${during.tmuxSession}\n`);
    if (during.clockJumpMs !== undefined) writeFileSync(process.env.START_RUN_CLOCK_OFFSET_FILE, String(during.clockJumpMs));
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
}

if (state.worker.alive && state.worker.heartbeat === "fresh" && state.worker.slowTick?.recovers && existsSync(heartbeatFile)) {
  const beat = JSON.parse(readFileSync(heartbeatFile, "utf8"));
  beat.at = Date.now();
  writeFileSync(heartbeatFile, JSON.stringify(beat));
}
