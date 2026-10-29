import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isManagedDoc, parseDoc, reportCrossPlanDependencyCycles } from "./parse.js";
import type { ArcadiaDoc, DocValidationError, LogDoc, PlanDoc } from "./types.js";

/** Directories never worth walking, and expensive to walk by accident. */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".venv",
  "vendor",
  "target",
  ".arcadia-workspace"
]);

const MAX_DEPTH = 6;

/** Hidden entries other than `.arcadia`, and heavy build directories, are never walked or read. */
function skipsEntry(entry: string): boolean {
  return (entry.startsWith(".") && entry !== ".arcadia") || SKIP_DIRECTORIES.has(entry);
}

/**
 * Only these records can govern which Action Arcadia dispatches. Supporting
 * records are still parsed and reported by docs sync, but their defects do not
 * make an unrelated active pointer disappear.
 */
export function isAuthoritativeControlPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return normalized === "PROJECT.md" || normalized.startsWith("docs/plans/") || normalized.startsWith("docs/decisions/");
}

export interface DiscoveryResult {
  docs: ArcadiaDoc[];
  errors: DocValidationError[];
  /** Files that declared `arcadia: v1` but could not be parsed at all. */
  rejected: string[];
  /** Unreadable evidence is distinct from a malformed supporting document. */
  ioErrors?: DiscoveryIoError[];
}

export interface DiscoveryIoError {
  relativePath: string;
  source: string;
  operation: "readdir" | "stat" | "read";
  code: string | null;
  message: string;
}

/** Active only inside `withDocsSnapshot`: repository root -> what one walk found. */
let snapshot: Map<string, DiscoveryResult> | null = null;

/**
 * Run a read-only pass over one consistent view of each repository: inside
 * `run`, discovering the same root again reuses the first walk instead of
 * re-reading and re-parsing every managed document. `arcadia todo` resolves
 * several views per Project and walked each repository many times (about 11 s,
 * past the dashboard's read timeout). Never wrap a pass that writes documents.
 * Synchronous only: `run` must not return a Promise (the snapshot ends when it returns).
 */
export function withDocsSnapshot<T>(run: () => T): T {
  if (snapshot) return run();
  snapshot = new Map();
  try {
    return run();
  } finally {
    snapshot = null;
  }
}

/**
 * Walk a repository for managed documents.
 *
 * Discovery is by frontmatter marker rather than by path, so an operator can
 * organize `docs/` however they like and a file only becomes Arcadia's business
 * when it explicitly opts in. Depth is capped and heavy directories skipped —
 * this runs over every project in the portfolio.
 */
export function discoverDocs(repoRoot: string): DiscoveryResult {
  if (!snapshot) return walkDocs(repoRoot);
  const key = path.resolve(repoRoot);
  let found = snapshot.get(key);
  if (!found) {
    found = walkDocs(repoRoot);
    snapshot.set(key, found);
  }
  // Fresh arrays, so a caller that sorts or appends cannot change what the next caller sees.
  return { docs: [...found.docs], errors: [...found.errors], rejected: [...found.rejected], ioErrors: [...(found.ioErrors ?? [])] };
}

/**
 * A cheap fingerprint of every Markdown file `discoverDocs` would read: each path, size, modification and change time,
 * found by the same walk without reading or parsing any file (about a tenth of a full discovery). An unchanged
 * fingerprint means a cached discovery of this root is still what a new walk would find, barring a same-size
 * rewrite within the filesystem's timestamp resolution.
 */
export function docsFingerprint(repoRoot: string): string {
  const hash = createHash("sha1");
  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(directory).sort();
    } catch {
      hash.update(`!${directory}\n`);
      return;
    }
    for (const entry of entries) {
      if (skipsEntry(entry)) continue;
      const absolute = path.join(directory, entry);
      let stats;
      try {
        stats = statSync(absolute);
      } catch {
        hash.update(`!${absolute}\n`);
        continue;
      }
      if (stats.isDirectory()) walk(absolute, depth + 1);
      // ctime also moves on a permission change or an mtime-preserving rewrite, which mtime alone would miss.
      else if (entry.toLowerCase().endsWith(".md")) hash.update(`${absolute}\0${stats.size}\0${stats.mtimeMs}\0${stats.ctimeMs}\n`);
    }
  };
  walk(path.resolve(repoRoot), 0);
  return hash.digest("hex");
}

