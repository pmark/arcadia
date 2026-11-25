// A scripted stand-in for `sleep` in a slow-tick scenario (Issue #3030): the executor's wait is when the slow worker's next
// tick lands, so a worker that `recovers` writes a fresh beat (same binding) here. The wait itself takes no real time.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const state = JSON.parse(readFileSync(path.join(process.env.FAKE_ROOT, "state.json"), "utf8"));
const heartbeatFile = path.join(state.workspace, ".arcadia", "worker-claude-usage-heartbeat.json");
if (state.worker.alive && state.worker.heartbeat === "fresh" && state.worker.slowTick?.recovers && existsSync(heartbeatFile)) {
  const beat = JSON.parse(readFileSync(heartbeatFile, "utf8"));
  beat.at = Date.now();
  writeFileSync(heartbeatFile, JSON.stringify(beat));
}
