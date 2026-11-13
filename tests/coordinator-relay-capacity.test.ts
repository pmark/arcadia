import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { relayCapacityGate } from "../src/commands/coordinator.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

// Real observeProviderCapacity with the workspace's default registries: no fake deps. A custodian row stores
// `claude`, while the capacity registry names it `claude-code-cli`; the relay must look it up under that id.

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-relay-capacity-"));
  roots.push(root);
  const ws = path.join(root, "workspace");
  initWorkspace(ws);
  return ws;
}

describe("the relay's capacity gate uses the capacity registry id", () => {
  it("a claude custodian is looked up as claude-code-cli, not refused as having no reading", () => {
    const verdict = relayCapacityGate(workspace())("claude");
    expect(verdict.reason).not.toBe("No capacity reading for claude.");
  });

  it("a codex custodian is looked up as codex-cli, not refused as having no reading", () => {
    const verdict = relayCapacityGate(workspace())("codex");
    expect(verdict.reason).not.toBe("No capacity reading for codex.");
  });

  it("a provider with no registry id is still refused with the same message", () => {
    expect(relayCapacityGate(workspace())("unknown-provider")).toEqual({ admitted: false, reason: "No capacity reading for unknown-provider." });
  });
});
