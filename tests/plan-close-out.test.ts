import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCloseOut, closeOutPath, decideWrite, hashCloseOut, parseCompletionEntries, parseFrictionFile, parseLegacyFrictions,
  parseSuccessor, renderCloseOut, validateCloseOut, type CloseOutInput
} from "../src/plans/closeOut.js";
import { execFileSync } from "node:child_process";
import { gitShaToPr, loadCloseOutInputs } from "../src/plans/closeOut.js";
import { runPlanCloseOutCommand } from "../src/commands/planCloseOut.js";
import type { SessionLedgerRow } from "../src/reports/sessionLedger.js";

const row = (over: Partial<SessionLedgerRow>): SessionLedgerRow => ({
  session_id: "s1", role: "driver", model: "m", effort: null, action_id: "a1", pr: 10, tokens_in_uncached: null,
  tokens_in_cached: null, tokens_out: null, subagent_tokens_total: 100, wall_min: null, attempts: 1, review_rounds: 2,
  blocking_findings: [], operator_touches: 1, host_touches: 0, frictions: [], outcome: "complete", ...over
});

const base = (): CloseOutInput => ({
  plan: {
    slug: "demo-plan", status: "active", milestone: "M",
    actions: [
      { id: "a1", title: "First — naïve\ntitle", status: "done", splitInto: ["a3"] },
      { id: "a2", title: "Second", status: "open", splitInto: [] },
      { id: "a3", title: "Third", status: "done", splitInto: [] }
    ]
  },
  ledgerRows: [
    row({ session_id: "s1", action_id: "a1", pr: 11, frictions: [{ id: "f-fixed", cost_min: null, fix_ref: null }, { id: "F9", cost_min: null, fix_ref: null }] }),
    row({ session_id: "s2", action_id: "a1", pr: 12, operator_touches: null, subagent_tokens_total: null, outcome: "split" }),
    row({ session_id: "s3", action_id: "a2", pr: null, frictions: [{ id: "f-cited", cost_min: null, fix_ref: null }] })
  ],
  frictions: [
    { id: "f-fixed", status: "fixed", testIds: [] },
    { id: "f-cited", status: "fixed", testIds: ["tests/x.test.ts"] }
  ],
  completions: [{ actionId: "a1", date: "2026-10-12", candidate: "abc1234", blockers: ["waiting on operator"] }],
  successor: { recommendation: null, reason: "the Plan document names no successor" }
});

const shuffle = <T,>(items: T[]): T[] => [...items].reverse();

