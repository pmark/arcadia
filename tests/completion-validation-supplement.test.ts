import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { Rehearsal, LINE_A, hostReviewHost, HOST_REVIEW_PR_URL } from "./helpers/rehearsalHarness.js";
import { runQaPrReviewCommand } from "../src/qa/prReview.js";
import { withDatabase } from "../src/db/connection.js";
import { completionSupplementOperator } from "../src/operatorActions/operatorExecution.js";
import { completionSupplementLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import { completionSupplementState, produceCompletionSupplement, resolveCompletionSupplement, getSessionExitReceipt } from "../src/sessions/reconciliation.js";
import { beginIndependentVerdict, independentVerdictReadiness, finishIndependentVerdict, independentVerdictGate } from "../src/sessions/roleLineage.js";
import { getSession } from "../src/sessions/index.js";
import type { CompletionSupplementPin } from "../src/sessions/completionValidationEvidence.js";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyInitialSchema } from "../src/db/schema.js";
import { createArtifactRecord, updateArtifact } from "../src/db/repositories.js";
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const kind = "session_completion_validation_supplement_v1";
function fixture() { const db = new Database(":memory:"); databases.push(db); applyInitialSchema(db); return db; }
describe("supplement Artifact custody", () => {
  it("refuses generic registration and retyping into the reserved producer kind", () => {
    const db = fixture();
    expect(() => createArtifactRecord(db, { title: "forged", artifactType: kind, status: "ready", path: "/forged.json" })).toThrow(/reserved|producer/i);
    const ordinary = createArtifactRecord(db, { title: "ordinary", artifactType: "file" });
    expect(() => updateArtifact(db, ordinary.id, { artifactType: kind })).toThrow(/reserved|producer/i);
  });
  it("refuses every generic mutation of a reserved Artifact, including retyping out", () => {
    const db = fixture();
    const ordinary = createArtifactRecord(db, { title: "producer fixture", artifactType: "file" });
    // Disposable SQL fixture models an already registered canonical record.
    db.prepare("UPDATE artifacts SET artifact_type = ? WHERE id = ?").run(kind, ordinary.id);
    for (const update of [{ path: "/other" }, { title: "other" }, { status: "failed" }, { artifactType: "file" }]) {
      expect(() => updateArtifact(db, ordinary.id, update)).toThrow(/immutable|reserved/i);
    }
  });
});

