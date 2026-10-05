import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderOperatorQaPlan } from "../src/sessions/operatorQaPlan.js";
import {
  COMPLETION_SETTLEMENT_LINE,
  PRESERVED_PULL_REQUEST_BODY_MAX_CHARS,
  VALIDATION_OUTPUT_TAIL_BYTES,
  composePreservedPullRequestBody,
  parseValidationEvidence,
  readValidationEvidence,
  renderValidationEvidence,
  type ValidationCheckRecord,
  type ValidationEvidenceInput
} from "../src/sessions/validationEvidence.js";

const TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const REF = "/Users/host/ws/artifacts/preservation/session-1/check-AbC123/validation.json";
const CWD = "/private/var/folders/xx/T/arcadia-preservation-Q1w2E3/source";
const PLAN = "## Operator QA plan\n\nRendered plan.\n\nMerge, deployment and publication remain separate operator gates.";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function check(overrides: Partial<ValidationCheckRecord> = {}): ValidationCheckRecord {
  return {
    command: "node scripts/preservation-self-check.mjs",
    exitStatus: 0,
    signal: null,
    error: null,
    stdout: "preservation self-check passed (812 files inspected)\n",
    stderr: "",
    cwd: CWD,
    durationMs: 1_234,
    timedOut: false,
    timeoutMs: 120_000,
    ...overrides
  };
}

function record(results: ValidationCheckRecord[], overrides: Record<string, unknown> = {}) {
  return { producer: "arcadia-host-seatbelt-v1", tree: TREE, complete: true, runningCommand: undefined, results, binding: { secret: "never rendered" }, ...overrides };
}

function input(results: ValidationCheckRecord[], overrides: Partial<ValidationEvidenceInput> = {}, recordOverrides: Record<string, unknown> = {}): ValidationEvidenceInput {
  return {
    evidenceRef: REF,
    evidence: parseValidationEvidence(record(results, recordOverrides)),
    declaredCommands: results.map((result) => result.command),
    candidateFingerprint: TREE,
    ...overrides
  };
}

function fencedBlocks(body: string): string[] {
  const blocks: string[] = [];
  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^(`{3,})text$/.exec(lines[index]);
    if (!open) continue;
    const content: string[] = [];
    let end = index + 1;
    // CommonMark: a closing fence is at least as long as the opening one, alone on its line.
    while (end < lines.length && !new RegExp(`^ {0,3}\`{${open[1].length},}\\s*$`).test(lines[end])) content.push(lines[end++]);
    blocks.push(content.join("\n"));
    index = end;
  }
  return blocks;
}