describe("buildCloseOut", () => {
  it("is deterministic and independent of input order", () => {
    const input = base();
    const a = buildCloseOut(input);
    const shuffled = buildCloseOut({
      ...input,
      plan: { ...input.plan, actions: shuffle(input.plan.actions) },
      ledgerRows: shuffle(input.ledgerRows),
      frictions: shuffle(input.frictions)
    });
    expect(shuffled.hash).toBe(a.hash);
    expect(renderCloseOut(shuffled)).toBe(renderCloseOut(a));
    expect(buildCloseOut(base()).hash).toBe(a.hash);
    expect(hashCloseOut(a)).toBe(a.hash);
  });

  it("changes the hash when any single field changes", () => {
    const hash = buildCloseOut(base()).hash;
    const variants: Array<(input: CloseOutInput) => void> = [
      input => { input.plan.status = "done"; },
      input => { input.plan.actions[1].title = "Second!"; },
      input => { input.plan.actions[1].status = "done"; },
      input => { input.ledgerRows[0].pr = 99; },
      input => { input.ledgerRows[0].review_rounds = 7; },
      input => { input.frictions[0].testIds = ["tests/y.test.ts"]; },
      input => { input.completions[0].blockers = []; },
      input => { input.successor = { recommendation: "next-plan", reason: "named by the Plan document" }; }
    ];
    for (const change of variants) {
      const input = base();
      change(input);
      expect(buildCloseOut(input).hash).not.toBe(hash);
    }
  });

  it("lists Actions with outcome and PRs, remainders, blockers, aggregates and frictions", () => {
    const record = buildCloseOut(base());
    expect(record.actions.map(a => [a.id, a.outcome, a.prs])).toEqual([["a1", "split", [11, 12]], ["a2", "open", []], ["a3", "done", []]]);
    expect(record.actions[0].title).toBe("First — naïve\ntitle");
    expect(record.actions[0].completion).toEqual({ date: "2026-10-12", candidate: "abc1234" });
    expect(record.openRemainders).toEqual([{ id: "a2", status: "open", source: "plan-action" }]);
    expect(record.openBlockers).toEqual([{ actionId: "a1", text: "waiting on operator" }]);
    expect(record.ledger).toEqual({ rowsConsidered: 3, rowsMatched: 3, rowsExcluded: 0, evidence: "partial", sessions: 3, reviewRounds: 6,
      subagentTokens: 200, attempts: 3, operatorTouches: 2, outcomes: { complete: 2, split: 1 } });
    expect(record.plan.closed).toBe(false);
    expect(record.frictions).toEqual([
      { id: "f-cited", status: "fixed", testIds: ["tests/x.test.ts"], uncited: false },
      { id: "f-fixed", status: "fixed", testIds: [], uncited: true }
    ]);
    expect(record.unresolvedFrictionIds).toEqual(["F9"]);
    expect(record.successor).toEqual({ recommendation: null, reason: "the Plan document names no successor" });
  });

  it("reports ledger rows citing Actions outside the Plan instead of dropping them", () => {
    const input = base();
    input.ledgerRows.push(row({ session_id: "s9", action_id: "elsewhere" }));
    const record = buildCloseOut(input);
    expect(record.unmatchedLedgerRows).toEqual([{ session_id: "s9", action_id: "elsewhere" }]);
    expect(record.ledger.sessions).toBe(3);
  });

  it("surfaces duplicate session ids once and counts them once", () => {
    const input = base();
    input.ledgerRows.push(row({ session_id: "s1", action_id: "a1", pr: 500 }));
    const record = buildCloseOut(input);
    expect(record.duplicateLedgerSessions).toEqual(["s1"]);
    expect(record.ledger.sessions).toBe(3);
    expect(buildCloseOut({ ...input, ledgerRows: shuffle(input.ledgerRows) }).hash).toBe(record.hash);
  });

  it("handles a Plan with zero Actions and a done Action with no ledger row", () => {
    const empty = buildCloseOut({ ...base(), plan: { slug: "empty", status: "draft", milestone: null, actions: [] }, completions: [] });
    expect(empty.actions).toEqual([]);
    expect(empty.openRemainders).toEqual([]);
    expect(validateCloseOut(empty)).toEqual([]);
    const record = buildCloseOut({ ...base(), ledgerRows: [] });
    expect(record.actions.find(a => a.id === "a3")).toMatchObject({ status: "done", prs: [], ledgerSessions: [] });
  });

  it("lists a split target missing from the Plan as an open remainder", () => {
    const input = base();
    input.plan.actions[0].splitInto = ["ghost"];
    expect(buildCloseOut(input).openRemainders).toContainEqual({ id: "ghost", status: "unknown", source: "split-target-not-in-plan" });
  });
});

describe("validateCloseOut", () => {
  const good = () => JSON.parse(renderCloseOut(buildCloseOut(base()))) as Record<string, unknown>;
  const ids = new Set(["a1", "a2", "a3"]);

  it("accepts a built record and rejects each malformation with a named reason", () => {
    expect(validateCloseOut(good(), ids)).toEqual([]);
    expect(validateCloseOut("nope")).toEqual(["record is not a JSON object"]);
    expect(validateCloseOut({ ...good(), schema: "v0" }).join()).toContain("schema must be arcadia-plan-close-out-v1");
    expect(validateCloseOut({ ...good(), hash: "0".repeat(64) }).join()).toContain("hash does not match");
    expect(validateCloseOut({ ...good(), extra: 1 }).join()).toContain("unknown keys: extra");
    const missing = good(); delete missing.successor;
    expect(validateCloseOut(missing).join()).toContain("missing keys: successor");
    const tampered = good(); (tampered.successor as Record<string, string>).reason = "edited";
    expect(validateCloseOut(tampered).join()).toContain("hash does not match");
    expect(validateCloseOut(good(), new Set(["a1"])).join()).toContain("Action a2 is not in the Plan document");
    const duplicate = good();
    (duplicate.actions as unknown[]).push((duplicate.actions as unknown[])[0]);
    expect(validateCloseOut(duplicate, ids).join()).toContain("duplicate Action a1");
  });
});

