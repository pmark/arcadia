// Strategy guard: keeps work on the operator's current strategy (docs/strategy/current.json).
//
//   pr     In CI's required lint job. While the phase freezes the engine, a pull request that
//          changes a runtime path must cite an Issue labelled with the freeze's cause label
//          ("Phase-cause: #N" on its own line in the PR body). Production worker candidates
//          (the night lane) pass. A PR may not change the strategy and runtime paths together.
//   track  On a schedule. Reports whether the strategy is on track: every runtime change on main
//          since the freeze passed the same rule, last night produced worker merges, and the
//          checkpoint verdict is recorded once its time has passed. Exits 1 when off track,
//          so the scheduled run goes red.
//
// Lives under .github/ rather than scripts/ on purpose: scripts/ is a runtime path
// (src/production/runtimeCurrency.ts), and changing it would make the installed engine stale.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RUNTIME_PATHS } from "../../src/production/runtimeCurrency.ts";

export const STRATEGY_FILE = "docs/strategy/current.json";
const FREEZE_PHASES = new Set(["freeze-and-prove"]);

export interface Strategy {
  schema: string;
  name: string;
  phase: string;
  freeze?: { engineRevision: string; causeLabel: string; workerBranchPattern: string };
  nights?: { timeZone: string; start: string; end: string; minimumWorkerMerges: number };
  checkpoint?: { at: string; graceHours: number; verdict: string | null };
}

export interface Verdict {
  ok: boolean;
  reason: string;
}