describe("Validation evidence rendering", () => {
  it("renders each passing command with its command, working directory, exit code, duration and output", () => {
    const body = renderValidationEvidence(input([check(), check({ command: "pnpm exec tsc --noEmit", stdout: "", stderr: "", durationMs: 850 })]));
    expect(body.startsWith("### Validation evidence\n")).toBe(true);
    expect(body).toContain("- **Record:** `artifacts/preservation/session-1/check-AbC123/validation.json` (producer `arcadia-host-seatbelt-v1`), bound to candidate tree `4b825dc642cb6eb9a060e54bf8d69288fbee4904`");
    expect(body).toContain("- **Status:** passed — all 2 declared validation commands ran to completion and exited 0.");
    expect(body).toContain("#### Command 1 of 2 — passed\n\n- **Command:** `node scripts/preservation-self-check.mjs`");
    expect(body).toContain("- **Working directory:** `arcadia-preservation-Q1w2E3/source` in the host's temporary directory — the root of candidate tree `4b825dc642cb`");
    expect(body).not.toContain("/private/var");
    expect(body).toContain("- **Exit code:** `0`\n- **Duration:** 1.2 s");
    expect(body).toContain("- **stdout** (53 bytes recorded):\n\n```text\npreservation self-check passed (812 files inspected)\n```");
    expect(body).toContain("- **stderr:** empty.");
    expect(body).toContain("#### Command 2 of 2 — passed\n\n- **Command:** `pnpm exec tsc --noEmit`");
    expect(body).toContain("- **Duration:** 850 ms");
    expect(body).not.toContain("/Users/host");
    expect(body).not.toContain("never rendered");
  });

  it("relates the record's tree to the named candidate commit only from Git's answer", () => {
    const sha = "50d1eab84e385a5566119831c82f5a6d32e752fd";
    const same = renderValidationEvidence(input([check()], { candidateCommit: { sha, tree: TREE } }));
    expect(same).toContain(`bound to candidate tree \`${TREE}\`, which is the tree of candidate commit \`${sha}\``);
    const other = renderValidationEvidence(input([check()], { candidateCommit: { sha, tree: "e".repeat(40) } }));
    expect(other).toContain(`; candidate commit \`${sha}\` has a different tree, \`${"e".repeat(40)}\`, so this record does not cover that commit`);
    expect(other).not.toContain("which is the tree of");
    const unread = renderValidationEvidence(input([check()], { candidateCommit: { sha, tree: null } }));
    expect(unread).toContain(`; the tree of candidate commit \`${sha}\` could not be read, so their relation is not stated`);
    const absent = renderValidationEvidence(input([check()]));
    expect(absent).toContain(`bound to candidate tree \`${TREE}\`\n`);
  });

  it("states that cwd and duration were not recorded by an earlier record, rather than inventing them", () => {
    const legacy = { ...check() } as Partial<ValidationCheckRecord>;
    delete legacy.cwd; delete legacy.durationMs; delete legacy.timedOut; delete legacy.timeoutMs;
    const body = renderValidationEvidence(input([legacy as ValidationCheckRecord]));
    expect(body).toContain("- **Working directory:** not recorded in this record; producer `arcadia-host-seatbelt-v1` runs every check from the root of candidate tree `4b825dc642cb`");
    expect(body).toContain("- **Duration:** not recorded in this record");
    expect(body).toContain("- **Status:** passed — the declared validation command ran to completion and exited 0.");
  });

  it("renders a failing command's exit code and output and an explicit failed status", () => {
    const body = renderValidationEvidence(input([check(), check({ command: "pnpm test", exitStatus: 1, stdout: "", stderr: "FAIL tests/a.test.ts\n1 failed\n" })]));
    expect(body).toContain("- **Status:** failed — 1 of 2 declared validation commands did not pass (1 failed). Arcadia preserved the candidate as usual; this body does not prove validation.");
    expect(body).toContain("#### Command 2 of 2 — failed");
    expect(body).toContain("- **Exit code:** `1`");
    expect(body).toContain("```text\nFAIL tests/a.test.ts\n1 failed\n```");
  });

  it("renders a timed-out command, in new and earlier records, as timed out", () => {
    const fresh = renderValidationEvidence(input([check({ exitStatus: null, signal: "SIGKILL", error: "spawnSync /usr/bin/sandbox-exec ETIMEDOUT", timedOut: true, stdout: "still running\n" })]));
    expect(fresh).toContain("#### Command 1 of 1 — timed out");
    expect(fresh).toContain("- **Exit code:** none; timed out after 120.0 s and was killed; terminated by signal `SIGKILL`; error: spawnSync /usr/bin/sandbox-exec ETIMEDOUT");
    expect(fresh).toContain("- **Status:** failed — 1 of 1 declared validation commands did not pass (1 timed out).");
    const legacy = renderValidationEvidence(input([{ ...check({ exitStatus: null, signal: "SIGKILL", error: "spawnSync /usr/bin/sandbox-exec ETIMEDOUT" }), timedOut: undefined, timeoutMs: undefined }]));
    expect(legacy).toContain("— timed out");
    expect(legacy).toContain("- **Exit code:** none; timed out and was killed;");
    const killed = renderValidationEvidence(input([check({ exitStatus: null, signal: "SIGKILL", stdout: null, stderr: null })]));
    expect(killed).toContain("#### Command 1 of 1 — did not complete");
    expect(killed).toContain("- **stdout:** not captured.");
  });

  it("renders a missing record, a missing command result, an unbound record and an unfinished record explicitly", () => {
    const unreadable = renderValidationEvidence(input([check()], { evidence: { status: "unreadable", reason: "the cited record does not exist" } }));
    expect(unreadable).toContain("- **Status:** missing — the cited record does not exist. Arcadia preserved the candidate as usual; this body does not prove validation.");
    expect(unreadable).not.toContain("#### Command");

    const missing = renderValidationEvidence(input([check()], { declaredCommands: ["node scripts/preservation-self-check.mjs", "pnpm lint"] }));
    expect(missing).toContain("#### Command 2 of 2 — missing\n\n- **Command:** `pnpm lint`\n- **Result:** none recorded");
    expect(missing).toContain("(1 missing)");

    const unbound = renderValidationEvidence(input([check()], { candidateFingerprint: "f".repeat(40) }));
    expect(unbound).toContain(`- **Status:** not bound to this candidate — the record is for candidate tree \`${TREE}\`, not the preserved tree \`${"f".repeat(40)}\`, so its results are not shown.`);
    expect(unbound).not.toContain("preservation self-check passed");

    const unfinished = renderValidationEvidence(input([check()], {}, { complete: false, runningCommand: "pnpm test" }));
    expect(unfinished).toContain("- **Status:** incomplete — host validation did not finalise this record (it was running `pnpm test`). every recorded command exited 0, but the record is not final.");

    const undeclared = renderValidationEvidence(input([check(), check({ command: "echo extra" })], { declaredCommands: ["node scripts/preservation-self-check.mjs"] }));
    expect(undeclared).toContain("- **Not shown:** 1 recorded result is for commands the Project does not declare.");
    expect(undeclared).not.toContain("echo extra");

    const none = renderValidationEvidence(input([check()], { declaredCommands: [] }));
    expect(none).toContain("- **Status:** none declared");
  });

  it("keeps only the last lines within the fixed byte cap per stream and says so", () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${String(index).padStart(3, "0")} ${"z".repeat(40)}`);
    const body = renderValidationEvidence(input([check({ stdout: `${lines.join("\n")}\n`, stderr: "x".repeat(1_000_000) })]));
    const [stdout, stderr] = fencedBlocks(body);
    expect(Buffer.byteLength(stdout, "utf8")).toBeLessThanOrEqual(VALIDATION_OUTPUT_TAIL_BYTES);
    expect(stdout.endsWith(lines[399])).toBe(true);
    expect(stdout.split("\n")[0]).toMatch(/^line \d{3} z{40}$/);
    expect(stdout).not.toContain(lines[0]);
    expect(body).toMatch(/- \*\*stdout\*\* \(last \d+ bytes after sanitising, of 20000 recorded; earlier lines omitted\):/);
    // One very long line keeps its end, marked.
    expect(stderr).toBe(`…${"x".repeat(VALIDATION_OUTPUT_TAIL_BYTES)}`);
    expect(body).toContain("- **stderr** (last 2048 bytes after sanitising, of 1000000 recorded; earlier lines omitted):");
    // Never splits a multi-byte character.
    const wide = renderValidationEvidence(input([check({ stdout: `${"é".repeat(5_000)}a` })]));
    expect(fencedBlocks(wide)[0]).not.toContain("\ufffd");
  });

  it("neutralises hostile output: fences, HTML, Markdown, ANSI, control and bidi characters, binary and secrets", () => {
    const hostile = [
      "\u001b[31mred\u001b[0m \u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007",
      "```",
      "````",
      "</details><script>alert(1)</script><img src=x onerror=alert(1)>",
      "# Heading [click](https://evil.example) @octocat #1",
      "bell\u0007 nul-free \u0008backspace\r\nprogress 10%\rprogress 100%",
      "trojan \u202eevil\u202c source",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 and GITHUB_TOKEN=supersecretvalue",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAA",
      "-----END OPENSSH PRIVATE KEY-----",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"
    ].join("\n");
    const body = renderValidationEvidence(input([check({ stdout: hostile, stderr: "\u0000\u0001binary\u00ff", command: "echo `x` <b>" })]));
    const [block] = fencedBlocks(body);
    // The whole hostile text stays inside one fence its content cannot close.
    expect(body).toContain("`````text\n");
    expect(block).toContain("</details><script>alert(1)</script>");
    expect(block).toContain("```\n````");
    expect(block.split("\n").length).toBe(hostile.replace(/\r\n?/g, "\n").split("\n").length - 2);
    for (const forbidden of ["\u001b", "\u0007", "\u0008", "\r", "\u202e", "\u202c", "ghp_abc", "supersecretvalue", "b3BlbnNzaC1rZXktdjEAAAAA", "abcdefghijklmnopqrstuvwxyz\n", "evil.example\u0007"]) {
      expect(body).not.toContain(forbidden);
    }
    expect(block).toContain("red link");
    expect(block).toContain("progress 10%\nprogress 100%");
    expect(block).toContain("[redacted token]");
    expect(block).toContain("GITHUB_TOKEN=[redacted]");
    expect(block).toContain("[redacted private key]");
    expect(block).toContain("Bearer [redacted]");
    expect(body).toContain("- **stderr:** binary output (10 bytes) withheld.");
    // Outside the fence, governed text is a code span and nothing is raw HTML.
    expect(body).toContain("- **Command:** ``echo `x` <b>``");
    const outside = body.replace(/^(`{3,})text\n[\s\S]*?\n\1$/gm, "");
    expect(outside).not.toMatch(/<(script|img|details)/);
  });

  it("is deterministic: the same receipt record renders the same bytes", () => {
    const make = () => composePreservedPullRequestBody(PLAN, input([check(), check({ command: "pnpm test", exitStatus: 2, stderr: "boom\n" })]));
    expect(make()).toBe(make());
  });
});

describe("preserved pull-request body", () => {
  it("keeps the Operator QA plan byte-for-byte as its prefix and ends with the one fixed settlement line", () => {
    const plan = renderOperatorQaPlan({
      kind: "action-acceptance", actionKey: "demo/a", actionTitle: "A", acceptanceCriteria: ["MARKER.md exists."], validationCommands: ["node scripts/preservation-self-check.mjs"]
    }, { branch: "claude/a", baseBranch: "main", baseRevision: "b".repeat(40), commitSha: "c".repeat(40), changedFiles: [{ status: "A", path: "MARKER.md" }] });
    const body = composePreservedPullRequestBody(plan.body, input([check()]));
    expect(body.startsWith(`${plan.body}\n\n### Validation evidence\n`)).toBe(true);
    expect(body.endsWith(`\n\n${COMPLETION_SETTLEMENT_LINE}`)).toBe(true);
    expect(body.split(COMPLETION_SETTLEMENT_LINE)).toHaveLength(2);
    expect(COMPLETION_SETTLEMENT_LINE).toContain("is the record Arcadia expects before independent review and is not an approval-boundary crossing");
  });

  it("stays within the pull-request body limit, shrinking tails and then detail deterministically", () => {
    const big = Array.from({ length: 10 }, (_, index) => check({ command: `check-${index}`, stdout: "o".repeat(200_000), stderr: "e".repeat(200_000) }));
    const full = composePreservedPullRequestBody(PLAN, input(big));
    expect(full.length).toBeLessThanOrEqual(PRESERVED_PULL_REQUEST_BODY_MAX_CHARS);
    expect(fencedBlocks(full)).toHaveLength(20);

    const largePlan = `${PLAN}\n${"p".repeat(50_000)}`;
    const shrunk = composePreservedPullRequestBody(largePlan, input(big));
    expect(shrunk.length).toBeLessThanOrEqual(PRESERVED_PULL_REQUEST_BODY_MAX_CHARS);
    expect(shrunk.startsWith(largePlan)).toBe(true);
    expect(fencedBlocks(shrunk).every((block) => Buffer.byteLength(block) < VALIDATION_OUTPUT_TAIL_BYTES)).toBe(true);

    const maxPlan = `${PLAN}\n${"p".repeat(60_000)}`;
    const atPlanLimit = composePreservedPullRequestBody(maxPlan, input(big));
    expect(atPlanLimit.length).toBeLessThanOrEqual(PRESERVED_PULL_REQUEST_BODY_MAX_CHARS);
    expect(atPlanLimit).toContain("- **Status:** passed — all 10 declared validation commands");
    expect(atPlanLimit).toContain("command output tails are omitted");
    expect(atPlanLimit).toContain("#### Command 10 of 10 — passed");

    const nearLimit = `${PLAN}\n${"p".repeat(63_800)}`;
    const summary = composePreservedPullRequestBody(nearLimit, input(big));
    expect(summary.length).toBeLessThanOrEqual(PRESERVED_PULL_REQUEST_BODY_MAX_CHARS);
    expect(summary).toContain("- **Status:** passed — all 10 declared validation commands");
    expect(summary).toContain("- **Details:** omitted so this body stays within 65000 characters");
    expect(summary).not.toContain("#### Command");
    expect(summary.endsWith(COMPLETION_SETTLEMENT_LINE)).toBe(true);
    expect(composePreservedPullRequestBody(nearLimit, input(big))).toBe(summary);

    const tooLarge = `${PLAN}\n${"p".repeat(64_900)}`;
    expect(composePreservedPullRequestBody(tooLarge, input(big))).toBe(tooLarge);
  });
});

