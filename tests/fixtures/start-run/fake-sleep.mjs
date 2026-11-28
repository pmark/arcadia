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

// A virtual clock (`state.virtualClock`, Issues #3184 and #3189): every sleep moves the executor's `node -e` clock on by its
// argument through fake-clock-offset.mjs (which this process loads too), so beat ages and gaps read in seconds of waiting.
if (state.virtualClock === true) {
  const offsetFile = process.env.START_RUN_CLOCK_OFFSET_FILE;
  const offset = (() => { try { return Number(readFileSync(offsetFile, "utf8")) || 0; } catch { return 0; } })();
  writeFileSync(offsetFile, String(offset + Number(process.argv[2] ?? 0) * 1000));
}
const writeBeatAt = (at) => {
  const beat = JSON.parse(readFileSync(heartbeatFile, "utf8"));
  beat.at = at;
  writeFileSync(heartbeatFile, JSON.stringify(beat));
};
const worker = state.worker;

// Issue #3189, `quietBeats`: while the card's quiet-host check samples the pre-restart worker, its beats land on the virtual
// clock `gaps` seconds apart (the last gap repeats), counted from the beat the check opened with.
const quiet = worker.quietBeats;
if (quiet && worker.pid !== worker.newPid && worker.alive && existsSync(heartbeatFile)) {
  if (quiet.anchorAt === undefined) { quiet.anchorAt = JSON.parse(readFileSync(heartbeatFile, "utf8")).at; quiet.cum = 0; quiet.landed = 0; }
  const gap = () => quiet.gaps[Math.min(quiet.landed, quiet.gaps.length - 1)];
  while (Date.now() >= quiet.anchorAt + (quiet.cum + gap()) * 1000) {
    quiet.cum += gap();
    quiet.landed += 1;
    writeBeatAt(quiet.anchorAt + quiet.cum * 1000);
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// Issue #3122, `from: "lead"`: the late beat lands once `arrivesAfterSeconds` of waiting have passed in the gap (each sleep counts
// its argument), and only once if it `relapses`. Issue #3184, `periodSeconds` (with the virtual clock): after it lands the worker
// beats steadily every periodSeconds, the next beat landing exactly one period after the last.
const slow = worker.slowTick;
let beats = Boolean(slow?.recovers) && slow.from !== "lead";
const now = Date.now();
if (slow?.from === "lead" && slow.started) {
  if (!slow.landed) {
    slow.slept = (slow.slept ?? 0) + Number(process.argv[2] ?? 0);
    if (slow.recovers && slow.slept >= (slow.arrivesAfterSeconds ?? 0)) { slow.landed = true; beats = true; slow.beatAt = now; }
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } else if (slow.periodSeconds !== undefined) {
    beats = false;
    if (worker.signedIn !== true && now >= slow.beatAt + slow.periodSeconds * 1000) {
      slow.beatAt += slow.periodSeconds * 1000;
      writeBeatAt(slow.beatAt);
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    }
  } else beats = slow.relapses !== true;
}
if (worker.alive && worker.heartbeat === "fresh" && beats && existsSync(heartbeatFile)) writeBeatAt(now);