export function loadStrategy(root: string): Strategy | null {
  const file = path.join(root, STRATEGY_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Strategy;
}

export function freezeActive(strategy: Strategy | null): strategy is Strategy & { freeze: NonNullable<Strategy["freeze"]> } {
  return Boolean(strategy && strategy.freeze && FREEZE_PHASES.has(strategy.phase));
}

export function isRuntimePath(file: string, runtimePaths: readonly string[] = RUNTIME_PATHS): boolean {
  return runtimePaths.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

export function citedCauses(body: string | null | undefined): number[] {
  const causes = new Set<number>();
  for (const match of (body ?? "").matchAll(/^[ \t]*Phase-cause:[ \t]*#(\d+)[ \t]*$/gim)) causes.add(Number(match[1]));
  return [...causes];
}

export function isWorkerBranch(strategy: Strategy, headRef: string): boolean {
  return freezeActive(strategy) && new RegExp(strategy.freeze.workerBranchPattern).test(headRef);
}

/** The pull-request rule. `labelsByIssue` holds the labels of each Issue the body cites. */
export function judgePullRequest(input: {
  strategy: Strategy | null;
  headRef: string;
  files: readonly string[];
  body: string | null | undefined;
  labelsByIssue: ReadonlyMap<number, readonly string[]>;
}): Verdict {
  const { strategy } = input;
  if (!freezeActive(strategy)) return { ok: true, reason: "no engine freeze is active" };
  const runtime = input.files.filter((file) => isRuntimePath(file));
  const strategyEdited = input.files.includes(STRATEGY_FILE);
  if (strategyEdited && runtime.length > 0) {
    return { ok: false, reason: `this PR changes ${STRATEGY_FILE} and runtime paths together (${runtime.slice(0, 5).join(", ")}); change the strategy in its own PR` };
  }
  if (runtime.length === 0) return { ok: true, reason: "no runtime path changes" };
  if (isWorkerBranch(strategy, input.headRef)) return { ok: true, reason: `production worker candidate ${input.headRef} (night lane)` };
  const label = strategy.freeze.causeLabel;
  const causes = citedCauses(input.body);
  const qualifying = causes.filter((n) => (input.labelsByIssue.get(n) ?? []).includes(label));
  if (qualifying.length > 0) return { ok: true, reason: `cites ${qualifying.map((n) => `#${n}`).join(", ")}, labelled ${label}` };
  const cited = causes.length > 0 ? `it cites ${causes.map((n) => `#${n}`).join(", ")}, none labelled ${label}` : "it cites no cause";
  return {
    ok: false,
    reason: `the engine is frozen at ${strategy.freeze.engineRevision.slice(0, 9)} ("${strategy.name}", phase ${strategy.phase}). ` +
      `This PR changes ${runtime.length} runtime path(s) (${runtime.slice(0, 5).join(", ")}${runtime.length > 5 ? ", …" : ""}) but ${cited}. ` +
      `Allowed only as a fix for a named failed-night cause: label that Issue "${label}", add the line "Phase-cause: #<issue>" to the PR body, and re-run this job. ` +
      `Otherwise the PR waits for promotion (docs/strategy/current.md).`
  };
}

function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - (at.getTime() - at.getMilliseconds());
}

/** A wall-clock time in `timeZone` as a UTC instant. */
export function zonedToUtc(year: number, month: number, day: number, hhmm: string, timeZone: string): Date {
  const [hour, minute] = hhmm.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

function localDate(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** The most recent night that has fully ended at `now`. */
export function lastNight(now: Date, nights: NonNullable<Strategy["nights"]>): { start: Date; end: Date } {
  const today = localDate(now, nights.timeZone);
  let end = zonedToUtc(today.year, today.month, today.day, nights.end, nights.timeZone);
  if (end.getTime() > now.getTime()) end = new Date(end.getTime() - 24 * 3600 * 1000);
  const endDay = localDate(end, nights.timeZone);
  const startDay = localDate(new Date(Date.UTC(endDay.year, endDay.month - 1, endDay.day) - 12 * 3600 * 1000), "UTC");
  return { start: zonedToUtc(startDay.year, startDay.month, startDay.day, nights.start, nights.timeZone), end };
}

export interface TrackInput {
  strategy: Strategy | null;
  now: Date;
  freezeViolations: readonly string[];
  workerMergesLastNight: number | null;
}

export function judgeTrack(input: TrackInput): { offTrack: boolean; lines: string[] } {
  const { strategy, now } = input;
  const lines: string[] = [];
  let offTrack = false;
  if (!strategy) return { offTrack: true, lines: [`OFF TRACK: ${STRATEGY_FILE} is missing`] };
  lines.push(`Strategy: "${strategy.name}", phase ${strategy.phase}`);
  if (freezeActive(strategy)) {
    if (input.freezeViolations.length > 0) {
      offTrack = true;
      lines.push(`OFF TRACK: ${input.freezeViolations.length} runtime change(s) reached main outside the freeze rule:`, ...input.freezeViolations.map((v) => `  - ${v}`));
    } else {
      lines.push(`On track: every runtime change on main since ${strategy.freeze.engineRevision.slice(0, 9)} passed the freeze rule`);
    }
  }
  if (strategy.nights && input.workerMergesLastNight !== null) {
    const night = lastNight(now, strategy.nights);
    const window = `${night.start.toISOString()} to ${night.end.toISOString()}`;
    if (input.workerMergesLastNight < strategy.nights.minimumWorkerMerges) {
      offTrack = true;
      lines.push(`OFF TRACK: last night (${window}) produced ${input.workerMergesLastNight} worker merge(s); at least ${strategy.nights.minimumWorkerMerges} expected`);
    } else {
      lines.push(`On track: last night (${window}) produced ${input.workerMergesLastNight} worker merge(s)`);
    }
  }
  if (strategy.checkpoint) {
    const at = new Date(strategy.checkpoint.at);
    const overdue = new Date(at.getTime() + strategy.checkpoint.graceHours * 3600 * 1000);
    if (strategy.checkpoint.verdict) {
      lines.push(`Checkpoint ${strategy.checkpoint.at}: verdict recorded (${strategy.checkpoint.verdict})`);
    } else if (now.getTime() > overdue.getTime()) {
      offTrack = true;
      lines.push(`OFF TRACK: checkpoint ${strategy.checkpoint.at} passed ${strategy.checkpoint.graceHours} h ago with no verdict in ${STRATEGY_FILE}`);
    } else {
      const hours = Math.round((at.getTime() - now.getTime()) / 3600000);
      lines.push(hours > 0 ? `Checkpoint in about ${hours} h (${strategy.checkpoint.at})` : `Checkpoint due now (${strategy.checkpoint.at}); record the verdict`);
    }
  }
  return { offTrack, lines };
}

// ---------- CLI (GitHub Actions) ----------

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(run("gh", args)) as T;
}

interface PullFacts {
  headRef: string;
  body: string | null;
  files: string[];
  labelsByIssue: Map<number, string[]>;
}

function pullFacts(repo: string, number: number): PullFacts {
  const pull = ghJson<{ head: { ref: string }; body: string | null }>(["api", `repos/${repo}/pulls/${number}`]);
  const files = run("gh", ["api", "--paginate", `repos/${repo}/pulls/${number}/files?per_page=100`, "--jq", ".[].filename"]).split("\n").filter(Boolean);
  const labelsByIssue = new Map<number, string[]>();
  for (const issue of citedCauses(pull.body)) {
    try {
      labelsByIssue.set(issue, ghJson<{ labels: { name: string }[] }>(["api", `repos/${repo}/issues/${issue}`]).labels.map((l) => l.name));
    } catch {
      labelsByIssue.set(issue, []);
    }
  }
  return { headRef: pull.head.ref, body: pull.body, files, labelsByIssue };
}

function summarize(lines: string[]): void {
  const text = lines.join("\n");
  process.stdout.write(`${text}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Strategy guard\n\n\`\`\`\n${text}\n\`\`\`\n`);
}

function mainPr(root: string, repo: string): number {
  const strategy = loadStrategy(root);
  const headRef = process.env.HEAD_REF ?? "";
  if (!freezeActive(strategy)) return summarize(["Strategy guard: no engine freeze is active"]), 0;
  if (isWorkerBranch(strategy, headRef)) return summarize([`Strategy guard: pass (production worker candidate ${headRef})`]), 0;
  const number = Number(process.env.PR_NUMBER);
  if (!Number.isInteger(number) || number <= 0) return summarize(["Strategy guard: PR_NUMBER is not set"]), 1;
  const facts = pullFacts(repo, number);
  const verdict = judgePullRequest({ strategy, ...facts });
  summarize([`Strategy guard: ${verdict.ok ? "pass" : "FAIL"}: ${verdict.reason}`]);
  return verdict.ok ? 0 : 1;
}

function mainTrack(root: string, repo: string): number {
  const strategy = loadStrategy(root);
  const now = new Date();
  const violations: string[] = [];
  if (freezeActive(strategy)) {
    const shas = run("git", ["-C", root, "log", "--format=%H", `${strategy.freeze.engineRevision}..HEAD`, "--", ...RUNTIME_PATHS]).split("\n").filter(Boolean);
    const judged = new Map<number, Verdict>();
    for (const sha of shas) {
      const pulls = ghJson<{ number: number; merged_at: string | null }[]>(["api", `repos/${repo}/commits/${sha}/pulls`]).filter((p) => p.merged_at);
      if (pulls.length === 0) {
        violations.push(`${sha.slice(0, 9)} reached main without a merged pull request`);
        continue;
      }
      const number = pulls[0].number;
      if (!judged.has(number)) judged.set(number, judgePullRequest({ strategy, ...pullFacts(repo, number) }));
      const verdict = judged.get(number)!;
      if (!verdict.ok) violations.push(`#${number} (${sha.slice(0, 9)}): ${verdict.reason}`);
    }
  }
  let workerMerges: number | null = null;
  if (strategy?.nights && freezeActive(strategy)) {
    const night = lastNight(now, strategy.nights);
    const merged = ghJson<{ headRefName: string; mergedAt: string }[]>([
      "pr", "list", "--repo", repo, "--state", "merged", "--limit", "200", "--json", "headRefName,mergedAt",
      "--search", `merged:${night.start.toISOString().slice(0, 19)}Z..${night.end.toISOString().slice(0, 19)}Z`
    ]);
    workerMerges = merged.filter((p) => isWorkerBranch(strategy, p.headRefName)).length;
  }
  const result = judgeTrack({ strategy, now, freezeViolations: violations, workerMergesLastNight: workerMerges });
  summarize([`Strategy track at ${now.toISOString()}: ${result.offTrack ? "OFF TRACK" : "on track"}`, ...result.lines]);
  return result.offTrack ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const repo = process.env.GITHUB_REPOSITORY ?? "pmark/arcadia";
  const mode = process.argv[2];
  process.exitCode = mode === "pr" ? mainPr(root, repo) : mode === "track" ? mainTrack(root, repo) : (process.stderr.write("usage: strategyGuard.ts pr|track\n"), 2);
}