describe("source parsers", () => {
  it("extracts completions, friction files, legacy rows and the successor line", () => {
    expect(parseCompletionEntries("# Log\n\n## 2026-10-12 — Completed arcadia/some-action\n\n- **Did:** Completed (Candidate df6799f).\n- **Blockers:** None recorded.\n\n## 2026-10-13 — Completed arcadia/other\n\n- **Blockers:** needs a key\n"))
      .toEqual([
        { actionId: "some-action", date: "2026-10-12", candidate: "df6799f", blockers: [] },
        { actionId: "other", date: "2026-10-13", candidate: null, blockers: ["needs a key"] }
      ]);
    expect(parseFrictionFile({ name: "x.md", content: "---\nid: a-b\ncost: 1\nfix: covered by tests/z.test.ts\nstatus: fixed\n---\nbody check:frozen-records\n" }))
      .toEqual({ id: "a-b", status: "fixed", testIds: ["check:frozen-records", "tests/z.test.ts"] });
    expect(parseLegacyFrictions("| # | F | C | P | S |\n|---|---|---|---|---|\n| 13 | text | cost | Guard in src/a.test.ts | Fixed in #1288 (F13) |\n| 20a | t | c | f | Open |\n"))
      .toEqual([
        { id: "F13", status: "fixed", testIds: ["src/a.test.ts"] },
        { id: "F20a", status: "open", testIds: [] }
      ]);
    expect(parseSuccessor("intro\nSuccessor: next-plan-slug\n")).toEqual({ recommendation: "next-plan-slug", reason: "named by the Plan document" });
    expect(parseSuccessor("none").recommendation).toBeNull();
  });
});

describe("decideWrite and the command", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  function fixture(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "close-out-"));
    dirs.push(root);
    mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
    mkdirSync(path.join(root, "docs", "reports", "session-ledger"), { recursive: true });
    writeFileSync(path.join(root, "docs", "plans", "demo-plan.md"), [
      "---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: draft", "milestone: M",
      "token_impact: small", "token_budget: none", "updated: 2026-10-12", "actions:",
      "  - id: only-action", "    title: Only", "    status: done", "    responsibility: agent",
      "    next_action: none", "    acceptance_criteria:", "      - It is done and tested.", "---", "", "Body", ""
    ].join("\n"));
    return root;
  }

  it("decides write, no-op and refuse", () => {
    const record = buildCloseOut(base());
    expect(decideWrite(null, record)).toEqual({ action: "write" });
    expect(decideWrite(renderCloseOut(record), record)).toEqual({ action: "noop" });
    expect(decideWrite("{", record).action).toBe("refuse");
    const other = buildCloseOut({ ...base(), successor: { recommendation: "x", reason: "named by the Plan document" } });
    expect(decideWrite(renderCloseOut(other), record).action).toBe("refuse");
  });

  it("is read-only by default, writes once, is a no-op when repeated, and refuses traversal slugs", () => {
    const root = fixture();
    const target = path.join(root, closeOutPath("demo-plan"));
    const dry = runPlanCloseOutCommand({ repo: root, planSlug: "demo-plan" });
    expect(dry.data.written).toBe(false);
    expect(() => readFileSync(target)).toThrow();
    const first = runPlanCloseOutCommand({ repo: root, planSlug: "demo-plan", write: true });
    expect(first.data.written).toBe(true);
    const bytes = readFileSync(target, "utf8");
    const second = runPlanCloseOutCommand({ repo: root, planSlug: "demo-plan", write: true });
    expect(second.data).toMatchObject({ written: false, unchanged: true });
    expect(readFileSync(target, "utf8")).toBe(bytes);
    expect(validateCloseOut(JSON.parse(bytes), new Set(["only-action"]))).toEqual([]);
    writeFileSync(target, bytes.replace('"reason": "the Plan document names no successor"', '"reason": "edited"'));
    expect(() => runPlanCloseOutCommand({ repo: root, planSlug: "demo-plan", write: true })).toThrow(/different hash|not regenerated/);
    expect(() => runPlanCloseOutCommand({ repo: root, planSlug: "../x", write: true })).toThrow(/Plan slug/);
    expect(() => runPlanCloseOutCommand({ repo: root, planSlug: "missing-plan" })).toThrow(/not found/);
  });
});

