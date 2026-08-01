import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDigestComposeCommand } from "../src/commands/digest.js";
import { withDatabase } from "../src/db/connection.js";
import { createMissionLog, setMissionLogDocRef, upsertProject } from "../src/db/repositories.js";
import type { DigestNarrator } from "../src/digests/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const WINDOW = { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" };

function temporary(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function obsidianVault(): string {
  const vault = temporary("arcadia-digest-vault-");
  mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  writeFileSync(path.join(vault, "Welcome.md"), "untouched\n", "utf8");
  return vault;
}

function enableMemory(workspace: string, vault: string): void {
  const configPath = getWorkspacePaths(workspace).configFile;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.memory = { enabled: true, obsidianVaultPath: vault };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function fixture(options: { memory: boolean }): { workspace: string; vault: string } {
  const workspace = temporary("arcadia-digest-workspace-");
  const vault = obsidianVault();
  initWorkspace(workspace);
  if (options.memory) {
    enableMemory(workspace, vault);
  }

  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Alpha",
      mission: "Ship Alpha honestly.",
      status: "active",
      currentMilestone: "Tell the story",
      nextAction: "Compose the digest",
      workClassification: "codex"
    });
    const log = createMissionLog(db, {
      projectId: project.id,
      workPerformed: "Implemented the parser.",
      result: "Focused tests passed.",
      nextAction: "Review it.",
      markdownPath: "MISSION_LOG.md"
    });
    setMissionLogDocRef(db, log.id, "log/alpha#2026-07-01--parser");
  });

  return { workspace, vault };
}

function narrator(text: string): DigestNarrator {
  return vi.fn(async () => ({ narrative: text, jobId: null }));
}

function recordFile(vault: string): string {
  return path.join(realpathSync(vault), "Arcadia", "Records", "Digests", "alpha", "2026", "2026-07-02-day-digest.md");
}

describe("narrative digests as vault Records", () => {
  it("does nothing when the workspace has not opted into vault memory", async () => {
    const { workspace, vault } = fixture({ memory: false });

    const response = await runDigestComposeCommand({
      workspace,
      project: "alpha",
      period: "day",
      ...WINDOW,
      narrator: narrator("Alpha shipped the parser.")
    });

    expect(response.data.memory).toBeNull();
    expect(response.data.memoryError).toBeNull();
    expect(readFileSync(path.join(vault, "Welcome.md"), "utf8")).toBe("untouched\n");
  });

  it("projects a composed digest into the vault, clearly marked as AI-narrated", async () => {
    const { workspace, vault } = fixture({ memory: true });

    const response = await runDigestComposeCommand({
      workspace,
      project: "alpha",
      period: "day",
      ...WINDOW,
      narrator: narrator("Alpha shipped the parser and reviewed it.")
    });

    expect(response.data.memory).toMatchObject({ status: "created", project: "Alpha" });
    const record = readFileSync(recordFile(vault), "utf8");
    expect(record).toContain("record_type: narrative_digest");
    expect(record).toContain("narration: ai");
    expect(record).toContain('arcadia_digest_key: "alpha/day/2026-07-01T00:00:00.000Z..2026-07-02T00:00:00.000Z"');
    expect(record).toContain("AI-narrated");
    expect(record).toContain("Alpha shipped the parser and reviewed it.");
  });

  it("skips a re-export of an unchanged digest, verified by content hash", async () => {
    const { workspace, vault } = fixture({ memory: true });
    const narrate = narrator("Alpha shipped the parser.");

    const first = await runDigestComposeCommand({ workspace, project: "alpha", period: "day", ...WINDOW, narrator: narrate });
    const before = readFileSync(recordFile(vault), "utf8");
    const second = await runDigestComposeCommand({ workspace, project: "alpha", period: "day", ...WINDOW, narrator: narrate });

    expect(first.data.memory?.status).toBe("created");
    expect(second.data.memory?.status).toBe("skipped");
    expect(readFileSync(recordFile(vault), "utf8")).toBe(before);
  });

  it("updates the Record when the narrative actually changed", async () => {
    const { workspace, vault } = fixture({ memory: true });

    await runDigestComposeCommand({
      workspace, project: "alpha", period: "day", ...WINDOW, narrator: narrator("First narration.")
    });
    const second = await runDigestComposeCommand({
      workspace, project: "alpha", period: "day", ...WINDOW, narrator: narrator("Second, revised narration.")
    });

    expect(second.data.memory?.status).toBe("updated");
    expect(readFileSync(recordFile(vault), "utf8")).toContain("Second, revised narration.");
  });

  it("reports a vault problem without losing the composed digest", async () => {
    const { workspace } = fixture({ memory: false });
    enableMemory(workspace, path.join(workspace, "missing-vault"));

    const response = await runDigestComposeCommand({
      workspace, project: "alpha", period: "day", ...WINDOW, narrator: narrator("Alpha shipped the parser.")
    });

    expect(response.data.artifact.path).toBeTruthy();
    expect(response.data.memory).toBeNull();
    expect(response.data.memoryError).toMatch(/vault directory does not exist/);
  });
});
