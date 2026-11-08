import { describe, expect, it } from "vitest";
import { isAuthoritativeControlPath } from "../src/docs/discover.js";

describe("isAuthoritativeControlPath", () => {
  it.each(["PROJECT.md", "docs/plans/my-plan.md", "docs/decisions/0001-x.md", "docs\\plans\\my-plan.md"])(
    "treats %s as an authoritative control record",
    (relativePath) => {
      expect(isAuthoritativeControlPath(relativePath)).toBe(true);
    },
  );

  it.each(["docs/notes.md", "docs/plan/x.md", "project.md", "sub/PROJECT.md"])(
    "does not treat %s as an authoritative control record",
    (relativePath) => {
      expect(isAuthoritativeControlPath(relativePath)).toBe(false);
    },
  );
});
