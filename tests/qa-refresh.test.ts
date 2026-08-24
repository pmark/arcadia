import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { refreshProject } from "../src/qa/refresh.js";
import { freshnessSummary, repoFreshness, serviceScriptPath } from "../src/qa/targets.js";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * An origin plus a clone of it, so fast-forward has something real to do.
 *
 * `withServiceScript` puts the script in the origin's first commit rather than
 * pushing it from the clone: pushing to a non-bare repository whose branch is
 * checked out is refused by git, and working around that would make the
 * fixture about git plumbing instead of about refresh.
 */
function repoPair(options: { withServiceScript?: string } = {}): {
  origin: string;
  clone: string;
  workspace: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-qa-refresh-"));
  scratch.push(root);
  const origin = path.join(root, "origin");
  const clone = path.join(root, "clone");
  const workspace = path.join(root, "workspace");

  mkdirSync(origin);
  run(origin, ["init", "--quiet", "--initial-branch=main"]);
  run(origin, ["config", "user.email", "test@example.com"]);
  run(origin, ["config", "user.name", "Test"]);
  writeFileSync(path.join(origin, "README.md"), "one\n");
  if (options.withServiceScript) writeServiceScript(origin, options.withServiceScript);
  run(origin, ["add", "."]);
  run(origin, ["commit", "--quiet", "-m", "one"]);

  run(root, ["clone", "--quiet", origin, clone]);
  run(clone, ["config", "user.email", "test@example.com"]);
  run(clone, ["config", "user.name", "Test"]);

  mkdirSync(path.join(workspace, "config"), { recursive: true });
  return { origin, clone, workspace };
}

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeConfig(workspace: string, repoPath: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    path.join(workspace, "config", "qa-targets.json"),
    JSON.stringify({
      schemaVersion: 1,
      projects: { sample: { repoPath, baseBranch: "main", ...extra } },
      targets: []
    })
  );
}

/** A service script honouring the contract, recording that it was called. */
function writeServiceScript(repoPath: string, marker: string): void {
  const dir = path.join(repoPath, "scripts");
  mkdirSync(dir, { recursive: true });
  const script = path.join(dir, "services.sh");
  writeFileSync(script, `#!/usr/bin/env bash\necho "$1" > "${marker}"\necho "ran $1"\n`);
  chmodSync(script, 0o755);
}

describe("repo freshness", () => {
  it("counts commits behind the base branch and names when refs were fetched", () => {
    const { origin, clone, workspace } = repoPair();
    writeFileSync(path.join(origin, "README.md"), "two\n");
    run(origin, ["commit", "--quiet", "-am", "two"]);
    run(clone, ["fetch", "--quiet", "origin", "main"]);
    writeConfig(workspace, clone);

    const freshness = repoFreshness({ repoPath: clone, baseBranch: "main" });
    expect(freshness.behind).toBe(1);
    expect(freshness.ahead).toBe(0);
    expect(freshness.dirty).toBe(false);
    expect(freshnessSummary(freshness)).toContain("1 commit behind main");
  });

  it("reports a dirty tree rather than hiding it", () => {
    const { clone } = repoPair();
    writeFileSync(path.join(clone, "README.md"), "edited\n");
    expect(repoFreshness({ repoPath: clone, baseBranch: "main" }).dirty).toBe(true);
  });
});

describe("service script discovery", () => {
  it("finds the conventional path, and honours an override", () => {
    const { clone } = repoPair();
    expect(serviceScriptPath({ repoPath: clone, baseBranch: "main" })).toBeNull();

    writeServiceScript(clone, path.join(clone, "marker"));
    expect(serviceScriptPath({ repoPath: clone, baseBranch: "main" })).toContain("scripts/services.sh");

    expect(serviceScriptPath({ repoPath: clone, baseBranch: "main", serviceScript: "nope/missing.sh" })).toBeNull();
  });
});

describe("refresh safety contract", () => {
  it("fast-forwards and runs the project's restart verb", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-qa-marker-"));
    scratch.push(root);
    const marker = path.join(root, "marker");
    const { origin, clone, workspace } = repoPair({ withServiceScript: marker });

    writeFileSync(path.join(origin, "README.md"), "two\n");
    run(origin, ["commit", "--quiet", "-am", "two"]);
    writeConfig(workspace, clone);

    const result = refreshProject("sample", { workspacePath: workspace });
    expect(result.refused).toBeNull();
    expect(result.advanced).toBe(true);
    expect(result.restarted).toBe(true);
    expect(result.output).toContain("ran restart");
    expect(run(clone, ["rev-parse", "HEAD"])).toBe(run(origin, ["rev-parse", "HEAD"]));
  });

  it("refuses a dirty tree before touching anything", () => {
    const { clone, workspace } = repoPair();
    writeFileSync(path.join(clone, "README.md"), "uncommitted\n");
    writeConfig(workspace, clone);

    const result = refreshProject("sample", { workspacePath: workspace });
    expect(result.refused).toBe("dirty");
    expect(result.fetched).toBe(false);
    // The edit is still there: refusing means refusing, not stashing.
    expect(repoFreshness({ repoPath: clone, baseBranch: "main" }).dirty).toBe(true);
  });

  it("refuses when the checkout is on another branch", () => {
    const { clone, workspace } = repoPair();
    run(clone, ["checkout", "--quiet", "-b", "feature"]);
    writeConfig(workspace, clone);
    expect(refreshProject("sample", { workspacePath: workspace }).refused).toBe("wrong-branch");
  });

  it("refuses to fast-forward past local commits the remote does not have", () => {
    const { clone, workspace } = repoPair();
    writeFileSync(path.join(clone, "local.md"), "mine\n");
    run(clone, ["add", "."]);
    run(clone, ["commit", "--quiet", "-m", "unpushed"]);
    writeConfig(workspace, clone);

    const result = refreshProject("sample", { workspacePath: workspace });
    expect(result.refused).toBe("diverged");
    // The unpushed commit survives.
    expect(run(clone, ["log", "-1", "--format=%s"])).toBe("unpushed");
  });

  it("advances without restarting when the project ships no service script", () => {
    const { origin, clone, workspace } = repoPair();
    writeFileSync(path.join(origin, "README.md"), "two\n");
    run(origin, ["commit", "--quiet", "-am", "two"]);
    writeConfig(workspace, clone);

    const result = refreshProject("sample", { workspacePath: workspace });
    expect(result.refused).toBeNull();
    expect(result.advanced).toBe(true);
    expect(result.restarted).toBe(false);
    expect(result.message).toContain("scripts/services.sh");
  });

  it("refuses an unknown project rather than guessing", () => {
    const { workspace, clone } = repoPair();
    writeConfig(workspace, clone);
    expect(refreshProject("not-a-project", { workspacePath: workspace }).refused).toBe("unknown-project");
  });
});