describe("evidence, closed flag, PR resolution and the load path", () => {
  it("marks evidence none with null aggregates when no row matches, and cannot read as clean", () => {
    const input = base();
    input.ledgerRows = input.ledgerRows.map(r => ({ ...r, action_id: "other-plan-action" }));
    const record = buildCloseOut(input);
    expect(record.ledger).toEqual({ rowsConsidered: 3, rowsMatched: 0, rowsExcluded: 3, evidence: "none", sessions: null,
      reviewRounds: null, subagentTokens: null, attempts: null, operatorTouches: null, outcomes: null });
    expect(validateCloseOut(record)).toEqual([]);
    const forged = JSON.parse(renderCloseOut(record)) as { ledger: Record<string, unknown> };
    forged.ledger.sessions = 0;
    expect(validateCloseOut(forged).join()).toContain("aggregates must be null when evidence is none");
    const inconsistent = JSON.parse(renderCloseOut(buildCloseOut(base()))) as { ledger: Record<string, unknown> };
    inconsistent.ledger.rowsExcluded = 5;
    expect(validateCloseOut(inconsistent).join()).toContain("rowsMatched + rowsExcluded must equal rowsConsidered");
  });

  it("bounds the unmatched list with a truncated flag", () => {
    const input = base();
    for (let i = 0; i < 25; i += 1) input.ledgerRows.push(row({ session_id: `x${String(i).padStart(2, "0")}`, action_id: "elsewhere" }));
    const record = buildCloseOut(input);
    expect(record.ledger.rowsExcluded).toBe(25);
    expect(record.unmatchedLedgerRows).toHaveLength(20);
    expect(record.unmatchedTruncated).toBe(true);
    expect(validateCloseOut(record)).toEqual([]);
  });

  it("sets closed only when every Action is done and no remainder is open", () => {
    const input = base();
    expect(buildCloseOut(input).plan.closed).toBe(false);
    input.plan.actions[1].status = "done";
    expect(buildCloseOut(input).plan.closed).toBe(true);
    input.plan.actions[0].splitInto = ["ghost"];
    expect(buildCloseOut(input).plan.closed).toBe(false);
  });

  it("unions ledger PRs with PRs resolved from completion candidates", () => {
    const input = base();
    input.shaToPr = sha => (sha === "abc1234" ? 777 : null);
    expect(buildCloseOut(input).actions[0].prs).toEqual([11, 12, 777]);
  });

  describe("through loadCloseOutInputs and a scratch repository", () => {
    const dirs: string[] = [];
    afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
    const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();

    it("resolves a candidate sha to its merge PR and reports evidence none for a ledger of other Plans", () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "close-out-git-"));
      dirs.push(root);
      sh(root, "init", "-q", "-b", "main");
      mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
      mkdirSync(path.join(root, "docs", "reports", "session-ledger"), { recursive: true });
      writeFileSync(path.join(root, "docs", "plans", "demo-plan.md"), [
        "---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: draft", "milestone: M",
        "token_impact: small", "token_budget: none", "updated: 2026-10-12", "actions:",
        "  - id: only-action", "    title: Only", "    status: open", "    responsibility: agent",
        "    next_action: do it", "    acceptance_criteria:", "      - It is done and tested.", "---", "", "Body", ""
      ].join("\n"));
      writeFileSync(path.join(root, "docs", "reports", "session-ledger.jsonl"), `${JSON.stringify(row({ session_id: "legacy-1", action_id: "someone-elses-action" }))}\n`);
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "base");
      sh(root, "checkout", "-q", "-b", "feature");
      writeFileSync(path.join(root, "work.txt"), "x");
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "feature work");
      const sha = sh(root, "rev-parse", "HEAD");
      sh(root, "checkout", "-q", "main");
      sh(root, "merge", "--no-ff", "-q", "-m", "Merge pull request #42 from someone/feature", "feature");
      expect(gitShaToPr(root)(sha)).toBe(42);
      expect(gitShaToPr(root)("0".repeat(40))).toBeNull();
      writeFileSync(path.join(root, "MISSION_LOG.md"), `## 2026-10-12 — Completed arcadia/only-action\n\n- **Did:** Completed (Candidate ${sha}).\n- **Blockers:** None recorded.\n`);
      const loaded = loadCloseOutInputs(root, "demo-plan");
      const record = buildCloseOut(loaded.input);
      expect(record.actions[0].prs).toEqual([42]);
      expect(record.ledger).toMatchObject({ rowsConsidered: 1, rowsMatched: 0, rowsExcluded: 1, evidence: "none", sessions: null });
      expect(record.unmatchedLedgerRows).toEqual([{ session_id: "legacy-1", action_id: "someone-elses-action" }]);
      expect(record.plan.closed).toBe(false);
      expect(validateCloseOut(record, new Set(["only-action"]))).toEqual([]);
    });
  });
});
