import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultRunWindowDeps, libraryMergeFreeze } from "../src/workMonitoring/runWindow.js";

/**
 * The batch-card merge path (scripts/merge-decision-card-batch.ts, Issue #2779). The script is an operator-only CLI
 * behind a guard that fetches the real `origin/main` and demands a github.com remote, so it cannot be spawned against a
 * hermetic fixture. Its `merge` gateway is one inlined expression:
 *
 *   libraryMergeFreeze(defaultRunWindowDeps(repoRoot), { pr: number, ownCardIds: [spec.cardId] })
 *
 * followed by `if (freeze) throw new Error(freeze.message)` before `gh pr merge`. These tests run that exact expression
 * with the real default dependencies (a real library directory, a real git `origin/main`) and pin the script's wiring
 * of it, so the refusal text, the surviving card and the ownCardIds exemption are checked without a stubbed window.
 */

const BATCH_CARD = "merge-decision-card-batch-fixture";
const OTHER_CARD = "start-run-unrelated";
const roots: string[] = [];
let repo: string;
let library: string;
let originMain: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function startCard(id: string, revision: string): string {
  const file = path.join(library, `${id}.json`);
  writeFileSync(file, JSON.stringify({
    schema: "arcadia-operator-script-v1",
    id,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    startRun: { schema: "arcadia-start-run-v1", reviewedRevision: revision }
  }));
  return file;
}

/** The script's own call, with the real default dependencies. */
const scriptFreeze = (pr: number) =>
  libraryMergeFreeze(defaultRunWindowDeps(repo, { ARCADIA_OPERATOR_SCRIPT_LIBRARY: library }), { pr, ownCardIds: [BATCH_CARD] });

beforeEach(() => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "batch-freeze-")));
  roots.push(root);
  repo = path.join(root, "repo");
  library = path.join(root, "library");
  mkdirSync(repo);
  mkdirSync(library);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", "Fixture"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "genesis"]);
  originMain = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["update-ref", "refs/remotes/origin/main", originMain]);
});

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("merge-decision-card-batch merge freeze", () => {
  it("refuses with the exact freeze message while an unrelated per-run START card is pinned, and the card survives", () => {
    const card = startCard(OTHER_CARD, originMain);
    const refusal = scriptFreeze(41);
    expect(refusal).not.toBeNull();
    expect(refusal?.code).toBe("start_card_waiting");
    expect(refusal?.message).toContain(`merge freeze: card ${OTHER_CARD} pinned to ${originMain.slice(0, 12)}`);
    expect(existsSync(card)).toBe(true);
    // Once the card is pressed (consumed) the batch is free to merge.
    writeFileSync(path.join(library, `${OTHER_CARD}.consumed.json`), JSON.stringify({ state: "CONSUMED" }));
    expect(scriptFreeze(41)).toBeNull();
    expect(existsSync(card)).toBe(true);
  });

  it("the batch's own card never freezes itself, even while an unrelated card does", () => {
    startCard(BATCH_CARD, originMain);
    expect(scriptFreeze(41)).toBeNull();
    startCard(OTHER_CARD, originMain);
    const refusal = scriptFreeze(41);
    expect(refusal?.message).toContain(`card ${OTHER_CARD} pinned to`);
    expect(refusal?.message).not.toContain(`card ${BATCH_CARD} `);
  });

  it("the script checks the freeze with its own card id, and throws before gh pr merge", () => {
    const source = readFileSync(path.join(import.meta.dirname, "..", "scripts", "merge-decision-card-batch.ts"), "utf8");
    const call = source.indexOf("libraryMergeFreeze(defaultRunWindowDeps(repoRoot), { pr: number, ownCardIds: [spec.cardId] })");
    const refuse = source.indexOf("if (freeze) throw new Error(freeze.message);");
    const merge = source.indexOf('gh(["pr", "merge"');
    expect(call).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(call);
    expect(merge).toBeGreaterThan(refuse);
  });
});
