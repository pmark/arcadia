import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { renderGoBrokerStatusSuccess, runGoBrokerStatusCommand } from "../src/commands/goBrokerInstall.js";
import {
  configureGoBrokerAgents,
  inspectGoBrokerAgentSetup,
  removeArcadiaGoRules,
  resolveAgentSetupPaths
} from "../src/agentSetup/goBrokerAgentSetup.js";

import { requestCandidatePreservation } from "../src/sessions/preservationTransport.js";

const roots: string[] = [];
const template = readFileSync(path.resolve(import.meta.dirname, "../src/agentSetup/arcadia-go.SKILL.md"), "utf8");
const agentAskTemplate = readFileSync(path.resolve(import.meta.dirname, "../src/agentSetup/arcadia-agent-ask.SKILL.md"), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("go broker agent setup", () => {
  it("converges a mixed existing installation without disturbing unrelated configuration", () => {
    const fixture = createFixture();
    const paths = resolveAgentSetupPaths(fixture.home);
    write(paths.codexConfig, 'model = "gpt-test"\n\n[features]\nvoice = true\n');
    write(
      path.join(paths.codexRulesDirectory, "default.rules"),
      [
        'prefix_rule(pattern=["git", "status"], decision="allow")',
        "prefix_rule(",
        '  pattern = ["arcadia", "go", "--apply", "--agent", ["codex", "claude"]],',
        '  decision = "allow",',
        ")",
        'prefix_rule(pattern=["/old/arcadia-go-broker-codex"], decision="allow")',
        ""
      ].join("\n")
    );
    write(paths.codexSkill, "operator-authored old skill\n");
    write(path.join(paths.claudeSkill, "SKILL.md"), "separate Claude skill\n");
    write(
      paths.claudeSettings,
      `${JSON.stringify({
        permissions: {
          allow: [
            "Bash(git status)",
            "Bash(arcadia go --apply --agent claude *)",
            "Bash(mise exec -- pnpm arcadia go --apply --agent claude *)"
          ],
          additionalDirectories: ["/keep/me"]
        },
        sandbox: { enabled: false },
        statusLine: { type: "command", command: "keep-this" }
      }, null, 2)}\n`
    );

    const first = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate,
      now: new Date("2026-09-06T12:34:56.000Z")
    });

    expect(first.status.ready).toBe(true);
    expect(first.backups.length).toBeGreaterThanOrEqual(4);
    const codexConfig = readFileSync(paths.codexConfig, "utf8");
    expect(codexConfig).toContain('approval_policy = "on-request"');
    expect(codexConfig).toContain('default_permissions = "arcadia-unattended"');
    expect(codexConfig).not.toContain('sandbox_mode = "workspace-write"');
    expect(codexConfig).toContain("[permissions.arcadia-unattended]");
    expect(codexConfig).toContain('".env" = "deny"');
    expect(codexConfig).toContain('model = "gpt-test"');
    expect(codexConfig).toContain("[features]\nvoice = true");
    const defaultRules = readFileSync(path.join(paths.codexRulesDirectory, "default.rules"), "utf8");
    expect(defaultRules).toContain('["git", "status"]');
    expect(defaultRules).not.toContain("arcadia");
    expect(readFileSync(paths.codexManagedRules, "utf8")).not.toContain(fixture.executables.go.codex);
    expect(readFileSync(paths.codexSkill, "utf8")).not.toContain(fixture.executables.go.codex);
    expect(readFileSync(paths.codexSkill, "utf8")).toContain(fixture.executables.advance.codex);
    expect(readFileSync(paths.codexSkill, "utf8")).toContain(fixture.executables.workMonitor.codex);
    expect(readFileSync(paths.codexAgentAskSkill, "utf8")).toContain("Do not ask the operator for permission");
    expect(lstatSync(paths.claudeSkill).isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(paths.claudeSkill), readlinkSync(paths.claudeSkill))).toBe(paths.codexSkillDirectory);
    expect(lstatSync(paths.claudeAgentAskSkill).isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(paths.claudeAgentAskSkill), readlinkSync(paths.claudeAgentAskSkill))).toBe(paths.codexAgentAskSkillDirectory);
    const claude = JSON.parse(readFileSync(paths.claudeSettings, "utf8"));
    expect(claude.permissions.allow).toEqual([
      "Bash(git status)",
      `Bash(${fixture.executables.advance.claude})`,
      `Bash(${fixture.executables.preserve.claude})`,
      `Bash(${fixture.executables.workMonitor.claude})`
    ]);
    expect(claude.permissions.additionalDirectories).toEqual([
      "/keep/me",
      path.join(fixture.home, ".codex", "worktrees"),
      path.join(fixture.home, ".claude", "worktrees")
    ]);
    expect(claude.permissions.disableBypassPermissionsMode).toBe("disable");
    expect(claude.sandbox).toEqual({ enabled: true, failIfUnavailable: true });
    expect(claude.statusLine.command).toBe("keep-this");

    write(
      path.join(fixture.home, ".codex", "arcadia-unattended.config.toml"),
      [
        'approval_policy = "never"',
        'sandbox_mode = "workspace-write"',
        "",
        "[sandbox_workspace_write]",
        'writable_roots = ["/keep/codex-root"]',
        "",
        "[features]",
        "multi_agent = true",
        ""
      ].join("\n")
    );

    const withProfile = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate,
      now: new Date("2026-09-06T12:36:56.000Z")
    });
    expect(withProfile.status.ready).toBe(true);
    const unattended = readFileSync(path.join(fixture.home, ".codex", "arcadia-unattended.config.toml"), "utf8");
    expect(unattended).toContain("Retired by `arcadia go-broker install`");
    expect(readFileSync(paths.codexConfig, "utf8")).toContain(`[permissions.arcadia-unattended.workspace_roots]`);

    const second = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate,
      now: new Date("2026-09-06T12:35:56.000Z")
    });
    expect(second).toMatchObject({ changed: [], backups: [], status: { ready: true } });
  });

  it("migrates the legacy unattended layer to the native Desktop permission profile", () => {
    const fixture = createFixture();
    const profile = path.join(fixture.home, ".codex", "arcadia-unattended.config.toml");
    write(profile, 'approval_policy = "never"\nsandbox_mode = "workspace-write"\n');

    const result = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(result.status.ready).toBe(true);
    const config = readFileSync(resolveAgentSetupPaths(fixture.home).codexConfig, "utf8");
    expect(config).toContain('approval_policy = "on-request"');
    expect(config).toContain('default_permissions = "arcadia-unattended"');
    expect(config).toContain("[permissions.arcadia-unattended]");
    expect(readFileSync(profile, "utf8")).toContain("Retired by `arcadia go-broker install`");
  });

  it("reports the named profile when its required roots are missing", () => {
    const fixture = createFixture();
    const profile = path.join(fixture.home, ".codex", "arcadia-unattended.config.toml");
    write(profile, 'approval_policy = "never"\nsandbox_mode = "workspace-write"\n');
    configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });
    const config = resolveAgentSetupPaths(fixture.home).codexConfig;
    write(config, readFileSync(config, "utf8").replace(/^.*\.codex\/worktrees.*\n/m, "").replace(/^.*\.claude\/worktrees.*\n/m, ""));

    const status = inspectGoBrokerAgentSetup({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(status.ready).toBe(false);
    expect(status.issues).toContain("codexNativeProfile");
  });

  it("does not mistake unrelated CLI profile layers for the native Desktop permission profile", () => {
    const fixture = createFixture();
    const profile = path.join(fixture.home, ".codex", "codex_build.config.toml");
    write(profile, "");

    const status = inspectGoBrokerAgentSetup({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(status.issues).not.toEqual(expect.arrayContaining(["codexProfile:codex_build.approval_policy"]));
  });

  it("creates the required native unattended profile in the shared Codex configuration", () => {
    const fixture = createFixture();
    const profile = path.join(fixture.home, ".codex", "arcadia-unattended.config.toml");

    const result = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(result.status.ready).toBe(true);
    expect(readFileSync(resolveAgentSetupPaths(fixture.home).codexConfig, "utf8")).toContain("[permissions.arcadia-unattended]");
    expect(result.changed).toContain(resolveAgentSetupPaths(fixture.home).codexConfig);
  });

  it("preserves roots from a multiline profile array while adding both required roots", () => {
    const fixture = createFixture();
    const profile = path.join(fixture.home, ".codex", "codex_build.config.toml");
    write(profile, [
      'approval_policy = "on-request"',
      'sandbox_mode = "workspace-write"',
      "",
      "[sandbox_workspace_write]",
      "writable_roots = [",
      '  "/keep/codex-root",',
      "]",
      "",
      "[features]",
      "multi_agent = true",
      ""
    ].join("\n"));

    const result = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(result.status.ready).toBe(true);
    const configured = readFileSync(profile, "utf8");
    expect(configured).toContain('writable_roots = [');
    expect(configured).toContain("[features]\nmulti_agent = true");
    expect(readFileSync(resolveAgentSetupPaths(fixture.home).codexConfig, "utf8")).toContain(`[permissions.arcadia-unattended.workspace_roots]`);
  });

  it("accepts multiline and literal-string roots in status", () => {
    const fixture = createFixture();
    const profile = path.join(fixture.home, ".codex", "codex_build.config.toml");
    write(profile, 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n');
    configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });
    const paths = resolveAgentSetupPaths(fixture.home);
    const configured = readFileSync(profile, "utf8");
    write(profile, configured.replace(
      /writable_roots = \[[^\]]*\]/,
      [
        "writable_roots = [",
        "  '/keep/codex-root',",
        `  '${path.join(fixture.home, ".codex", "worktrees")}',`,
        `  '${path.join(fixture.home, ".claude", "worktrees")}'`,
        "]"
      ].join("\n")
    ));

    const status = inspectGoBrokerAgentSetup({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(status.ready).toBe(true);
    expect(status.paths.codexConfig).toBe(paths.codexConfig);
  });

  it("retires duplicate legacy sandbox tables before changing other setup", () => {
    const fixture = createFixture();
    const paths = resolveAgentSetupPaths(fixture.home);
    write(
      paths.codexConfig,
      [
        "[sandbox_workspace_write]",
        'writable_roots = ["/one"]',
        "",
        "[sandbox_workspace_write]",
        'writable_roots = ["/two"]',
        ""
      ].join("\n")
    );

    expect(() => configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    })).not.toThrow();
    expect(readFileSync(paths.codexConfig, "utf8")).not.toContain("[sandbox_workspace_write]");
  });

  it("validates every user-owned format before writing anything", () => {
    const fixture = createFixture();
    const paths = resolveAgentSetupPaths(fixture.home);
    write(paths.codexConfig, 'model = "keep"\n');
    write(paths.claudeSettings, "{ invalid json\n");

    expect(() => configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    })).toThrow(ArcadiaError);

    expect(readFileSync(paths.codexConfig, "utf8")).toBe('model = "keep"\n');
    expect(readFileSync(paths.claudeSettings, "utf8")).toBe("{ invalid json\n");
    expect(existsSync(paths.codexManagedRules)).toBe(false);
  });

  it("removes only Arcadia go and broker prefix rules", () => {
    const input = [
      '# prefix_rule(pattern=["arcadia", "go"], decision="allow")',
      'prefix_rule(pattern=["git", "status"], decision="allow")',
      "prefix_rule(",
      '  pattern = ["mise", "exec", "--", "pnpm", "arcadia", "go", "--apply"],',
      '  decision = "allow",',
      '  justification = "parentheses (inside a string) stay balanced",',
      ")",
      ""
    ].join("\n");

    const output = removeArcadiaGoRules(input);

    expect(output).toContain('# prefix_rule(pattern=["arcadia", "go"], decision="allow")');
    expect(output).toContain('prefix_rule(pattern=["git", "status"], decision="allow")');
    expect(output).not.toContain('"mise", "exec"');
  });

  it("does not allow sandboxed agents to invoke the Git-mutating go controller", () => {
    const fixture = createFixture();

    configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    const rules = readFileSync(resolveAgentSetupPaths(fixture.home).codexManagedRules, "utf8");
    const claude = JSON.parse(readFileSync(resolveAgentSetupPaths(fixture.home).claudeSettings, "utf8")) as {
      permissions: { allow: string[] };
    };
    expect(rules).not.toContain(fixture.executables.go.codex);
    expect(claude.permissions.allow).not.toContain(`Bash(${fixture.executables.go.claude})`);
    expect(rules).toContain(fixture.executables.preserve.codex);
    expect(rules).toContain(fixture.executables.advance.codex);
    expect(rules).toContain(fixture.executables.workMonitor.codex);
  });

  it("reports a stale Claude go-controller permission as unsafe", () => {
    const fixture = createFixture();
    configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });
    const settingsPath = resolveAgentSetupPaths(fixture.home).claudeSettings;
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { permissions: { allow: string[] } };
    settings.permissions.allow.push(`Bash(${fixture.executables.go.claude})`);
    write(settingsPath, `${JSON.stringify(settings)}\n`);

    const status = inspectGoBrokerAgentSetup({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });
    expect(status.issues).toContain("noLegacyClaudePermissions");
  });

  it("reports every missing new-device component without mutating it", () => {
    const fixture = createFixture(false);
    const status = inspectGoBrokerAgentSetup({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(status.ready).toBe(false);
    expect(status.issues).toEqual(expect.arrayContaining([
      "brokerExecutables",
      "codexGuardrails",
      "codexRule",
      "managedSkill",
      "sharedClaudeSkill",
      "claudePermission",
      "claudeSandbox",
      "claudeBypassDisabled",
      "claudeWorktreeDirectories"
    ]));
  });

  it("reports worker downtime separately from a correct install and refuses actual requests", async () => {
    const fixture = createInstalledFixture();
    vi.stubEnv("ARCADIA_WORKSPACE", fixture.home);
    const result = runGoBrokerStatusCommand({ home: fixture.home, repository: path.resolve(import.meta.dirname, "..") });
    expect(result.data).toMatchObject({
      ready: true,
      brokerIssues: [],
      agentSetup: { ready: true, checks: { preservationLauncher: true } },
      preservationTransport: { ready: false, detail: expect.stringContaining("start the updated host worker") }
    });
    expect(renderGoBrokerStatusSuccess(result)).toEqual(expect.arrayContaining([
      "Protected broker setup: READY",
      expect.stringContaining("Preservation transport: NOT READY")
    ]));
    await expect(requestCandidatePreservation(fixture.home)).rejects.toThrow("Protected preservation request path is unavailable");
    expect(existsSync(path.join(fixture.home, ".arcadia-preserve-request"))).toBe(false);
  });

  it("still refuses a missing preserve launcher on an otherwise correct install", () => {
    const fixture = createInstalledFixture();
    vi.stubEnv("ARCADIA_WORKSPACE", fixture.home);
    rmSync(fixture.executables.preserve.codex);
    expect(() => runGoBrokerStatusCommand({ home: fixture.home, repository: path.resolve(import.meta.dirname, "..") }))
      .toThrow(expect.objectContaining({
        message: "Protected broker setup is not ready.",
        details: expect.objectContaining({ ready: false, checks: expect.objectContaining({ preservationLauncher: false }) })
      }));
  });

  it("makes an incomplete status check fail automation", () => {
    const fixture = createFixture(false);
    expect(() => runGoBrokerStatusCommand({
      home: fixture.home,
      repository: path.resolve(import.meta.dirname, "..")
    })).toThrow("Protected broker setup is not ready");
  });
});

