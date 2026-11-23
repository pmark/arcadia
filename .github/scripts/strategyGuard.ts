// Strategy guard: keeps work on the operator's current strategy (docs/strategy/current.json).
//
//   pr     In CI's required lint job. The strategy is read from the PR's BASE revision, never from
//          the PR's own tree, so a PR cannot switch the guard off for itself. While the phase freezes
//          the engine, a PR that changes an engine path must cite an Issue labelled with the freeze's
//          cause label ("Phase-cause: #N" on its own line in the PR body). Production worker
//          candidates (the night lane) pass by branch name. A PR may not change a guard file and an
//          engine path together.
//   track  On a schedule. Reports whether the strategy is on track: every engine change on main
//          since the freeze passed the same rule, the strategy's phase or freeze was not changed
//          without a checkpoint verdict, last night produced worker merges (morning run only), and
//          the checkpoint verdict is recorded once its time has passed. Exits 1 when off track, so
//          the scheduled run goes red. It also lists every engine change and the causes it cited,
//          for the 8 AM audit.
//
// Lives under .github/ rather than scripts/ on purpose: scripts/ is a runtime path
// (src/production/runtimeCurrency.ts), and changing it would make the installed engine stale.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RUNTIME_PATHS } from "../../src/production/runtimeCurrency.ts";

export const STRATEGY_FILE = "docs/strategy/current.json";
/** Files that define the guard; changing one together with an engine path is always refused. */
export const GUARD_FILES = [STRATEGY_FILE, ".github/scripts/strategyGuard.ts", ".github/workflows/strategy-track.yml", ".github/workflows/ci.yml"];
const FREEZE_PHASES = new Set(["freeze-and-prove"]);
const DAY_MS = 24 * 3600 * 1000;

export interface Strategy {
  schema: string;
  name: string;
  phase: string;
  freeze?: { engineRevision: string; causeLabel: string; workerBranchPattern: string; extraPaths?: string[] };
  nights?: { timeZone: string; start: string; end: string; minimumWorkerMerges: number };
  checkpoint?: { at: string; graceHours: number; verdict: string | null };
}

export interface Verdict {
  ok: boolean;
  reason: string;
  /** How it passed, for the audit: "none", "worker", "cause" or "inactive". */
  route?: "none" | "worker" | "cause" | "inactive";
}

export function parseStrategy(text: string | null): Strategy | null {
  return text === null ? null : (JSON.parse(text) as Strategy);
}

export function freezeActive(strategy: Strategy | null): strategy is Strategy & { freeze: NonNullable<Strategy["freeze"]> } {
  return Boolean(strategy && strategy.freeze && FREEZE_PHASES.has(strategy.phase));
}

