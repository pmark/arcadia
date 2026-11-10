import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyAuthorityPaths } from "../src/decisions/batchMerge.js";
// @ts-expect-error plain-node script without type declarations
import { discoverGateModules, listSourceFiles } from "../scripts/discover-gate-modules.mjs";

/**
 * Classifier-coverage audit (Decision 0214 answer A, Action
 * implement-a-classifier-coverage-audit). If unattended production's worker may
 * merge src/** changes that classifyAuthorityPaths leaves unclassified, every
 * module that defines or enforces an approval, spend, review or merge gate must
 * be classified. The module list comes from scripts/discover-gate-modules.mjs.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory: Record<string, { reason: string; gateScanPatterns: string[] }> = JSON.parse(
  readFileSync(join(root, "tests/fixtures/authority-unclassified-src-inventory.json"), "utf8"),
).entries;
const sourceFiles: string[] = listSourceFiles(root);
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
  // Review of head 78437af83 (repair round 1).
  "src/sessions/reviewRepair.ts",
  "src/sessions/operatorLaunch.ts",
  "src/sessions/candidatePreservation.ts",
  "src/sessions/dispatchAdmission.ts",
  "src/dispatch/pointer.ts",
  "src/dispatch/planActivationApply.ts",
  "src/workspace/experimentGuard.ts",
  "src/scout/runAdmission.ts",
  "src/commands/worker.ts",
  "src/review/responseParser.ts",
  "src/codingAgents/signIn.ts",
  "src/codingAgents/claudeCodeToken.ts",
  "src/codingAgents/providerUsage.ts",
  "src/cli.ts",
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

  it("every unclassified src file is in the default-deny inventory", () => {
    const missing = sourceFiles.filter((p) => !isClassified(p) && !inventory[p]);
    expect(
      missing,
      "classify these in src/decisions/batchMerge.ts, or run node scripts/discover-gate-modules.mjs --inventory and give each a reason",
    ).toEqual([]);
  });

  it("every inventory entry exists, is still unclassified and has a reason", () => {
    const existing = new Set(sourceFiles);
    for (const [path, entry] of Object.entries(inventory)) {
      expect(existing.has(path), `${path} no longer exists; drop it from the inventory`).toBe(true);
      expect(isClassified(path), `${path} is classified now; drop it from the inventory`).toBe(false);
      expect(entry.reason.trim().length, `${path} needs a reason`).toBeGreaterThan(10);
      expect(entry.reason.startsWith("Unreviewed"), `${path} still has the unreviewed placeholder reason`).toBe(false);
    }
  });

  it("every gate-scan hit is classified or inventoried", () => {
    const uncovered = hits.filter((h) => !isClassified(h.path) && !inventory[h.path]).map((h) => h.path);
    expect(uncovered).toEqual([]);
  });
});
