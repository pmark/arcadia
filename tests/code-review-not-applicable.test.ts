import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SelectedCodingAgentConfiguration } from "../src/codingAgents/providerAdapters.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, upsertProjectMetadata } from "../src/db/repositories.js";
import { classifyPatchApplicability, evaluateNotApplicableClaims } from "../src/qa/patchApplicability.js";
import {
  CODE_REVIEW_PR_CRITERIA,
  parsePersistedQaContext,
  QA_PR_REVIEW_CRITERIA,
  runQaPrReviewCommand,
  type PrReviewRole,
  type QaPrModelVerdict,
  type QaPrReviewDependencies
} from "../src/qa/prReview.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * The code-review role's bounded `not-applicable` status, driven through the
 * real `arcadia qa code-review` executor with only GitHub and the reviewer
 * model stubbed. The fixtures under tests/fixtures/rehearsal-code-review are
 * the live three-Action rehearsal's captured attempt for
 * pmark/arcadia-three-action-rehearsal-20261004#1 at head 58bcd9155: the exact
 * compare patch (sha256 4735243546392dfa…, as its receipt records), the PR
 * evidence (901714a25ba0…), and the real model verdict (correctness pass, five
 * criteria not-checked, zero findings). The persisted context is that
 * attempt's Decision context as the code before this change wrote it,
 * reconstructed from the same attempt's metadata, report and receipt.
 */
const FIXTURES = path.join(import.meta.dirname, "fixtures", "rehearsal-code-review");
const REAL_PATCH = readFileSync(path.join(FIXTURES, "candidate.patch"), "utf8");
const REAL_EVIDENCE = JSON.parse(readFileSync(path.join(FIXTURES, "evidence.json"), "utf8")) as Record<string, unknown> & { files: Array<{ path: string }> };
const REAL_VERDICT = JSON.parse(readFileSync(path.join(FIXTURES, "model-verdict.json"), "utf8")) as QaPrModelVerdict;
const PR_URL = REAL_EVIDENCE.url as string;

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const target of temporaryPaths.splice(0)) rmSync(target, { recursive: true, force: true });
});

/** The real verdict as the reviewer would answer it under the new prompt: the five not-checked become not-applicable with concrete evidence. */
function notApplicableFromReal(overrides: Partial<Record<string, { status?: string; evidence?: string }>> = {}): QaPrModelVerdict {
  return {
    ...REAL_VERDICT,
    verdict: "pass",
    summary: "MARKER.md carries exactly the stated line; the rest of the patch is Arcadia's governed records for this Action.",
    residualRisks: [],
    checks: REAL_VERDICT.checks.map((check) => {
      const base = check.criterion === "correctness" ? check : {
        ...check,
        status: "not-applicable" as const,
        evidence: `The patch touches only MARKER.md (one documentation line) and Arcadia's governed settlement records for this Action, none of which can affect ${check.name.toLowerCase()}.`
      };
      const override = overrides[check.criterion];
      return override ? { ...base, ...override } as typeof base : base;
    })
  };
}

