import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { sessionAgentForProvider } from "../src/sessions/index.js";
import { LAUNCH_ADAPTER_SUPPORT } from "../src/sessions/launchPreview.js";
import {
  buildAgentLaunchCommand,
  defaultAgentWorktreeRoot,
  opencodeVariant,
  prepareAgentWorktree
} from "../src/sessions/worktreePreparation.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("opencode provider launch support", () => {
  it("builds a headless opencode build command with the reasoning variant", () => {
    expect(buildAgentLaunchCommand("opencode", "/work/tree", "opencode-go/deepseek-v4.1-flash", "e3_deep")).toBe(
      'cd "/work/tree" && opencode run --model "opencode-go/deepseek-v4.1-flash" --variant "high" "arcadia advance"'
    );
    expect(buildAgentLaunchCommand("opencode", "/work/tree", "opencode-go/deepseek-v4.1-flash", null)).toBe(
      'cd "/work/tree" && opencode run --model "opencode-go/deepseek-v4.1-flash" "arcadia advance"'
    );
  });

  it("maps every reasoning effort to a variant and omits an unknown one", () => {
    expect(opencodeVariant("e1_brief")).toBe("low");
    expect(opencodeVariant("e2_standard")).toBe("low");
    expect(opencodeVariant("e3_deep")).toBe("high");
    expect(opencodeVariant("e4_rigorous")).toBe("max");
    expect(opencodeVariant("high")).toBe("high");
    expect(opencodeVariant(null)).toBeNull();
    expect(opencodeVariant("e9_unknown")).toBeNull();
  });

  it("prepares the candidate under ~/.opencode/worktrees on the opencode branch", () => {
    expect(defaultAgentWorktreeRoot("opencode")).toBe(path.join(homedir(), ".opencode", "worktrees"));
    expect(defaultAgentWorktreeRoot("codex")).toBe(path.join(homedir(), ".codex", "worktrees"));
    expect(defaultAgentWorktreeRoot("claude")).toBe(path.join(homedir(), ".claude", "worktrees"));

    const root = mkdtempSync(path.join(tmpdir(), "arcadia-opencode-worktree-"));
    roots.push(root);
    const repo = path.join(root, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    execFileSync("git", ["-C", repo, "config", "user.email", "arcadia@example.test"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Arcadia Test"]);
    execFileSync("git", ["-C", repo, "commit", "--allow-empty", "-qm", "initial"]);
    const override = path.join(root, "worktrees");

    const prepared = prepareAgentWorktree({
      agent: "opencode",
      actionId: "Write-The-Marker",
      baseBranch: "main",
      repositoryPath: repo,
      rootOverride: override,
      now: new Date("2026-09-16T12:00:00.000Z"),
      model: "opencode-go/deepseek-v4.1-flash",
      effort: "e3_deep"
    });

    expect(prepared.agent).toBe("opencode");
    expect(prepared.branch.startsWith("opencode/write-the-marker-")).toBe(true);
    expect(prepared.path.startsWith(override + path.sep)).toBe(true);
    expect(prepared.command).toContain('opencode run --model "opencode-go/deepseek-v4.1-flash" --variant "high"');
  });

  it("keeps the launch-adapter table and the Session agent map in step with the registry", () => {
    const registry = defaultAdapters as ProviderAdapterRegistry;
    for (const provider of registry.providers.filter((entry) => entry.enabled)) {
      expect(LAUNCH_ADAPTER_SUPPORT[provider.id]).toBe(true);
      expect(sessionAgentForProvider(provider.id)).not.toBeNull();
    }
    // A provider the canonical map does not know is refused rather than launched.
    expect(sessionAgentForProvider("gemini-cli")).toBeNull();
    expect(LAUNCH_ADAPTER_SUPPORT["gemini-cli"]).not.toBe(true);
  });

  it("never emits an opencode variant the pinned model does not support", () => {
    // opencode-go/deepseek-v4.1-flash declares low/high/max reasoning efforts.
    const supported = new Set(["low", "high", "max"]);
    for (const binding of (defaultAdapters as ProviderAdapterRegistry).bindings) {
      if (binding.provider !== "opencode-cli") continue;
      for (const args of Object.values(binding.effortArgs)) {
        const variant = args?.[args.indexOf("--variant") + 1];
        expect(supported.has(variant ?? "")).toBe(true);
      }
    }
  });
});
