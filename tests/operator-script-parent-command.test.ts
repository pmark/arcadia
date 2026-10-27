import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isCanonicalOperatorScriptParentCommand, operatorScriptRunnerSource } from "../src/operatorActions/operatorExecution.js";

const argv = ["/fixture/action.sh", "/fixture/run.json", "/fixture/state.json", "/fixture/action.lock", "/fixture/run", "fixture-run", "/fixture/descriptor.json"];
const rawCommand = `/fixture/node -e ${operatorScriptRunnerSource} ${argv.join(" ")}`;
// Independent fixture of macOS ps display, not a call to the production matcher.
const darwinCommand = rawCommand.replace(/\n/g, "\\012");

describe("canonical operator parent command display", () => {
  it("accepts raw Linux and escaped Darwin displays of exactly the canonical command", () => {
    expect(isCanonicalOperatorScriptParentCommand(rawCommand, argv, "linux")).toBe(true);
    expect(isCanonicalOperatorScriptParentCommand(darwinCommand, argv, "darwin")).toBe(true);
  });
  it("does not reinterpret observed escapes or accept another platform's display", () => {
    expect(isCanonicalOperatorScriptParentCommand(darwinCommand, argv, "linux")).toBe(false);
    expect(isCanonicalOperatorScriptParentCommand(rawCommand, argv, "darwin")).toBe(false);
    expect(isCanonicalOperatorScriptParentCommand(darwinCommand.replace("\\012", "\\013"), argv, "darwin")).toBe(false);
    expect(isCanonicalOperatorScriptParentCommand(darwinCommand.replace("\\012", "\\n"), argv, "darwin")).toBe(false);
    expect(isCanonicalOperatorScriptParentCommand(darwinCommand.replace("\\012", "\\\\012"), argv, "darwin")).toBe(false);
  });
  it.each(["linux", "darwin"] as const)("retains exact executable, source and every argument on %s", platform => {
    const command = platform === "darwin" ? darwinCommand : rawCommand;
    expect(isCanonicalOperatorScriptParentCommand(command.replace("/fixture/node -e", "/fixture/other -e"), argv, platform)).toBe(false);
    expect(isCanonicalOperatorScriptParentCommand(command.replace('require("node:fs")', 'require("node:os")'), argv, platform)).toBe(false);
    for (let i = 0; i < argv.length; i++) {
      const changed = [...argv]; changed[i] += "-foreign";
      expect(isCanonicalOperatorScriptParentCommand(command, changed, platform)).toBe(false);
    }
  });
});

function actualParent(alteredSource: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-parent-command-"));
  try {
    const script = path.join(root, "fixture.sh");
    const args = [script, path.join(root, "run.json"), path.join(root, "state.json"), path.join(root, "fixture.lock"), root, "fixture-run", path.join(root, "descriptor.json")];
    const module = pathToFileURL(fileURLToPath(new URL("../src/operatorActions/operatorExecution.ts", import.meta.url))).href;
    const child = path.join(root, "child.mjs");
    writeFileSync(child, `import { execFileSync } from "node:child_process";
import { isCanonicalOperatorScriptParentCommand } from ${JSON.stringify(module)};
const command = execFileSync("ps", ["-ww", "-p", String(process.ppid), "-o", "command="], { encoding: "utf8", timeout: 2000, maxBuffer: 65536 });
const args = ${JSON.stringify(args)};
console.log(JSON.stringify({ accepted: isCanonicalOperatorScriptParentCommand(command, args), wrongRun: isCanonicalOperatorScriptParentCommand(command, args.map((arg, i) => i === 5 ? "foreign-run" : arg)), escapedNewlines: command.includes("\\\\012") }));
`);
    const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
    writeFileSync(script, `#!/usr/bin/env bash\nexec ${quote(process.execPath)} --import tsx ${quote(child)}\n`, { mode: 0o700 });
    writeFileSync(args[1], "{}"); writeFileSync(args[6], "{}");
    const source = alteredSource ? `${operatorScriptRunnerSource}\n// foreign runner source\n` : operatorScriptRunnerSource;
    const result = spawnSync(process.execPath, ["-e", source, ...args], { encoding: "utf8", timeout: 15000 });
    expect(result.error).toBeUndefined();
    expect(result.status, readFileSync(path.join(root, "stderr.log"), "utf8")).toBe(0);
    return JSON.parse(readFileSync(path.join(root, "stdout.log"), "utf8")) as { accepted: boolean; wrongRun: boolean; escapedNewlines: boolean };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("real canonical node-e runner and platform ps composition", () => {
  it("accepts its actual parent display while refusing a different pinned run", () => {
    const result = actualParent(false);
    expect(result.accepted).toBe(true);
    expect(result.wrongRun).toBe(false);
    if (process.platform === "darwin") expect(result.escapedNewlines).toBe(true);
  });
  it("refuses a real parent that runs altered source", () => {
    expect(actualParent(true).accepted).toBe(false);
  });
});
