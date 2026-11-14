import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { yamlScalar } from "../src/docs/frontmatter.js";

describe("yamlScalar quoting", () => {
  it("trims and leaves plain values unquoted", () => {
    expect(yamlScalar("  plain value  ")).toBe("plain value");
    expect(yamlScalar("a-b")).toBe("a-b");
    expect(yamlScalar("a,b]c}d")).toBe("a,b]c}d");
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

  it("JSON-quotes values starting with a flow indicator and round-trips through the frontmatter parser", () => {
    for (const value of [", leading comma", "] leading bracket", "} leading brace", "[ENTRY] x", "{a} y"]) {
      const quoted = yamlScalar(value);
      expect(quoted).toBe(JSON.stringify(value));
      expect(parseYaml(`value: ${quoted}\n`)).toEqual({ value });
    }
  });

  it("round-trips plain values through the frontmatter parser unchanged", () => {
    for (const value of ["a,b", "a]b", "plain text"]) {
      expect(yamlScalar(value)).toBe(value);
      expect(parseYaml(`value: ${yamlScalar(value)}\n`)).toEqual({ value });
    }
  });
});
