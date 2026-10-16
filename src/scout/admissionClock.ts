import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { validationError } from "../cli/errors.js";

export interface ScoutClockSample {
  kind: "host" | "scripted-fixture";
  bootId: string;
  wallMs: number;
  monoStartMs: number;
  monoEndMs: number;
  uptimeMs: number;
  uncertaintyMs: number;
}
export interface ScoutClockContinuity {
  bootId: string;
  firstMonoMs: number | null;
  firstUptimeMs: number | null;
  lastMonoEndMs: number;
  lastUptimeMs: number;
  uncertaintyMs: number;
}
const mono = () => Number(process.hrtime.bigint() / 1_000_000n);

/** Existing OS/kernel observations only. Missing boot proof is a refusal. */
export function captureScoutClock(): ScoutClockSample {
  let bootId: string;
  try {
    if (process.platform === "linux") {
      const id = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw new Error("unreadable kernel boot identity");
      bootId = `linux:${id}`;
    }
    else if (process.platform === "darwin") {
      const raw = execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8", timeout: 1000 });
      const found = raw.match(/sec\s*=\s*(\d+),\s*usec\s*=\s*(\d+)/);
      if (!found) throw new Error("unreadable kernel boot identity");
      bootId = `darwin:${found[1]}:${found[2]}`;
    } else throw new Error("unsupported kernel boot identity");
  } catch { throw validationError("Durable Scout admission refused: boot/monotonic clock continuity is unknown."); }
  const monoStartMs = mono();
  const wallMs = Date.now();
  const uptimeMs = os.uptime() * 1000;
  return { kind: "host", bootId, wallMs, monoStartMs, monoEndMs: mono(), uptimeMs, uncertaintyMs: 1000 };
}

/** Explicit deterministic fixture time; the public CLI exposes no clock override. */
export function fixtureScoutClock(wallMs: number, elapsedMs = wallMs, bootId = "explicit-scripted-fixture-boot"): ScoutClockSample {
  return { kind: "scripted-fixture", bootId, wallMs, monoStartMs: elapsedMs, monoEndMs: elapsedMs, uptimeMs: elapsedMs, uncertaintyMs: 0 };
}

export function validScoutClock(sample: ScoutClockSample): boolean {
  return !!sample && ["host", "scripted-fixture"].includes(sample.kind) && typeof sample.bootId === "string" && !!sample.bootId.trim()
    && [sample.wallMs, sample.monoStartMs, sample.monoEndMs, sample.uptimeMs, sample.uncertaintyMs].every((n) => Number.isFinite(n) && n >= 0)
    && sample.monoEndMs >= sample.monoStartMs && sample.monoEndMs - sample.monoStartMs <= 250
    && (sample.kind === "host" ? sample.uncertaintyMs === 1000 : sample.uncertaintyMs === 0);
}

export function initialScoutContinuity(sample: ScoutClockSample): ScoutClockContinuity {
  if (!validScoutClock(sample)) throw validationError("Clock continuity sample is missing or invalid.");
  return { bootId: sample.bootId, firstMonoMs: null, firstUptimeMs: null, lastMonoEndMs: sample.monoEndMs,
    lastUptimeMs: sample.uptimeMs, uncertaintyMs: sample.uncertaintyMs };
}