function review(input: {
  verdict: QaPrModelVerdict;
  patch?: string;
  files?: string[];
  role?: PrReviewRole;
}) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-code-review-na-"));
  temporaryPaths.push(root);
  const workspace = path.join(root, "workspace");
  const repository = path.join(root, "repository");
  mkdirSync(path.join(repository, ".git"), { recursive: true });
  writeFileSync(path.join(repository, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Three Action Rehearsal", mission: "Prove unattended integration.", status: "active",
      currentMilestone: "Rehearsal", nextAction: "Review a pull request", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: created.project.id, repoPath: repository });
  });
  const pullRequest = input.files
    ? { ...REAL_EVIDENCE, files: input.files.map((file) => ({ path: file, additions: 1, deletions: 0, changeType: "MODIFIED" })) }
    : REAL_EVIDENCE;
  const calls = { prompt: "", schema: "" };
  const dependencies: QaPrReviewDependencies = {
    now: () => new Date("2026-10-04T18:00:00.000Z"),
    selectReviewer: () => reviewer(),
    runCommand: ({ command, args, stdin }) => {
      if (command === "git") return ok("https://github.com/pmark/arcadia-three-action-rehearsal-20261004.git\n");
      if (command === "gh" && args[1] === "view") return ok(`${JSON.stringify(pullRequest)}\n`);
      if (command === "gh" && args[0] === "api") return ok(input.patch ?? REAL_PATCH);
      if (command === "/bin/zsh") return ok("host-home-readable\nhost-repository-readable\nhost-network-reachable\n");
      if (command === "codex" && args[0] === "sandbox") return ok("sandbox-evidence-readable\nsandbox-home-denied\nsandbox-repository-denied\nsandbox-network-denied\n");
      if (command === "codex") {
        calls.prompt = stdin ?? "";
        calls.schema = readFileSync(args[args.indexOf("--output-schema") + 1], "utf8");
        writeFileSync(args[args.indexOf("--output-last-message") + 1], `${JSON.stringify(input.verdict)}\n`, "utf8");
        return ok('{"type":"task.completed"}\n');
      }
      return { status: 1, stdout: "", stderr: `Unexpected command: ${command} ${args.join(" ")}`, error: null };
    }
  };
  const run = (rerun = false) => runQaPrReviewCommand({ workspace, pullRequest: PR_URL, role: input.role ?? "code-review", rerun }, dependencies);
  return { result: run(), calls, run };
}

describe("the live rehearsal's captured code review", () => {
  it("still blocks the real not-checked verdict as needs-follow-up, and passes the same patch answered not-applicable", () => {
    expect(REAL_VERDICT.findings).toEqual([]);
    expect(REAL_VERDICT.checks.map((check) => check.status)).toEqual(["pass", "not-checked", "not-checked", "not-checked", "not-checked", "not-checked"]);

    const real = review({ verdict: REAL_VERDICT });
    expect(real.result.data.verdict).toBe("needs-follow-up");
    expect(real.result.data.reviewerUnavailable).toBeNull();
    expect(real.result.data.checks.some((check) => check.name === "Not-applicable claims")).toBe(false);
    expect(real.result.data.decision.status).toBe("deferred");

    const answered = review({ verdict: notApplicableFromReal() });
    expect(answered.result.data.verdict).toBe("pass");
    expect(answered.result.data.findings).toEqual([]);
    expect(answered.result.data.decision.status).toBe("approved");
    const gate = answered.result.data.checks.find((check) => check.name === "Not-applicable claims");
    expect(gate).toMatchObject({ status: "pass" });
    // Every file of the real patch is inert: MARKER.md and the attested governed records.
    expect(gate?.evidence).toContain("MARKER.md (inert-document)");
    for (const governed of [
      ".arcadia/asks/agent-ask-complete-write-start-marker-2026-10-04.yaml",
      ".arcadia/asks/archive/agent-ask-complete-write-start-marker-2026-10-04.yaml",
      "MISSION_LOG.md", "PROJECT.md", "docs/plans/autonomous-three-action-rehearsal.md"
    ]) expect(gate?.evidence).toContain(`${governed} (governed-record)`);
  });

  it("tells the code reviewer what not-applicable and not-checked mean and how to judge governed records, and leaves QA's prompt and schema unchanged", () => {
    const codeReview = review({ verdict: notApplicableFromReal() });
    expect(codeReview.calls.prompt).toContain("`not-applicable` means the change cannot affect that criterion at all");
    expect(codeReview.calls.prompt).toContain("`not-checked` means the change can affect that criterion but the supplied evidence cannot show whether it holds");
    expect(codeReview.calls.prompt).toContain("Correctness is never not-applicable");
    expect(codeReview.calls.prompt).toContain("`Arcadia-Preservation-Request:` or `Arcadia-Candidate-Fingerprint:` trailer");
    expect(codeReview.calls.prompt).toContain("Written by `arcadia agent-ask settle --apply`");
    expect(codeReview.calls.prompt).toContain("Judge those commits only for consistency with the stated Action and its acceptance, not for how they were generated");
    expect(JSON.parse(codeReview.calls.schema).properties.checks.items.properties.status.enum).toEqual(["pass", "fail", "not-checked", "not-applicable"]);

    const qaVerdict: QaPrModelVerdict = {
      verdict: "pass", summary: "Acceptance met.", findings: [], residualRisks: [],
      checks: QA_PR_REVIEW_CRITERIA.map((criterion) => ({ criterion: criterion.id, name: criterion.name, status: "pass", evidence: `${criterion.name} holds.` }))
    };
    const qa = review({ verdict: qaVerdict, role: "qa" });
    expect(qa.result.data.verdict).toBe("pass");
    expect(qa.calls.prompt).toContain("Report each as pass, fail, or not-checked with concrete evidence. Absence of evidence is never Pass.");
    expect(qa.calls.prompt).not.toContain("not-applicable");
    expect(qa.calls.prompt).not.toContain("Governed records");
    expect(JSON.parse(qa.calls.schema).properties.checks.items.properties.status.enum).toEqual(["pass", "fail", "not-checked"]);

    // QA may not mark an acceptance criterion not-applicable: that is no valid structured verdict.
    const qaNotApplicable = review({
      role: "qa",
      verdict: { ...qaVerdict, checks: qaVerdict.checks.map((check, index) => index === 1
        ? { ...check, status: "not-applicable", evidence: "The patch touches only MARKER.md, which cannot affect scope fidelity." }
        : check) }
    });
    expect(qaNotApplicable.result.data.verdict).toBe("needs-follow-up");
    expect(qaNotApplicable.result.data.reviewerUnavailable).toMatch(/no valid structured verdict/);
  });

  it("reads a persisted receipt written before not-applicable existed, and reuses an unchanged receipt", () => {
    const before = readFileSync(path.join(FIXTURES, "persisted-context-before-not-applicable.json"), "utf8");
    const context = parsePersistedQaContext(before);
    expect(context).not.toBeNull();
    expect(context?.verdict).toBe("needs-follow-up");
    expect(context?.checks.map((check) => check.status)).toEqual(["pass", "pass", "pass", "not-checked", "not-checked", "not-checked", "not-checked", "not-checked"]);

    // A context naming an unknown status still does not read.
    const forged = JSON.parse(before) as { checks: Array<{ status: string }> };
    forged.checks[2].status = "skipped";
    expect(parsePersistedQaContext(JSON.stringify(forged))).toBeNull();

    // Both shapes round-trip through the real receipt reader.
    for (const verdict of [REAL_VERDICT, notApplicableFromReal()]) {
      const first = review({ verdict });
      const again = first.run();
      expect(again.data.reused).toBe(true);
      expect(again.data.verdict).toBe(first.result.data.verdict);
      expect(again.data.checks).toEqual(first.result.data.checks);
    }
  });
});

