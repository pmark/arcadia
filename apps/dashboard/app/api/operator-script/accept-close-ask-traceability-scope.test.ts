import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../../..");
const scriptPath = path.join(
  repositoryRoot,
  "artifacts/generated/operator-scripts/accept-close-ask-traceability-scope-2026-09-30.sh"
);
const planPath = path.join(
  repositoryRoot,
  "docs/plans/bootstrap-managed-production-to-build-flight-deck.md"
);

describe("Ask traceability scope-repair operator script", () => {
  it("finds the exact current Action block and parses its acceptance criteria without running the action", () => {
    const script = readFileSync(scriptPath, "utf8");
    const python = script.match(/<<'PY'[^\n]*\n([\s\S]*?)\nPY\n/)?.[1];
    expect(python).toBeDefined();

    const definitionsEnd = python!.indexOf("\ntry:\n");
    expect(definitionsEnd).toBeGreaterThan(0);
    const validation = python!.slice(0, definitionsEnd)
      + "\nblock = action_block(pathlib.Path(sys.argv[3]))\n"
      + "print(json.dumps(criteria(block)))\n";
    const result = spawnSync("python3", ["-c", validation, "unused-library", "unused-run-dir", planPath], {
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      "#591: A command maps a capture_… id to the ask, back-burner item, or Action it produced.",
      "#716: The arcadia-go skill's node_modules bridge step works on a target repo that is not Arcadia's own monorepo."
    ]);
  });
});
