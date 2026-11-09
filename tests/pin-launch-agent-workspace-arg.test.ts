import { describe, expect, it } from "vitest";
import { launchAgentWorkspace } from "../src/runtime/launchAgents.js";

describe("launchAgentWorkspace", () => {
  it("returns the value following a --workspace argument", () => {
    expect(launchAgentWorkspace(["node", "arcadia", "worker", "--workspace", "/w/one"])).toBe("/w/one");
  });

  it("returns null when no usable --workspace value follows", () => {
    expect(launchAgentWorkspace(["node", "arcadia"])).toBeNull();
    expect(launchAgentWorkspace(["--workspace"])).toBeNull();
    expect(launchAgentWorkspace(["--workspace", "--other", "/w"])).toBeNull();
    expect(launchAgentWorkspace(["--workspace", ""])).toBeNull();
    expect(launchAgentWorkspace(["--workspace=/w/one"])).toBeNull();
  });
});