function matchesPath(file: string, entries: readonly string[]): boolean {
  return entries.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

/** RUNTIME_PATHS plus the freeze's extra engine paths (toolchain pins and the like). */
export function enginePaths(strategy: Strategy | null): string[] {
  return [...RUNTIME_PATHS, ...(strategy?.freeze?.extraPaths ?? [])];
}

export function isEnginePath(file: string, strategy: Strategy | null): boolean {
  return matchesPath(file, enginePaths(strategy));
}

export function citedCauses(body: string | null | undefined): number[] {
  const causes = new Set<number>();
  for (const match of (body ?? "").matchAll(/^[ \t]*(?:[-*][ \t]+)?Phase-cause:[ \t]*#(\d+)[ \t]*$/gim)) causes.add(Number(match[1]));
  return [...causes];
}

export function isWorkerBranch(strategy: Strategy, headRef: string): boolean {
  return freezeActive(strategy) && new RegExp(strategy.freeze.workerBranchPattern).test(headRef);
}

/**
 * The pull-request rule. `strategy` must be the BASE revision's strategy. `files` lists every path
 * the PR adds, changes or deletes, including both sides of a rename. `labelsFor` is asked only when
 * a cause must be checked.
 */
export function judgePullRequest(input: {
  strategy: Strategy | null;
  headRef: string;
  files: readonly string[];
  body: () => string | null | undefined;
  labelsFor: (issue: number) => readonly string[];
}): Verdict {
  const { strategy } = input;
  const engine = input.files.filter((file) => isEnginePath(file, strategy));
  const guard = input.files.filter((file) => GUARD_FILES.includes(file));
  if (guard.length > 0 && engine.length > 0) {
    return { ok: false, reason: `this PR changes guard file(s) (${guard.join(", ")}) and engine paths together (${engine.slice(0, 5).join(", ")}); change the strategy or its guard in its own PR` };
  }
  if (!freezeActive(strategy)) return { ok: true, reason: "no engine freeze is active at the base revision", route: "inactive" };
  if (engine.length === 0) return { ok: true, reason: "no engine path changes", route: "none" };
  if (isWorkerBranch(strategy, input.headRef)) return { ok: true, reason: `production worker candidate ${input.headRef} (night lane, exempt by branch name)`, route: "worker" };
  const label = strategy.freeze.causeLabel;
  const causes = citedCauses(input.body());
  const qualifying = causes.filter((n) => input.labelsFor(n).includes(label));
  if (qualifying.length > 0) return { ok: true, reason: `cites ${qualifying.map((n) => `#${n}`).join(", ")}, labelled ${label}`, route: "cause" };
  const cited = causes.length > 0 ? `it cites ${causes.map((n) => `#${n}`).join(", ")}, none labelled ${label}` : "it cites no cause";
  return {
    ok: false,
    reason: `the engine is frozen at ${strategy.freeze.engineRevision.slice(0, 9)} ("${strategy.name}", phase ${strategy.phase}). ` +
      `This PR changes ${engine.length} engine path(s) (${engine.slice(0, 5).join(", ")}${engine.length > 5 ? ", …" : ""}) but ${cited}. ` +
      `Allowed only as a fix for a named failed-night cause: label that Issue "${label}", add the line "Phase-cause: #<issue>" to the PR body, and re-run this job. ` +
      `Otherwise the PR waits for the checkpoint (docs/strategy/current.md).`
  };
}

/**
 * Did a commit loosen the strategy without recording a checkpoint verdict? Changing the phase, the
 * freeze revision, the cause label or the worker pattern, or dropping an extra engine path, loosens
 * or redefines it; adding extra engine paths only tightens it and needs no verdict.
 */
export function strategyChangeViolation(before: Strategy | null, after: Strategy | null): string | null {
  if (!before) return null;
  if (!after) return "deleted the strategy";
  if (after.checkpoint?.verdict) return null;
  const changed: string[] = [];
  if (before.phase !== after.phase) changed.push(`phase ${before.phase} → ${after.phase}`);
  const b = before.freeze;
  const a = after.freeze;
  if (b && !a) changed.push("removed the freeze");
  if (b && a) {
    if (b.engineRevision !== a.engineRevision) changed.push(`freeze revision ${b.engineRevision.slice(0, 9)} → ${a.engineRevision.slice(0, 9)}`);
    if (b.causeLabel !== a.causeLabel) changed.push(`cause label ${b.causeLabel} → ${a.causeLabel}`);
    if (b.workerBranchPattern !== a.workerBranchPattern) changed.push("worker branch pattern");
    const dropped = (b.extraPaths ?? []).filter((p) => !(a.extraPaths ?? []).includes(p));
    if (dropped.length > 0) changed.push(`dropped engine path(s) ${dropped.join(", ")}`);
  }
  return changed.length === 0 ? null : `changed the strategy (${changed.join("; ")}) with no checkpoint verdict`;
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

interface LocalDay { year: number; month: number; day: number }

function localDate(at: Date, timeZone: string): LocalDay {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function dayBefore(day: LocalDay): LocalDay {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day) - DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The most recent night that has fully ended at `now`, using local calendar days (DST-safe). */
export function lastNight(now: Date, nights: NonNullable<Strategy["nights"]>): { start: Date; end: Date } {
  let endDay = localDate(now, nights.timeZone);
  let end = zonedToUtc(endDay.year, endDay.month, endDay.day, nights.end, nights.timeZone);
  if (end.getTime() > now.getTime()) {
    endDay = dayBefore(endDay);
    end = zonedToUtc(endDay.year, endDay.month, endDay.day, nights.end, nights.timeZone);
  }
  const startDay = dayBefore(endDay);
  return { start: zonedToUtc(startDay.year, startDay.month, startDay.day, nights.start, nights.timeZone), end };
}

/** The night check runs only in the morning, within 12 hours after a night ends, so the evening run does not repeat it. */
export function isMorningRun(now: Date, nights: NonNullable<Strategy["nights"]>): boolean {
  return now.getTime() - lastNight(now, nights).end.getTime() < 12 * 3600 * 1000;
}

export interface TrackInput {
  strategy: Strategy | null;
  now: Date;
  freezeViolations: readonly string[];
  strategyViolations: readonly string[];
  /** null when the night check did not run. */
  workerMergesLastNight: number | null;
  audit: readonly string[];
}

export function judgeTrack(input: TrackInput): { offTrack: boolean; lines: string[] } {
  const { strategy, now } = input;
  const lines: string[] = [];
  let offTrack = false;
  if (input.strategyViolations.length > 0) {
    offTrack = true;
    lines.push(`OFF TRACK: the strategy itself was changed outside its rule:`, ...input.strategyViolations.map((v) => `  - ${v}`));
  }
  if (!strategy) return { offTrack: true, lines: [...lines, `OFF TRACK: ${STRATEGY_FILE} is missing`] };
  lines.unshift(`Strategy: "${strategy.name}", phase ${strategy.phase}`);
  if (freezeActive(strategy)) {
    if (input.freezeViolations.length > 0) {
      offTrack = true;
      lines.push(`OFF TRACK: ${input.freezeViolations.length} engine change(s) reached main outside the freeze rule:`, ...input.freezeViolations.map((v) => `  - ${v}`));
    } else {
      lines.push(`On track: every engine change on main since ${strategy.freeze.engineRevision.slice(0, 9)} passed the freeze rule`);
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
  if (input.audit.length > 0) lines.push("Audit (engine changes since the freeze and how each passed):", ...input.audit.map((a) => `  - ${a}`));
  return { offTrack, lines };
}

// ---------- CLI (GitHub Actions) ----------

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

function tryRun(cmd: string, args: string[]): string | null {
  try {
    return run(cmd, args);
  } catch {
    return null;
  }
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(run("gh", args)) as T;
}

function issueLabels(repo: string): (issue: number) => string[] {
  const cache = new Map<number, string[]>();
  return (issue) => {
    if (!cache.has(issue)) {
      const labels = tryRun("gh", ["api", `repos/${repo}/issues/${issue}`, "--jq", "[.labels[].name] | join(\"\\n\")"]);
      cache.set(issue, (labels ?? "").split("\n").filter(Boolean));
    }
    return cache.get(issue)!;
  };
}

function prBody(repo: string, number: number): () => string | null {
  let body: string | null | undefined;
  return () => (body === undefined ? (body = ghJson<{ body: string | null }>(["api", `repos/${repo}/pulls/${number}`]).body) : body);
}

function strategyAt(root: string, revision: string): Strategy | null {
  return parseStrategy(tryRun("git", ["-C", root, "show", `${revision}:${STRATEGY_FILE}`]));
}

function summarize(lines: string[]): void {
  const text = lines.join("\n");
  process.stdout.write(`${text}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Strategy guard\n\n\`\`\`\n${text}\n\`\`\`\n`);
}

function mainPr(root: string, repo: string): number {
  const base = process.env.BASE_SHA ?? "";
  const headRef = process.env.HEAD_REF ?? "";
  const number = Number(process.env.PR_NUMBER);
  if (!/^[0-9a-f]{40}$/.test(base) || !Number.isInteger(number) || number <= 0) {
    summarize(["Strategy guard: FAIL: BASE_SHA and PR_NUMBER must be set by the workflow"]);
    return 1;
  }
  if (tryRun("git", ["-C", root, "cat-file", "-e", `${base}^{commit}`]) === null && tryRun("git", ["-C", root, "fetch", "--no-tags", "--depth=1", "origin", base]) === null) {
    summarize([`Strategy guard: FAIL: could not fetch the base revision ${base}; re-run this job`]);
    return 1;
  }
  const strategy = strategyAt(root, base);
  const diff = tryRun("git", ["-C", root, "diff", "--name-only", "--no-renames", base, "HEAD"]);
  if (diff === null) {
    summarize([`Strategy guard: FAIL: could not diff ${base}..HEAD; re-run this job`]);
    return 1;
  }
  try {
    const verdict = judgePullRequest({ strategy, headRef, files: diff.split("\n").filter(Boolean), body: prBody(repo, number), labelsFor: issueLabels(repo) });
    summarize([`Strategy guard: ${verdict.ok ? "pass" : "FAIL"}: ${verdict.reason}`]);
    return verdict.ok ? 0 : 1;
  } catch (error) {
    summarize([`Strategy guard: FAIL: could not read PR #${number} or its cited Issues from GitHub (${(error as Error).message.split("\n")[0]}); re-run this job`]);
    return 1;
  }
}

function mainTrack(root: string, repo: string): number {
  const now = new Date();
  const strategy = parseStrategy(tryRun("git", ["-C", root, "show", `HEAD:${STRATEGY_FILE}`]));
  const strategyViolations: string[] = [];
  for (const sha of run("git", ["-C", root, "log", "--format=%H", "HEAD", "--", STRATEGY_FILE]).split("\n").filter(Boolean)) {
    const violation = strategyChangeViolation(strategyAt(root, `${sha}^`), strategyAt(root, sha));
    if (violation) strategyViolations.push(`${sha.slice(0, 9)} ${violation}`);
  }
  const freezeViolations: string[] = [];
  const audit: string[] = [];
  if (freezeActive(strategy)) {
    const shas = run("git", ["-C", root, "log", "--format=%H", `${strategy.freeze.engineRevision}..HEAD`, "--", ...enginePaths(strategy)]).split("\n").filter(Boolean);
    const judged = new Map<number, Verdict>();
    for (const sha of shas) {
      const pulls = ghJson<{ number: number; merged_at: string | null; base: { sha: string }; head: { ref: string } }[]>(["api", `repos/${repo}/commits/${sha}/pulls`]).filter((p) => p.merged_at);
      if (pulls.length === 0) {
        freezeViolations.push(`${sha.slice(0, 9)} reached main without a merged pull request`);
        continue;
      }
      const pull = pulls[0];
      if (!judged.has(pull.number)) {
        const files = run("gh", ["api", "--paginate", `repos/${repo}/pulls/${pull.number}/files?per_page=100`, "--jq", ".[] | .filename, (.previous_filename // empty)"]).split("\n").filter(Boolean);
        const baseStrategy = strategyAt(root, pull.base.sha) ?? strategy;
        const verdict = judgePullRequest({ strategy: baseStrategy, headRef: pull.head.ref, files, body: prBody(repo, pull.number), labelsFor: issueLabels(repo) });
        judged.set(pull.number, verdict);
        const how = verdict.route === "cause" ? verdict.reason : verdict.route === "worker" ? `worker branch ${pull.head.ref}, merged ${pull.merged_at}` : verdict.reason;
        audit.push(`#${pull.number}: ${verdict.ok ? how : `FAILED: ${verdict.reason}`}`);
      }
      const verdict = judged.get(pull.number)!;
      if (!verdict.ok) freezeViolations.push(`#${pull.number} (${sha.slice(0, 9)}): ${verdict.reason}`);
    }
  }
  let workerMerges: number | null = null;
  if (strategy?.nights && freezeActive(strategy) && isMorningRun(now, strategy.nights)) {
    const night = lastNight(now, strategy.nights);
    const merged = ghJson<{ headRefName: string; mergedAt: string }[]>([
      "pr", "list", "--repo", repo, "--state", "merged", "--base", "main", "--limit", "200", "--json", "headRefName,mergedAt",
      "--search", `merged:${night.start.toISOString().slice(0, 19)}Z..${night.end.toISOString().slice(0, 19)}Z`
    ]);
    workerMerges = merged.filter((p) => isWorkerBranch(strategy, p.headRefName)).length;
  }
  const result = judgeTrack({ strategy, now, freezeViolations, strategyViolations, workerMergesLastNight: workerMerges, audit });
  summarize([`Strategy track at ${now.toISOString()}: ${result.offTrack ? "OFF TRACK" : "on track"}`, ...result.lines]);
  return result.offTrack ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const repo = process.env.GITHUB_REPOSITORY ?? "pmark/arcadia";
  const mode = process.argv[2];
  process.exitCode = mode === "pr" ? mainPr(root, repo) : mode === "track" ? mainTrack(root, repo) : (process.stderr.write("usage: strategyGuard.ts pr|track\n"), 2);
}
