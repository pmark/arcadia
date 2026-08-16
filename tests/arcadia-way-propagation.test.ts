import { describe, expect, it } from "vitest";
import { thinClaudeWrapper, updateAgentsMarkdown } from "../src/projects/contextSetup.js";

const SECTION_START = "<!-- ARCADIA_CONTEXT_START -->";
const SECTION_END = "<!-- ARCADIA_CONTEXT_END -->";

describe("adopted AGENTS.md block", () => {
  it("names the constitution, the pointer, and the naming rule", () => {
    const rendered = updateAgentsMarkdown(null);

    expect(rendered).toContain("CONSTITUTION.md");
    expect(rendered).toContain("PROJECT.md");
    expect(rendered).toContain("nouns read state, verbs may mutate");
  });

  it("replaces only the managed block and preserves project-authored content", () => {
    const existing = [
      "# AGENTS",
      "",
      SECTION_START,
      "## Arcadia Context",
      "stale content",
      SECTION_END,
      "",
      "## Guided intake-field changes",
      "Follow docs/intake-field-change-protocol.md before editing a field."
    ].join("\n");

    const rendered = updateAgentsMarkdown(existing);

    // The project's own section is not Arcadia's to rewrite.
    expect(rendered).toContain("## Guided intake-field changes");
    expect(rendered).toContain("docs/intake-field-change-protocol.md");
    expect(rendered).not.toContain("stale content");
    expect(rendered.match(new RegExp(SECTION_START, "g"))).toHaveLength(1);
  });
});

describe("adopted CLAUDE.md wrapper", () => {
  it("writes an @AGENTS.md import and no shared rules of its own", () => {
    const rendered = thinClaudeWrapper(null);

    expect(rendered).toContain("@AGENTS.md");
    expect(rendered).toContain("Never put shared rules here");
  });

  it("replaces a CLAUDE.md that only carries an older injected block", () => {
    const existing = [
      "# CLAUDE",
      "",
      SECTION_START,
      "## Arcadia Context",
      "a duplicated copy of the AGENTS.md block",
      SECTION_END
    ].join("\n");

    const rendered = thinClaudeWrapper(existing);

    // This duplicate is exactly the drift the wrapper exists to end, and it is
    // Arcadia's own output, so replacing it is safe.
    expect(rendered).toContain("@AGENTS.md");
    expect(rendered).not.toContain("duplicated copy");
  });

  it("refuses to overwrite a CLAUDE.md holding project-authored content", () => {
    const existing = [
      "# CLAUDE",
      "",
      SECTION_START,
      "## Arcadia Context",
      SECTION_END,
      "",
      "## House rules",
      "Never run the seed script against staging."
    ].join("\n");

    // Silently discarding a project's own agent instructions is the governance
    // mutation the Constitution forbids, so setup declines and reports instead.
    expect(thinClaudeWrapper(existing)).toBeNull();
  });

  it("is idempotent once the wrapper is in place", () => {
    const first = thinClaudeWrapper(null);
    expect(thinClaudeWrapper(first)).toBe(first);
  });
});