describe("adversarial output stays bounded in time and visible", () => {
  it("renders 1 MiB pathological streams quickly (no quadratic regex work)", () => {
    const mib = 1 << 20;
    const streams = [
      "TOKEN".repeat(mib / 5),
      "SECRET_".repeat(Math.floor(mib / 7)),
      `${" ".repeat(mib)}x`,
      `${"\n".repeat(mib)}x`,
      "\u001b]".repeat(mib / 2),
      "-----BEGIN RSA PRIVATE KEY-----".repeat(Math.floor(mib / 31)),
      `Bearer${" ".repeat(mib)}`,
      "sk-".repeat(Math.floor(mib / 3))
    ];
    for (const stdout of streams) {
      const started = performance.now();
      const body = composePreservedPullRequestBody(PLAN, input([check({ stdout, stderr: stdout })]));
      expect(performance.now() - started).toBeLessThan(1_500);
      expect(body.length).toBeLessThanOrEqual(PRESERVED_PULL_REQUEST_BODY_MAX_CHARS);
    }
  });

  it("replaces invisible format, separator, private-use and tag characters so nothing is hidden", () => {
    const hidden = "a\u200bb\ufeffc\u00add\u2028e\u2029f\u{e0041}\u{e0042}g\ue000h\u200di\ufe0fj\u3164k";
    const [block] = fencedBlocks(renderValidationEvidence(input([check({ stdout: hidden })])));
    expect(block).toBe("a?b?c?d?e?f??g?h?i?j?k");
    // A zero-width character inside a token is made visible rather than silently splitting it.
    const split = fencedBlocks(renderValidationEvidence(input([check({ stdout: "ghp_abcdefghij\u200bklmnopqrstuvwxyz0123" })])))[0];
    expect(split).toContain("?");
  });

  it("states truncation when only the end window of a huge stream is read", () => {
    const lines = Array.from({ length: 20_000 }, (_, index) => `row ${index}`).join("\n");
    const body = renderValidationEvidence(input([check({ stdout: lines })]));
    const [block] = fencedBlocks(body);
    expect(block.endsWith("row 19999")).toBe(true);
    expect(block.split("\n")[0]).toMatch(/^row \d+$/);
    expect(body).toMatch(/- \*\*stdout\*\* \(last \d+ bytes after sanitising, of \d+ recorded; earlier lines omitted\):/);
  });

  it("redacts a secret even when escape padding after it would shrink the end window", () => {
    const key = ["-----BEGIN OPENSSH PRIVATE KEY-----", ...Array.from({ length: 8 }, () => "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ"), "-----END OPENSSH PRIVATE KEY-----"].join("\n");
    const padding = "\u001b[0m".repeat(20_000);
    const body = renderValidationEvidence(input([check({ stdout: `start\n${key}\n${padding}done`, stderr: `ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789${padding}end` })]));
    expect(body).not.toContain("b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ");
    expect(body).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(body).toContain("[redacted private key]");
  });

  it("does not call a long stream empty when only its end is whitespace", () => {
    const body = renderValidationEvidence(input([check({ stdout: `FAIL: assertion x != y\n${" ".repeat(1 << 20)}` })]));
    expect(body).not.toContain("- **stdout:** empty");
    expect(body).toContain("- **stdout:** the last 65536 characters after sanitising are whitespace; earlier output (of 1048599 bytes recorded) is omitted.");
  });

  it("marks a single cut line with an ellipsis", () => {
    const [block] = fencedBlocks(renderValidationEvidence(input([check({ stdout: `${"y".repeat(70_000)}end` })])));
    expect(block.startsWith("…y")).toBe(true);
    expect(block.endsWith("yend")).toBe(true);
  });

  it("never publishes a working directory outside the producer's own temporary copy name", () => {
    const body = renderValidationEvidence(input([check({ cwd: "/Users/someone/private/source" })]));
    expect(body).toContain("- **Working directory:** a host directory (path not published) — the root of candidate tree");
    expect(body).not.toContain("/Users/someone");
  });

  it("keeps the settlement line when only it, not the evidence status, still fits", () => {
    const tight = `${PLAN}\n${"p".repeat(64_400)}`;
    const body = composePreservedPullRequestBody(tight, input([check()]));
    expect(body).toBe(`${tight}\n\n${COMPLETION_SETTLEMENT_LINE}`);
    expect(body.length).toBeLessThanOrEqual(PRESERVED_PULL_REQUEST_BODY_MAX_CHARS);
  });
});

