import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNeutralCwd, createProject, createTempConfigPath, initializedWorkspace, parseJson, runCli, cleanupTrackedPaths } from "./cli-response-fixture.js";

afterEach(cleanupTrackedPaths);

describe("CLI response contract — projects and metadata", () => {
  it("emits JSON success for project list", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["project", "list", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.list");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.projects).toEqual([]);
  });

  it("defaults workspace commands from ARCADIA_WORKSPACE", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["project", "list", "--json"], { ARCADIA_WORKSPACE: workspace });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.list");
    expect(json.workspace).toBe(path.resolve(workspace));
  });

  it("lets explicit --workspace override ARCADIA_WORKSPACE", () => {
    const envWorkspace = initializedWorkspace();
    const explicitWorkspace = initializedWorkspace();
    createProject(explicitWorkspace);

    const result = runCli(
      ["project", "list", "--workspace", explicitWorkspace, "--json"],
      { ARCADIA_WORKSPACE: envWorkspace }
    );

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.workspace).toBe(path.resolve(explicitWorkspace));
    expect(json.data.projects).toHaveLength(1);
  });

  it("sets, gets, and uses the persistent default workspace", () => {
    const workspace = initializedWorkspace();
    const configPath = createTempConfigPath();
    const neutralCwd = createNeutralCwd();

    const set = runCli(["config", "set", "defaultWorkspace", workspace, "--json"], {}, { configPath, cwd: neutralCwd });
    expect(set.status).toBe(0);
    expect(parseJson(set.stdout).data.defaultWorkspace).toBe(path.resolve(workspace));

    const get = runCli(["config", "get", "defaultWorkspace", "--json"], {}, { configPath, cwd: neutralCwd });
    expect(get.status).toBe(0);
    expect(parseJson(get.stdout).data.defaultWorkspace).toBe(path.resolve(workspace));

    const listed = runCli(["project", "list", "--json"], {}, { configPath, cwd: neutralCwd });
    expect(listed.status).toBe(0);
    expect(parseJson(listed.stdout).workspace).toBe(path.resolve(workspace));
  });

  it("reports workspace resolution source precedence", () => {
    const userWorkspace = initializedWorkspace();
    const localWorkspace = initializedWorkspace();
    const envWorkspace = initializedWorkspace();
    const explicitWorkspace = initializedWorkspace();
    const configPath = createTempConfigPath();
    const neutralCwd = createNeutralCwd();
    const nested = path.join(localWorkspace, "projects", "nested");
    mkdirSync(nested, { recursive: true });

    expect(runCli(["config", "set", "defaultWorkspace", userWorkspace], {}, { configPath }).status).toBe(0);

    const user = parseJson(runCli(["workspace", "resolve", "--json"], {}, { configPath, cwd: neutralCwd }).stdout);
    expect(user.data.source).toBe("user config");
    expect(user.data.workspacePath).toBe(path.resolve(userWorkspace));

    const local = parseJson(runCli(["workspace", "resolve", "--json"], {}, { configPath, cwd: nested }).stdout);
    expect(local.data.source).toBe("local marker");
    expect(local.data.workspacePath).toBe(realpathSync(localWorkspace));

    const env = parseJson(runCli(["workspace", "resolve", "--json"], { ARCADIA_WORKSPACE: envWorkspace }, { configPath, cwd: nested }).stdout);
    expect(env.data.source).toBe("environment variable");
    expect(env.data.workspacePath).toBe(path.resolve(envWorkspace));

    const explicit = parseJson(
      runCli(
        ["workspace", "resolve", "--workspace", explicitWorkspace, "--json"],
        { ARCADIA_WORKSPACE: envWorkspace },
        { configPath, cwd: nested }
      ).stdout
    );
    expect(explicit.data.source).toBe("flag");
    expect(explicit.data.workspacePath).toBe(path.resolve(explicitWorkspace));
  }, 20_000);

  it("imports projects with JSON output", () => {
    const workspace = initializedWorkspace();

    const result = runCli([
      "project",
      "import",
      "--workspace",
      workspace,
      "--name",
      "Rebuster",
      "--mission",
      "Help users turn product evidence into better shipping decisions.",
      "--outcome",
      "Ship Pinterest support.",
      "--milestone",
      "Pinterest publishing support",
      "--next-action",
      "Define Pinterest posting support boundaries.",
      "--responsibility",
      "agent",
      "--expected-artifact",
      "Pinterest implementation plan",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.import");
    expect(json.data.project.name).toBe("Rebuster");
    expect(json.data.project.status).toBe("active");
    expect(json.data.project.goal).toBe("Ship Pinterest support.");
    expect(json.data.project.outcome).toBe("Ship Pinterest support.");
    expect(json.data.milestone.title).toBe("Pinterest publishing support");
    expect(json.data.workItem.next_action).toBe("Define Pinterest posting support boundaries.");
    expect(json.data.workItem.work_classification).toBe("agent");
    expect(json.data.workItem.responsibility).toBe("agent");
  });

  it("keeps legacy project goal and classification flags working", () => {
    const workspace = initializedWorkspace();

    const result = runCli([
      "project",
      "import",
      "--workspace",
      workspace,
      "--name",
      "Legacy Flags",
      "--mission",
      "Keep old automation working.",
      "--goal",
      "Accept legacy project goal input.",
      "--milestone",
      "Compatibility",
      "--next-action",
      "Run compatibility smoke.",
      "--classification",
      "autonomous",
      "--json"
    ]);

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.data.project.goal).toBe("Accept legacy project goal input.");
    expect(json.data.project.outcome).toBe("Accept legacy project goal input.");
    expect(json.data.workItem.work_classification).toBe("autonomous");
    expect(json.data.workItem.responsibility).toBe("autonomous");
  });

  it("rejects conflicting canonical and legacy semantic flags", () => {
    const workspace = initializedWorkspace();

    const outcomeConflict = runCli([
      "project",
      "update",
      createProject(workspace).project.id,
      "--workspace",
      workspace,
      "--goal",
      "Legacy",
      "--outcome",
      "Canonical",
      "--json"
    ]);
    expect(outcomeConflict.status).toBe(2);
    expect(parseJson(outcomeConflict.stderr).error.message).toContain("Use only one of --goal or --outcome.");

    const responsibilityConflict = runCli([
      "work",
      "update",
      createProject(workspace).workItem.id,
      "--workspace",
      workspace,
      "--classification",
      "agent",
      "--responsibility",
      "autonomous",
      "--json"
    ]);
    expect(responsibilityConflict.status).toBe(2);
    expect(parseJson(responsibilityConflict.stderr).error.message).toContain(
      "Use only one of --classification or --responsibility."
    );
  });

  it("creates a project when the workspace is supplied as the second positional argument", () => {
    const workspace = initializedWorkspace();

    const result = runCli(["project", "create", "Boring Defaults", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.create");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.project.name).toBe("Boring Defaults");
    expect(json.data.projectPath).toBe(path.join(path.resolve(workspace), "projects", "boring-defaults"));
    expect(existsSync(path.join(path.resolve(workspace), "projects", "boring-defaults", "PROJECT.md"))).toBe(true);
  });

});
