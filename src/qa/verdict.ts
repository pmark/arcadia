import path from "node:path";
import { tryGit } from "../git/worktrees.js";
import { qaProject, type QaProjectConfig } from "./targets.js";

/**
 * Whether incoming commits need a restart, decided from their paths alone.
 *
 * This exists because "Pull & restart" was one welded action, so shipping a
 * CSS tweak cost the same seven-dev-server bounce as changing a lockfile. The
 * paths in the diff already know the difference; nothing was asking them.
 *
 * Deterministic on purpose — no model, no network, just `git diff --name-only`
 * and an ordered rule table. It is a planning signal, not a guarantee, and the
 * wording everywhere reflects that: the honest claim is "HMR should cover
 * this", never "no restart needed". HMR genuinely misses things, which is the
 * reason this work exists at all.
 */

export type RestartVerdict =
  /** Dependencies moved; `node_modules` is stale before the services are. */
  | "install-and-restart"
  /** Something read once at boot changed. */
  | "restart"
  /** Only source a dev server watches changed. */
  | "hmr"
  /** Nothing a running process reads changed at all. */
  | "inert"
  /** No rule matched. Not evidence of safety — offer the restart. */
  | "unknown";

/** Strongest wins when files disagree. `unknown` outranks `hmr` deliberately. */
const RANK: Record<RestartVerdict, number> = {
  "install-and-restart": 5,
  restart: 4,
  unknown: 3,
  hmr: 2,
  inert: 1
};

export interface VerdictRule {
  id: string;
  /** Operator-facing reason, used verbatim in the headline and the UI. */
  label: string;
  verdict: RestartVerdict;
  matches: (filePath: string) => boolean;
}

export interface VerdictReason {
  rule: string;
  label: string;
  verdict: RestartVerdict;
  /** The actual files that earned it. A verdict without these is a rumour. */
  paths: string[];
}

export interface RestartVerdictResult {
  verdict: RestartVerdict;
  /** One sentence an operator can act on. */
  headline: string;
  reasons: VerdictReason[];
  /** True when schema or migration files moved; orthogonal to the verdict. */
  migrationsChanged: boolean;
  /** Monorepo workspace directories the changes fall under, e.g. `apps/intake`. */
  apps: string[];
  changedPaths: string[];
  /** Set when `changedPaths` was capped; the verdict still reflects every file. */
  truncated: boolean;
}

const MAX_LISTED_PATHS = 200;
const MAX_PATHS_PER_REASON = 12;

const base = (p: string): string => path.posix.basename(p);
const ext = (p: string): string => path.posix.extname(p).toLowerCase();
const segments = (p: string): string[] => p.split("/").filter(Boolean);

const CONFIG_STEMS =
  /^(next|astro|vite|tailwind|postcss|drizzle|svelte|nuxt|remix|vitest|playwright|rollup|webpack|babel)\.config\.(js|cjs|mjs|ts|mts|cts|json)$/;
const BOOT_ENTRIES = /^(middleware|instrumentation|server)\.(js|cjs|mjs|ts|mts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/i;
const HMR_EXTENSIONS = new Set([
  ".tsx", ".jsx", ".ts", ".js", ".mjs", ".cjs",
  ".css", ".scss", ".sass", ".less",
  ".astro", ".svelte", ".vue", ".mdx"
]);
const SOURCE_ROOTS = new Set(["app", "src", "components", "packages", "apps", "lib", "hooks", "styles", "pages"]);

/**
 * First match wins, so order is meaning here rather than decoration.
 *
 * `inert` sits ahead of `hmr` because a test file is a `.ts` under `src/` and
 * would otherwise be classified as watched source. Both outcomes say "no
 * restart", but the reason shown to the operator should be the true one.
 */
export const VERDICT_RULES: VerdictRule[] = [
  {
    id: "dependencies",
    label: "Dependencies changed",
    verdict: "install-and-restart",
    matches: (p) =>
      ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "package.json"].includes(base(p))
  },
  {
    id: "service-script",
    label: "The service control script itself changed",
    verdict: "restart",
    matches: (p) => p.endsWith("scripts/services.sh")
  },
  {
    id: "environment",
    label: "Environment or deploy configuration changed",
    verdict: "restart",
    matches: (p) => {
      const name = base(p);
      return (
        name === ".env" ||
        name.startsWith(".env.") ||
        /^wrangler\.(toml|json|jsonc)$/.test(name) ||
        ext(p) === ".vars"
      );
    }
  },
  {
    id: "build-config",
    label: "Build or framework configuration changed",
    verdict: "restart",
    matches: (p) => {
      const name = base(p);
      return CONFIG_STEMS.test(name) || name === "pnpm-workspace.yaml" || /^tsconfig.*\.json$/.test(name);
    }
  },
  {
    id: "boot-entry",
    label: "Code that runs once at startup changed",
    verdict: "restart",
    matches: (p) => BOOT_ENTRIES.test(base(p))
  },
  {
    id: "schema",
    label: "Database schema or migrations changed",
    verdict: "restart",
    matches: (p) => segments(p).includes("migrations") || ext(p) === ".sql" || p.endsWith("db/schema.ts")
  },
  {
    id: "inert",
    label: "Documentation and tests only",
    verdict: "inert",
    matches: (p) => {
      const first = segments(p)[0];
      return (
        ext(p) === ".md" ||
        TEST_FILE.test(base(p)) ||
        first === "docs" ||
        first === ".github" ||
        base(p) === "LICENSE"
      );
    }
  },
  {
    id: "watched-source",
    label: "Application source a dev server watches",
    verdict: "hmr",
    matches: (p) => {
      if (!HMR_EXTENSIONS.has(ext(p))) return false;
      const parts = segments(p);
      return parts.some((part) => SOURCE_ROOTS.has(part));
    }
  }
];

