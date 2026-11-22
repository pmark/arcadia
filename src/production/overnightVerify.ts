import { readReviewMarker, type StandingRunCommand } from "./standingMerge.js";
import { formatAge } from "./momentumWatch.js";
import type { BatchFileEntry } from "../decisions/batchMerge.js";

/**
 * The 8 AM overnight report (Action verify-overnight-merges-at-8am).
 *
 * The operator decides once and Arcadia verifies that the conditions matched
 * reality, so nothing here trusts the night's own receipts: for each merged PR
 * the head sha, check runs, review marker and file list are read again from
 * GitHub, and the diff is classified by the `batchMerge` classifier of the
 * release sha recorded at the run's first admission, not by the code running now.
 *
 * Pure apart from the injected readers: it opens no database, calls no model,
 * sends nothing and grants nothing. The caller owns delivery.
 */

/** Hours Active with no merge and no park before the liveness timer pages (uncalibrated; the operator may change it). */
export const NIGHT_SILENCE_HOURS_DEFAULT = 3;

/** Classifies a file list; the shape of `classifyAuthorityPaths`. */
export type ReleaseClassifier = (files: readonly BatchFileEntry[]) => string[];

/** Loads the classifier of one release sha, or null when that release cannot be loaded. */
export type ClassifierLoader = (releaseSha: string) => Promise<ReleaseClassifier | null>;

const RELEASE_SHA = /^[0-9a-f]{40}$/;

/** The default loader: the `batchMerge` module inside a go-broker release directory. */
export function releaseClassifierLoader(releasesDir: string, importer: (specifier: string) => Promise<unknown> = (s) => import(s)): ClassifierLoader {
  return async (releaseSha) => {
    if (!RELEASE_SHA.test(releaseSha)) return null;
    try {
      const mod = (await importer(`${releasesDir}/${releaseSha}/dist/src/decisions/batchMerge.js`)) as { classifyAuthorityPaths?: unknown };
      return typeof mod.classifyAuthorityPaths === "function" ? (mod.classifyAuthorityPaths as ReleaseClassifier) : null;
    } catch {
      return null;
    }
  };
}

export interface MergedPr {
  url: string;
  number: number;
  /** The head the worker says it merged (from its receipt); compared, never trusted. */
  claimedHead: string;
  /** The classes the night's receipt recorded, compared with the re-classification. */
  claimedClasses: string[];
  mergedAt: string;
}

export interface GithubPrFacts {
  headSha: string;
  checks: Array<{ name: string; conclusion: string | null }>;
  /** The review marker URL for exactly the head, or the reason none was found. */
  reviewMarker: { url: string } | { error: string };
  files: BatchFileEntry[];
}

export type GithubPrReader = (pr: MergedPr) => GithubPrFacts | { error: string };

/** Reads one PR through `gh`, independent of every local receipt. */
export function ghPrReader(run: StandingRunCommand, repoRoot: string): GithubPrReader {
  return (pr) => {
    const view = run({ command: "gh", args: ["pr", "view", pr.url, "--json", "headRefOid,statusCheckRollup,files"], cwd: repoRoot, timeoutMs: 30_000 });
    if (view.status !== 0) return { error: `gh pr view failed: ${view.error ?? (view.stderr.trim() || `exit ${String(view.status)}`)}` };
    let parsed: { headRefOid?: unknown; statusCheckRollup?: unknown; files?: unknown };
    try { parsed = JSON.parse(view.stdout); } catch { return { error: "gh pr view returned unusable JSON" }; }
    if (typeof parsed.headRefOid !== "string" || !Array.isArray(parsed.files) || !Array.isArray(parsed.statusCheckRollup)) return { error: "gh pr view omitted the head, checks or files" };
    const checks = (parsed.statusCheckRollup as Array<{ name?: unknown; context?: unknown; conclusion?: unknown; state?: unknown }>).map((c) => ({
      name: String(c.name ?? c.context ?? "unnamed"),
      conclusion: typeof c.conclusion === "string" && c.conclusion ? c.conclusion : typeof c.state === "string" ? c.state : null
    }));
    const files = (parsed.files as Array<{ path?: unknown }>).map((f) => String(f.path ?? ""));
    return { headSha: parsed.headRefOid, checks, reviewMarker: readReviewMarker(run, repoRoot, pr.url, parsed.headRefOid), files };
  };
}

export interface ParkRecord {
  actionKey: string;
  reason: string;
  /** Lettered options, in order; the first letter is A. */
  options: string[];
}

export interface IdleSpan {
  hours: number;
  cause: string;
}

export interface OvernightInput {
  now: number;
  /** Newest worker progress stamp (epoch ms); null when none could be read. */
  heartbeatAt: number | null;
  /** Release sha recorded at the run's first admission; null when none was recorded. */
  firstAdmissionReleaseSha: string | null;
  merges: MergedPr[];
  parks: ParkRecord[];
  idle: IdleSpan[];
  /** Tokens burned over the night; null when not recorded (said so, never zero). */
  tokenBurn: number | null;
}

export type MergeVerdict = "verified" | "mismatch" | "unverifiable";

