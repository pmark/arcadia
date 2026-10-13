import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFrozenRecords } from "../src/reports/frozenRecords.js";
import {
  combineSessionLedger, readSessionLedger, validateFrictionFiles, validateHandoffFiles,
} from "../src/reports/sessionLedgerSource.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const legacyText = readFileSync(path.join(repoRoot, "docs/reports/session-ledger.jsonl"), "utf8");
const baseRow = (id: string, extra: Record<string, unknown> = {}) => ({
  session_id: id, role: "driver", model: "sonnet", effort: null, action_id: "a", pr: null,
  tokens_in_uncached: null, tokens_in_cached: null, tokens_out: null, wall_min: null, attempts: 1,
  review_rounds: 0, blocking_findings: [], operator_touches: null, host_touches: null, frictions: [], outcome: "complete", ...extra,
});
const file = (stamp: string, id: string, row: unknown = baseRow(id)) => ({
  name: `docs/reports/session-ledger/${stamp}-${id}.json`, content: JSON.stringify(row),
});
const legacyLine = JSON.stringify(baseRow("legacy-1"));

describe("combined session ledger reader", () => {
  it("returns legacy rows first, then directory files sorted by name", () => {
    const out = combineSessionLedger(`${legacyLine}\n`, [file("20261013T1200Z", "b"), file("20261013T1100Z", "a")]);
    expect(out.errors).toEqual([]);
    expect(out.rows.map(r => r.session_id)).toEqual(["legacy-1", "a", "b"]);
  });
  it("sorts equal timestamp prefixes deterministically by full name", () => {
    const out = combineSessionLedger(null, [file("20261013T1100Z", "zed"), file("20261013T1100Z", "alpha")]);
    expect(out.rows.map(r => r.session_id)).toEqual(["alpha", "zed"]);
  });
  it("rejects a file name whose session_id differs from the row, naming the file", () => {
    const f = file("20261013T1100Z", "one", baseRow("two"));
    expect(combineSessionLedger(null, [f]).errors[0]).toContain(f.name);
  });
  it("rejects duplicate session_id across legacy and directory", () => {
    const out = combineSessionLedger(`${legacyLine}\n`, [file("20261013T1100Z", "legacy-1")]);
    expect(out.errors.join("\n")).toMatch(/duplicate session_id legacy-1/);
  });
  it("names the file for non-JSON content and unknown top-level keys", () => {
    const bad = { name: "docs/reports/session-ledger/20261013T1100Z-x.json", content: "{nope" };
    expect(combineSessionLedger(null, [bad]).errors).toEqual([`${bad.name}: invalid JSON`]);
    const extra = file("20261013T1100Z", "y", baseRow("y", { surprise: 1 }));
    expect(combineSessionLedger(null, [extra]).errors).toEqual([`${extra.name}: unknown field surprise`]);
  });
  it("rejects a traversal-looking session_id", () => {
    const f = { name: "docs/reports/session-ledger/20261013T1100Z-..-evil.json", content: JSON.stringify(baseRow("../evil")) };
    expect(combineSessionLedger(null, [f]).errors.join("\n")).toMatch(/unsafe session_id|file name must be/);
  });
  it("accepts an empty directory and a missing directory", () => {
    expect(combineSessionLedger(`${legacyLine}\n`, []).errors).toEqual([]);
    const dir = mkdtempSync(path.join(tmpdir(), "ledger-missing-"));
    try { expect(readSessionLedger(dir)).toMatchObject({ rows: [], errors: [] }); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("qa parity: legacy rows deep-equal JSON.parse of the legacy lines, in order", () => {
    const expected = legacyText.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
    const live = readSessionLedger(repoRoot);
    expect(live.errors).toEqual([]);
    expect(live.rows.slice(0, expected.length)).toEqual(expected);
  });
});

describe("friction and hand-off file names", () => {
  const front = (id: string) => `---\nid: ${id}\ncost: 5\nfix: x\nstatus: open\n---\nbody\n`;
  it("accepts a valid friction and rejects id mismatch and missing keys", () => {
    expect(validateFrictionFiles([{ name: "f/20261013-good-slug.md", content: front("good-slug") }])).toEqual([]);
    expect(validateFrictionFiles([{ name: "f/20261013-good-slug.md", content: front("other") }])[0]).toMatch(/must equal slug/);
    expect(validateFrictionFiles([{ name: "f/20261013-good-slug.md", content: "no front matter" }])[0]).toMatch(/missing id/);
  });
  it("rejects a slug that collides with a legacy friction number", () => {
    expect(validateFrictionFiles([{ name: "f/20261013-20.md", content: front("20") }]).join("\n")).toMatch(/collides with a legacy/);
    expect(validateFrictionFiles([{ name: "f/20261013-f21.md", content: front("f21") }]).join("\n")).toMatch(/collides with a legacy/);
  });
  it("requires hand-off names <timestamp>-<session_id>.md", () => {
    expect(validateHandoffFiles([{ name: "h/20261013T1100Z-sess-1.md", content: "" }])).toEqual([]);
    expect(validateHandoffFiles([{ name: "h/notes.md", content: "" }])).toHaveLength(1);
  });
});

describe("frozen records", () => {
  it("the checked-in manifest matches the frozen files", () => {
    expect(checkFrozenRecords(repoRoot)).toEqual([]);
  });
  it("fails with a remedy when a frozen file differs by one byte", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "frozen-"));
    try {
      writeFileSync(path.join(dir, "a.md"), "hello\n");
      const sha = "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"; // sha256("hello\n")
      const manifest = JSON.stringify({ frozen: [{ path: "a.md", sha256: sha, record_new_entries_in: "docs/x/" }] });
      expect(checkFrozenRecords(dir, manifest)).toEqual([]);
      writeFileSync(path.join(dir, "a.md"), "hello\n.");
      expect(checkFrozenRecords(dir, manifest)[0]).toMatch(/a\.md: frozen file changed; record new entries as one file under docs\/x\/; do not edit frozen files/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("two branches adding records merge without conflict", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const commitAll = (cwd: string, msg: string) => { git(cwd, "add", "-A"); execFileSync("git", ["commit", "-qm", msg], { cwd, env }); };
  const put = (cwd: string, rel: string, content: string) => { mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); writeFileSync(path.join(cwd, rel), content); };
  const merges = (cwd: string, a: string, b: string): boolean => {
    try { git(cwd, "merge-tree", "--write-tree", a, b); return true; } catch { return false; }
  };
  function scratch() {
    const dir = mkdtempSync(path.join(tmpdir(), "merge-proof-"));
    git(dir, "init", "-q", "-b", "main");
    put(dir, "docs/reports/session-ledger.jsonl", `${legacyLine}\n`);
    put(dir, "docs/reports/session-ledger/README.md", "x\n");
    commitAll(dir, "base");
    return dir;
  }
  const branch = (dir: string, name: string, kind: "files" | "append") => {
    git(dir, "checkout", "-q", "-b", name, "main");
    if (kind === "files") {
      put(dir, `docs/reports/session-ledger/20261013T1100Z-${name}.json`, JSON.stringify(baseRow(name)));
      put(dir, `docs/reports/frictions/20261013-${name}.md`, `---\nid: ${name}\n---\n`);
      put(dir, `docs/reports/handoffs/20261013T1100Z-${name}.md`, `${name}\n`);
    } else {
      put(dir, "docs/reports/session-ledger.jsonl", `${legacyLine}\n${JSON.stringify(baseRow(name))}\n`);
    }
    commitAll(dir, name);
  };
  it("merges per-file records in either order with no conflict", () => {
    const dir = scratch();
    try {
      branch(dir, "one", "files");
      branch(dir, "two", "files");
      expect(merges(dir, "one", "two")).toBe(true);
      expect(merges(dir, "two", "one")).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("control: two appends to the legacy JSONL do conflict", () => {
    const dir = scratch();
    try {
      branch(dir, "one", "append");
      branch(dir, "two", "append");
      expect(merges(dir, "one", "two")).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
