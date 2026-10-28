import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { docsFingerprint, discoverDocs, type DiscoveryResult } from "../../../src/docs/discover";
import { runPlanProgressCommand, runPlansCommand } from "../../../src/commands/plans";
import { PLAN_SUMMARY_DIR } from "../../../src/docs/planSummaries";
import { createFingerprintCache } from "./fingerprint-cache";
import type { PlanProgressData, ProjectPlansResponse } from "./plans-types";

/**
 * In-process, change-aware reads of a repository's managed documents for the dashboard.
 *
 * `arcadia plans` only reads documents, yet each spawned read cost about 1.5 s of tsx start-up plus a full
 * discovery walk: a cold /workspace spent ~15 s on one CLI process per Project, and every Plan opened another.
 * Here one discovery per repository is cached and reused by the Plan list and every Plan's detail, and it is
 * re-read only when a document's size or modification time changes (checked at most every `CHECK_AFTER_MS`).
 */
const CHECK_AFTER_MS = 2_000;

const discoveries = createFingerprintCache<string, DiscoveryResult>({
  name: "repo-docs:discovery",
  keyOf: (repoPath) => path.resolve(repoPath),
  fingerprint: (repoPath) => docsFingerprint(repoPath),
  load: (repoPath) => discoverDocs(repoPath),
  checkAfterMs: CHECK_AFTER_MS,
  maxEntries: 50
});

/** Views derived from one discovery die with it, so they can never outlive the documents they came from. */
const derived = new WeakMap<DiscoveryResult, Map<string, unknown>>();
function memo<T>(discovered: DiscoveryResult, key: string, build: () => T): T {
  let views = derived.get(discovered);
  if (!views) derived.set(discovered, (views = new Map()));
  if (!views.has(key)) views.set(key, build());
  return views.get(key) as T;
}

/** What `arcadia plans --repo <repo> --project <slug> --json` returns as `data`. */
export async function readProjectPlans(repoPath: string, projectSlug: string, fresh = false): Promise<ProjectPlansResponse> {
  const discovered = await discoveries.get(repoPath, { fresh });
  return memo(discovered, `plans:${projectSlug}`, () => runPlansCommand({ repo: repoPath, project: projectSlug, discovered }).data);
}

/** What `arcadia plans --repo <repo> --project <slug> --plan <plan> --all --json` returns as `data`. */
export async function readPlanProgress(repoPath: string, projectSlug: string, planSlug: string, fresh = false): Promise<PlanProgressData> {
  const discovered = await discoveries.get(repoPath, { fresh });
  return memo(discovered, `plan:${projectSlug}:${planSlug}`, () =>
    runPlanProgressCommand({ repo: repoPath, project: projectSlug, plan: planSlug, discovered }).data);
}

/**
 * The documents' fingerprint plus every generated Plan summary's size and modification time: a summary read is
 * current while neither its Plans nor its summary files have changed.
 */
export function summariesFingerprint(repoPath: string): string {
  const dir = path.join(repoPath, PLAN_SUMMARY_DIR);
  let files: string[] = [];
  try {
    files = readdirSync(dir).sort();
  } catch {
    // No summaries yet; the documents' fingerprint alone decides.
  }
  const stamps = files.map((name) => {
    try {
      const stats = statSync(path.join(dir, name));
      return `${name}:${stats.size}:${stats.mtimeMs}`;
    } catch {
      return `${name}:!`;
    }
  });
  return `${docsFingerprint(repoPath)}|${stamps.join(",")}`;
}

/** Drop every cached discovery, e.g. after the dashboard itself changes a document. */
export function invalidateRepoDocs(repoPath?: string): void {
  discoveries.invalidate(repoPath);
}
