import { describe, expect, it } from "vitest";
import {
  dependencyRequiringPreservationCheck,
  PRESERVATION_DEPENDENCY_CODE,
  PRESERVATION_DEPENDENCY_REMEDY
} from "../src/sessions/preservationChecks.js";

describe("preservation check dependency classification", () => {
  it("accepts self-contained checks that use only tracked files and node or system tools", () => {
    expect(dependencyRequiringPreservationCheck(["node scripts/preservation-self-check.mjs"])).toBeNull();
    expect(dependencyRequiringPreservationCheck(["/usr/bin/python3 -I -c 'print(1)'", "true"])).toBeNull();
    expect(dependencyRequiringPreservationCheck([])).toBeNull();
  });

  it("names the offending command when a declared check needs installed dependencies", () => {
    const manager = dependencyRequiringPreservationCheck(["pnpm test"]);
    expect(manager?.tool).toBe("pnpm");
    expect(manager?.command).toBe("pnpm test");
    expect(manager?.remedy).toContain(PRESERVATION_DEPENDENCY_REMEDY);
    expect(dependencyRequiringPreservationCheck(["pnpm lint"])?.tool).toBe("pnpm");
    expect(dependencyRequiringPreservationCheck(["vitest run"])?.tool).toBe("vitest");
    expect(dependencyRequiringPreservationCheck(["npx tsc -p tsconfig.json"])?.tool).toBe("npx");
    expect(dependencyRequiringPreservationCheck(["node ./node_modules/.bin/eslint src"])?.tool).toBe("node_modules");
  });

  it("names network and version-control tools the sandbox refuses", () => {
    expect(dependencyRequiringPreservationCheck(["curl -s https://example.invalid"])?.tool).toBe("curl");
    expect(dependencyRequiringPreservationCheck(["git fetch origin"])?.tool).toBe("git");
  });

  it("recognises dependency-backed python modules but keeps standard-library ones self-contained", () => {
    expect(dependencyRequiringPreservationCheck(["python3 -m pytest tests"])?.tool).toBe("python -m pytest");
    expect(dependencyRequiringPreservationCheck(["/usr/bin/python3 -m mypy src"])?.tool).toBe("python -m mypy");
    expect(dependencyRequiringPreservationCheck(["python3 -m json.tool data.json"])).toBeNull();
    expect(dependencyRequiringPreservationCheck(["python3 -m unittest discover"])).toBeNull();
  });

  it("matches only executable positions, not arguments or filenames", () => {
    expect(dependencyRequiringPreservationCheck(["node scripts/report.mjs git"])).toBeNull();
    expect(dependencyRequiringPreservationCheck(["node scripts/check.mjs --label curl"])).toBeNull();
    expect(dependencyRequiringPreservationCheck(["node scripts/vitest-summary.mjs"])).toBeNull();
    expect(dependencyRequiringPreservationCheck(["FOO=bar node scripts/check.mjs"]))
      .toBeNull();
    expect(dependencyRequiringPreservationCheck(["env FOO=bar pnpm test"])?.tool).toBe("pnpm");
  });

  it("reports the first offending command in declaration order", () => {
    const dependency = dependencyRequiringPreservationCheck(["node scripts/ok.mjs", "pnpm test", "curl https://x"]);
    expect(dependency?.command).toBe("pnpm test");
    expect(PRESERVATION_DEPENDENCY_CODE).toBe("validation_requires_dependencies");
  });
});
