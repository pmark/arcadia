import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criteriaValidationCommands, validateCompletionCandidate } from "../src/sessions/completionValidation.js";
import { headlessClaudeAllowList } from "../src/sessions/headlessPermissions.js";
import { runOwnedValidation } from "../src/sessions/preservationProcessLifecycle.js";
import { dependencyRequiringPreservationCheck } from "../src/sessions/preservationChecks.js";

vi.mock("../src/sessions/preservationProcessLifecycle.js", () => ({ runOwnedValidation: vi.fn() }));

const preservation = "node scripts/preservation-self-check.mjs";
const required = ["pnpm lint", "pnpm exec tsc --noEmit"];
const roots: string[] = [];
let failCommand: string | null = null;

beforeEach(() => {
  failCommand = null;
  vi.mocked(runOwnedValidation).mockReset().mockImplementation(({ argv }) => {
    const report = argv.find((arg) => arg.startsWith("--test-reporter-destination="));
    if (report) writeFileSync(report.slice("--test-reporter-destination=".length), "TAP version 13\nok 1 - fixture\n# pass 1\n# fail 0\n");
    return { status: argv.at(-1) === failCommand ? 1 : 0, signal: null, stdout: "", stderr: "", timedOut: false, terminalProven: true, error: null };
  });
});
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function candidate() {
  const root = mkdtempSync(path.join(tmpdir(), "criteria-validation-"));
  roots.push(root);
  const repository = path.join(root, "repo"), workspace = path.join(root, "workspace");
  mkdirSync(path.join(repository, "tests"), { recursive: true });
  mkdirSync(workspace);
  writeFileSync(path.join(repository, "package.json"), JSON.stringify({ name: "fixture", scripts: { lint: "echo fixture" } }));
  writeFileSync(path.join(repository, "tests/ready.test.js"), "// fixture, execution is replaced by the owned-validator mock\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("add", "."); git("commit", "-qm", "fixture");
  return { repository, worktree: repository, workspace, base: git("rev-parse", "HEAD"), commands: ["true"], acceptanceCriteria: ["tests/ready.test.js, pnpm lint and tsc pass."] };
}

describe("criteria-required checks", () => {
  it.each(["tests/native-mail.test.ts", "tests/launch-preview.test.ts", "tests/agent-guidance.test.ts"])("permits exactly the required commands for %s", (file) => {
    const criteria = [`The change touches only ${file}; the focused vitest run of that file, pnpm lint and tsc pass.`];
    expect(criteriaValidationCommands(criteria)).toEqual(required);
    const rules = headlessClaudeAllowList([preservation], null, criteria);
    expect(rules).toContain("Bash(pnpm lint)");
    expect(rules).toContain("Bash(pnpm exec tsc --noEmit)");
    expect(rules).not.toContain("Bash(pnpm lint *)");
    expect(rules).not.toContain("Bash(pnpm exec tsc --noEmit *)");
    expect(rules).not.toContain("Bash(pnpm:*)");
    expect(rules).toContain(`Bash(${preservation})`);
  });

  it.each([
    ["pnpm lint and tsc pass, but no test file is named."],
    ["tests/ready.test.js passes; do not run pnpm lint or tsc."],
    ["tests/ready.test.js passes; pnpm lint and tsc are optional."],
    ["tests/ready.test.js and pnpm lint:fix pass."],
    ["tests/ready.test.js passes; arbitrary shell commands are required."],
    ["tests/tsc.test.ts passes."],
    ["tests/ready.test.js passes; pnpm lint; touch marker and tsc --watch pass."]
  ])("grants no extra command for unsupported or negative criteria %j", (criterion) => {
    expect(criteriaValidationCommands([criterion])).toEqual([]);
  });

  it("keeps preservation dependency rejection unchanged", () => {
    expect(dependencyRequiringPreservationCheck([preservation])).toBeNull();
    expect(dependencyRequiringPreservationCheck([preservation, ...required])).toMatchObject({ tool: "pnpm" });
  });

  it.each(required)("a failing required %s check blocks host completion", (command) => {
    failCommand = command;
    const result = validateCompletionCandidate(candidate(), { unconfinedForTests: true });
    expect(result).toMatchObject({ status: "refused", failures: [command] });
    expect(vi.mocked(runOwnedValidation).mock.calls.some(([call]) => call.argv.at(-1) === command)).toBe(true);
  });

  it("proves both required commands and the named test before accepting completion", () => {
    const result = validateCompletionCandidate(candidate(), { unconfinedForTests: true });
    expect(result).toMatchObject({ status: "passed", commands: ["true", ...required] });
    expect(vi.mocked(runOwnedValidation).mock.calls.some(([call]) => call.argv.includes("--test"))).toBe(true);
  });

  it("refuses a candidate that changes the lint script definition", () => {
    const input = candidate();
    writeFileSync(path.join(input.repository, "package.json"), JSON.stringify({ name: "fixture", scripts: { lint: "true" } }));
    expect(validateCompletionCandidate(input, { unconfinedForTests: true })).toMatchObject({ status: "refused", reason: expect.stringContaining("captured for validation") });
    expect(runOwnedValidation).not.toHaveBeenCalled();
  });
});
