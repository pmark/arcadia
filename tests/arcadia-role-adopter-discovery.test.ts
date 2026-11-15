import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectAgentSkills } from "../scripts/check-agent-skills.js";

/**
 * Criterion 1 of prove-rowan-supervisor-attention-loop: a representative
 * adopting Project that installs the current arcadia-role skill the supported
 * way (a maintained `.agents/skills` source plus the relative Claude alias)
 * exposes the team briefing to Codex and OpenCode (`.agents/skills`) and to
 * Claude Code (`.claude/skills`). Filesystem discovery only; no agent runs.
 */

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const SOURCE = path.resolve(import.meta.dirname, "../.agents/skills/arcadia-role");

function adopter(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-adopter-"));
  roots.push(root);
  writeFileSync(path.join(root, "AGENTS.md"), "# AGENTS\n\nUnless your brief assigns another profile/role, you are Rowan (Coordinator) in Role `lead`.\n");
  mkdirSync(path.join(root, ".agents/skills"), { recursive: true });
  cpSync(SOURCE, path.join(root, ".agents/skills/arcadia-role"), { recursive: true });
  mkdirSync(path.join(root, ".claude/skills"), { recursive: true });
  symlinkSync("../../.agents/skills/arcadia-role", path.join(root, ".claude/skills/arcadia-role"));
  return root;
}

describe("arcadia-role team briefing in an adopting Project", () => {
  it("passes three-agent discovery and every path carries the team briefing and round trip", () => {
    const root = adopter();
    expect(inspectAgentSkills(root)).toEqual([]);
    for (const discovery of [".agents/skills", ".claude/skills"]) {
      const skill = readFileSync(path.join(root, discovery, "arcadia-role/SKILL.md"), "utf8");
      expect(skill).toContain("## Project team: Signal, Rowan, Flynn and workers");
      expect(skill).toMatch(/\*\*Direct\s+variant\*\*/);
      expect(skill).toMatch(/native-mail relay/);
      expect(skill).toMatch(/native-mail overdue/);
      expect(skill).toMatch(/standby/);
    }
  });
});