export interface VerifiedMerge {
  pr: MergedPr;
  verdict: MergeVerdict;
  problems: string[];
  headSha: string | null;
  checkSummary: string;
  classes: string[] | null;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Re-reads and re-classifies one merge. Anything unreadable is unverifiable, never a pass. */
export function verifyMerge(pr: MergedPr, facts: GithubPrFacts | { error: string }, classify: ReleaseClassifier | null): VerifiedMerge {
  if ("error" in facts) return { pr, verdict: "unverifiable", problems: [facts.error], headSha: null, checkSummary: "unread", classes: null };
  const problems: string[] = [];
  if (facts.headSha !== pr.claimedHead) problems.push(`head on GitHub is ${facts.headSha.slice(0, 12)}, the receipt says ${pr.claimedHead.slice(0, 12)}`);
  const bad = facts.checks.filter((c) => c.conclusion !== "SUCCESS" && c.conclusion !== "success" && c.conclusion !== "NEUTRAL" && c.conclusion !== "SKIPPED");
  if (facts.checks.length === 0) problems.push("GitHub lists no check runs");
  for (const c of bad) problems.push(`check ${c.name} is ${c.conclusion ?? "unfinished"}`);
  if ("error" in facts.reviewMarker) problems.push(facts.reviewMarker.error);
  let classes: string[] | null = null;
  if (!classify) problems.push("the classifier of the first-admission release could not be loaded");
  else {
    classes = classify(facts.files);
    const claimed = [...pr.claimedClasses].sort().join(",");
    if (claimed !== [...classes].sort().join(",")) problems.push(`classes differ: receipt ${claimed || "none"}, re-classified ${classes.join(",") || "none"}`);
  }
  const unverifiable = !classify;
  return {
    pr,
    verdict: problems.length === 0 ? "verified" : unverifiable ? "unverifiable" : "mismatch",
    problems,
    headSha: facts.headSha,
    checkSummary: `${facts.checks.length - bad.length}/${facts.checks.length} green`,
    classes
  };
}

/** The report text. Its first line is heartbeat age and says when host death is detected. */
export function renderOvernightReport(input: OvernightInput, merges: VerifiedMerge[]): string {
  const age = input.heartbeatAt === null ? "unreadable" : formatAge(input.now - input.heartbeatAt);
  const lines = [
    `Heartbeat age: ${age}. Host death is detected only at 8 AM, by this report.`,
    "",
    `Release pinned at first admission: ${input.firstAdmissionReleaseSha ?? "none recorded"}`,
    "",
    `Merges (${merges.length}):`
  ];
  if (merges.length === 0) lines.push("- none");
  for (const m of merges) {
    lines.push(`- #${m.pr.number} ${m.verdict.toUpperCase()} head ${m.headSha?.slice(0, 12) ?? "unread"}, checks ${m.checkSummary}, classes ${m.classes ? m.classes.join(",") || "none" : "unknown"}, merged ${m.pr.mergedAt}`);
    for (const p of m.problems) lines.push(`  - ${p}`);
  }
  lines.push("", `Parks (${input.parks.length}):`);
  if (input.parks.length === 0) lines.push("- none");
  for (const park of input.parks) {
    lines.push(`- ${park.actionKey}: ${park.reason}`);
    park.options.forEach((option, i) => lines.push(`  ${LETTERS[i] ?? String(i + 1)}) ${option}`));
  }
  const idleTotal = input.idle.reduce((sum, s) => sum + s.hours, 0);
  lines.push("", `Idle: ${idleTotal} h`);
  for (const span of input.idle) lines.push(`- ${span.hours} h: ${span.cause}`);
  lines.push("", `Token burn: ${input.tokenBurn === null ? "not recorded" : input.tokenBurn.toLocaleString("en-US")}`);
  return lines.join("\n");
}

/** Builds the whole report: re-reads every merge from GitHub, loading the pinned classifier once. */
export async function buildOvernightReport(input: OvernightInput, deps: { reader: GithubPrReader; loadClassifier: ClassifierLoader }): Promise<{ text: string; merges: VerifiedMerge[] }> {
  const classify = input.firstAdmissionReleaseSha ? await deps.loadClassifier(input.firstAdmissionReleaseSha) : null;
  const merges = input.merges.map((pr) => verifyMerge(pr, deps.reader(pr), classify));
  return { text: renderOvernightReport(input, merges), merges };
}

export interface NightLivenessState {
  /** When production went Active for this night (epoch ms). */
  activeSince: number;
  lastMergeAt: number | null;
  lastParkAt: number | null;
  /** Set once the page is sent; the same night never pages twice. */
  pagedAt: number | null;
}

/** The one page's text. It states what was seen and that nothing was done about it. */
export function nightSilencePage(hours: number): string {
  return `Production has been Active for ${hours} h with no merge and no park. The worker may be alive but doing nothing, or the host may be gone. Nothing was changed; check the host.`;
}

/**
 * The liveness timer's rule, pure: exactly one page once N hours have passed since
 * the last progress (merge, park, or going Active) and none before N. A merge or
 * park restarts the clock, but a night already paged does not page again.
 */
export function decideNightSilence(state: NightLivenessState, now: number, hours: number = NIGHT_SILENCE_HOURS_DEFAULT): { page: string | null; pagedAt: number | null } {
  if (state.pagedAt !== null) return { page: null, pagedAt: state.pagedAt };
  const lastProgress = Math.max(state.activeSince, state.lastMergeAt ?? 0, state.lastParkAt ?? 0);
  if (now - lastProgress < hours * 3_600_000) return { page: null, pagedAt: null };
  return { page: nightSilencePage(hours), pagedAt: now };
}
