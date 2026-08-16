import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isManagedDoc, parseDoc } from "./parse.js";
import type { ArcadiaDoc, DocValidationError } from "./types.js";

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
  const docs: ArcadiaDoc[] = [];
  const errors: DocValidationError[] = [];
  const rejected: string[] = [];

  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return; // unreadable directory is not worth failing a portfolio-wide sync
    }

    for (const entry of entries) {
      if (entry.startsWith(".") && entry !== ".arcadia") {
        continue;
      }
      const absolute = path.join(directory, entry);

      let stats;
      try {
        stats = statSync(absolute);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry)) {
          walk(absolute, depth + 1);
        }
        continue;
      }

      if (!entry.toLowerCase().endsWith(".md")) {
        continue;
      }

      let content: string;
      try {
        content = readFileSync(absolute, "utf8");
      } catch {
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

  // Stable ordering keeps dry-run output diffable between runs.
  docs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  errors.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.field.localeCompare(b.field));

  return { docs, errors, rejected };
}
