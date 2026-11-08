import { describe, expect, it } from "vitest";
import { isGovernedRecordPath } from "../src/sessions/scopeCriteria.js";

describe("isGovernedRecordPath", () => {
  it.each(["PROJECT.md", "MISSION_LOG.md", "docs/plans/x.md", "docs/decisions/0001-x.md", ".arcadia/asks/x.yaml"])(
    "counts %s as a governed record",
    (file) => {
      expect(isGovernedRecordPath(file)).toBe(true);
    },
  );

  it.each(["project.md", "docs/plansx.md", "src/x.ts", "tests/x.test.ts", "./PROJECT.md"])(
    "does not count %s as a governed record",
    (file) => {
      expect(isGovernedRecordPath(file)).toBe(false);
    },
  );
});
