import { describe, expect, it } from "vitest";
import { cloudflareWorkerName } from "../src/projects/stagingDeployment.js";

describe("cloudflareWorkerName", () => {
  it("lowercases and collapses runs of other characters to a single hyphen", () => {
    expect(cloudflareWorkerName("My Field_Notes!!")).toBe("my-field-notes");
  });

  it("trims leading and trailing hyphens", () => {
    expect(cloudflareWorkerName("--abc--")).toBe("abc");
  });

  it("truncates to 54 characters", () => {
    expect(cloudflareWorkerName("a".repeat(60))).toBe("a".repeat(54));
  });

  it("throws when nothing usable remains", () => {
    const message = "Project name cannot be converted to a Cloudflare Worker name";
    expect(() => cloudflareWorkerName("!!!")).toThrow(message);
    expect(() => cloudflareWorkerName("")).toThrow(message);
  });
});
