import { execFileSync } from "node:child_process";

/**
 * Paths whose changes alter what the installed broker runs; docs-only differences do not.
 * `config` and `database` are staged into the release by `go-broker install` (role registry,
 * worker defaults and schema), so they count too.
 */
export const RUNTIME_PATHS = ["src", "scripts", "apps", "config", "database", "package.json", "pnpm-lock.yaml", "tsconfig.json"] as const;

const FULL_SHA = /^[0-9a-f]{40}$/;

const MAX_NAMED_PATHS = 10;

export interface RuntimeCurrencyAssessment {
  current: boolean;
  head: string;
  installedRevision: string | null;
  reasons: string[];
}

function git(repository: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitSucceeds(repository: string, args: string[]): boolean {
  try {
    git(repository, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is the installed broker release the same runtime as the repository's HEAD?
 * Mirrors the START card check: the release must be an ancestor of HEAD and no
 * runtime path may differ between them.
 */
export function assessRuntimeCurrency(input: {
  repository: string;
  installedRevision: string | null;
}): RuntimeCurrencyAssessment {
  const { repository } = input;
  const installedRevision = input.installedRevision?.trim() || null;
  const head = git(repository, ["rev-parse", "HEAD"]).trim();
  const reasons: string[] = [];

  if (!installedRevision) {
    reasons.push("no installed broker revision was found");
  } else if (!FULL_SHA.test(installedRevision)) {
    reasons.push(`installed revision ${installedRevision} is not a full commit id`);
  } else if (!gitSucceeds(repository, ["cat-file", "-e", `${installedRevision}^{commit}`])) {
    reasons.push(`installed revision ${installedRevision} is unknown to this repository`);
  } else {
    if (!gitSucceeds(repository, ["merge-base", "--is-ancestor", installedRevision, head])) {
      reasons.push(`installed revision ${installedRevision} is not an ancestor of HEAD ${head}`);
    }
    const differing = git(repository, ["diff", "--name-only", installedRevision, head, "--", ...RUNTIME_PATHS.map((entry) => `:(top)${entry}`)])
      .split("\n")
      .filter(Boolean);
    if (differing.length > 0) {
      const named = differing.slice(0, MAX_NAMED_PATHS).join(", ");
      const more = differing.length > MAX_NAMED_PATHS ? ` (and ${differing.length - MAX_NAMED_PATHS} more)` : "";
      reasons.push(`runtime paths differ between the installed release and HEAD: ${named}${more}`);
    }
  }

  return { current: reasons.length === 0, head, installedRevision, reasons };
}