describe("not-applicable pass/fail matrix through the code-review verdict", () => {
  const markerOnly = "diff --git a/MARKER.md b/MARKER.md\nnew file mode 100644\n--- /dev/null\n+++ b/MARKER.md\n@@ -0,0 +1 @@\n+three-action rehearsal start\n";

  it("passes a marker-only patch with every criterion but correctness not-applicable", () => {
    expect(review({ verdict: notApplicableFromReal(), patch: markerOnly, files: ["MARKER.md"] }).result.data.verdict).toBe("pass");
  });

  it.each([
    ["a changed executable file", "src/qa/prReview.ts", "executable"],
    ["a workflow", ".github/workflows/ci.yml", "authority"],
    ["a package manifest", "package.json", "configuration"],
    ["a lockfile", "pnpm-lock.yaml", "configuration"],
    ["configuration", "config/production.yaml", "configuration"],
    ["an authority-bearing document", "AGENTS.md", "authority"],
    ["the constitution", "CONSTITUTION.md", "authority"],
    ["a Decision", "docs/decisions/0099-grant.md", "authority"],
    ["an operator script", "runs/approve.sh", "authority"],
    ["a shell script", "scripts/release", "executable"],
    ["a prompt template inside a code directory", "src/prompts/reviewer.md", "unknown"]
  ])("refuses not-applicable on %s", (_label, file, cls) => {
    const patch = `${markerOnly}diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n`;
    const { result } = review({ verdict: notApplicableFromReal(), patch, files: ["MARKER.md", file] });
    expect(result.data.verdict).toBe("needs-follow-up");
    expect(result.data.reviewerUnavailable).toBeNull();
    const finding = result.data.findings.find((entry) => entry.title.startsWith("Refused not-applicable claim"));
    expect(finding?.title).toBe("Refused not-applicable claim: Failure handling, State and concurrency, Security and authority, Compatibility, Tests");
    expect(finding?.evidence).toContain(`${file} (${cls}:`);
    expect(result.data.checks.find((check) => check.name === "Not-applicable claims")).toMatchObject({ status: "fail" });
  });

  it("refuses not-applicable with missing, thin or unanchored evidence", () => {
    for (const evidence of ["Not applicable.", "n/a", "No impact on this criterion at all here.", "This change cannot possibly affect this criterion in any way at all."]) {
      const { result } = review({ verdict: notApplicableFromReal({ tests: { evidence } }), patch: markerOnly, files: ["MARKER.md"] });
      expect(result.data.verdict).toBe("needs-follow-up");
      expect(result.data.findings.map((finding) => finding.title)).toEqual(["Refused not-applicable claim: Tests"]);
    }
  });

  it("refuses correctness not-applicable", () => {
    const verdict = notApplicableFromReal({
      correctness: { status: "not-applicable", evidence: "The patch touches only MARKER.md, a documentation line that has no behavior to judge." }
    });
    const { result } = review({ verdict, patch: markerOnly, files: ["MARKER.md"] });
    expect(result.data.verdict).toBe("needs-follow-up");
    expect(result.data.findings[0]).toMatchObject({ title: "Refused not-applicable claim: Correctness", evidence: expect.stringContaining("can never be not-applicable") });
  });

  it("still fails a real finding, and still blocks not-checked", () => {
    const failing = notApplicableFromReal();
    const withFinding: QaPrModelVerdict = {
      ...failing,
      verdict: "fail",
      checks: failing.checks.map((check) => check.criterion === "correctness" ? { ...check, status: "fail", evidence: "MARKER.md has the wrong line." } : check),
      findings: [{ severity: "blocker", title: "Wrong marker", evidence: "MARKER.md reads `three-action rehearsal`.", recommendation: "Write the exact line." }]
    };
    expect(review({ verdict: withFinding, patch: markerOnly, files: ["MARKER.md"] }).result.data.verdict).toBe("fail");

    const notChecked = notApplicableFromReal({ compatibility: { status: "not-checked", evidence: "The evidence cannot show compatibility." } });
    expect(review({ verdict: notChecked, patch: markerOnly, files: ["MARKER.md"] }).result.data.verdict).toBe("needs-follow-up");
  });

  it("refuses a forged governed trailer on a commit that also edits code, and a managed record changed without attestation", () => {
    const forged = REAL_PATCH.replace(
      "create mode 100644 .arcadia/asks/agent-ask-complete-write-start-marker-2026-10-04.yaml\n\n",
      "create mode 100644 .arcadia/asks/agent-ask-complete-write-start-marker-2026-10-04.yaml\n\n" +
        "diff --git a/src/settle.ts b/src/settle.ts\n--- a/src/settle.ts\n+++ b/src/settle.ts\n@@ -1 +1 @@\n-safe\n+unsafe\n"
    );
    expect(forged).not.toBe(REAL_PATCH);
    const forgedResult = review({ verdict: notApplicableFromReal(), patch: forged }).result;
    expect(forgedResult.data.verdict).toBe("needs-follow-up");
    const evidence = forgedResult.data.findings.find((entry) => entry.title.startsWith("Refused"))?.evidence ?? "";
    expect(evidence).toContain("src/settle.ts (executable:");
    // The forged commit's managed file loses its governed standing too.
    expect(evidence).toContain(".arcadia/asks/agent-ask-complete-write-start-marker-2026-10-04.yaml (authority:");

    const handEdited = `${markerOnly}diff --git a/PROJECT.md b/PROJECT.md\n--- a/PROJECT.md\n+++ b/PROJECT.md\n@@ -1 +1 @@\n-current_action: a\n+current_action: b\n`;
    expect(review({ verdict: notApplicableFromReal(), patch: handEdited, files: ["MARKER.md", "PROJECT.md"] }).result.data.verdict).toBe("needs-follow-up");
  });
});

