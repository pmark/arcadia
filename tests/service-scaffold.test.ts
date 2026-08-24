import { execFileSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldServiceScript, SERVICE_SCRIPT_RELATIVE } from "../src/projects/serviceScaffold.js";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "arcadia-service-scaffold-"));
  scratch.push(dir);
  return dir;
}

describe("service script scaffold", () => {
  it("writes an executable placeholder at the conventional path", () => {
    const dir = repo();
    const result = scaffoldServiceScript(dir);

    expect(result.written).toBe(true);
    expect(result.path).toBe(path.join(dir, SERVICE_SCRIPT_RELATIVE));
    // Discovery finds it by path, but spawning needs the bit. A scaffolded file
    // that cannot be executed looks configured and is not.
    expect(() => accessSync(result.path, constants.X_OK)).not.toThrow();
  });

  it("never overwrites a script the project already wrote", () => {
    const dir = repo();
    const existing = path.join(dir, SERVICE_SCRIPT_RELATIVE);
    mkdirSync(path.dirname(existing), { recursive: true });
    writeFileSync(existing, "#!/usr/bin/env bash\necho mine\n");

    const result = scaffoldServiceScript(dir);
    expect(result.written).toBe(false);
    expect(readFileSync(existing, "utf8")).toContain("echo mine");
  });

  it("fails loudly for every verb until it is completed", () => {
    const dir = repo();
    const { path: script } = scaffoldServiceScript(dir);

    for (const action of ["status", "restart", "stop"]) {
      let code = 0;
      let stderr = "";
      try {
        execFileSync(script, [action], { cwd: dir, encoding: "utf8", stdio: "pipe" });
      } catch (error) {
        const failure = error as { status?: number; stderr?: string };
        code = failure.status ?? -1;
        stderr = failure.stderr ?? "";
      }
      // Exiting 0 here would make `qa refresh` report a restart that never
      // happened — the same class of lie as a hand-typed freshness string.
      expect(code).not.toBe(0);
      expect(stderr).toContain("not implemented");
    }
  });

  it("rejects an unknown verb", () => {
    const dir = repo();
    const { path: script } = scaffoldServiceScript(dir);
    let code = 0;
    try {
      execFileSync(script, ["deploy"], { cwd: dir, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      code = (error as { status?: number }).status ?? -1;
    }
    expect(code).toBe(2);
  });

  it("is a syntactically valid bash script", () => {
    const dir = repo();
    const { path: script } = scaffoldServiceScript(dir);
    expect(() => execFileSync("bash", ["-n", script], { stdio: "pipe" })).not.toThrow();
  });
});
