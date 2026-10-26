import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_COMPLETION_EVIDENCE_BYTES, readCompletionEvidence, renderCompletionEvidence, writeCompletionEvidence, type CompletionEvidenceRecord } from "../src/sessions/completionValidationEvidence.js";
import { composePreservedPullRequestBody } from "../src/sessions/validationEvidence.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const workspace = mkdtempSync(path.join(tmpdir(), "completion-evidence-")); roots.push(workspace);
  const record: CompletionEvidenceRecord = { version: 1, producer: "arcadia-completion-validation-v1",
    binding: { sessionId: "session_one", packetSha256: "packet-one", actionId: "action", base: "base", repository: "/private/repo", worktree: "/private/candidate" },
    tree: "a".repeat(40), commands: ["pnpm lint"], namedTests: ["tests/one.test.js"],
    executions: [{ command: "pnpm lint", argv: ["/bin/sh", "-c", "echo fixture"], exitStatus: 0, signal: null, timedOut: false, terminalProven: true, durationMs: 4, error: null, stdout: "fixture", stderr: "" }],
    reports: [{ file: "tests/one.test.js", tests: [{ name: "one", status: "passed" }] }], outcome: "passed", reason: null, durationMs: 5 };
  const reference = writeCompletionEvidence(workspace, record);
  const read = () => readCompletionEvidence(workspace, reference, record.binding, [record.tree]);
  const rewrite = (text: string) => { writeFileSync(reference.ref, text); reference.sha256 = createHash("sha256").update(text).digest("hex"); };
  return { workspace, record, reference, read, rewrite };
}
describe("completion execution evidence", () => {
  it("retains exact execution, named reports and sanitized provenance without publishing host paths", () => {
    const f = fixture(); const view = f.read(); expect(view.status).toBe("verified");
    expect(renderCompletionEvidence(view)).toContain('"argv"');
    expect(renderCompletionEvidence(view)).not.toContain("/private/repo");
    expect(readFileSync(f.reference.ref, "utf8")).toContain(f.record.tree);
  });
  it.each(["sessionId", "packetSha256", "actionId", "base", "repository", "worktree"] as const)("refuses foreign %s binding", key => {
    const f = fixture(); expect(readCompletionEvidence(f.workspace, f.reference, { ...f.record.binding, [key]: "foreign" }, [f.record.tree]).status).toBe("unavailable");
  });
  it("refuses stale exact trees even if a caller supplies some later tree", () => {
    const f = fixture(); expect(readCompletionEvidence(f.workspace, f.reference, f.record.binding, ["b".repeat(40)]).status).toBe("unavailable");
  });
  it("refuses altered bytes, malformed JSON, schema and oversized records", () => {
    const f = fixture(); writeFileSync(f.reference.ref, "altered"); expect(f.read().status).toBe("unavailable");
    f.rewrite("{"); expect(f.read().status).toBe("unavailable");
    f.rewrite(JSON.stringify({ ...f.record, version: 2 })); expect(f.read().status).toBe("unavailable");
    truncateSync(f.reference.ref, MAX_COMPLETION_EVIDENCE_BYTES + 1); expect(f.read().status).toBe("unavailable");
  });
  it("refuses a symlink leaf and symlink ancestor", () => {
    const f = fixture(); const text = readFileSync(f.reference.ref); const elsewhere = path.join(f.workspace, "elsewhere"); writeFileSync(elsewhere, text);
    rmSync(f.reference.ref); symlinkSync(elsewhere, f.reference.ref); expect(f.read().status).toBe("unavailable");
    rmSync(path.dirname(f.reference.ref), { recursive: true });
    const outside = path.join(f.workspace, "outside"); mkdirSync(outside); writeFileSync(path.join(outside, "validation.json"), text);
    symlinkSync(outside, path.dirname(f.reference.ref)); expect(f.read().status).toBe("unavailable");
  });
  it("redacts secret-shaped strings, neutralizes control characters and bounds test names", () => {
    const f = fixture(); f.record.executions[0].stdout = `ghp_${"a".repeat(30)}\u001b[31m@operator`; f.record.reports[0].tests[0].name = "x".repeat(5000);
    f.rewrite(JSON.stringify(f.record)); const view = f.read(); expect(view.status).toBe("verified");
    const text = renderCompletionEvidence(view); expect(text).not.toContain("ghp_"); expect(text).not.toContain("\\u001b"); expect(text).not.toContain("x".repeat(301));
  });
  it("keeps completion detail within the existing PR body budget and neutralizes Markdown fences", () => {
    const f = fixture(); f.record.commands = Array.from({ length: 10 }, () => "x".repeat(500));
    f.record.reports[0].tests[0].name = "```# injected heading"; f.rewrite(JSON.stringify(f.record));
    const view = f.read();
    expect(renderCompletionEvidence(view)).not.toContain("```# injected");
    const body = composePreservedPullRequestBody("QA plan", { completionExecutionEvidence: view, evidenceRef: "missing", evidence: { status: "unreadable", reason: "missing" }, declaredCommands: [], candidateFingerprint: f.record.tree }, 1500);
    expect(body.length).toBeLessThanOrEqual(1500); expect(body).toContain("Details omitted");
  });
  it("redacts output and refusal secrets before retaining bytes", () => {
    const f = fixture();
    f.record.executions[0].stdout = `ghp_${"a".repeat(30)}`;
    f.record.reason = `failed: ghp_${"b".repeat(30)}`;
    const reference = writeCompletionEvidence(f.workspace, f.record);
    expect(readFileSync(reference.ref, "utf8")).not.toContain("ghp_");
    expect(readCompletionEvidence(f.workspace, reference, f.record.binding, [f.record.tree]).status).toBe("verified");
  });
  it("keeps legacy evidence explicitly unavailable", () => {
    const f = fixture(); expect(readCompletionEvidence(f.workspace, undefined, f.record.binding, [f.record.tree])).toMatchObject({ status: "unavailable", reason: expect.stringContaining("legacy") });
  });
});
