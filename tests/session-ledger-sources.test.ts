import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFrozenRecords } from "../src/reports/frozenRecords.js";
import {
  combineSessionLedger, readFrictionFiles, readSessionLedger, tailLedger, validateFrictionFiles, validateHandoffFiles,
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
  const mergeTree = (cwd: string, a: string, b: string) => {
    const r = spawnSync("git", ["merge-tree", "--write-tree", a, b], { cwd, encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  it("precondition: git supports merge-tree --write-tree (2.38+)", () => {
    const version = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
    const m = /(\d+)\.(\d+)/.exec(version);
    const ok = m !== null && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 38));
    expect(ok, `${version}: merge-tree --write-tree needs git >= 2.38; upgrade git so the merge proof can run`).toBe(true);
  });
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
      for (const [a, b] of [["one", "two"], ["two", "one"]]) {
        const r = mergeTree(dir, a, b);
        expect(r.status, r.out).toBe(0);
        expect(r.out).not.toMatch(/CONFLICT/);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("control: two appends to the legacy JSONL do conflict", () => {
    const dir = scratch();
    try {
      branch(dir, "one", "append");
      branch(dir, "two", "append");
      const r = mergeTree(dir, "one", "two");
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(/CONFLICT/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("directory hygiene and qa tolerance", () => {
  const withDir = (fn: (root: string, dir: string) => void) => {
    const root = mkdtempSync(path.join(tmpdir(), "ledger-dir-"));
    const dir = path.join(root, "docs/reports/session-ledger");
    mkdirSync(dir, { recursive: true });
    try { fn(root, dir); } finally { rmSync(root, { recursive: true, force: true }); }
  };
  const goodName = "20261013T1100Z-ok.json";
  it("N3: misnamed entries are named errors; README.md and .gitkeep are ignored", () => {
    withDir((root, dir) => {
      writeFileSync(path.join(dir, "README.md"), "x");
      writeFileSync(path.join(dir, ".gitkeep"), "");
      for (const n of ["x.JSON", "x.jsonl", "stray.txt"]) writeFileSync(path.join(dir, n), "{}");
      const errors = readSessionLedger(root).errors.join("\n");
      for (const n of ["x.JSON", "x.jsonl", "stray.txt"]) expect(errors).toContain(`docs/reports/session-ledger/${n}: `);
      expect(errors).not.toContain("README.md");
      expect(errors).not.toContain(".gitkeep");
    });
  });
  it("N4: a directory or symlink named *.json is a named error, not a crash", () => {
    withDir((root, dir) => {
      mkdirSync(path.join(dir, "20261013T1100Z-dir.json"));
      writeFileSync(path.join(root, "target.json"), JSON.stringify(baseRow("link")));
      symlinkSync(path.join(root, "target.json"), path.join(dir, "20261013T1100Z-link.json"));
      const out = readSessionLedger(root);
      expect(out.errors).toHaveLength(2);
      expect(out.errors.join("\n")).toContain("20261013T1100Z-dir.json: not a regular file");
      expect(out.errors.join("\n")).toContain("20261013T1100Z-link.json: not a regular file");
    });
  });
  it("N4: a non-regular entry in the frictions directory is a named error", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fr-dir-"));
    try {
      mkdirSync(path.join(root, "docs/reports/frictions/20261013-x.md"), { recursive: true });
      expect(validateFrictionFiles(readFrictionFiles(root))[0]).toContain("20261013-x.md: not a regular file");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("Q: one invalid file is excluded from rows but reported; valid rows are kept", () => {
    withDir((root, dir) => {
      writeFileSync(path.join(dir, goodName), JSON.stringify(baseRow("ok")));
      writeFileSync(path.join(dir, "20261013T1200Z-bad.json"), "{nope");
      const out = readSessionLedger(root);
      expect(out.rows.map(r => r.session_id)).toEqual(["ok"]);
      expect(out.errors).toEqual(["docs/reports/session-ledger/20261013T1200Z-bad.json: invalid JSON"]);
    });
  });
  it("Q: the check script still fails on that file", () => {
    withDir((root, dir) => {
      writeFileSync(path.join(dir, "20261013T1200Z-bad.json"), "{nope");
      const r = spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "scripts/check-session-ledger.ts"), root], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("20261013T1200Z-bad.json: invalid JSON");
    });
  });
  it("N1: tailLedger returns the last n rows, legacy first, compactly", () => {
    const out = combineSessionLedger(`${legacyLine}\n`, [file("20261013T1100Z", "a"), file("20261013T1200Z", "b", baseRow("b", { notes: "n", pr: 7 }))]);
    const lines = tailLedger(out.rows, 2).map(l => JSON.parse(l));
    expect(lines).toEqual([
      { session_id: "a", outcome: "complete", action_id: "a", pr: null, notes: null },
      { session_id: "b", outcome: "complete", action_id: "a", pr: 7, notes: "n" },
    ]);
    expect(tailLedger(out.rows, 0)).toEqual([]);
  });
  it("N1: the ledger:tail script prints the last rows of the real repository", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "scripts/ledger-tail.ts"), "2"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toHaveLength(2);
  });
});
