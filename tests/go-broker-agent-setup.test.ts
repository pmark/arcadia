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
    expect(readFileSync(paths.codexManagedRules, "utf8")).toContain(fixture.executables.codex);
    expect(readFileSync(paths.codexSkill, "utf8")).toContain(fixture.executables.codex);
    expect(lstatSync(paths.claudeSkill).isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(paths.claudeSkill), readlinkSync(paths.claudeSkill))).toBe(paths.codexSkillDirectory);
    const claude = JSON.parse(readFileSync(paths.claudeSettings, "utf8"));
    expect(claude.permissions.allow).toEqual([
      "Bash(git status)",
      `Bash(${fixture.executables.claude})`
    ]);
    expect(claude.permissions.additionalDirectories).toEqual([
      "/keep/me",
      path.join(fixture.home, ".codex", "worktrees"),
      path.join(fixture.home, ".claude", "worktrees")
    ]);
    expect(claude.permissions.disableBypassPermissionsMode).toBe("disable");
    expect(claude.sandbox).toEqual({ enabled: true, failIfUnavailable: true });
    expect(claude.statusLine.command).toBe("keep-this");

    const second = configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template,
      now: new Date("2026-09-06T12:35:56.000Z")
    });
    expect(second).toMatchObject({ changed: [], backups: [], status: { ready: true } });
  });

  it("validates every user-owned format before writing anything", () => {
    const fixture = createFixture();
    const paths = resolveAgentSetupPaths(fixture.home);
    write(paths.codexConfig, 'model = "keep"\n');
    write(paths.claudeSettings, "{ invalid json\n");

    expect(() => configureGoBrokerAgents({
      home: fixture.home,
      executables: fixture.executables,
      skillTemplate: template
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
      skillTemplate: template
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

function createFixture(withExecutables = true): { home: string; executables: { codex: string; claude: string } } {
  const home = mkdtempSync(path.join(tmpdir(), "arcadia-agent-setup-"));
  roots.push(home);
  const executables = {
    codex: path.join(home, ".local", "bin", "arcadia-go-broker-codex"),
    claude: path.join(home, ".local", "bin", "arcadia-go-broker-claude")
  };
  if (withExecutables) {
    write(executables.codex, "broker\n");
    write(executables.claude, "broker\n");
  }
  return { home, executables };
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
