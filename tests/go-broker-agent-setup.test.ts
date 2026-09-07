import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runGoBrokerStatusCommand } from "../src/commands/goBrokerInstall.js";
import {
  configureGoBrokerAgents,
  inspectGoBrokerAgentSetup,
  removeArcadiaGoRules,
  resolveAgentSetupPaths
} from "../src/agentSetup/goBrokerAgentSetup.js";

const roots: string[] = [];
const template = readFileSync(path.resolve(import.meta.dirname, "../src/agentSetup/arcadia-go.SKILL.md"), "utf8");
const agentAskTemplate = readFileSync(path.resolve(import.meta.dirname, "../src/agentSetup/arcadia-agent-ask.SKILL.md"), "utf8");

afterEach(() => {
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
    expect(codexConfig).toContain('sandbox_mode = "workspace-write"');
    expect(codexConfig).toContain('model = "gpt-test"');
    expect(codexConfig).toContain("[features]\nvoice = true");
    const defaultRules = readFileSync(path.join(paths.codexRulesDirectory, "default.rules"), "utf8");
    expect(defaultRules).toContain('["git", "status"]');
    expect(defaultRules).not.toContain("arcadia");
    expect(readFileSync(paths.codexManagedRules, "utf8")).toContain(fixture.executables.go.codex);
    expect(readFileSync(paths.codexSkill, "utf8")).toContain(fixture.executables.go.codex);
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
      `Bash(${fixture.executables.go.claude})`,
      `Bash(${fixture.executables.advance.claude})`,
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
    expect(unattended).toContain('approval_policy = "never"');
    expect(unattended).toContain(
      `writable_roots = ["/keep/codex-root", "${path.join(fixture.home, ".codex", "worktrees")}", "${path.join(fixture.home, ".claude", "worktrees")}"]`
    );

    const second = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate,
      now: new Date("2026-09-06T12:35:56.000Z")
    });
    expect(second).toMatchObject({ changed: [], backups: [], status: { ready: true } });
  });

  it("keeps interactive approval and unattended approval independent of sandbox roots", () => {
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
    expect(readFileSync(resolveAgentSetupPaths(fixture.home).codexConfig, "utf8")).toContain('approval_policy = "on-request"');
    expect(readFileSync(profile, "utf8")).toContain('approval_policy = "never"');
    expect(readFileSync(profile, "utf8")).toContain('sandbox_mode = "workspace-write"');
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
    write(profile, 'approval_policy = "never"\nsandbox_mode = "workspace-write"\n\n[sandbox_workspace_write]\nwritable_roots = []\n');

    const status = inspectGoBrokerAgentSetup({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(status.ready).toBe(false);
    expect(status.issues).toContain("codexProfile:arcadia-unattended.sandbox_workspace_write.writable_roots");
  });

  it("reports a present empty profile instead of treating it as absent", () => {
    const fixture = createFixture();
    const profile = path.join(fixture.home, ".codex", "codex_build.config.toml");
    write(profile, "");

    const status = inspectGoBrokerAgentSetup({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(status.ready).toBe(false);
    expect(status.issues).toEqual(expect.arrayContaining([
      "codexProfile:codex_build.approval_policy",
      "codexProfile:codex_build.sandbox_mode",
      "codexProfile:codex_build.sandbox_workspace_write.writable_roots"
    ]));
  });

  it("does not create the optional unattended profile when it is absent", () => {
    const fixture = createFixture();
    const profile = path.join(fixture.home, ".codex", "arcadia-unattended.config.toml");

    const result = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      agentAskSkillTemplate: agentAskTemplate
    });

    expect(result.status.ready).toBe(true);
    expect(existsSync(profile)).toBe(false);
    expect(result.changed).not.toContain(profile);
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
    expect(configured).toContain(
      `writable_roots = ["/keep/codex-root", "${path.join(fixture.home, ".codex", "worktrees")}", "${path.join(fixture.home, ".claude", "worktrees")}"]`
    );
    expect(configured).toContain("[features]\nmulti_agent = true");
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

  it("refuses duplicate sandbox tables before changing any other setup", () => {
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
    })).toThrow("duplicate [sandbox_workspace_write] tables");
    expect(existsSync(paths.codexManagedRules)).toBe(false);
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

  it("makes an incomplete status check fail automation", () => {
    const fixture = createFixture(false);
    expect(() => runGoBrokerStatusCommand({
      home: fixture.home,
      repository: path.resolve(import.meta.dirname, "..")
    })).toThrow("Protected broker setup is not ready");
  });
});

function createFixture(withExecutables = true): { home: string; executables: { go: { codex: string; claude: string }; advance: { codex: string; claude: string }; workMonitor: { codex: string; claude: string } } } {
  const home = mkdtempSync(path.join(tmpdir(), "arcadia-agent-setup-"));
  roots.push(home);
  const executables = {
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
