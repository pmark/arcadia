import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tryGit, uncommittedChanges } from "../git/worktrees.js";

/**
 * One list of testable targets, and what each one is built from.
 *
 * This replaces two hand-maintained lists — `qa-candidates.json` and
 * `proof-targets.json` — that held the same URLs with nothing keeping them in
 * step. Both went stale, in the same way, for the same reason: three fields
 * (`targetState`, `validation`, `evidenceFreshness`) promised freshness and
 * were typed by hand. A second list is a second thing to forget, so there is
 * now one, and the fields that claim freshness are computed rather than
 * declared.
 *
 * **It lives in the workspace, not the repository.** Repository paths and LAN
 * hostnames are facts about one person's machine, and Arcadia is meant to work
 * on anyone's. `config/qa-targets.example.json` ships as documentation; the
 * real file sits beside `arcadia.json` in the workspace, which is already
 * where machine-specific values like the Obsidian vault path live.
 */

export type ProofEnvironment = "Stable" | "Candidate";
export type ProofEnvironmentKind = "local" | "lan" | "remote" | "missing";
export type ProofAccessState = "public" | "access-protected" | "local-only" | "unknown";

/** The conventional service-control script, relative to a project's repo root. */
export const SERVICE_SCRIPT = "scripts/services.sh";

export interface QaProjectConfig {
  repoPath: string;
  baseBranch: string;
  /**
   * Overrides the conventional `scripts/services.sh`, relative to the repo
   * root. Present so a project whose services live elsewhere is not forced to
   * add a shim, and absent for every project that follows the convention.
   */
  serviceScript?: string | null;
}

export interface QaTargetConfig {
  id: string;
  project: string;
  label: string;
  environment: ProofEnvironment;
  environmentKind: ProofEnvironmentKind;
  accessState: ProofAccessState;
  url: string;
  /** Path to a `/_version`-style endpoint, when the target self-reports. */
  versionPath?: string | null;
  pullRequestUrl?: string | null;
  testProcedure: string;
}

export interface QaTargetsFile {
  schemaVersion: number;
  projects: Record<string, QaProjectConfig>;
  targets: QaTargetConfig[];
}

const EXAMPLE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../config/qa-targets.example.json"
);

export function qaTargetsPath(workspacePath: string): string {
  return path.join(workspacePath, "config", "qa-targets.json");
}

/**
 * Reads the workspace's target list, falling back to the shipped example.
 *
 * The fallback is deliberate and empty-ish rather than clever: a fresh clone
 * with no workspace config should render an empty QA queue that explains where
 * to write one, not crash, and not silently adopt the example author's
 * machine.
 */
export function loadQaTargetsFile(workspacePath?: string): QaTargetsFile {
  const candidate = workspacePath ? qaTargetsPath(workspacePath) : null;
  const source = candidate && existsSync(candidate) ? candidate : EXAMPLE_PATH;
  const parsed = JSON.parse(readFileSync(source, "utf8")) as QaTargetsFile;
  if (!Array.isArray(parsed.targets)) throw new Error(`${source} must contain a targets array.`);
  if (!parsed.projects || typeof parsed.projects !== "object") {
    throw new Error(`${source} must contain a projects map.`);
  }
  return parsed;
}

/** True when the operator has written their own list rather than the example. */
export function usingExampleTargets(workspacePath?: string): boolean {
  return !(workspacePath && existsSync(qaTargetsPath(workspacePath)));
}

export function loadQaTargets(workspacePath?: string): QaTargetConfig[] {
  return loadQaTargetsFile(workspacePath).targets;
}

export function qaProject(slug: string, workspacePath?: string): QaProjectConfig | null {
  return loadQaTargetsFile(workspacePath).projects[slug] ?? null;
}

/**
 * The absolute path to a project's service-control script, when it has one.
 *
 * Convention over configuration: a project that ships `scripts/services.sh`
 * is controllable with no config at all. See `docs/service-contract.md` for
 * what that script must accept.
 */
export function serviceScriptPath(project: QaProjectConfig): string | null {
  const relative = project.serviceScript ?? SERVICE_SCRIPT;
  const absolute = path.resolve(project.repoPath, relative);
  return existsSync(absolute) ? absolute : null;
}