function walkDocs(repoRoot: string): DiscoveryResult {
  const docs: ArcadiaDoc[] = [];
  const errors: DocValidationError[] = [];
  const rejected: string[] = [];
  const ioErrors: DiscoveryIoError[] = [];
  const unreadable = (source: string, operation: DiscoveryIoError["operation"], error: unknown) => {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    ioErrors.push({ relativePath: path.relative(repoRoot, source) || ".", source, operation, code,
      message: error instanceof Error ? error.message : String(error) });
  };

  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch (error) {
      unreadable(directory, "readdir", error);
      return;
    }

    for (const entry of entries) {
      if (skipsEntry(entry)) continue;
      const absolute = path.join(directory, entry);

      let stats;
      try {
        stats = statSync(absolute);
      } catch (error) {
        unreadable(absolute, "stat", error);
        continue;
      }

      if (stats.isDirectory()) {
        walk(absolute, depth + 1);
        continue;
      }

      if (!entry.toLowerCase().endsWith(".md")) {
        continue;
      }

      let content: string;
      try {
        content = readFileSync(absolute, "utf8");
      } catch (error) {
        unreadable(absolute, "read", error);
        continue;
      }

      if (!isManagedDoc(content)) {
        continue;
      }

      const relativePath = path.relative(repoRoot, absolute);
      const { doc, errors: parseErrors } = parseDoc(relativePath, absolute, content);
      errors.push(...parseErrors);
      if (doc) {
        docs.push(doc);
      } else {
        rejected.push(relativePath);
      }
    }
  };

  walk(repoRoot, 0);

  // Action links are deliberately explicit and must resolve within the same
  // Project. Invalid links reject the Log rather than becoming guessed history.
  const invalidLogs = validateLogActionReferences(docs, errors);
  for (const relativePath of invalidLogs) {
    if (!rejected.includes(relativePath)) rejected.push(relativePath);
  }
  const withoutInvalidLogs = docs.filter((doc) => !invalidLogs.has(doc.relativePath));

  // A cycle confined to one Plan is already caught, and that document already
  // rejected, inside `parsePlan` itself. A cycle that runs through a
  // `plan/<slug>#<action-id>` reference spans documents a single-file parse
  // never sees, so it can only be found once every surviving Plan is in hand.
  const cyclePlans = withoutInvalidLogs.filter((doc): doc is PlanDoc => doc.type === "plan");
  const cycleRejected = reportCrossPlanDependencyCycles(cyclePlans, errors);
  for (const relativePath of cycleRejected) {
    if (!rejected.includes(relativePath)) rejected.push(relativePath);
  }
  const acceptedDocs = withoutInvalidLogs.filter((doc) => !cycleRejected.has(doc.relativePath));

  // Stable ordering keeps dry-run output diffable between runs.
  acceptedDocs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  errors.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.field.localeCompare(b.field));
  rejected.sort((a, b) => a.localeCompare(b));

  ioErrors.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.operation.localeCompare(b.operation));
  return { docs: acceptedDocs, errors, rejected, ioErrors };
}

function validateLogActionReferences(docs: ArcadiaDoc[], errors: DocValidationError[]): Set<string> {
  const plans = docs.filter((doc): doc is PlanDoc => doc.type === "plan");
  const logs = docs.filter((doc): doc is LogDoc => doc.type === "log");
  const invalid = new Set<string>();

  for (const log of logs) {
    for (const entry of log.entries) {
      if (!entry.action) continue;
      const [planSlug, actionId] = entry.action.split("#", 2);
      const plan = plans.find((candidate) => candidate.project === log.project && candidate.slug === planSlug);
      if (!plan) {
        invalid.add(log.relativePath);
        errors.push({
          relativePath: log.relativePath,
          field: `entry(${entry.date}).action`,
          message: `Action reference ${JSON.stringify(entry.action)} names no plan for Project ${JSON.stringify(log.project)}.`
        });
        continue;
      }
      if (!plan.actions.some((action) => action.id === actionId)) {
        invalid.add(log.relativePath);
        errors.push({
          relativePath: log.relativePath,
          field: `entry(${entry.date}).action`,
          message: `Action reference ${JSON.stringify(entry.action)} names no Action in plan ${JSON.stringify(planSlug)}.`
        });
      }
    }
  }
  return invalid;
}