const host = vi.hoisted(() => ({ parentCommand: "", validations: 0, afterValidation: null as null | (() => void), beforeValidation: null as null | (() => void) }));
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, execFileSync: (...args: Parameters<typeof actual.execFileSync>) => args[0] === "ps" ? host.parentCommand : actual.execFileSync(...args) };
});
vi.mock("../src/sessions/completionValidation.js", async original => {
  const actual = await original<typeof import("../src/sessions/completionValidation.js")>();
  return { ...actual, validateCompletionCandidate: (...args: Parameters<typeof actual.validateCompletionCandidate>) => {
    host.validations++; host.beforeValidation?.();
    try { return actual.validateCompletionCandidate(args[0], { ...args[1], unconfinedForTests: true }); } finally { host.afterValidation?.(); }
  } };
});
const rehearsals: Rehearsal[] = [];
afterEach(() => { host.beforeValidation = null; host.afterValidation = null; vi.unstubAllEnvs(); for (const r of rehearsals.splice(0)) r.dispose(); });
function candidate() {
  const criteria = [`MARKER.md contains ${LINE_A}.`, "tests/proof.test.mjs passes with node --test."];
  const actionsYaml = ["write-marker-a", "write-marker-b"].map((id, index) => `  - id: ${id}
    title: Implement MARKER.md containing marker ${index}
    status: open
    responsibility: agent
    effort: session
    next_action: Implement MARKER.md containing marker ${index}
    expected_artifact: MARKER.md
    clarification: clarified
    confidence: high
    acceptance_criteria:
${(index === 0 ? criteria : ["MARKER.md exists."]).map(c => `      - ${JSON.stringify(c)}`).join("\n")}
    depends_on: ${index ? "[write-marker-a]" : "[]"}
    decisions: []
`).join("");
  const r = new Rehearsal({ independentReviewers: false, fixturePlan: { firstAction: "write-marker-a", actionsYaml,
    genesisFiles: { "tests/proof.test.mjs": 'import test from "node:test"; import assert from "node:assert/strict"; test("actual host proof", () => { assert.equal(1, 1); });\n' } } });
  rehearsals.push(r); r.createFixtureRepository(); r.approve(r.registerProject()); r.activate();
  r.tickUntil(t => t.launch?.outcome === "launched", 3);
  const session = r.lease()!; r.agentEdit(session, "MARKER.md", `${LINE_A}\n`); r.agentFinish(session, criteria); r.tmux.exit(session.tmux_session_name);
  expect(r.tick().reconciled[0]?.outcome).toBe("accepted_completion");
  return { r, session: withDatabase(r.workspace, db => getSession(db, session.id)!) };
}
function operator(f: ReturnType<typeof candidate>, phase: "produce" | "code-review" | "qa", pin: CompletionSupplementPin | null = null) {
  const state = withDatabase(f.r.workspace, db => completionSupplementState(db, f.r.workspace, f.session));
  const id = `supplement-${phase}`;
  const library = path.join(f.r.repo, "artifacts/generated/operator-scripts"); mkdirSync(library, { recursive: true });
  const runId = `20261026000000000-${randomUUID()}`;
  const directory = path.join(library, "runs/operator", id, runId); mkdirSync(directory, { recursive: true });
  const descriptor: OperatorScriptDescriptor = { schema: "arcadia-operator-script-v1", id, script: `${id}.sh`, kind: "grant",
    title: "Disposable fixture operation", problem: "Fixture evidence gap", desired_effect: "One bounded fixture result", authority: { does: ["one operation"], never_does: ["production"] },
    success: { effect: "Retained", next: "Review" }, failure: { effect: "Held", next: "Inspect" }, expires_at: new Date(Date.now() + 3600000).toISOString(),
    completionSupplement: { schema: "arcadia-completion-supplement-action-v1", phase, requestId: `request-${phase}-fixture`, workspace: f.r.workspace,
      repository: f.r.repo, sessionId: f.session.id, inputRevision: state.binding.inputRevision, packetSha256: state.binding.packetSha256,
      preservationSha256: state.binding.preservationSha256, head: state.binding.head, tree: state.binding.tree, commandsSha256: state.binding.commandsSha256,
      artifact: pin ? { artifactId: pin.artifactId, sha256: pin.sha256 } : null, pullRequest: phase === "produce" ? null : HOST_REVIEW_PR_URL, bodySha256: phase === "produce" ? null : createHash("sha256").update("## QA plan\nRead MARKER.md.").digest("hex") } };
  const file = path.join(library, `${id}.json`), snapshot = path.join(directory, "descriptor.json"), runFile = path.join(directory, "run.json");
  writeFileSync(file, JSON.stringify(descriptor)); writeFileSync(snapshot, JSON.stringify(descriptor)); writeFileSync(path.join(library, descriptor.script), completionSupplementLauncher(id));
  const run = { schema: "arcadia-operator-script-run-v1", runId, scriptId: id, pid: process.ppid, status: "running", startedAt: new Date().toISOString() };
  writeFileSync(runFile, JSON.stringify(run));
  for (const [key, value] of Object.entries({ ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: file, ARCADIA_OPERATOR_SCRIPT_ID: id, ARCADIA_OPERATOR_SCRIPT_RUN_ID: runId,
    ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY: directory, ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR: snapshot })) vi.stubEnv(key, value);
  host.parentCommand = `const writeState = canonical fixture ${snapshot} ${runFile} ${runId}`;
  return { descriptor, file, runFile, run, finish: () => writeFileSync(runFile, JSON.stringify({ ...run, status: "succeeded", exitCode: 0, finishedAt: new Date().toISOString() })) };
}
function produce(f: ReturnType<typeof candidate>) {
  const op = operator(f, "produce"); const before = host.validations;
  const pin = withDatabase(f.r.workspace, db => produceCompletionSupplement(db, completionSupplementOperator(op.file)));
  expect(host.validations).toBe(before + 1); op.finish();
  return { op, pin };
}
describe("canonical append-only supplemental validation", () => {
  it("executes actual checks once, binds retained evidence and leaves old immutable history unchanged", () => {
    const f = candidate();
    // Preserve four real legacy terminal non-pass receipts; code5 is the sole
    // exceptional ordinal, not a reset or an unavailable-review allowance.
    withDatabase(f.r.workspace, db => {
      for (let ordinal = 1; ordinal <= 4; ordinal++) {
        const requestId = `legacy-code-review-${ordinal}`;
        beginIndependentVerdict(db, { session: f.session, repoRoot: f.r.repo, role: "code-review", requestId,
          actorId: "code-reviewer", executionCwd: f.r.root, retryAuthorized: true, now: new Date() });
        finishIndependentVerdict(db, { session: f.session, repoRoot: f.r.repo, requestId, actorId: "code-reviewer", verdict: "failed", receipt: { verdict: "fail", substantive: true }, now: new Date() });
      }
    });
    const old = withDatabase(f.r.workspace, db => ({ exit: getSessionExitReceipt(db, f.session.id), preservation: db.prepare("SELECT * FROM candidate_preservation_receipts").all(), attempts: db.prepare("SELECT * FROM session_role_attempts").all() }));
    const original = withDatabase(f.r.workspace, db => independentVerdictReadiness(db, { session: f.session, repoRoot: f.r.repo }));
    expect(original.ready).toBe(true);
    host.beforeValidation = () => withDatabase(f.r.workspace, db => {
      expect(() => beginIndependentVerdict(db, { session: f.session, repoRoot: f.r.repo, role: "code-review", requestId: "worker-interleaving-attempt",
        actorId: "other-reviewer", executionCwd: f.r.root, retryAuthorized: true, maxOrdinal: 99, now: new Date() })).toThrow(/not deterministically ready/);
    });
    const { op, pin } = produce(f); host.beforeValidation = null;
    const result = withDatabase(f.r.workspace, db => resolveCompletionSupplement(db, f.session, pin));
    expect(result.view.status).toBe("verified");
    expect(result.view.status === "verified" && result.view.record.reports[0].tests[0].name).toContain("actual host proof");
    withDatabase(f.r.workspace, db => {
      expect({ exit: getSessionExitReceipt(db, f.session.id), preservation: db.prepare("SELECT * FROM candidate_preservation_receipts").all(), attempts: db.prepare("SELECT * FROM session_role_attempts").all() }).toEqual(old);
      expect(independentVerdictReadiness(db, { session: f.session, repoRoot: f.r.repo })).toMatchObject({ ready: false });
      const selected = independentVerdictReadiness(db, { session: f.session, repoRoot: f.r.repo, supplement: pin });
      expect(selected.ready).toBe(true);
      if (original.ready && selected.ready) expect(selected.binding.evidenceFingerprint).not.toBe(original.binding.evidenceFingerprint);
    });
    // A second actual card press is a new run receipt, but the same exact
    // request reuses its immutable original registration without validation.
    const next = operator(f, "produce"); const count = host.validations;
    expect(withDatabase(f.r.workspace, db => produceCompletionSupplement(db, completionSupplementOperator(next.file)))).toEqual(pin);
    expect(host.validations).toBe(count); next.finish();
    expect(op.descriptor.completionSupplement!.phase).toBe("produce");
    const begin = (role: "code-review" | "qa", requestId: string) => withDatabase(f.r.workspace, db => beginIndependentVerdict(db, {
      session: f.session, repoRoot: f.r.repo, supplement: pin, role, requestId, actorId: `${role}-independent`, executionCwd: f.r.root,
      retryAuthorized: true, maxOrdinal: 99, now: new Date() }));
    const qa = operator(f, "qa", pin);
    expect(() => begin("qa", qa.descriptor.completionSupplement!.requestId)).toThrow(/requires a current passed/);
    let simulatedReviewers = 0;
    const review = (role: "code-review" | "qa") => {
      const card = operator(f, role, pin), p = card.descriptor.completionSupplement!;
      const stub = hostReviewHost(f.session, p.head);
      const result = runQaPrReviewCommand({ workspace: f.r.workspace, role, pullRequest: p.pullRequest!, completionSupplement: pin,
        expectedCandidate: { headSha: p.head, bodySha256: p.bodySha256!, inputRevision: p.inputRevision, maxOrdinal: 99 }, rerun: true },
        stub.dependencies);
      simulatedReviewers += stub.calls.reviewer;
      expect(result.data.verdict).toBe("pass");
      const immutable = JSON.parse(readFileSync(path.join(f.r.workspace, result.data.evidencePath), "utf8"));
      expect(immutable.completionSupplement).toEqual({ artifactId: pin.artifactId, sha256: pin.sha256, fingerprint: resultFingerprint });
      expect(immutable.completionExecutionEvidence).toContain("actual host proof");
      card.finish(); return card;
    };
    const resultFingerprint = result.fingerprint;
    const code = review("code-review");
    expect(() => begin("code-review", code.descriptor.completionSupplement!.requestId)).toThrow(/already consumed/);
    const qaAfter = review("qa");
    withDatabase(f.r.workspace, db => {
      expect(independentVerdictGate(db, { session: f.session, repoRoot: f.r.repo }).satisfied).toBe(true);
      expect(db.prepare("SELECT * FROM session_role_attempts WHERE ordinal <= 4 AND role = 'code-review'").all()).toEqual((old.attempts as { role: string }[]).filter(row => row.role === "code-review"));
      const selected = independentVerdictReadiness(db, { session: f.session, repoRoot: f.r.repo, supplement: pin });
      expect(selected.ready).toBe(true);
      const attempts = db.prepare("SELECT * FROM session_role_attempts WHERE request_id IN (?, ?)").all(code.descriptor.completionSupplement!.requestId, qaAfter.descriptor.completionSupplement!.requestId) as { ordinal: number; evidence_fingerprint: string; terminal_receipt_json: string }[];
      expect(attempts.map(a => a.ordinal).sort()).toEqual([1, 5]);
      for (const attempt of attempts) {
        if (selected.ready) expect(attempt.evidence_fingerprint).toBe(selected.binding.evidenceFingerprint);
        expect(JSON.parse(attempt.terminal_receipt_json).completionSupplement).toEqual(pin);
      }
    });
    expect(simulatedReviewers).toBe(2); // Simulated reviewers, zero provider/model calls.
    // Even an exact-context caller cannot turn caller-local maxOrdinal into6/QA2.
    for (const role of ["code-review", "qa"] as const) {
      const extra = operator(f, role, pin); extra.descriptor.completionSupplement!.requestId += "-extra";
      writeFileSync(extra.file, JSON.stringify(extra.descriptor));
      const snapshot = process.env.ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR!; writeFileSync(snapshot, JSON.stringify(extra.descriptor));
      expect(() => begin(role, extra.descriptor.completionSupplement!.requestId)).toThrow(/only code-review ordinal 5 and QA ordinal 1/);
      extra.finish();
    }
    writeFileSync(path.join(f.session.worktree_path, "later-code.txt"), "later code");
    withDatabase(f.r.workspace, db => {
      const requestId = code.descriptor.completionSupplement!.requestId;
      const attempt = db.prepare("SELECT * FROM session_role_attempts WHERE request_id = ?").get(requestId) as { actor_id: string };
      expect(finishIndependentVerdict(db, { session: f.session, repoRoot: f.r.repo, supplement: pin, requestId,
        actorId: attempt.actor_id, verdict: "passed", receipt: {}, now: new Date() }).stale).toBe(true);
      expect(db.prepare("SELECT * FROM session_role_attempts WHERE request_id = ?").get(requestId)).toEqual(attempt);
      expect(independentVerdictGate(db, { session: f.session, repoRoot: f.r.repo }).satisfied).toBe(false);
    });
  });
  it("rejects missing, forged and partial pins before allocating any reviewer", () => {
    const f = candidate();
    const action = operator(f, "produce"); const before = host.validations;
    const operatorProof = completionSupplementOperator(action.file);
    expect(() => withDatabase(f.r.workspace, db => produceCompletionSupplement(db, { ...operatorProof, run: { ...operatorProof.run, ref: "/arbitrary/reference" } }))).toThrow(/actual current operator run/);
    writeFileSync(action.runFile, JSON.stringify({ ...action.run, pid: 0 }));
    expect(() => completionSupplementOperator(action.file)).toThrow(/running parent/);
    writeFileSync(action.runFile, JSON.stringify(action.run));
    const parent = host.parentCommand; host.parentCommand = "ordinary inherited environment";
    expect(() => completionSupplementOperator(action.file)).toThrow(/canonical operator script runner/); host.parentCommand = parent;
    const expired = { ...action.descriptor, expires_at: "2020-01-01T00:00:00Z" };
    writeFileSync(action.file, JSON.stringify(expired)); expect(() => completionSupplementOperator(action.file)).toThrow(/expired/);
    writeFileSync(action.file, JSON.stringify(action.descriptor));
    expect(() => validateOperatorScriptContract(action.descriptor, action.descriptor.id, completionSupplementLauncher(action.descriptor.id) + "echo arbitrary command\n")).toThrow(/canonical launcher/);
    expect(host.validations).toBe(before);
    const { pin } = produce(f);
    withDatabase(f.r.workspace, db => {
      const n = db.prepare("SELECT COUNT(*) AS n FROM session_role_attempts").get();
      for (const selected of [undefined, { ...pin, sha256: "0".repeat(64) }, { ...pin, artifactId: "artifact_foreign" }, { ...pin, workspace: f.r.root }]) {
        expect(() => beginIndependentVerdict(db, { session: f.session, repoRoot: f.r.repo, supplement: selected, role: "code-review", requestId: "negative-fixture-request", actorId: "independent", executionCwd: f.r.root, now: new Date() })).toThrow();
        expect(db.prepare("SELECT COUNT(*) AS n FROM session_role_attempts").get()).toEqual(n);
      }
      const artifact = db.prepare("SELECT path FROM artifacts WHERE id = ?").get(pin.artifactId) as { path: string };
      const registration = path.join(path.dirname(artifact.path), "registration.json"); const retained = readFileSync(registration);
      rmSync(registration); expect(() => resolveCompletionSupplement(db, f.session, pin)).toThrow(/registration|ENOENT/); writeFileSync(registration, retained);
      const bytes = readFileSync(artifact.path); writeFileSync(artifact.path, "{}"); expect(() => resolveCompletionSupplement(db, f.session, pin)).toThrow(/hash/); writeFileSync(artifact.path, bytes);
      const elsewhere = path.join(f.r.root, "copied-envelope.json"); writeFileSync(elsewhere, bytes); rmSync(artifact.path); symlinkSync(elsewhere, artifact.path);
      expect(() => resolveCompletionSupplement(db, f.session, pin)).toThrow(/symlink/);
    });
  });
  it("retains a failed execution and consumed request without allocation or reexecution", () => {
    const f = candidate(); const op = operator(f, "produce");
    const file = path.join(f.session.worktree_path, "tests/proof.test.mjs"), original = readFileSync(file);
    host.beforeValidation = () => writeFileSync(file, 'import test from "node:test"; test("actual failed proof", () => { throw new Error("fixture failure"); });\n');
    host.afterValidation = () => writeFileSync(file, original);
    const count = host.validations;
    expect(() => withDatabase(f.r.workspace, db => produceCompletionSupplement(db, completionSupplementOperator(op.file)))).toThrow(/did not pass/);
    host.beforeValidation = null; host.afterValidation = null;
    expect(host.validations).toBe(count + 1);
    expect(() => withDatabase(f.r.workspace, db => produceCompletionSupplement(db, completionSupplementOperator(op.file)))).toThrow(/ENOENT/);
    expect(host.validations).toBe(count + 1);
    withDatabase(f.r.workspace, db => {
      expect(independentVerdictReadiness(db, { session: f.session, repoRoot: f.r.repo }).ready).toBe(false);
      expect(db.prepare("SELECT COUNT(*) AS n FROM session_role_attempts WHERE role IN ('code-review','qa')").get()).toEqual({ n: 0 });
    });
  });
  it("rejects altered schema/binding/provenance, oversized files and later code edits", () => {
    const f = candidate(); const { pin } = produce(f);
    withDatabase(f.r.workspace, db => {
      const artifact = db.prepare("SELECT path FROM artifacts WHERE id = ?").get(pin.artifactId) as { path: string };
      const bytes = readFileSync(artifact.path, "utf8"), envelope = JSON.parse(bytes);
      const registrationFile = path.join(path.dirname(artifact.path), "registration.json"), originalRegistration = readFileSync(registrationFile, "utf8");
      const registration = JSON.parse(originalRegistration);
      for (const altered of [ { ...envelope, schema: "unknown/2" }, { ...envelope, binding: { ...envelope.binding, sessionId: "foreign" } },
        { ...envelope, binding: { ...envelope.binding, packetSha256: "0".repeat(64) } }, { ...envelope, binding: { ...envelope.binding, inputRevision: "0".repeat(64) } },
        { ...envelope, operator: { ...envelope.operator, descriptor: { ...envelope.operator.descriptor, sha256: "0".repeat(64) } } },
        { ...envelope, validation: { ...envelope.validation, sha256: "0".repeat(64) } }, { ...envelope, after: "changed" } ]) {
        const text = JSON.stringify(altered), sha256 = createHash("sha256").update(text).digest("hex");
        writeFileSync(artifact.path, text); writeFileSync(registrationFile, JSON.stringify({ ...registration, sha256 }));
        expect(() => resolveCompletionSupplement(db, f.session, { ...pin, sha256 })).toThrow();
      }
      writeFileSync(artifact.path, "x".repeat(65537)); expect(() => resolveCompletionSupplement(db, f.session, pin)).toThrow(/bounded/);
      writeFileSync(artifact.path, bytes); writeFileSync(registrationFile, originalRegistration);
      writeFileSync(path.join(f.session.worktree_path, "later-code.txt"), "later code");
      expect(() => resolveCompletionSupplement(db, f.session, pin)).toThrow(/clean/);
    });
  });

});