export function classifyPath(filePath: string): VerdictRule | null {
  return VERDICT_RULES.find((rule) => rule.matches(filePath)) ?? null;
}

/** The classifier proper. Pure: give it paths, get a verdict. */
export function classifyChangedPaths(paths: string[]): RestartVerdictResult {
  const changed = paths.map((p) => p.trim()).filter(Boolean);

  if (changed.length === 0) {
    return {
      verdict: "inert",
      headline: "No incoming changes.",
      reasons: [],
      migrationsChanged: false,
      apps: [],
      changedPaths: [],
      truncated: false
    };
  }

  const byRule = new Map<string, VerdictReason>();
  const unmatched: string[] = [];

  for (const filePath of changed) {
    const rule = classifyPath(filePath);
    if (!rule) {
      unmatched.push(filePath);
      continue;
    }
    const existing = byRule.get(rule.id);
    if (existing) existing.paths.push(filePath);
    else byRule.set(rule.id, { rule: rule.id, label: rule.label, verdict: rule.verdict, paths: [filePath] });
  }

  if (unmatched.length > 0) {
    byRule.set("unmatched", {
      rule: "unmatched",
      label: "Changed files no rule recognises",
      verdict: "unknown",
      paths: unmatched
    });
  }

  const reasons = [...byRule.values()]
    .sort((a, b) => RANK[b.verdict] - RANK[a.verdict])
    .map((reason) => ({ ...reason, paths: reason.paths.slice(0, MAX_PATHS_PER_REASON) }));

  const verdict = [...byRule.values()].reduce<RestartVerdict>(
    (strongest, reason) => (RANK[reason.verdict] > RANK[strongest] ? reason.verdict : strongest),
    "inert"
  );

  const migrationsChanged = byRule.has("schema");
  const apps = workspaceApps(changed);

  return {
    verdict,
    headline: headlineFor(verdict, migrationsChanged, reasons, changed.length),
    reasons,
    migrationsChanged,
    apps,
    changedPaths: changed.slice(0, MAX_LISTED_PATHS),
    truncated: changed.length > MAX_LISTED_PATHS
  };
}

/**
 * Which workspace packages the changes touch.
 *
 * Restart is all-or-nothing per project — Private Practice Now bounces seven
 * dev servers — so naming the apps at least tells the operator what they are
 * paying for, even though the service contract cannot yet charge less.
 */
function workspaceApps(paths: string[]): string[] {
  const found = new Set<string>();
  for (const filePath of paths) {
    const [root, name] = segments(filePath);
    if ((root === "apps" || root === "packages") && name) found.add(`${root}/${name}`);
  }
  return [...found].sort();
}

function headlineFor(
  verdict: RestartVerdict,
  migrationsChanged: boolean,
  reasons: VerdictReason[],
  fileCount: number
): string {
  const files = `${fileCount} file${fileCount === 1 ? "" : "s"}`;
  const because = reasons[0] ? ` — ${reasons[0].label.toLowerCase()}.` : ".";
  const migrate = migrationsChanged ? " Migrations changed; run them before testing." : "";

  switch (verdict) {
    case "install-and-restart":
      return `Install dependencies, then restart${because}${migrate}`;
    case "restart":
      return `Restart needed${because}${migrate}`;
    case "hmr":
      return `HMR should cover this (${files}). Restart if the running app looks stale.`;
    case "inert":
      return `Nothing running reads these ${files}.`;
    case "unknown":
      return `Unrecognised changes in ${files}; restart to be sure.`;
  }
}

export interface ProjectVerdictResult extends RestartVerdictResult {
  project: string;
  /** The range the verdict was computed over, e.g. `HEAD..origin/main`. */
  range: string;
  error: string | null;
}

/**
 * The verdict for what `origin/<baseBranch>` has that this checkout does not.
 *
 * Reads local refs only — it never fetches, for the same reason page loads do
 * not. Run `qa fetch` first or the answer describes whatever origin looked
 * like the last time anything asked.
 */
export function projectVerdict(slug: string, workspacePath?: string): ProjectVerdictResult | null {
  const project = qaProject(slug, workspacePath);
  return project ? verdictForProject(slug, project) : null;
}

export function verdictForProject(slug: string, project: QaProjectConfig): ProjectVerdictResult {
  const range = `HEAD..origin/${project.baseBranch}`;
  const empty = classifyChangedPaths([]);

  const output = tryGit(project.repoPath, ["diff", "--name-only", range]);
  if (output === null) {
    return {
      ...empty,
      project: slug,
      range,
      headline: `Could not read ${range}. Fetch first, or check the repository.`,
      verdict: "unknown",
      error: `git diff --name-only ${range} failed in ${project.repoPath}`
    };
  }

  return { ...classifyChangedPaths(output.split("\n")), project: slug, range, error: null };
}
