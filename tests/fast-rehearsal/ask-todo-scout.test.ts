import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../../src/commands/ask.js";
import { runAskShowCommand } from "../../src/commands/askTrail.js";
import { runTodoCommand } from "../../src/commands/todo.js";
import { withReadOnlyDatabase, withDatabase } from "../../src/db/connection.js";
import { attachArtifactToExecutionRun, createArtifactRecord, createMilestoneForProject, createProjectWithInitialWork, upsertProjectMetadata } from "../../src/db/repositories.js";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";
import { PhaseRecorder, sanitizer, writeScenarioReport } from "./helpers/report.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";

const REQUEST_ID = "ask-todo-scout-hello-world-20261012";
const APPROVAL_REQUEST_ID = `${REQUEST_ID}-approval`;
const PROJECT = "Ask To-do Scout";
const OUTPUT_PATH = "HelloWorld.txt";
const OUTPUT_BYTES = Buffer.from("Hello World!\n", "utf8");
const SCENARIO = "Ask/To-do scout";
const NEXT_STEP = "Issue #1320: expose the correlated queued/running review Run and its truthful state in Ask and To-do; then rerun this scout with a worker-capable fixture.";

interface ScoutState {
  outcome: "yes" | "no";
  firstBlocker: string | null;
  identifiers: Record<string, string | null>;
    transcript: Array<{ command: "ask" | "todo"; input: string; result: unknown }>;
  artifactCheck: { path: string; expectedSha256: string; actualSha256: string | null; canonicalPath: string; exists: boolean; exactBytes: boolean; acceptedCompletionEvidence: boolean; evidence: Array<{ id: string; path: string | null; canonicalPath: string | null; status: string; work_item_id: string | null; linkedRunIds: string[] }> };
  launched: { queued: boolean; launched: boolean; publicRunId: string | null; runId: string | null; runStatus: string | null; workItemId: string | null; linkedArtifactIds: string[]; executionObserved: boolean };
  modelUsage: { calls: 0; tokens: 0; guardCalls: string[]; proof: string[] };
  findings: Array<{ code: string; detail: string; fingerprint: string; proposedNextStep: string }>;
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

function canonicalArtifactPath(repo: string, artifactPath: string | null): string | null {
  if (!artifactPath) return null;
  const relative = path.relative(repo, path.resolve(repo, artifactPath));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function acceptedCompletion(
  run: { id: string; status: string; work_item_id: string | null; linkedArtifactIds: string[] },
  artifacts: ScoutState["artifactCheck"]["evidence"]
): boolean {
  return run.status === "completed" && run.work_item_id !== null && artifacts.some((artifact) =>
    artifact.canonicalPath === OUTPUT_PATH && ["ready", "published"].includes(artifact.status) &&
    artifact.work_item_id === run.work_item_id && run.linkedArtifactIds.includes(artifact.id) && artifact.linkedRunIds.includes(run.id)
  );
}

function scoutPasses(
  fileExists: boolean,
  exactBytes: boolean,
  run: { id: string; status: string; work_item_id: string | null; linkedArtifactIds: string[] } | undefined,
  artifacts: ScoutState["artifactCheck"]["evidence"]
): boolean {
  return fileExists && exactBytes && Boolean(run && acceptedCompletion(run, artifacts));
}

describe("Ask/To-do scout", () => {
  it("writes a binary report for the bounded Hello World Ask journey", () => {
    const began = performance.now();
    const isolation: IsolatedProcess = isolateProcess();
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-ask-todo-scout-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const repo = path.join(root, "project-repo");
    const recorder = new PhaseRecorder(SCENARIO, import.meta.filename, sanitizer([[root, "<scout>"]]));
    const scout: ScoutState = {
      outcome: "no", firstBlocker: "Journey did not reach a verified completion state.",
      identifiers: { requestId: REQUEST_ID, captureId: null, askId: null, reviewId: null, approvalRequestId: APPROVAL_REQUEST_ID, approvalCaptureId: null, approvalAskId: null, runId: null },
      transcript: [],
      artifactCheck: { path: OUTPUT_PATH, expectedSha256: hash(OUTPUT_BYTES), actualSha256: null, canonicalPath: OUTPUT_PATH, exists: false, exactBytes: false, acceptedCompletionEvidence: false, evidence: [] },
      launched: { queued: false, launched: false, publicRunId: null, runId: null, runStatus: null, workItemId: null, linkedArtifactIds: [], executionObserved: false },
      modelUsage: { calls: 0, tokens: 0, guardCalls: [], proof: ["For this deterministic scout only: runAskCommand, runTodoCommand and Ask show are the sole interaction paths.", "Provider binary guards recorded zero calls; their exact call list is retained in guardCalls.", "Ask intent resolution uses the deterministic local registry and does not call a model adapter; zero tokens excludes coding-agent implementation work."] },
      findings: []
    };
    let journeyError: unknown = null;
    let providerGuardCalls: string[];

    try {
      initWorkspace(workspace);
      mkdirSync(repo, { recursive: true });
      const created = withDatabase(workspace, (db) => createProjectWithInitialWork(db, {
        name: PROJECT, mission: "Disposable fixture for a zero-model Ask and To-do scout.",
        goal: "Observe whether a user-approved Hello World request reaches a completed artifact.",
        status: "active", currentMilestone: "Scout fixture", nextAction: "Keep the scout fixture ready.",
        workClassification: "agent"
      }));
      withDatabase(workspace, (db) => {
        createMilestoneForProject(db, created.project.id, "Hello World scout");
        upsertProjectMetadata(db, { projectId: created.project.id, repoPath: repo, aliases: [PROJECT], validationCommands: [] });
      });

      const request = `Implement ${OUTPUT_PATH} in ${PROJECT}, containing exactly the bytes "Hello World!\\n".`;
      const first = runAskCommand({ workspace, project: PROJECT, request, requestId: REQUEST_ID });
      const reviewId = first.data.reviewItemId ?? null;
      scout.identifiers.captureId = first.data.captureEnvelope.id;
      scout.identifiers.askId = first.data.ask?.id ?? null;
      scout.identifiers.reviewId = reviewId;
      scout.transcript.push({ command: "ask", input: request, result: { status: first.data.result.status, summary: first.data.result.summary, captureId: first.data.captureEnvelope.id, askId: first.data.ask?.id ?? null, reviewItemId: reviewId, resolvedIntent: first.data.resolvedIntent.intentId } });

      const todoBefore = runTodoCommand({ workspace, project: created.project.slug, fixtureRoots: [], now: new Date("2026-10-12T19:23:00.000Z") });
      const visibleBefore = todoBefore.data.items.filter((item) => item.sourceRef === `review_items:${reviewId}`);
      scout.transcript.push({ command: "todo", input: `project=${created.project.slug} after initial Ask`, result: { schema: todoBefore.data.schema, matchingReviewItems: visibleBefore } });

      if (!reviewId) throw new Error("Initial Ask created no Requires Review item.");
      const approvalText = `approve ${reviewId}`;
      const approval = runAskCommand({ workspace, request: approvalText, requestId: APPROVAL_REQUEST_ID, adapterMetadata: { reviewId } });
      expect(approval.data.result.status).toBe("queued");
      expect(approval.data.result.summary).not.toMatch(/resum|execution is running/i);
      expect(approval.data.run?.status).toBe("pending_execution");
      scout.identifiers.approvalCaptureId = approval.data.captureEnvelope.id;
      scout.identifiers.approvalAskId = approval.data.ask?.id ?? null;
      scout.transcript.push({ command: "ask", input: `${approvalText} (fixture operator approval transported with reviewId=${reviewId})`, result: { status: approval.data.result.status, summary: approval.data.result.summary, captureId: approval.data.captureEnvelope.id, askId: approval.data.ask?.id ?? null, run: approval.data.run ?? null } });

      const trail = runAskShowCommand({ workspace, id: REQUEST_ID });
      scout.transcript.push({ command: "ask", input: `show ${REQUEST_ID}`, result: trail.data });
      const todoAfter = runTodoCommand({ workspace, project: created.project.slug, fixtureRoots: [], now: new Date("2026-10-12T19:23:00.000Z") });
      const visibleAfter = todoAfter.data.items.filter((item) => item.sourceRef === `review_items:${reviewId}`);
      scout.transcript.push({ command: "todo", input: `project=${created.project.slug} after fixture approval`, result: { schema: todoAfter.data.schema, matchingReviewItems: visibleAfter, agentWork: todoAfter.data.agentWork, runs: todoAfter.data.runs } });

      // Both public read paths must preserve every existing Run state and linked Artifact evidence.
      const queuedRunId = approval.data.run?.id;
      if (!queuedRunId) throw new Error("Default Ask approval returned no queued Run id.");
      const artifactId = withDatabase(workspace, (db) => {
        const artifact = createArtifactRecord(db, { projectId: created.project.id, title: "HelloWorld.txt", artifactType: "text", status: "planned", path: OUTPUT_PATH });
        attachArtifactToExecutionRun(db, queuedRunId, artifact.id);
        return artifact.id;
      });
      for (const status of ["pending_execution", "running", "failed", "requires_review", "completed"]) {
        withDatabase(workspace, (db) => db.prepare("UPDATE execution_runs SET status = ?, summary = ? WHERE id = ?").run(status, status === "failed" ? "fixture failure" : "fixture summary", queuedRunId));
        const askEvidence = runAskShowCommand({ workspace, id: REQUEST_ID }).data.asks[0]?.runs[0];
        const todoEvidence = runTodoCommand({ workspace, project: created.project.slug, fixtureRoots: [] }).data.runs.find((run) => run.id === queuedRunId);
        expect(askEvidence).toEqual(todoEvidence);
        expect(askEvidence).toMatchObject({ id: queuedRunId, status, artifacts: [{ id: artifactId, status: "planned", evidenceReference: OUTPUT_PATH }] });
        expect(Boolean(askEvidence?.waitingReason)).toBe(["pending_execution", "failed", "requires_review"].includes(status));
      }
      const beforePollCounts = withDatabase(workspace, (db) => (db.prepare(`SELECT
        (SELECT COUNT(*) FROM ask_requests) AS asks,
        (SELECT COUNT(*) FROM work_items) AS actions,
        (SELECT COUNT(*) FROM execution_runs) AS runs`).get() as { asks: number; actions: number; runs: number }));
      runAskShowCommand({ workspace, id: REQUEST_ID });
      runAskShowCommand({ workspace, id: REQUEST_ID });
      runTodoCommand({ workspace, project: created.project.slug, fixtureRoots: [] });
      runTodoCommand({ workspace, project: created.project.slug, fixtureRoots: [] });
      expect(withDatabase(workspace, (db) => db.prepare(`SELECT
        (SELECT COUNT(*) FROM ask_requests) AS asks,
        (SELECT COUNT(*) FROM work_items) AS actions,
        (SELECT COUNT(*) FROM execution_runs) AS runs`).get())).toEqual(beforePollCounts);
      withDatabase(workspace, (db) => db.prepare("UPDATE execution_runs SET status = 'pending_execution' WHERE id = ?").run(queuedRunId));

      const dbEvidence = withReadOnlyDatabase(workspace, (db) => {
        const run = db.prepare("SELECT id, status, review_item_id, work_item_id FROM execution_runs WHERE review_item_id = ? ORDER BY created_at DESC LIMIT 1").get(reviewId) as { id: string; status: string; review_item_id: string; work_item_id: string | null } | undefined;
        const artifacts = db.prepare("SELECT a.id, a.path, a.status, a.work_item_id, ra.run_id AS linked_run_id FROM artifacts a LEFT JOIN run_artifacts ra ON ra.artifact_id = a.id").all() as Array<{ id: string; path: string | null; status: string; work_item_id: string | null; linked_run_id: string | null }>;
        const linkedArtifactIds = run ? db.prepare("SELECT artifact_id FROM run_artifacts WHERE run_id = ?").all(run.id).map((row) => (row as { artifact_id: string }).artifact_id) : [];
        const groupedArtifacts = new Map<string, ScoutState["artifactCheck"]["evidence"][number]>();
        for (const artifact of artifacts) {
          const previous = groupedArtifacts.get(artifact.id) ?? {
            id: artifact.id, path: artifact.path, canonicalPath: canonicalArtifactPath(repo, artifact.path),
            status: artifact.status, work_item_id: artifact.work_item_id, linkedRunIds: []
          };
          if (artifact.linked_run_id && !previous.linkedRunIds.includes(artifact.linked_run_id)) previous.linkedRunIds.push(artifact.linked_run_id);
          groupedArtifacts.set(artifact.id, previous);
        }
        return { run, linkedArtifactIds, artifacts: [...groupedArtifacts.values()] };
      });
      const outputFile = path.join(repo, OUTPUT_PATH);
      scout.artifactCheck.exists = existsSync(outputFile);
      scout.artifactCheck.exactBytes = scout.artifactCheck.exists && readFileSync(outputFile).equals(OUTPUT_BYTES);
      scout.artifactCheck.actualSha256 = scout.artifactCheck.exists ? hash(readFileSync(outputFile)) : null;
      scout.artifactCheck.evidence = dbEvidence.artifacts;
      scout.artifactCheck.acceptedCompletionEvidence = Boolean(dbEvidence.run && acceptedCompletion({ ...dbEvidence.run, linkedArtifactIds: dbEvidence.linkedArtifactIds }, dbEvidence.artifacts));
      scout.launched = {
        queued: dbEvidence.run?.status === "pending_execution", launched: Boolean(dbEvidence.run && dbEvidence.run.status !== "pending_execution"),
        publicRunId: approval.data.run?.id ?? null, runId: dbEvidence.run?.id ?? null,
        runStatus: dbEvidence.run?.status ?? null,
        workItemId: dbEvidence.run?.work_item_id ?? null, linkedArtifactIds: dbEvidence.linkedArtifactIds,
        executionObserved: Boolean(dbEvidence.run && dbEvidence.run.status !== "pending_execution")
      };
      scout.identifiers.runId = scout.launched.runId;
      const success = scoutPasses(scout.artifactCheck.exists, scout.artifactCheck.exactBytes, dbEvidence.run ? { ...dbEvidence.run, linkedArtifactIds: dbEvidence.linkedArtifactIds } : undefined, dbEvidence.artifacts);
      scout.outcome = success ? "yes" : "no";
      scout.firstBlocker = success ? null : dbEvidence.run?.status === "pending_execution"
        ? "The approved Ask queued a review-execution Run, but no worker executed it; completion Artifact evidence is still absent."
        : "No exact HelloWorld.txt with matching completed-run and ready/published Artifact evidence exists.";
      if (!success) {
        const details = [scout.firstBlocker, `run=${dbEvidence.run?.status ?? "missing"}`, `fileExact=${scout.artifactCheck.exactBytes}`, `acceptedEvidence=${scout.artifactCheck.acceptedCompletionEvidence}`].join("\n");
        scout.findings.push({ code: "queued-run-not-execution", detail: details, fingerprint: hash(`queued-run-not-execution\n${details}`), proposedNextStep: NEXT_STEP });
      }
    } catch (error) {
      journeyError = error;
      scout.firstBlocker = error instanceof Error ? error.message : String(error);
      const details = `Journey stopped before completion proof: ${scout.firstBlocker}`;
      scout.findings.push({ code: "journey-stopped", detail: details, fingerprint: hash(`journey-stopped\n${details}`), proposedNextStep: NEXT_STEP });
    } finally {
      providerGuardCalls = isolation.guardCalls();
      scout.modelUsage.guardCalls = providerGuardCalls;
      if (providerGuardCalls.length) {
        const details = `Provider guard calls were observed: ${providerGuardCalls.join(" | ")}`;
        scout.findings.push({ code: "provider-call-guard-triggered", detail: details, fingerprint: hash(`provider-call-guard-triggered\n${details}`), proposedNextStep: "Fix the scout boundary before running it again; no provider invocation is permitted." });
        scout.firstBlocker ??= details;
        scout.outcome = "no";
      }
      const report = recorder.build("unsandboxed", 0, []);
      report.wallMs = Math.round(performance.now() - began);
      report.notes.push("Scout runner success means the bounded journey and report completed; scout.outcome=yes is the separate product completion result.");
      report.scout = scout;
      writeScenarioReport(report);
      isolation.restore();
    }

    if (journeyError instanceof Error) throw journeyError;
    if (journeyError !== null) throw new Error(String(journeyError));
    expect(providerGuardCalls).toEqual([]);
    expect(scout.outcome).toBe("no");
    expect(scout.identifiers.captureId).toMatch(/^capture_/);
    expect(scout.identifiers.reviewId).toMatch(/^review_/);
    expect(scout.launched.runStatus).toBe("pending_execution");
    expect(scout.launched.queued).toBe(true);
    expect(scout.launched.launched).toBe(false);
    expect(scout.launched.publicRunId).toBe(scout.launched.runId);
    const askRun = runAskShowCommand({ workspace, id: REQUEST_ID }).data.asks[0]?.runs[0];
    const todoRun = runTodoCommand({ workspace, fixtureRoots: [] }).data.runs[0];
    expect(askRun).toMatchObject({ id: scout.launched.runId, status: "pending_execution" });
    expect(todoRun).toEqual(askRun);
    expect(scout.launched.executionObserved).toBe(false);
    expect(scout.artifactCheck.exactBytes).toBe(false);
    expect(scout.artifactCheck.acceptedCompletionEvidence).toBe(false);
    expect(scout.modelUsage).toMatchObject({ calls: 0, tokens: 0 });
  });

  it("does not pass an existing file without correlated completed-run Artifact evidence", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-scout-negative-oracle-"));
    roots.push(root);
    const file = path.join(root, OUTPUT_PATH);
    writeFileSync(file, OUTPUT_BYTES);
    expect(canonicalArtifactPath(root, OUTPUT_PATH)).toBe(OUTPUT_PATH);
    expect(canonicalArtifactPath(root, file)).toBe(OUTPUT_PATH);
    const staleArtifact = { id: "artifact-stale", path: OUTPUT_PATH, canonicalPath: OUTPUT_PATH, status: "ready", work_item_id: "work-1", linkedRunIds: [] };
    const completedRunWithoutArtifactLink = { id: "run-target", status: "completed", work_item_id: "work-1", linkedArtifactIds: [] };
    expect(scoutPasses(existsSync(file), readFileSync(file).equals(OUTPUT_BYTES), completedRunWithoutArtifactLink, [staleArtifact])).toBe(false);
    expect(acceptedCompletion({ id: "run-target", status: "completed", work_item_id: "work-1", linkedArtifactIds: [] }, [staleArtifact])).toBe(false);
    expect(acceptedCompletion({ id: "run-target", status: "completed", work_item_id: null, linkedArtifactIds: ["artifact-stale"] }, [staleArtifact])).toBe(false);
  });

  it("validates the combined report and preserves diagnostics for missing, malformed, bare-yes, and contradictory-yes reports", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-scout-launcher-regression-"));
    roots.push(root);
    const scriptDir = path.join(root, "project", "artifacts", "generated", "operator-scripts");
    const fakeBin = path.join(root, "fake-bin");
    const reports = path.join(root, "reports");
    mkdirSync(scriptDir, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(reports, { recursive: true });
    const sourceScript = path.resolve(import.meta.dirname, "../../artifacts/generated/operator-scripts/run-scout-hello-world-probe.sh");
    const launcher = path.join(scriptDir, "run-scout-hello-world-probe.sh");
    copyFileSync(sourceScript, launcher);
    chmodSync(launcher, 0o755);
    const fakeMise = path.join(fakeBin, "mise");
    writeFileSync(fakeMise, `#!/bin/sh
if [ "\${SCOUT_FAKE_MODE}" = missing ]; then printf 'no report produced\\n'; else printf 'Fast rehearsal report path: %s\\n' "\${SCOUT_REPORT}"; fi
exit 0
`);
    chmodSync(fakeMise, 0o755);

    const noScout = () => ({
      outcome: "no",
      firstBlocker: "The Run is queued but no worker executed it.",
      identifiers: { requestId: REQUEST_ID, captureId: "capture-1", askId: "ask-1", reviewId: "review-1", approvalRequestId: APPROVAL_REQUEST_ID, approvalCaptureId: "capture-2", approvalAskId: "ask-2", runId: "run-1" },
      transcript: [
        { command: "ask", input: "create HelloWorld.txt", result: { status: "requires_review" } },
        { command: "todo", input: "inspect review item", result: { matchingReviewItems: [] } },
        { command: "ask", input: "show request", result: { asks: [] } }
      ],
      artifactCheck: { path: OUTPUT_PATH, expectedSha256: hash(OUTPUT_BYTES), actualSha256: null, canonicalPath: OUTPUT_PATH, exists: false, exactBytes: false, acceptedCompletionEvidence: false, evidence: [] },
      launched: { queued: true, launched: false, publicRunId: null, runId: "run-1", runStatus: "pending_execution", workItemId: null, linkedArtifactIds: [], executionObserved: false },
      modelUsage: { calls: 0, tokens: 0, guardCalls: [], proof: ["deterministic fixture"] },
      findings: [{ code: "queued-run-not-execution", detail: "No worker ran.", fingerprint: "a".repeat(64), proposedNextStep: "Issue #1320: expose the queued Run." }]
    });
    const makeReport = (scout: Record<string, unknown>) => ({
      wallMs: 100, vitestStatus: 0, reportDir: "/tmp/fast-rehearsal", scenarios: [{
        scenario: SCENARIO, file: "tests/fast-rehearsal/ask-todo-scout.test.ts", validator: "unsandboxed", wallMs: 10,
        ticks: 0, actions: [], tickLog: [], errors: [], notes: [], workerLog: [], scout
      }]
    });
    const bareYes = makeReport({ outcome: "yes" });
    const contradictoryYesScout = noScout();
    contradictoryYesScout.outcome = "yes";
    const cases: Array<{ mode: string; report?: unknown; succeeds: boolean; retained: boolean }> = [
      { mode: "missing", succeeds: false, retained: false },
      { mode: "malformed", report: "{broken\n", succeeds: false, retained: true },
      { mode: "bare-yes", report: JSON.stringify(bareYes), succeeds: false, retained: true },
      { mode: "contradictory-yes", report: JSON.stringify(makeReport(contradictoryYesScout)), succeeds: false, retained: true },
      { mode: "valid-no", report: JSON.stringify(makeReport(noScout())), succeeds: true, retained: true }
    ];

    for (const testCase of cases) {
      const reportPath = path.join(reports, `${testCase.mode}.json`);
      if (testCase.report !== undefined) writeFileSync(reportPath, testCase.report);
      const result = spawnSync("bash", [launcher, "run"], {
        cwd: root,
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, SCOUT_FAKE_MODE: testCase.mode === "missing" ? "missing" : "report", SCOUT_REPORT: reportPath }
      });
      const receiptMatch = `${result.stdout}\n${result.stderr}`.match(/Receipt: (.+?)(?:\. Handoff:|\n|$)/);
      expect(receiptMatch, `${testCase.mode} did not print its receipt path`).not.toBeNull();
      const receiptPath = receiptMatch![1];
      const runDirectory = path.dirname(receiptPath);
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as { outcome: string; scoutOutcome: string; retainedReportPath: string };
      if (testCase.succeeds) {
        expect(result.status).toBe(0);
        expect(receipt).toMatchObject({ outcome: "succeeded", scoutOutcome: "no" });
        expect(existsSync(path.join(runDirectory, "failure-handoff.md"))).toBe(false);
      } else {
        expect(result.status).not.toBe(0);
        expect(receipt.outcome).toBe("failed");
        expect(existsSync(path.join(runDirectory, "failure-handoff.md"))).toBe(true);
      }
      expect(Boolean(receipt.retainedReportPath)).toBe(testCase.retained);
      if (testCase.retained) expect(readFileSync(receipt.retainedReportPath, "utf8")).toBe(String(testCase.report));
    }
  });
});
