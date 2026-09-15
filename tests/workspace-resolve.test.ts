import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspace } from "../src/workspace/resolve.js";

describe("resolveWorkspace", () => {
  let root: string;
  let configHome: string;
  let repo: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-workspace-resolve-")));
    configHome = path.join(root, "config-home");
    repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function initWorkspace(workspacePath: string): void {
    mkdirSync(path.join(workspacePath, "config"), { recursive: true });
    writeFileSync(path.join(workspacePath, "config", "arcadia.json"), "{}\n");
  }

  it("prefers the configured default workspace over a repo-local dogfood marker", () => {
    const realWorkspace = path.join(root, "real-workspace");
    initWorkspace(realWorkspace);
    mkdirSync(path.dirname(path.join(configHome, "arcadia", "config.json")), { recursive: true });
    writeFileSync(
      path.join(configHome, "arcadia", "config.json"),
      JSON.stringify({ defaultWorkspace: realWorkspace })
    );

    initWorkspace(path.join(repo, ".arcadia-workspace"));

    const resolution = resolveWorkspace({
      cwd: repo,
      env: { XDG_CONFIG_HOME: configHome }
    });

    expect(resolution.source).toBe("user config");
    expect(resolution.workspacePath).toBe(path.resolve(realWorkspace));
    expect(resolution.warning).toBeUndefined();
  });

  it("falls back to the dogfood marker with a warning when no default is configured", () => {
    initWorkspace(path.join(repo, ".arcadia-workspace"));

    const resolution = resolveWorkspace({
      cwd: repo,
      env: { XDG_CONFIG_HOME: configHome }
    });

    expect(resolution.source).toBe("local marker");
    expect(resolution.workspacePath).toBe(path.resolve(repo, ".arcadia-workspace"));
    expect(resolution.warning).toMatch(/dogfood workspace/);
  });

  it("still prefers a direct workspace marker over the configured default", () => {
    const realWorkspace = path.join(root, "real-workspace");
    initWorkspace(realWorkspace);
    mkdirSync(path.dirname(path.join(configHome, "arcadia", "config.json")), { recursive: true });
    writeFileSync(
      path.join(configHome, "arcadia", "config.json"),
      JSON.stringify({ defaultWorkspace: realWorkspace })
    );

    initWorkspace(repo);

    const resolution = resolveWorkspace({
      cwd: repo,
      env: { XDG_CONFIG_HOME: configHome }
    });

    expect(resolution.source).toBe("local marker");
    expect(resolution.workspacePath).toBe(path.resolve(repo));
  });

  it("searches from ARCADIA_INVOKED_FROM instead of the runtime cwd", () => {
    const invokedFrom = path.join(root, "operator-cwd");
    mkdirSync(invokedFrom, { recursive: true });
    initWorkspace(path.join(invokedFrom, ".arcadia-workspace"));

    const resolution = resolveWorkspace({
      cwd: undefined,
      env: { XDG_CONFIG_HOME: configHome, ARCADIA_INVOKED_FROM: invokedFrom }
    });

    expect(resolution.workspacePath).toBe(path.resolve(invokedFrom, ".arcadia-workspace"));
  });
});
