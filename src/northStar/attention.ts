import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface RepositoryActivity {
  commits: number;
  lastCommitAt: string | null;
}

/**
 * Where the week actually went, measured in commits.
 *
 * The database is a poor witness here and it is worth saying why: rows move
 * when `docs sync` runs, so `work_items.updated_at` clusters on sync days and
 * reports a burst of activity on a day the operator may have spent entirely
 * elsewhere. Git does not have that problem — a commit is a thing that
 * happened, at the time it happened, in a repository that belongs to exactly
 * one Project. The drift number has to be one the operator cannot argue with,
 * because its whole job is to say something they would rather not hear.
 *
 * Read-only: `git log` over local refs, never a fetch.
 */
export function readRepositoryActivity(repositoryPath: string | null, sinceDays: number): RepositoryActivity {
  if (!repositoryPath || !existsSync(repositoryPath)) {
    return { commits: 0, lastCommitAt: null };
  }

  const log = git(repositoryPath, [
    "log",
    "--all",
    "--no-merges",
    `--since=${sinceDays} days ago`,
    "--pretty=%aI"
  ]);
  if (!log.ok) {
    return { commits: 0, lastCommitAt: null };
  }

  const stamps = log.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return { commits: stamps.length, lastCommitAt: stamps[0] ?? null };
}

/** Whole days since the most recent commit anywhere in the repository. */
export function daysSinceLastCommit(repositoryPath: string | null, now: Date): number | null {
  if (!repositoryPath || !existsSync(repositoryPath)) {
    return null;
  }
  const log = git(repositoryPath, ["log", "--all", "-1", "--pretty=%aI"]);
  const stamp = log.ok ? log.stdout.trim() : "";
  if (!stamp) {
    return null;
  }
  const then = new Date(stamp);
  if (Number.isNaN(then.getTime())) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

/** Recent commit subjects, used as evidence for the narrative — never invented. */
export function readRecentSubjects(repositoryPath: string | null, sinceDays: number, limit: number): string[] {
  if (!repositoryPath || !existsSync(repositoryPath)) {
    return [];
  }
  const log = git(repositoryPath, [
    "log",
    "--all",
    "--no-merges",
    `--since=${sinceDays} days ago`,
    `--max-count=${limit}`,
    "--pretty=%s"
  ]);
  if (!log.ok) {
    return [];
  }
  return log.stdout.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, limit);
}

function git(cwd: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}
