import { describe, expect, it } from "vitest";
import { SLUG_MAX_LENGTH, slugify } from "../src/utils/slug.js";

/** The managed-document `slug` grammar from src/docs/parse.ts. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("slugify", () => {
  it("truncates an over-long question to a valid kebab-case slug", () => {
    // Issue #269's exact question: its 80th character fell just before a
    // separator, so the old slice produced a trailing hyphen the parser refused.
    const question =
      "Should Arcadia treat plan and Action priority as a projection of the live queue, "
      + "re-derived at dispatch, so priority belongs in advance queue order and never becomes a Decision?";
    const slug = slugify(question);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).toMatch(KEBAB_CASE);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("cuts back to a whole word inside the cap instead of truncating at a separator", () => {
    // "abcd-abcd-…" puts its 80th character (index 79) on a hyphen.
    const value = Array.from({ length: 30 }, () => "abcd").join("-");
    expect(value[SLUG_MAX_LENGTH - 1]).toBe("-");
    const slug = slugify(value);
    expect(slug).toMatch(KEBAB_CASE);
    expect(slug.length).toBeLessThan(SLUG_MAX_LENGTH);
    expect(slug.endsWith("abcd")).toBe(true);
  });

  it("keeps short values, unicode, and empty input stable", () => {
    expect(slugify("Add settlement proof")).toBe("add-settlement-proof");
    expect(slugify("  Mixed CASE & punctuation!! ")).toBe("mixed-case-punctuation");
    expect(slugify("Résumé déjà vu")).toBe("resume-deja-vu");
    expect(slugify("")).toBe("item");
    expect(slugify("---")).toBe("item");
  });

  it("leaves a value that is exactly the cap and one character longer distinct and valid", () => {
    const exact = "a".repeat(SLUG_MAX_LENGTH);
    expect(slugify(exact)).toBe(exact);
    expect(slugify(`${exact}b`)).toMatch(KEBAB_CASE);
    expect(slugify(`${exact}b`).length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });
});
