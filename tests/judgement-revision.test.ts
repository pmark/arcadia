import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JUDGEMENT_REVISION } from "../src/qa/reviewCriteria.js";
import { judgedCriteriaFingerprint } from "../src/sessions/roleLineage.js";

/**
 * JUDGEMENT_REVISION (src/qa/reviewCriteria.ts) is hashed into every
 * independent verdict's criteria binding, so a bump re-reviews candidates whose
 * verdicts the old deterministic judgement produced. This tripwire pins the
 * content of the two files that judgement lives in, per revision: changing the
 * patch check or the review criteria without deciding about a bump fails here.
 */
const JUDGEMENT_FILES = ["src/qa/patchApplicability.ts", "src/qa/reviewCriteria.ts"];
const PINNED: Record<number, string> = {
  // Re-pinned without a bump: isSettlementArchiveOf only exports an existing rule for the worker merge.
  2: "d0929404bc12b824d3ddef6ea1fa71ab5a033cbdef3186c02de1dc826be9b1a5"
};

function judgementContentHash(): string {
  const hash = createHash("sha256");
  for (const file of JUDGEMENT_FILES) {
    hash.update(`${file}\n`);
    hash.update(readFileSync(path.join(import.meta.dirname, "..", file), "utf8")
      .replace(/^export const JUDGEMENT_REVISION = \d+;$/m, "export const JUDGEMENT_REVISION = <pinned>;"));
  }
  return hash.digest("hex");
}

describe("JUDGEMENT_REVISION", () => {
  it("pins the patch check and review criteria content for the current revision", () => {
    // On failure: if the change can alter any verdict (a check, a criterion,
    // the not-applicable rules), bump JUDGEMENT_REVISION and pin the new hash
    // under the new revision; otherwise (comments, refactors) re-pin the hash
    // under the current revision. Either way the choice is explicit in review.
    expect({ revision: JUDGEMENT_REVISION, hash: judgementContentHash() }).toEqual({ revision: JUDGEMENT_REVISION, hash: PINNED[JUDGEMENT_REVISION] });
  });

  it("binds revision 1 to the bare criteria fingerprint and every later revision to a distinct one", () => {
    const bare = "a".repeat(64);
    expect(judgedCriteriaFingerprint(bare, 1)).toBe(bare);
    expect(judgedCriteriaFingerprint(bare, 2)).not.toBe(bare);
    expect(judgedCriteriaFingerprint(bare, 3)).not.toBe(judgedCriteriaFingerprint(bare, 2));
    expect(judgedCriteriaFingerprint(bare)).toBe(judgedCriteriaFingerprint(bare, JUDGEMENT_REVISION));
    expect(JUDGEMENT_REVISION).toBeGreaterThanOrEqual(2);
  });
});
