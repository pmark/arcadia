import { describe, expect, it } from "vitest";
import { replacePointer } from "../src/dispatch/pointer.js";

describe("replacePointer", () => {
  it("rewrites an existing current_action line and changes nothing else", () => {
    const before = "---\nslug: p\ncurrent_action: a1\nstatus: active\n---\nbody\n";
    expect(replacePointer(before, "a2", "status")).toBe(
      "---\nslug: p\ncurrent_action: a2\nstatus: active\n---\nbody\n"
    );
  });

  it("inserts current_action directly after the given field when none exists", () => {
    const before = "---\nslug: p\nstatus: active\nupdated: x\n---\n";
    expect(replacePointer(before, "a2", "status")).toBe(
      "---\nslug: p\nstatus: active\ncurrent_action: a2\nupdated: x\n---\n"
    );
  });

  it("leaves a current_action line in the body unchanged", () => {
    const before = "---\nslug: p\nstatus: active\n---\ncurrent_action: a1\n";
    expect(replacePointer(before, "a2", "status")).toBe(
      "---\nslug: p\nstatus: active\ncurrent_action: a2\n---\ncurrent_action: a1\n"
    );
  });

  it("throws when there is no current_action and no line for the given field", () => {
    expect(() => replacePointer("---\nslug: p\n---\n", "a2", "status")).toThrow(
      "Managed document has no stable field beside which to insert current_action."
    );
  });

  it("throws when the text has no frontmatter block", () => {
    expect(() => replacePointer("slug: p\nstatus: active\n", "a2", "status")).toThrow(
      "Managed document has no YAML frontmatter block to update."
    );
  });
});
