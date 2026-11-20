/**
 * One Decision number, one file. Decision ids are allocated against origin main (never a stale local
 * checkout or an open pull request) and a duplicate id is refused before it can reach main.
 *
 * The 0250 race: an Ask settle candidate chose N from its local tree while a START sign-in minted N on main.
 * Allocation now reads the ids on origin main as well as the local tree, and every merge path plus CI
 * re-runs `findDecisionIdClashes` against current origin main.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const DECISIONS_DIR = "docs/decisions";
const DECISION_FILE = /^(\d+)-[^/]+\.md$/;

/** Ids that already had two files when this guard was added; a third file or a new pair is never grandfathered. */
export const GRANDFATHERED_DUPLICATE_IDS: readonly string[] = ["0004", "0005", "0079", "0100", "0191"];

export function decisionIdOfFile(name: string): string | null {
  return DECISION_FILE.exec(path.posix.basename(name))?.[1] ?? null;
}

export interface DecisionIdClash {
  id: string;
  /** Every file that carries the id, repository-relative, sorted. */
  files: string[];
}

export function describeDecisionIdClash(clash: DecisionIdClash): string {
  return `Decision id ${clash.id} is carried by ${clash.files.join(" and ")}`;
}

function byId(files: Iterable<string>): Map<string, Set<string>> {
  const ids = new Map<string, Set<string>>();
  for (const file of files) {
    const id = decisionIdOfFile(file);
    if (!id) continue;
    const relative = file.includes("/") ? file : `${DECISIONS_DIR}/${file}`;
    ids.set(id, (ids.get(id) ?? new Set()).add(relative));
  }
  return ids;
}

/**
 * Clashes in `files` (a tree's Decision files). With `added`, only ids that one of those files introduces are
 * reported (a pull request is judged on what it adds, not on the base's own history). Grandfathered ids are
 * exempt only while they still hold the two files they held when grandfathered.
 */
export function findDecisionIdClashes(
  files: readonly string[],
  options: { added?: readonly string[]; grandfathered?: readonly string[] } = {}
): DecisionIdClash[] {
  const grandfathered = new Set(options.grandfathered ?? GRANDFATHERED_DUPLICATE_IDS);
  const focus = options.added ? new Set(options.added.map(decisionIdOfFile).filter((id): id is string => id !== null)) : null;
  const clashes: DecisionIdClash[] = [];
  for (const [id, names] of byId(files)) {
    if (names.size < 2 || (focus && !focus.has(id))) continue;
    if (grandfathered.has(id) && names.size === 2) continue;
    clashes.push({ id, files: [...names].sort() });
  }
  return clashes.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * What a pull request head would do to current origin main: clashes among the Decision files the head adds
 * (relative to the files at its merge base) and everything origin main holds now.
 */
export function findPullRequestDecisionIdClashes(input: {
  originFiles: readonly string[];
  headFiles: readonly string[];
  mergeBaseFiles: readonly string[];
}): DecisionIdClash[] {
  const base = new Set(input.mergeBaseFiles);
  const added = input.headFiles.filter((file) => !base.has(file) && decisionIdOfFile(file) !== null);
  return findDecisionIdClashes([...input.originFiles, ...input.headFiles], { added });
}

export type DecisionGit = (args: string[]) => { status: number; stdout: string };

export function systemDecisionGit(repoRoot: string): DecisionGit {
  return (args) => {
    const r = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    return { status: typeof r.status === "number" ? r.status : -1, stdout: r.stdout ?? "" };
  };
}

function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Decision files in `ref`'s tree, or null when the ref cannot be read. */
export function decisionFilesAtRef(git: DecisionGit, ref: string): string[] | null {
  const r = git(["ls-tree", "--name-only", `${ref}:${DECISIONS_DIR}`]);
  if (r.status !== 0) {
    // A readable commit with no Decisions directory simply holds no Decision files; an unreadable ref stays null.
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0 ? [] : null;
  }
  return lines(r.stdout).filter((name) => decisionIdOfFile(name) !== null).map((name) => `${DECISIONS_DIR}/${name}`);
}

/** Refreshes origin/<base> (best effort: an unreachable remote falls back to the last fetched ref) and lists its Decision files. */
export function originDecisionFiles(git: DecisionGit, base = "main"): string[] | null {
  git(["fetch", "--quiet", "origin", base]);
  return decisionFilesAtRef(git, `refs/remotes/origin/${base}`);
}

function localDecisionIds(repoRoot: string): number[] {
  const dir = path.join(repoRoot, DECISIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map(decisionIdOfFile).filter((id): id is string => id !== null).map((id) => Number.parseInt(id, 10));
}

/**
 * The next Decision id: one above the highest id in the local tree or on origin main, whichever is higher.
 * `knownIds` adds ids the caller already holds (for example documents not yet written). Call it at the moment the
 * file is written, not earlier.
 */
export function allocateDecisionId(repoRoot: string, knownIds: readonly (string | number)[] = [], git: DecisionGit = systemDecisionGit(repoRoot)): string {
  const origin = originDecisionFiles(git) ?? [];
  const all = [
    ...localDecisionIds(repoRoot),
    ...origin.map((file) => Number.parseInt(decisionIdOfFile(file)!, 10)),
    ...knownIds.map((id) => (typeof id === "number" ? id : Number.parseInt(id, 10) || 0))
  ];
  return String(all.reduce((highest, id) => Math.max(highest, id), 0) + 1).padStart(4, "0");
}

/**
 * Merge-time check: would merging `head` leave two Decision files with one id on current origin main? Fetches
 * origin/<base>; returns the refusal text or null. An unreadable origin or head is itself a refusal.
 */
export function decisionIdClashRefusal(git: DecisionGit, head: string, base = "main"): string | null {
  const origin = originDecisionFiles(git, base);
  if (!origin) return `origin/${base} Decision files could not be read, so a duplicate Decision id cannot be ruled out`;
  const headFiles = decisionFilesAtRef(git, head);
  if (!headFiles) return `${head.slice(0, 7)} Decision files could not be read, so a duplicate Decision id cannot be ruled out`;
  const mergeBase = git(["merge-base", head, `refs/remotes/origin/${base}`]);
  const mergeBaseFiles = mergeBase.status === 0 ? decisionFilesAtRef(git, mergeBase.stdout.trim()) : null;
  const clashes = findPullRequestDecisionIdClashes({ originFiles: origin, headFiles, mergeBaseFiles: mergeBaseFiles ?? [] });
  return clashes.length === 0 ? null : `${clashes.map(describeDecisionIdClash).join("; ")} on origin/${base} once merged`;
}
