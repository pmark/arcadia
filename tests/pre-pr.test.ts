import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guidanceFingerprint, renderGuidanceFingerprints, renderGuidanceIndex } from "../src/projects/agentGuidance.js";
import { refreshStaleGuidance } from "../src/production/mechanicalRepair.js";
import { runPrePr, renderFailure, type CommandResult, type CommandRunner } from "../scripts/pre-pr.js";

const IDS = ["continuation", "agent-asks", "operator-actions", "proposals", "principles", "pull-requests", "learning", "git-identity", "managed-documents", "planning", "working-copy"];
const ok: CommandResult = { status: 0, stdout: "", stderr: "" };
const passing: CommandRunner = () => ok;

let root: string;
const write = (file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "pre-pr-"));
  const docs = Object.fromEntries(IDS.map((id) => [id, `# ${id}\n`]));
  for (const [id, text] of Object.entries(docs)) write(`docs/agent-guidance/${id}.md`, text);
  write("docs/agent-guidance/index.json", renderGuidanceIndex({
    schema: "arcadia-agent-guidance-v1",
    entries: IDS.map((id) => ({ id, trigger: id, path: `docs/agent-guidance/${id}.md`, read_before: `Before ${id}.` })),
  }));
  write("docs/agent-guidance/fingerprints.json", renderGuidanceFingerprints(Object.fromEntries(IDS.map((id) => [id, guidanceFingerprint(docs[id])]))));
  write("src/domain/known.ts", "export const known = 1;\n");
  write("tests/fixtures/authority-unclassified-src-inventory.json", JSON.stringify({ entries: {} }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("pre-pr", () => {
  it("fails on an edited guidance document then an unclassified src file, and passes once both are fixed", () => {
    write("docs/agent-guidance/learning.md", "# learning\nedited\n");
    write("src/brandnew/gate.ts", "export const gate = 1;\n");

    const first = runPrePr(root, { run: passing, changedFiles: [] });
    expect(first?.step).toBe("check:agent-guidance");
    expect(renderFailure(first!)).toContain("pnpm guidance:refresh docs/agent-guidance/learning.md");

    // `pnpm guidance:refresh <doc>` is refreshStaleGuidance with the named document.
    expect(refreshStaleGuidance(root, ["docs/agent-guidance/learning.md"]).refreshed).toEqual(["docs/agent-guidance/learning.md"]);

    const second = runPrePr(root, { run: passing, changedFiles: [] });
    expect(second?.step).toBe("tests/authority-classifier-coverage.test.ts");
    expect(second?.problems.join("\n")).toContain("src/brandnew/gate.ts");
    expect(renderFailure(second!)).toContain('"src/brandnew/gate.ts": "operator_authority",');

    // Applying a classification entry (here: the default-deny inventory) clears it.
    write("tests/fixtures/authority-unclassified-src-inventory.json", JSON.stringify({ entries: { "src/brandnew/gate.ts": { reason: "Fixture gate module.", gateScanPatterns: [] } } }));
    expect(runPrePr(root, { run: passing, changedFiles: [] })).toBeNull();
  });

  it("stops at the first failing step", () => {
    const calls: string[] = [];
    const run: CommandRunner = (_c, args) => {
      calls.push(args.join(" "));
      return args[0] === "check:agent-guidance" ? { status: 1, stdout: "Stale mandatory guidance: docs/agent-guidance/planning.md. Refresh", stderr: "" } : ok;
    };
    expect(runPrePr(root, { run, changedFiles: [] })?.step).toBe("check:agent-guidance");
    expect(calls).toEqual(["check:agent-guidance"]);
  });

  it("reproduces #2752 (lint): an auto-fixable eslint error gets the eslint --fix line", () => {
    const report = [{ filePath: path.join(root, "src/domain/known.ts"), errorCount: 1, fixableErrorCount: 1, messages: [{ line: 3, ruleId: "prefer-const", message: "x is never reassigned.", fix: {}, severity: 2 }] }];
    const run: CommandRunner = (_c, args) => (args.includes("eslint") ? { status: 1, stdout: JSON.stringify(report), stderr: "" } : ok);
    const failure = runPrePr(root, { run, changedFiles: ["src/domain/known.ts"] });
    expect(failure?.step).toBe("eslint");
    expect(failure?.problems[0]).toContain("src/domain/known.ts:3");
    expect(failure?.fixes).toContain("pnpm exec eslint --fix src/domain/known.ts");
  });

  it("reproduces #2766 (guidance fingerprint): a stale document gets pnpm guidance:refresh", () => {
    write("docs/agent-guidance/pull-requests.md", "# pull-requests\nchanged\n");
    const failure = runPrePr(root, { run: passing, changedFiles: [] });
    expect(failure?.fixes).toEqual(["pnpm guidance:refresh docs/agent-guidance/pull-requests.md"]);
  });

  it("reproduces #2744 (classification): a new unclassified src file gets a most-restrictive entry", () => {
    write("src/newarea/thing.ts", "export const t = 1;\n");
    const failure = runPrePr(root, { run: passing, changedFiles: [] });
    expect(failure?.step).toBe("tests/authority-classifier-coverage.test.ts");
    expect(failure?.fixes).toEqual(['Add to EXACT in src/decisions/batchMerge.ts (most restrictive): "src/newarea/thing.ts": "operator_authority",']);
  });

  it("prints the cap, measured bytes and file for an instruction-cap overflow", () => {
    write("AGENTS.md", "x".repeat(12 * 1024 + 10));
    const failure = runPrePr(root, { run: passing, changedFiles: [] });
    expect(failure?.step).toBe("check:agent-guidance");
    expect(failure?.fixes[0]).toContain("AGENTS.md");
    expect(failure?.fixes[0]).toContain(String(12 * 1024 + 10));
    expect(failure?.fixes[0]).toContain(String(12 * 1024));
  });

  it("names the file, measured bytes and cap for project and combined instruction-cap overflows", () => {
    const evidence = {
      schema: "arcadia-guidance-delivery-evidence-v1",
      evidence: ["codex", "claude"].map((agent) => ({
        cwd: ".", agent,
        sources: [
          { path: path.join(root, "AGENTS.md"), bytes: 11000, sha256: "a" },
          { path: path.join(root, "CLAUDE.md"), bytes: 14000, sha256: "b" },
          { path: "/Users/someone/.claude/CLAUDE.md", bytes: 9000, sha256: "c" },
        ],
        projectBytes: 25002, combinedBytes: 34004,
        problems: ["Project instructions exceed 24576 bytes (25002).", "Combined guidance exceeds the supported 32768-byte envelope (34004); mandatory guidance may be truncated."],
      })),
    };
    const run: CommandRunner = (_c, args) => (args[0] === "check:agent-guidance" ? { status: 1, stdout: JSON.stringify(evidence), stderr: "" } : ok);
    const failure = runPrePr(root, { run, changedFiles: [] });
    expect(failure?.step).toBe("check:agent-guidance");
    const project = failure?.fixes.find((f) => f.includes("project instructions"));
    expect(project).toContain("Shrink CLAUDE.md (14000 bytes)");
    expect(project).toContain("measured 25002 bytes, cap 24576");
    const combined = failure?.fixes.find((f) => f.includes("combined guidance"));
    expect(combined).toContain("measured 34004 bytes, cap 32768");
    expect(combined).toContain("CLAUDE.md (14000 bytes)");
    // The same overflow reported for several agents prints once.
    expect(failure?.fixes.filter((f) => f.includes("project instructions"))).toHaveLength(1);
  });

  it("captures the full path of a stale guidance document from the check output", () => {
    const run: CommandRunner = (_c, args) => (args[0] === "check:agent-guidance"
      ? { status: 1, stdout: "", stderr: "Stale mandatory guidance: docs/agent-guidance/learning.md. Refresh adoption before its operation." }
      : ok);
    const failure = runPrePr(root, { run, changedFiles: [] });
    expect(failure?.fixes).toEqual(["pnpm guidance:refresh docs/agent-guidance/learning.md"]);
  });

  it("prints file:line for type errors", () => {
    const run: CommandRunner = (_c, args) => (args.includes("tsc") ? { status: 2, stdout: "src/a.ts(7,3): error TS2322: Type string is not assignable to type number.", stderr: "" } : ok);
    const failure = runPrePr(root, { run, changedFiles: [] });
    expect(failure?.step).toBe("tsc");
    expect(failure?.fixes[0]).toContain("src/a.ts:7");
  });
});