function createFixture(withExecutables = true) {
  const home = mkdtempSync(path.join(tmpdir(), "arcadia-agent-setup-"));
  roots.push(home);
  const executables = {
    preserve: { codex: path.join(home, ".local", "bin", "arcadia-preserve-broker-codex"), claude: path.join(home, ".local", "bin", "arcadia-preserve-broker-claude") },
    go: {
      codex: path.join(home, ".local", "bin", "arcadia-go-broker-codex"),
      claude: path.join(home, ".local", "bin", "arcadia-go-broker-claude")
    },
    advance: {
      codex: path.join(home, ".local", "bin", "arcadia-advance-broker-codex"),
      claude: path.join(home, ".local", "bin", "arcadia-advance-broker-claude")
    },
    workMonitor: {
      codex: path.join(home, ".local", "bin", "arcadia-work-monitor-broker-codex"),
      claude: path.join(home, ".local", "bin", "arcadia-work-monitor-broker-claude")
    }
  };
  if (withExecutables) {
    for (const providers of Object.values(executables)) {
      write(providers.codex, "broker\n");
      write(providers.claude, "broker\n");
    }
  }
  return { home, executables };
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function createInstalledFixture() {
  const fixture = createFixture(false);
  const release = path.join(fixture.home, ".local", "share", "arcadia", "test-revision");
  const brokerEntrypoint = path.join(release, "dist", "scripts", "arcadia-go-broker.js");
  write(brokerEntrypoint, "// fixture runtime\n");
  write(path.join(release, "dist", "database", "schema.sql"), "-- fixture schema\n");
  write(path.join(release, "broker-manifest.json"), JSON.stringify({
    schema: "arcadia-go-broker-install-v1", revision: "test-revision", brokerEntrypoint
  }));
  for (const providers of Object.values(fixture.executables)) {
    for (const executable of Object.values(providers)) {
      const target = path.join(release, path.basename(executable));
      write(target, "#!/bin/sh\n");
      mkdirSync(path.dirname(executable), { recursive: true });
      symlinkSync(target, executable);
    }
  }
  configureGoBrokerAgents({
    ...fixture, skillTemplate: template, agentAskSkillTemplate: agentAskTemplate
  });
  return fixture;
}
