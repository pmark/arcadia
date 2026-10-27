import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criteriaValidationCommands, validateCompletionCandidate } from "../src/sessions/completionValidation.js";
import { readCompletionEvidence, type CompletionEvidenceReference } from "../src/sessions/completionValidationEvidence.js";
import { headlessClaudeAllowList } from "../src/sessions/headlessPermissions.js";
import { runOwnedValidation } from "../src/sessions/preservationProcessLifecycle.js";
import { dependencyRequiringPreservationCheck } from "../src/sessions/preservationChecks.js";

vi.mock("../src/sessions/preservationProcessLifecycle.js", () => ({ runOwnedValidation: vi.fn() }));

const preservation = "node scripts/preservation-self-check.mjs";
const required = ["pnpm lint", "pnpm exec tsc --noEmit"];
const roots: string[] = [];
const checkCommand = (argv: string[]) => argv.at(-1) === "echo fixture" ? "pnpm lint" : argv.at(-1) === "--noEmit" ? "pnpm exec tsc --noEmit" : argv.at(-1);
let failCommand: string | null = null;

beforeEach(() => {
  failCommand = null;
  vi.mocked(runOwnedValidation).mockReset().mockImplementation(({ argv }) => {
    const report = argv.find((arg) => arg.startsWith("--test-reporter-destination="));
    if (report) writeFileSync(report.slice("--test-reporter-destination=".length), "TAP version 13\nok 1 - fixture\n# pass 1\n# fail 0\n");
    return { status: checkCommand(argv) === failCommand ? 1 : 0, signal: null, stdout: "", stderr: checkCommand(argv) === failCommand ? "fixture check failed" : "", timedOut: false, terminalProven: true, error: null };
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
  writeFileSync(path.join(repository, ".gitignore"), "node_modules/\n");
  git("init", "-q"); git("add", "."); git("commit", "-qm", "fixture");
  mkdirSync(path.join(repository, "node_modules/typescript/bin"), { recursive: true });
  writeFileSync(path.join(repository, "node_modules/typescript/bin/tsc"), "// installed fixture compiler, execution is mocked\n");
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
    ["tests/ready.test.js passes; document `echo pnpm lint passes` as an example."],
    ["tests/ready.test.js passes; echo tsc pass."],
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
    expect(result).toMatchObject({ status: "refused", failures: [command], reason: expect.stringContaining("fixture check failed") });
    expect(vi.mocked(runOwnedValidation).mock.calls.some(([call]) => checkCommand(call.argv) === command)).toBe(true);
  });

  it("proves both required commands and the named test before accepting completion", () => {
    const result = validateCompletionCandidate(candidate(), { unconfinedForTests: true });
    expect(result).toMatchObject({ status: "passed", commands: ["true", ...required] });
    expect(vi.mocked(runOwnedValidation).mock.calls.some(([call]) => call.argv.includes("--test"))).toBe(true);
    expect(vi.mocked(runOwnedValidation).mock.calls.some(([call]) => call.argv[0] === "/bin/sh" && call.argv.at(-1) === "echo fixture")).toBe(true);
    expect(vi.mocked(runOwnedValidation).mock.calls.some(([call]) => call.argv[0] === process.execPath && call.argv.at(-2)?.endsWith("/typescript/bin/tsc") && call.argv.at(-1) === "--noEmit")).toBe(true);
    expect(vi.mocked(runOwnedValidation).mock.calls.some(([call]) => call.argv.some((arg) => /corepack|^pnpm$/.test(arg)))).toBe(false);
  });


  it("retains named-test/lint/tsc executions after scratch cleanup, including refusals", () => {
    const input = candidate();
    const evidenceBinding = { sessionId: "session_execution", packetSha256: "packet", actionId: "action", base: input.base, repository: input.repository, worktree: input.worktree };
    let reference: CompletionEvidenceReference | undefined;
    const result = validateCompletionCandidate({ ...input, evidenceBinding }, { unconfinedForTests: true, onEvidence: ref => { reference = ref; } });
    expect(result.status).toBe("passed"); expect(reference).toBeDefined();
    for (const [call] of vi.mocked(runOwnedValidation).mock.calls) expect(existsSync(call.executionRoot)).toBe(false);
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: input.repository, encoding: "utf8" }).trim();
    const view = readCompletionEvidence(input.workspace, reference, evidenceBinding, [tree]);
    expect(view.status).toBe("verified");
    if (view.status !== "verified") throw new Error(view.reason);
    expect(view.record.executions.map(e => e.command)).toEqual(["true", ...required, "node --test tests/ready.test.js"]);
    expect(view.record.reports).toEqual([{ file: "tests/ready.test.js", tests: [{ name: "fixture", status: "passed" }] }]);
    expect(JSON.stringify(view)).not.toContain(input.repository);
    failCommand = "pnpm lint";
    const refused = validateCompletionCandidate({ ...input, evidenceBinding }, { unconfinedForTests: true, onEvidence: ref => { reference = ref; } });
    expect(refused.status).toBe("refused");
    expect(readCompletionEvidence(input.workspace, reference, evidenceBinding, [tree])).toMatchObject({ status: "verified", record: { outcome: "refused", executions: [{ exitStatus: 0 }, { exitStatus: 1 }] } });
  });

  it("retains timeout and custody uncertainty without accepting completion or removing scratch", () => {
    const input = candidate();
    const evidenceBinding = { sessionId: "session_timeout", packetSha256: "packet", actionId: "action", base: input.base, repository: input.repository, worktree: input.worktree };
    vi.mocked(runOwnedValidation).mockReturnValueOnce({ status: null, signal: "SIGTERM", stdout: "", stderr: "timeout fixture", timedOut: true, terminalProven: false, error: null });
    let reference: CompletionEvidenceReference | undefined;
    expect(validateCompletionCandidate({ ...input, evidenceBinding }, { unconfinedForTests: true, onEvidence: ref => { reference = ref; } })).toMatchObject({ status: "refused", hostFault: true, timedOut: true });
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: input.repository, encoding: "utf8" }).trim();
    expect(readCompletionEvidence(input.workspace, reference, evidenceBinding, [tree])).toMatchObject({ status: "verified", record: { outcome: "refused", executions: [{ exitStatus: null, signal: "SIGTERM", timedOut: true, terminalProven: false }] } });
    const executionRoot = vi.mocked(runOwnedValidation).mock.calls[0][0].executionRoot;
    expect(existsSync(executionRoot)).toBe(true); roots.push(executionRoot);
  });

  it("refuses completion and retains scratch if durable evidence cannot be written", () => {
    const input = candidate();
    writeFileSync(path.join(input.workspace, "artifacts"), "blocked");
    const evidenceBinding = { sessionId: "session_write_fail", packetSha256: "packet", actionId: "action", base: input.base, repository: input.repository, worktree: input.worktree };
    const result = validateCompletionCandidate({ ...input, evidenceBinding }, { unconfinedForTests: true });
    expect(result).toMatchObject({ status: "refused", hostFault: true, reason: expect.stringContaining("evidence could not be retained") });
    for (const [call] of vi.mocked(runOwnedValidation).mock.calls) {
      expect(existsSync(call.executionRoot)).toBe(true);
      roots.push(call.executionRoot);
    }
  });

  it("refuses rather than accepting without an installed TypeScript compiler", () => {
    const input = candidate();
    rmSync(path.join(input.repository, "node_modules/typescript/bin/tsc"));
    expect(validateCompletionCandidate(input, { unconfinedForTests: true })).toMatchObject({ status: "refused", hostFault: true, reason: expect.stringContaining("TypeScript compiler is not installed") });
    expect(runOwnedValidation).not.toHaveBeenCalled();
  });

  it("refuses a candidate that changes the lint script definition", () => {
    const input = candidate();
    writeFileSync(path.join(input.repository, "package.json"), JSON.stringify({ name: "fixture", scripts: { lint: "true" } }));
    expect(validateCompletionCandidate(input, { unconfinedForTests: true })).toMatchObject({ status: "refused", reason: expect.stringContaining("captured for validation") });
    expect(runOwnedValidation).not.toHaveBeenCalled();
  });
});
