import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { systemTmux } from "../src/sessions/index.js";

/**
 * `systemTmux.capturePane` shells out to real tmux, so the one thing a fake
 * adapter can never prove is that the target it hands tmux actually resolves
 * to a pane. Issue #564 was exactly that: `capture-pane -t =<name>` is a valid
 * session target for `has-session` but not for `capture-pane`, which silently
 * returned `null` for every live Session and disabled stall detection's pane
 * signal. This suite runs against the real tmux binary so the target grammar
 * itself is exercised, and skips cleanly where tmux is not installed.
 */
function tmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasTmux = tmuxAvailable();

describe.skipIf(!hasTmux)("systemTmux pane targeting", () => {
  const launched: string[] = [];
  const roots: string[] = [];

  afterEach(() => {
    for (const name of launched.splice(0)) {
      try {
        execFileSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" });
      } catch {
        // Already gone; nothing to clean up.
      }
    }
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("captures a live session's pane through an exact pane target", async () => {
    const capturePane = (target: string) => systemTmux.capturePane?.(target) ?? null;

    const root = mkdtempSync(path.join(tmpdir(), "arcadia-tmux-"));
    roots.push(root);
    const name = `arcadia-tmux-target-${process.pid}-${Date.now()}`;
    launched.push(name);

    // The marker proves the capture read *this* session's pane; `sleep` keeps
    // the pane alive so the Session outlives the capture.
    systemTmux.launch({
      name,
      cwd: root,
      command: "sh",
      args: ["-c", "printf 'arcadia-pane-marker\\n'; sleep 30"]
    });
    expect(systemTmux.hasSession(name)).toBe(true);

    let captured: string | null = null;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      captured = capturePane(name);
      if (captured?.includes("arcadia-pane-marker")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // With the old `=<name>` target this stayed null ("can't find pane"),
    // which is the regression this test exists to catch.
    expect(captured).not.toBeNull();
    expect(captured).toContain("arcadia-pane-marker");
  });
});
