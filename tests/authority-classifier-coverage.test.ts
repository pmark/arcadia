import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyAuthorityPaths } from "../src/decisions/batchMerge.js";
// @ts-expect-error plain-node script without type declarations
import { discoverGateModules } from "../scripts/discover-gate-modules.mjs";

/**
 * Classifier-coverage audit (Decision 0214 answer A, Action
 * implement-a-classifier-coverage-audit). If unattended production's worker may
 * merge src/** changes that classifyAuthorityPaths leaves unclassified, every
 * module that defines or enforces an approval, spend, review or merge gate must
 * be classified. The module list comes from scripts/discover-gate-modules.mjs.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exclusions: Record<string, string> = JSON.parse(
  readFileSync(join(root, "tests/fixtures/authority-classifier-exclusions.json"), "utf8"),
).exclusions;
const hits: Array<{ path: string; patterns: string[] }> = discoverGateModules(root);
const isClassified = (path: string) => classifyAuthorityPaths([path]).length > 0;

/** Named gate-enforcing modules the audit must see classified, whatever the scan finds. */
const REQUIRED_CLASSIFIED = [
  "src/intelligence/config/defaults.ts",
  "src/intelligence/routing/resolveRoute.ts",
  "src/execution/approvedReviewScope.ts",
  "src/execution/claimedReviewRun.ts",
  "src/execution/reviewExecutor.ts",
  "src/execution/runFinalization.ts",
  "src/qa/verdict.ts",
  "src/qa/prReview.ts",
  "src/qa/reviewerReplay.ts",
  "src/qa/executionClaim.ts",
  "src/qa/patchApplicability.ts",
  "src/spend/spendCheck.ts",
  "src/spend/spendGuard.ts",
  "src/production/workerMerge.ts",
  "src/decisions/batchMerge.ts",
  "src/commands/decision.ts",
  "src/commands/actionSettle.ts",
  "src/commands/startRun.ts",
  "src/sessions/launch.ts",
];

describe("authority classifier coverage", () => {
  it("the discovery scan finds gate modules", () => {
    expect(hits.length).toBeGreaterThan(30);
  });

  it("classifies every named gate-enforcing module", () => {
    for (const path of REQUIRED_CLASSIFIED) {
      expect(classifyAuthorityPaths([path]), path).not.toEqual([]);
      expect(classifyAuthorityPaths([path]), path).not.toContain("unclassifiable_path");
    }
  });

  it("every discovered gate module is classified or carries an exclusion reason", () => {
    const uncovered = hits
      .filter((h) => !isClassified(h.path) && !exclusions[h.path])
      .map((h) => `${h.path} (${h.patterns.join(",")})`);
    expect(uncovered, "classify these in src/decisions/batchMerge.ts or add a reasoned exclusion").toEqual([]);
  });

  it("every exclusion is unclassified, discovered by the scan and has a reason", () => {
    const discovered = new Set(hits.map((h) => h.path));
    for (const [path, reason] of Object.entries(exclusions)) {
      expect(reason.trim().length, `${path} needs a reason`).toBeGreaterThan(10);
      expect(discovered.has(path), `${path} is stale: the scan no longer finds it`).toBe(true);
      expect(isClassified(path), `${path} is classified now; drop the exclusion`).toBe(false);
    }
  });
});
