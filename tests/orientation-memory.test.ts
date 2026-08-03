import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportOrientationPacket } from "../src/memory/obsidian.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporary(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function fixture(): { workspace: string; vault: string } {
  const workspace = temporary("arcadia-orientation-workspace-");
  const vault = temporary("arcadia-orientation-vault-");
  mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  initWorkspace(workspace);
  const configPath = getWorkspacePaths(workspace).configFile;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.memory = { enabled: true, obsidianVaultPath: vault };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { workspace, vault };
}

describe("Morning Packets as vault Records", () => {
  it("writes the deterministic narrative and supplemental AI perspective idempotently", () => {
    const { workspace, vault } = fixture();
    const input = {
      packet: {
        id: "opacket_test",
        localDate: "2026-08-03",
        body: "**Morning narrative**\nArcadia made the export durable.",
        createdAt: "2026-08-03T13:00:00.000Z",
        discordMessageId: "discord-1"
      },
      supplementalAiSummary: {
        headline: "Durable context replaces morning reconstruction",
        paragraph: "The narrative now survives outside Discord, so orientation compounds instead of resetting."
      }
    };
    const first = exportOrientationPacket(workspace, input);
    const second = exportOrientationPacket(workspace, input);
    expect(first?.status).toBe("created");
    expect(second?.status).toBe("skipped");
    const recordPath = path.join(
      realpathSync(vault), "Arcadia", "Records", "Orientation", "2026", "2026-08-03-morning-orientation.md"
    );
    const record = readFileSync(recordPath, "utf8");
    expect(record).toContain("record_type: morning_orientation");
    expect(record).toContain("ai_summary: present");
    expect(record).toContain("## AI perspective — Durable context replaces morning reconstruction");
    expect(record).toContain("**Morning narrative**");
    expect(record).toContain("SQLite remains operational truth");
  });
});