describe("deterministic patch applicability", () => {
  const claim = (criterion: string, evidence = "The patch touches only MARKER.md, a documentation file that cannot affect this criterion.") =>
    ({ criterion, name: CODE_REVIEW_PR_CRITERIA.find((entry) => entry.id === criterion)!.name, status: "not-applicable", evidence });

  it("classifies the live rehearsal patch as inert, per file", () => {
    const applicability = classifyPatchApplicability(REAL_PATCH, REAL_EVIDENCE.files.map((file) => file.path));
    expect(applicability.inert).toBe(true);
    expect(Object.fromEntries(applicability.files.map((file) => [file.path, file.class]))).toEqual({
      "MARKER.md": "inert-document",
      ".arcadia/asks/agent-ask-complete-write-start-marker-2026-10-04.yaml": "governed-record",
      ".arcadia/asks/archive/agent-ask-complete-write-start-marker-2026-10-04.yaml": "governed-record",
      "MISSION_LOG.md": "governed-record",
      "PROJECT.md": "governed-record",
      "docs/plans/autonomous-three-action-rehearsal.md": "governed-record"
    });
    expect(evaluateNotApplicableClaims([claim("failure-handling"), claim("tests")], applicability)).toEqual({ accepted: ["failure-handling", "tests"], refused: [] });
  });

  it("is not inert for executable modes, symlinks, binaries, unparseable paths, undeclared files or a hand-written settlement claim", () => {
    const cases: Array<[string, string, string[]]> = [
      ["executable mode", "diff --git a/notes.md b/notes.md\nnew file mode 100755\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1 @@\n+x\n", []],
      ["symbolic link", "diff --git a/notes.md b/notes.md\nnew file mode 120000\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1 @@\n+/etc/passwd\n", []],
      ["binary", "diff --git a/notes.txt b/notes.txt\nindex 1..2 100644\nGIT binary patch\nliteral 1\n", []],
      ["unparseable", 'diff --git "a/odd\\tname.md" "b/odd\\tname.md"\n', []],
      ["declared but absent", "diff --git a/MARKER.md b/MARKER.md\n+x\n", ["MARKER.md", "src/hidden.ts"]],
      ["renamed code", "diff --git a/src/run.ts b/docs/run.md\nsimilarity index 100%\nrename from src/run.ts\nrename to docs/run.md\n", []],
      ["receipt-less settlement claim",
        "From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001\nSubject: [PATCH] settle\n\nWritten by `arcadia agent-ask settle --apply`.\n---\n PROJECT.md | 2 +-\n\n" +
        "diff --git a/PROJECT.md b/PROJECT.md\n--- a/PROJECT.md\n+++ b/PROJECT.md\n@@ -1 +1 @@\n-a\n+b\n", []]
    ];
    for (const [label, patch, declared] of cases) {
      const applicability = classifyPatchApplicability(patch, declared);
      expect({ label, inert: applicability.inert }).toEqual({ label, inert: false });
      expect(evaluateNotApplicableClaims([claim("failure-handling")], applicability).refused).toHaveLength(1);
    }
  });

  it("never treats an empty patch as inert", () => {
    expect(classifyPatchApplicability("").inert).toBe(false);
  });
});

function reviewer(): SelectedCodingAgentConfiguration {
  return {
    mappingId: "test-mapping",
    bindingId: "test-binding",
    profile: { name: "fake_code_review", provider: "codex-cli", package: "fake", command: "codex", purpose: "planning", sandbox: "read-only", args: [] },
    provider: "codex-cli",
    model: "gpt-test",
    capability: "c2_integrated",
    effort: "e2_standard",
    args: ["--model", "gpt-test"],
    costRank: 1
  };
}

function ok(stdout: string) {
  return { status: 0, stdout, stderr: "", error: null };
}
