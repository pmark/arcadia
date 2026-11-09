import { describe, expect, it } from "vitest";
import { yamlScalar } from "../src/docs/frontmatter.js";

describe("yamlScalar quoting", () => {
  it("trims and leaves plain values unquoted", () => {
    expect(yamlScalar("  plain value  ")).toBe("plain value");
    expect(yamlScalar("a-b")).toBe("a-b");
  });

  it("JSON-quotes values containing a colon or hash", () => {
    expect(yamlScalar("Question: why?")).toBe('"Question: why?"');
    expect(yamlScalar("issue #12")).toBe('"issue #12"');
  });

  it("JSON-quotes values starting with a YAML indicator", () => {
    expect(yamlScalar("- item")).toBe('"- item"');
    expect(yamlScalar("*bold")).toBe('"*bold"');
    expect(yamlScalar("'quoted'")).toBe('"\'quoted\'"');
  });
});