/**
 * How far a project's checkout is from its base branch.
 *
 * Deliberately does not fetch. A page load must not reach the network on the
 * operator's behalf, and a `git fetch` on every render would make the screen
 * slow in exactly the moment it is meant to orient. So this reads refs that
 * are already local and reports `fetchedAt` alongside — a count of 0 commits
 * behind means nothing if the last fetch was a week ago, and saying when the
 * refs were refreshed is the difference between a fact and a false comfort.
 */
export interface RepoFreshness {
  repoPath: string;
  baseBranch: string;
  /**
   * The branch HEAD is actually on, `"HEAD"` when detached, null when unreadable.
   *
   * Counts below are always measured against `origin/<baseBranch>` whatever
   * this says. That is fine when they agree and actively misleading when they
   * do not — "3 behind main" is a true and useless sentence about a checkout
   * sitting on a feature branch. Reporting the branch is what lets a reader
   * tell those two cases apart.
   */
  branch: string | null;
  /** False when `branch` is a different branch, or detached. */
  onBaseBranch: boolean;
  /** Short SHA of the checkout's HEAD. */
  head: string | null;
  /** Short SHA of `origin/<baseBranch>` as currently known locally. */
  base: string | null;
  behind: number | null;
  ahead: number | null;
  dirty: boolean;
  /** When `git fetch` last wrote refs. Null when it never has. */
  fetchedAt: string | null;
  /** Set when the repository could not be read at all. */
  error: string | null;
}

export function repoFreshness(project: QaProjectConfig): RepoFreshness {
  const empty: RepoFreshness = {
    repoPath: project.repoPath,
    baseBranch: project.baseBranch,
    branch: null,
    onBaseBranch: false,
    head: null,
    base: null,
    behind: null,
    ahead: null,
    dirty: false,
    fetchedAt: null,
    error: null
  };

  if (!existsSync(path.join(project.repoPath, ".git"))) {
    return { ...empty, error: `Not a git checkout: ${project.repoPath}` };
  }

  const remoteRef = `origin/${project.baseBranch}`;
  const head = tryGit(project.repoPath, ["rev-parse", "--short", "HEAD"]);
  const baseSha = tryGit(project.repoPath, ["rev-parse", "--short", remoteRef]);
  const branch = tryGit(project.repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const onBaseBranch = branch === project.baseBranch;

  if (!head) return { ...empty, branch, onBaseBranch, error: "Could not read HEAD." };
  if (!baseSha) {
    return { ...empty, branch, onBaseBranch, head, error: `No local ref for ${remoteRef}. Refresh to fetch it.` };
  }

  const counts = tryGit(project.repoPath, ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`]);
  const [aheadRaw, behindRaw] = (counts ?? "").split(/\s+/);
  const toCount = (raw: string | undefined): number | null => {
    const value = Number(raw);
    return raw === undefined || Number.isNaN(value) ? null : value;
  };

  return {
    ...empty,
    branch,
    onBaseBranch,
    head,
    base: baseSha,
    ahead: toCount(aheadRaw),
    behind: toCount(behindRaw),
    dirty: uncommittedChanges(project.repoPath).length > 0,
    fetchedAt: fetchHeadTime(project.repoPath)
  };
}

function fetchHeadTime(repoPath: string): string | null {
  try {
    return statSync(path.join(repoPath, ".git", "FETCH_HEAD")).mtime.toISOString();
  } catch {
    return null;
  }
}

/** One sentence an operator can act on, or the honest absence of one. */
export function freshnessSummary(freshness: RepoFreshness): string {
  if (freshness.error) return freshness.error;
  const parts: string[] = [];

  // Lead with the branch when it is not the one the counts are about, so the
  // numbers are never read as a statement about the checked-out branch.
  if (freshness.branch === "HEAD") {
    parts.push("detached HEAD");
  } else if (freshness.branch && !freshness.onBaseBranch) {
    parts.push(`on \`${freshness.branch}\`, not ${freshness.baseBranch}`);
  }

  if (freshness.behind && freshness.behind > 0) {
    parts.push(`${freshness.behind} commit${freshness.behind === 1 ? "" : "s"} behind ${freshness.baseBranch}`);
  } else if (freshness.behind === 0) {
    parts.push(`up to date with ${freshness.baseBranch}`);
  }
  if (freshness.ahead && freshness.ahead > 0) parts.push(`${freshness.ahead} ahead`);
  if (freshness.dirty) parts.push("uncommitted changes present");
  parts.push(freshness.fetchedAt ? `refs fetched ${freshness.fetchedAt.slice(0, 10)}` : "never fetched");
  return parts.join(" · ");
}
