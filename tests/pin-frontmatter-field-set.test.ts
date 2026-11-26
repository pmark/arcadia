import { describe, expect, it } from "vitest";

import { setFrontmatterField } from "../src/dispatch/planActivationApply.js";

describe("setFrontmatterField", () => {
  it("changes only the status line", () => {
    const doc = "---\nslug: p\nstatus: draft\nupdated: x\n---\n\n# Body\n";
    expect(setFrontmatterField(doc, "status", "active")).toBe("---\nslug: p\nstatus: active\nupdated: x\n---\n\n# Body\n");
  });

  it("appends active_plan as the last frontmatter line, before the closing marker", () => {
    const doc = "---\nslug: p\n---\n\n# Body\n";
    expect(setFrontmatterField(doc, "active_plan", "track-4")).toBe("---\nslug: p\nactive_plan: track-4\n---\n\n# Body\n");
  });

  it("leaves a status_note line unchanged when status is set", () => {
    const doc = "---\nstatus_note: x\nstatus: draft\n---\n";
    expect(setFrontmatterField(doc, "status", "active")).toBe("---\nstatus_note: x\nstatus: active\n---\n");
  });

  it("leaves a status line in the body unchanged", () => {
    const doc = "---\nslug: p\nstatus: draft\n---\n\nstatus: draft\n";
    expect(setFrontmatterField(doc, "status", "active")).toBe("---\nslug: p\nstatus: active\n---\n\nstatus: draft\n");
  });

  it("throws when the text has no frontmatter block", () => {
    expect(() => setFrontmatterField("# Body\nstatus: draft\n", "status", "active")).toThrow(
      "Managed document has no YAML frontmatter block to update."
    );
  });
});
