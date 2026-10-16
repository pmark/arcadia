import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectAgentSkills } from "../scripts/check-agent-skills.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-skills-"));
  roots.push(root);
  mkdirSync(path.join(root, ".agents/skills/example"), { recursive: true });
  mkdirSync(path.join(root, ".claude/skills"), { recursive: true });
  writeFileSync(path.join(root, ".agents/skills/example/SKILL.md"), "---\nname: example\ndescription: Example skill\n---\nUse existing commands.\n");
  return root;
}
describe("three-agent shared skill discovery", () => {
  it("accepts a relative alias resolving to the same complete source", () => {
    const root = fixture();
    symlinkSync("../../.agents/skills/example", path.join(root, ".claude/skills/example"));
    expect(inspectAgentSkills(root)).toEqual([]);
  });
  it("rejects a machine-specific absolute alias even when it resolves", () => {
    const root = fixture();
    symlinkSync(path.join(root, ".agents/skills/example"), path.join(root, ".claude/skills/example"));
    expect(inspectAgentSkills(root).join("\n")).toContain("must link to the shared source");
  });
  it("rejects a new shared skill that Claude cannot discover", () => {
    expect(inspectAgentSkills(fixture())).length(1);
  });
  it("rejects a stale alias pointing at a different skill source", () => {
    const root = fixture();
    mkdirSync(path.join(root, "stale"));
    symlinkSync("../../stale", path.join(root, ".claude/skills/example"));
    expect(inspectAgentSkills(root).join("\n")).toContain("must link to the shared source");
  });
  it("rejects invalid shared entrypoints rather than silently skipping them", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".agents/skills/example/SKILL.md"), "---\nname: other\ndescription: ''\n---\n");
    const problems = inspectAgentSkills(root).join("\n");
    expect(problems).toContain("frontmatter name");
    expect(problems).toContain("description");
  });
});
