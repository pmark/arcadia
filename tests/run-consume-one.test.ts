import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
import { runWorkerIteration } from "../src/commands/worker.js";
import { reduceExecutionOutcome } from "../src/execution/runFinalization.js";
import { executeApprovedReview } from "../src/execution/reviewExecutor.js";
import { runAskShowCommand } from "../src/commands/askTrail.js";
import { runRunConsumeCommand, type RunConsumeOptions } from "../src/commands/runConsume.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, createReviewExecutionRun, createReviewItem, getExecutionRun, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { isolateProcess, type IsolatedProcess } from "./fast-rehearsal/helpers/environment.js";
import { repoRoot, tsxLoader, runCli } from "./cli-response-fixture.js";

const roots: string[] = [];
let isolation: IsolatedProcess | undefined;
afterEach(() => { expect(isolation?.guardCalls() ?? []).toEqual([]); isolation?.restore(); isolation = undefined; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
function fixture(scriptBody = 'writeFileSync("HelloWorld.txt", "Hello World!\\n");') {
  isolation = isolateProcess();
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-consume-one-"))); roots.push(workspace);
  initWorkspace(workspace, { experiment: { enabled: true, allowedRepoRoot: "projects" } });
  const repo = path.join(workspace, "projects", "hello"); mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const project = withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, { name: "Named Run Fixture", mission: "Fixture", goal: "Fixture", status: "active", currentMilestone: "Fixture", nextAction: "Keep fixture", workClassification: "agent" });
    upsertProjectMetadata(db, { projectId: created.project.id, repoPath: repo, validationCommands: ["node --version"] });
    return created.project;
  });
  const request = 'Implement HelloWorld.txt in Named Run Fixture, containing exactly the bytes "Hello World!\\n".';
  const ask = runAskCommand({ workspace, project: project.name, request, requestId: "consume-fixture-ask" });
  const reviewId = ask.data.reviewItemId!;
  const approved = runAskCommand({ workspace, request: `approve ${reviewId}`, requestId: "consume-fixture-approve", adapterMetadata: { reviewId } });
  expect(approved.data.run?.status).toBe("pending_execution");
  const script = path.join(workspace, "executor.mjs");
  writeFileSync(script, `import { writeFileSync, appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(path.join(workspace, "invocations"))}, "called\\n");\n${scriptBody}\n`);
  const options: RunConsumeOptions = { workspace, runId: approved.data.run!.id, askId: ask.data.ask!.id, sourceHead, fixtureScript: script };
  const otherId = withDatabase(workspace, (db) => {
    const review = createReviewItem(db, { projectId: project.id, decisionNeeded: "Unrelated", recommendation: "Leave alone", sourceInput: "Unrelated", proposedAction: "Nothing", resolvedIntent: "Fixture", confidenceLabel: "high", confidence: 1 });
    return createReviewExecutionRun(db, { reviewItemId: review.id, executorName: "codex", summary: "Unrelated" }).id;
  });
  const other = withDatabase(workspace, (db) => getExecutionRun(db, otherId));
  const protectedState = () => withDatabase(workspace, (db) => ({
    production: db.prepare("SELECT * FROM production_policy").all(),
    projects: db.prepare("SELECT * FROM projects").all(),
    metadata: db.prepare("SELECT * FROM project_metadata").all(),
    unrelatedActions: db.prepare("SELECT * FROM work_items WHERE id != ?").all(options.runId ? approved.data.run!.work_item_id : ""),
    gitConfig: readFileSync(path.join(repo, ".git", "config"), "utf8"),
    serviceFiles: existsSync(path.join(workspace, ".arcadia", "worker.pid")),
    unrelated: getExecutionRun(db, otherId)
  }));
  const before = protectedState();
  return { workspace, repo, reviewId, options, other, protectedState, before };
}
function calls(workspace: string) { const file = path.join(workspace, "invocations"); return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").length : 0; }
function cliArgs(options: RunConsumeOptions) { return ["run", "consume-one", "--workspace", options.workspace, "--run-id", options.runId!, "--ask-id", options.askId, "--source-head", options.sourceHead, "--fixture-script", options.fixtureScript!, "--json"]; }

describe("public named approved Run consumption", () => {
  it("completes one correlated Run and exact product Artifact via the CLI with zero providers or protected writes", () => {
    const f = fixture();
    const result = runCli(cliArgs(f.options));
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data.run.status).toBe("completed");
    expect(data.liveProviderAdmission).toBe("blocked");
    expect(isolation?.guardCalls()).toEqual([]);
    expect(readFileSync(path.join(f.repo, "HelloWorld.txt"))).toEqual(Buffer.from("Hello World!\n"));
    expect(data.run.artifacts).toContainEqual(expect.objectContaining({ status: "ready", path: path.join(f.repo, "HelloWorld.txt"), work_item_id: data.run.work_item_id }));
    const trail = runAskShowCommand({ workspace: f.workspace, id: "consume-fixture-ask" });
    expect(trail.data.asks[0]?.runs).toContainEqual(expect.objectContaining({ id: f.options.runId, status: "completed" }));
    expect(calls(f.workspace)).toBe(1);
    expect(f.protectedState()).toEqual(f.before);
    expect(() => runRunConsumeCommand(f.options)).toThrow(/already claimed/);
    expect(calls(f.workspace)).toBe(1);
  });

  it("rejects an omitted CLI selector without claiming another Run", () => {
    const f = fixture();
    const args = cliArgs(f.options); const at = args.indexOf("--run-id"); args.splice(at, 2);
    expect(runCli(args).status).not.toBe(0);
    expect(calls(f.workspace)).toBe(0);
    expect(withDatabase(f.workspace, (db) => getExecutionRun(db, f.options.runId!)?.status)).toBe("pending_execution");
  });

  it.each([undefined, "", " ", "invalid", " run_missing "])("rejects selector %j without fallback", (runId) => {
    const f = fixture();
    expect(() => runRunConsumeCommand({ ...f.options, runId })).toThrow();
    expect(calls(f.workspace)).toBe(0); expect(f.protectedState()).toEqual(f.before);
    expect(withDatabase(f.workspace, (db) => getExecutionRun(db, f.options.runId!)?.status)).toBe("pending_execution");
  });

  it.each(["ask", "approval", "missing-approval", "other-action", "other-plan", "forged-receipt", "stale-scope", "source", "live", "production", "nonfixture", "unrelated"])("refuses %s before invoking an executor", (failure) => {
    const f = fixture(); const options = { ...f.options };
    if (failure === "ask") options.askId = "ask_missing";
    if (failure === "approval") withDatabase(f.workspace, (db) => db.prepare("UPDATE review_items SET status = 'rejected' WHERE id = ?").run(f.reviewId));
    if (failure === "missing-approval") withDatabase(f.workspace, (db) => db.prepare("UPDATE review_items SET context_json = '{}' WHERE id = ?").run(f.reviewId));
    if (failure === "stale-scope") withDatabase(f.workspace, (db) => db.prepare("UPDATE review_items SET source_input = source_input || 'changed' WHERE id = ?").run(f.reviewId));
    if (failure === "other-action") withDatabase(f.workspace, (db) => db.prepare("UPDATE execution_runs SET work_item_id = NULL WHERE id = ?").run(f.options.runId));
    if (failure === "other-plan") withDatabase(f.workspace, (db) => db.prepare("UPDATE execution_runs SET plan_id = NULL WHERE id = ?").run(f.options.runId));
    if (failure === "forged-receipt") withDatabase(f.workspace, (db) => db.prepare("UPDATE review_items SET decision_note = 'approved' WHERE id = ?").run(f.reviewId));
    if (failure === "source") options.sourceHead = "0".repeat(40);
    if (failure === "live") delete options.fixtureScript;
    if (failure === "production") withDatabase(f.workspace, (db) => db.prepare("UPDATE production_policy SET desired_state = 'active'").run());
    if (failure === "nonfixture") { const configPath = path.join(f.workspace, "config", "arcadia.json"); const config = JSON.parse(readFileSync(configPath, "utf8")); delete config.experiment; writeFileSync(configPath, JSON.stringify(config)); }
    if (failure === "unrelated") options.runId = f.other!.id;
    const before = f.protectedState();
    expect(() => runRunConsumeCommand(options)).toThrow(); expect(calls(f.workspace)).toBe(0);
    expect(f.protectedState()).toEqual(before);
    expect(withDatabase(f.workspace, (db) => getExecutionRun(db, f.options.runId!)?.status)).toBe("pending_execution");
  });

  it("keeps approved Ask receipts unavailable to default providers and the ordinary worker", () => {
    const f = fixture();
    withDatabase(f.workspace, (db) => {
      for (const executorName of ["codex", "claude-code", "gemini"]) {
        expect(() => executeApprovedReview(db, { workspace: f.workspace, reviewId: f.reviewId, runId: f.options.runId, executorName })).toThrow(/current approved Run receipt/);
      }
      const run = runWorkerIteration(db, f.workspace);
      expect(run?.id).toBe(f.options.runId);
      expect(run?.status).toBe("failed");
      expect(run?.summary).toContain("current approved Run receipt");
    });
    expect(calls(f.workspace)).toBe(0);
    expect(isolation?.guardCalls()).toEqual([]);
  });

  it("never reduces a zero exit with a spawn error, timeout or signal to completion", () => {
    for (const extra of [{ error: "spawnSync ETIMEDOUT" }, { timedOut: true }, { signal: "SIGTERM" as const }]) {
      expect(reduceExecutionOutcome({ exitStatus: 0, validation: [], ...extra })).toBe("failed");
    }
  });

  it.each([
    'process.on("SIGTERM", () => process.exit(0));',
    'process.on("SIGTERM", () => {});'
  ])("hard-bounds a timed-out child even with %s", (handler) => {
    const f = fixture(`writeFileSync("HelloWorld.txt", "Hello World!\\n"); ${handler} setInterval(() => {}, 1000);`);
    const start = performance.now();
    const result = runRunConsumeCommand(f.options);
    expect(performance.now() - start).toBeLessThan(10000);
    expect(result.data.run?.status).toBe("failed");
    expect(result.data.run?.artifacts.some((a) => a.artifact_type === "text" && a.status === "ready")).toBe(false);
    const metadata = JSON.parse(readFileSync(path.join(f.workspace, "artifacts", "review-executions", f.options.runId!, "metadata.json"), "utf8"));
    expect(metadata).toMatchObject({ timedOut: true });
    expect(metadata.error).toContain("ETIMEDOUT");
    expect(readFileSync(path.join(f.repo, "HelloWorld.txt"))).toEqual(Buffer.from("Hello World!\n"));
  });

  it.each(["SIGINT", "SIGTERM", "SIGKILL"] as const)("retains an unresolved durable posture if the consumer receives %s", async (signal) => {
    const f = fixture('writeFileSync("HelloWorld.txt", "Hello World!\\n"); setTimeout(() => process.exit(0), 1500);');
    const child = spawn(process.execPath, ["--import", tsxLoader, path.join(repoRoot, "src", "cli.ts"), ...cliArgs(f.options)], { env: process.env, stdio: "ignore" });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      const deadline = Date.now() + 10000;
      while (calls(f.workspace) === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls(f.workspace)).toBe(1);
      expect(withDatabase(f.workspace, (db) => getExecutionRun(db, f.options.runId!)?.status)).toBe("requires_review");
      child.kill(signal);
      await exited;
      await new Promise((resolve) => setTimeout(resolve, 1600));
      const run = withDatabase(f.workspace, (db) => getExecutionRun(db, f.options.runId!));
      expect(run?.status).toBe("requires_review");
      expect(run?.summary).toContain("unresolved");
      expect(readFileSync(path.join(f.repo, "HelloWorld.txt"))).toEqual(Buffer.from("Hello World!\n"));
      expect(run?.artifacts.some((a) => a.artifact_type === "text" && a.status === "ready")).toBe(false);
      expect(() => runRunConsumeCommand(f.options)).toThrow(/already claimed/);
      expect(calls(f.workspace)).toBe(1);
      expect(f.protectedState()).toEqual(f.before);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  });

  it.each(['process.exit(0);', 'setInterval(() => {}, 1000);', 'process.exit(7);', 'process.kill(process.pid, "SIGTERM");', 'writeFileSync("HelloWorld.txt", "wrong");', 'writeFileSync("HelloWorld.txt", "Hello World!\\n"); writeFileSync("extra.txt", "extra");'])("retains truthful failure for %s", (body) => {
    const f = fixture(body); const result = runRunConsumeCommand(f.options);
    expect(result.data.run?.status).toBe("failed");
    expect(result.data.run?.artifacts.some((a) => a.status === "ready" && a.path === path.join(f.repo, "HelloWorld.txt"))).toBe(false);
    expect(calls(f.workspace)).toBe(1); expect(f.protectedState()).toEqual(f.before);
  });

  it("never selects configured provider adapters or metadata shell validation for a scripted fixture", () => {
    const f = fixture();
    withDatabase(f.workspace, (db) => db.prepare("UPDATE project_metadata SET validation_commands = ?").run(JSON.stringify(["codex exec should-never-run"])));
    const config = path.join(f.workspace, "config", "arcadia.json");
    const parsed = JSON.parse(readFileSync(config, "utf8"));
    parsed.executors = [{ name: "codex", commandTemplate: "codex", args: ["exec", "should-never-run"] }];
    writeFileSync(config, JSON.stringify(parsed));
    expect(runRunConsumeCommand(f.options).data.run?.status).toBe("completed");
    expect(calls(f.workspace)).toBe(1);
  });

  it("admits at most one of simultaneous public CLI callers", async () => {
    const f = fixture();
    const invoke = () => new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn(process.execPath, ["--import", tsxLoader, path.join(repoRoot, "src", "cli.ts"), ...cliArgs(f.options)], { env: process.env });
      let output = ""; child.stdout.on("data", (chunk) => { output += String(chunk); }); child.stderr.on("data", (chunk) => { output += String(chunk); }); child.on("exit", (code) => resolve({ code, output }));
    });
    const results = await Promise.all([invoke(), invoke()]);
    expect(results.filter((r) => r.code === 0), JSON.stringify(results)).toHaveLength(1);
    expect(calls(f.workspace)).toBe(1); expect(f.protectedState()).toEqual(f.before);
    expect(withDatabase(f.workspace, (db) => getExecutionRun(db, f.options.runId!)?.status)).toBe("completed");
  });
});
