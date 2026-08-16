import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adoptContinuationProtocol,
  readAgentsContextBlock,
  thinClaudeWrapper,
  updateAgentsMarkdown
} from "../src/projects/contextSetup.js";

const SECTION_START = "<!-- ARCADIA_CONTEXT_START -->";
const SECTION_END = "<!-- ARCADIA_CONTEXT_END -->";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function managedRegion(markdown: string): string {
  const start = markdown.indexOf(SECTION_START);
  const end = markdown.indexOf(SECTION_END);
  if (start < 0 || end < 0) return "";
  return markdown.slice(start + SECTION_START.length, end).trim();
}

describe("Arcadia is adopter zero", () => {
  it("carries the same managed AGENTS.md region it writes into every adopter", () => {
    // Arcadia's own AGENTS.md was hand-written and exempt from the generator,
    // which is how the noun/verb naming rule came to exist in every adopting
    // repository and nowhere here. The shared region is now one file, and this
    // asserts Arcadia holds it byte for byte like anyone else.
    const own = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");

    expect(managedRegion(own)).toBe(readAgentsContextBlock());
  });

  it("keeps this repository's own sections outside the managed region", () => {
    const own = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");

    // Adopter zero must still be able to say things only Arcadia needs, exactly
    // as PPN keeps its launch-readiness lens.
    expect(own).toContain("## The 80/20 rule");
    expect(own).toContain("## Working-Copy Safety");
    expect(managedRegion(own)).not.toContain("## The 80/20 rule");
  });

  it("writes adopters the same bytes, from the file rather than a literal", () => {
    // The shared text used to be a string array in contextSetup.ts, so the
    // canonical wording of the most-loaded governance file was reviewable only
    // as a code diff and could drift from Arcadia's own copy without a trace.
    const canonical = readFileSync(path.join(repoRoot, "docs/agents-context.md"), "utf8").trim();

    expect(readAgentsContextBlock()).toBe(canonical);
    expect(managedRegion(updateAgentsMarkdown(null))).toBe(canonical);
  });
});

describe("adopted AGENTS.md block", () => {
  it("names the constitution, the pointer, and the naming rule", () => {
    const rendered = updateAgentsMarkdown(null);

    expect(rendered).toContain("CONSTITUTION.md");
    expect(rendered).toContain("PROJECT.md");
    expect(rendered).toContain("nouns read state, verbs may mutate");
  });

  it("states the stopping contract inline rather than only linking to it", () => {
    const rendered = updateAgentsMarkdown(null);

    // The whole point: this block is loaded automatically, a linked document is
    // not. An agent that reads only this must still know what it owes.
    expect(rendered).toContain("OK to go:");
    expect(rendered).toContain("Absence is the signal");
    expect(rendered).toContain("record one precise operator question");
    expect(rendered).toContain("is itself a stopping condition");
    expect(rendered).toContain("docs/agent-continuation-protocol.md");
    expect(rendered).toContain("reference, not a prerequisite");
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

  it("refuses to overwrite a CLAUDE.md that imports AGENTS.md and adds its own notes", () => {
    const existing = [
      "# CLAUDE.md",
      "",
      "@AGENTS.md",
      "",
      "## Claude Code specifics",
      "",
      "- This repository pins Node 22.23.1 in `mise.toml`."
    ].join("\n");

    // A file that imports AGENTS.md and then adds project-authored notes is the
    // most natural shape for CLAUDE.md, and the presence of the import used to
    // be read as proof the whole file was generated. Running setup against
    // Arcadia itself destroyed exactly this content on the first real run.
    expect(thinClaudeWrapper(existing)).toBeNull();
  });

  it("declines rather than overwrites Arcadia's own CLAUDE.md", () => {
    const own = readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");

    expect(own).toContain("@AGENTS.md");
    expect(thinClaudeWrapper(own)).toBeNull();
  });
});

describe("adopted continuation protocol", () => {
  const source = [
    "---",
    "arcadia: v1",
    "type: reference",
    "project: arcadia",
    "---",
    "",
    "# Agent Continuation Protocol",
    "",
    "Shared rules."
  ].join("\n");

  it("retitles the document to the adopting project", () => {
    const rendered = adoptContinuationProtocol(source, null, "private-practice-now");

    expect(rendered).toContain("project: private-practice-now");
    expect(rendered).not.toContain("project: arcadia");
    expect(rendered).toContain("Shared rules.");
  });

  it("preserves a repository's own section on first adoption", () => {
    const existing = [
      "---",
      "arcadia: v1",
      "type: reference",
      "project: private-practice-now",
      "---",
      "",
      "# Agent Continuation Protocol",
      "",
      "## Launch readiness",
      "",
      "A request phrased as \"What is left?\" resolves against the pilot decision."
    ].join("\n");

    const rendered = adoptContinuationProtocol(source, existing, "private-practice-now");

    // The first version of this overwrote the file wholesale and destroyed this
    // exact section on the first real run against PPN.
    expect(rendered).toContain("## Launch readiness");
    expect(rendered).toContain("What is left?");
    expect(rendered).toContain("Shared rules.");
  });

  it("marks the preserved section for triage", () => {
    const existing = [
      "---",
      "arcadia: v1",
      "---",
      "",
      "## Valid current action",
      "",
      "- Its status is `in_progress`."
    ].join("\n");

    const rendered = adoptContinuationProtocol(source, existing, "demo");

    // Preserving verbatim is right -- losing a project's rules is worse -- but
    // it leaves two statements of one contract in a file. PPN's preserved copy
    // required `in_progress`, which no dispatch check enforces, and read
    // strictly it made the current Action unexecutable. Say so at the seam.
    expect(rendered).toContain("TRIAGE THIS SECTION");
    expect(rendered).toContain("the stricter copy");
    expect(rendered).toContain("- Its status is `in_progress`.");
  });

  it("regenerates only the managed region on later runs", () => {
    const first = adoptContinuationProtocol(source, null, "demo");
    const withProjectSection = `${first}\n## Local lens\n\nProject-owned.\n`;
    const updated = source.replace("Shared rules.", "Shared rules, revised.");

    const rendered = adoptContinuationProtocol(updated, withProjectSection, "demo");

    expect(rendered).toContain("Shared rules, revised.");
    expect(rendered).toContain("## Local lens");
    expect(rendered).toContain("Project-owned.");
  });

  it("is idempotent", () => {
    const first = adoptContinuationProtocol(source, null, "demo");
    expect(adoptContinuationProtocol(source, first, "demo")).toBe(first);
  });
});
