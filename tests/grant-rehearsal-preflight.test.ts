import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const source = readFileSync(new URL("../artifacts/generated/operator-scripts/grant-production-two-action-v6-remaining-stages-2026-09-30.sh", import.meta.url), "utf8");
const program = source.split("<<'PREFLIGHT'\n")[1].split("\nPREFLIGHT")[0];
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

function runPreflight(fakePnpm: string, sandbox?: string, timeout?: number, reportParentContext = false) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "arcadia-grant-preflight-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "pnpm"), `#!/bin/sh\n${fakePnpm}\n`, { mode: 0o755 });
  const env = {
    ...process.env, PATH: `${directory}:${process.env.PATH}`,
    ARCADIA_OPERATOR_SCRIPT_ID: "live-v6-grant",
    ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: "/operator/live-v6-grant.json"
  };
  // This isolated test runs a fake pnpm only, never the preservation consumer.
  delete env.CODEX_SANDBOX;
  if (sandbox) env.CODEX_SANDBOX = sandbox;
  let input = timeout ? program.replace("300_000", String(timeout)) : program;
  if (reportParentContext) input = input.replace("process.exit(result.status ?? 1);", `
    process.stdout.write(JSON.stringify({
      id: process.env.ARCADIA_OPERATOR_SCRIPT_ID,
      descriptor: process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR
    }));
    process.exit(result.status ?? 1);
  `);
  return { directory, result: spawnSync(process.execPath, ["--input-type=module", "-", directory], {
    input,
    env, encoding: "utf8", timeout: 10_000
  }) };
}

it("refuses an agent sandbox before running any replay process", () => {
  const { directory, result } = runPreflight("touch invoked", "seatbelt");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("host operator-action library");
  expect(() => readFileSync(path.join(directory, "invoked"))).toThrow();
});

it("propagates a failed host replay so the Grant cannot continue", () => {
  const { result } = runPreflight("echo replay-failed >&2\nexit 7");
  expect(result.status).toBe(7);
  expect(result.stderr).toContain("replay-failed");
});

it("runs the exact suite with host validation and bounded discovery", () => {
  const { result } = runPreflight('test "$ARCADIA_PRESERVATION_HOST_TEST" = 1 || exit 9\nprintf "%s\\n" "$@"');
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n")).toEqual(["exec", "vitest", "run", "--dir", "tests", "rehearsal-two-action.test.ts"]);
});

it("isolates fixture governance from the live Grant while preserving the parent's operator scope", () => {
  const { result } = runPreflight(
    'test -z "${ARCADIA_OPERATOR_SCRIPT_ID+x}" || exit 10\ntest -z "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR+x}" || exit 11\ntest "$ARCADIA_PRESERVATION_HOST_TEST" = 1 || exit 12',
    undefined, undefined, true
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    id: "live-v6-grant", descriptor: "/operator/live-v6-grant.json"
  });
});

it("refuses a replay that exceeds its process deadline", () => {
  const { result } = runPreflight("sleep 1", undefined, 20);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("ETIMEDOUT");
});