describe("reading the receipt's host validation record", () => {
  function evidenceFile(content: string | object): string {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-evidence-"));
    roots.push(root);
    const directory = path.join(root, "artifacts", "preservation", "session-1", "check-x1");
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "validation.json");
    writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    return file;
  }

  it("reads a host record at Arcadia's evidence path", () => {
    const file = evidenceFile(record([check()]));
    expect(readValidationEvidence(file)).toMatchObject({ status: "read", record: { tree: TREE, complete: true, results: [{ exitStatus: 0, cwd: CWD }] } });
  });

  it("refuses anything that is not a regular host record at that path", () => {
    expect(readValidationEvidence("tests green")).toMatchObject({ status: "unreadable" });
    expect(readValidationEvidence("/etc/passwd")).toMatchObject({ status: "unreadable" });
    const missing = path.join(tmpdir(), "artifacts", "preservation", "nope", "check-0", "validation.json");
    expect(readValidationEvidence(missing)).toEqual({ status: "unreadable", reason: "the cited record does not exist" });
    expect(readValidationEvidence(evidenceFile("{not json"))).toEqual({ status: "unreadable", reason: "the cited record is not valid JSON" });
    expect(readValidationEvidence(evidenceFile({ producer: "x", results: [] }))).toEqual({ status: "unreadable", reason: "the cited record is malformed (no candidate tree)" });
    const target = evidenceFile(record([check()]));
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-evidence-link-"));
    roots.push(root);
    const linkDirectory = path.join(root, "artifacts", "preservation", "s", "check-1");
    mkdirSync(linkDirectory, { recursive: true });
    symlinkSync(target, path.join(linkDirectory, "validation.json"));
    expect(readValidationEvidence(path.join(linkDirectory, "validation.json"))).toEqual({ status: "unreadable", reason: "the cited record is not a regular file" });
  });
});
