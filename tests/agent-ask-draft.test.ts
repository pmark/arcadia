import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/cli.js";
import { renderAgentAskDraftSuccess, runAgentAskDraftCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function scratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-draft-"));
  roots.push(dir);
  return dir;
}

const strictAsk = (requestId: string) =>
  `agent_ask: v1\nrequest_id: ${requestId}\nproject: unknown\nintent: log\ndesired_result: Record something worth keeping\n`;

describe("Agent Ask draft", () => {
  it("validates and writes the canonical .arcadia/asks/ file with no workspace present", () => {
    const dir = scratchRepo();
    const result = runAgentAskDraftCommand({ request: strictAsk("draft-no-workspace"), dir, workspace: path.join(dir, "does-not-exist") });
    expect(result.data.written).toBe("created");
    expect(result.data.workspaceStatus).toBe("not_available");
    expect(result.data.previewFailure?.code).toBe("WORKSPACE_NOT_FOUND");
    expect(result.data.preview).toBeNull();
    const expectedPath = path.join(dir, ".arcadia", "asks", "agent-ask-draft-no-workspace.yaml");
    expect(result.data.path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, "utf8")).toContain("request_id: draft-no-workspace");
  });

  it("accepts plain JSON text, since JSON is valid YAML and is far more reliable for a model to emit", () => {
    const dir = scratchRepo();
    const json = JSON.stringify({ agent_ask: "v1", request_id: "draft-json", project: "unknown", intent: "log", desired_result: "Recorded via JSON" });
    const result = runAgentAskDraftCommand({ request: json, dir, workspace: path.join(dir, "does-not-exist") });
    expect(result.data.requestId).toBe("draft-json");
    expect(result.data.written).toBe("created");
  });

  it("also previews the Ask in one call when a ready workspace resolves", () => {
    const dir = scratchRepo();
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-draft-ws-"));
    roots.push(workspace);
    initWorkspace(workspace);
    const result = runAgentAskDraftCommand({ request: strictAsk("draft-with-workspace"), dir, workspace });
    expect(result.data.workspaceStatus).toBe("previewed");
    expect(result.data.previewFailure).toBeNull();
    expect(result.data.preview?.proposal.normalized.intent).toBe("log");
    expect(result.data.preview?.fingerprint).toBeTruthy();
  });

  it("still succeeds and places the file when a resolvable workspace's database write is denied (the sandboxed-agent case)", () => {
    if (process.getuid && process.getuid() === 0) return; // root bypasses the permission bits this test relies on
    const dir = scratchRepo();
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-draft-denied-"));
    roots.push(workspace);
    initWorkspace(workspace);
    const databaseFile = path.join(workspace, "database", "arcadia.sqlite3");
    chmodSync(databaseFile, 0o444);
    try {
      const result = runAgentAskDraftCommand({ request: strictAsk("draft-write-denied"), dir, workspace });
      expect(result.data.written).toBe("created");
      expect(result.data.workspaceStatus).toBe("preview_blocked");
      expect(result.data.previewFailure?.code).toBe("SQLITE_WORKSPACE_WRITE_DENIED");
      expect(result.data.previewFailure?.message).toContain(databaseFile);
      expect(result.data.preview).toBeNull();
      expect(existsSync(path.join(dir, ".arcadia", "asks", "agent-ask-draft-write-denied.yaml"))).toBe(true);
      const rendered = renderAgentAskDraftSuccess(result).join("\n");
      expect(rendered).toContain("Previewed: blocked (SQLITE_WORKSPACE_WRITE_DENIED)");
      expect(rendered).toContain("Do not guess a workspace from the Project name");
      expect(rendered).not.toContain("no ready Arcadia workspace resolved");
    } finally {
      chmodSync(databaseFile, 0o644);
    }
  });

  it("retains the SQLite cause when a resolved workspace rejects the preview receipt", () => {
    const dir = scratchRepo();
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-draft-sqlite-"));
    roots.push(workspace);
    initWorkspace(workspace);
    withDatabase(workspace, (db) => db.exec(`CREATE TRIGGER reject_agent_ask_preview
      BEFORE INSERT ON agent_ask_proposals
      BEGIN SELECT RAISE(ABORT, 'simulated preview failure'); END;`));

    const result = runAgentAskDraftCommand({ request: strictAsk("draft-sqlite-failure"), dir, workspace });
    expect(result.data.workspaceStatus).toBe("preview_blocked");
    expect(result.data.previewFailure).toEqual({
      code: "SQLITE_ERROR",
      message: "SQLite operation failed.",
      cause: "simulated preview failure"
    });
    expect(renderAgentAskDraftSuccess(result).join("\n")).toContain("Cause: simulated preview failure");
  });

  it("is idempotent when the identical content is drafted twice", () => {
    const dir = scratchRepo();
    const request = strictAsk("draft-idempotent");
    const first = runAgentAskDraftCommand({ request, dir, workspace: path.join(dir, "does-not-exist") });
    expect(first.data.written).toBe("created");
    const second = runAgentAskDraftCommand({ request, dir, workspace: path.join(dir, "does-not-exist") });
    expect(second.data.written).toBe("unchanged");
  });

  it("refuses to silently overwrite a request id with different content", () => {
    const dir = scratchRepo();
    runAgentAskDraftCommand({ request: strictAsk("draft-collision"), dir, workspace: path.join(dir, "does-not-exist") });
    expect(() =>
      runAgentAskDraftCommand({
        request: strictAsk("draft-collision").replace("Record something worth keeping", "A different desired result"),
        dir,
        workspace: path.join(dir, "does-not-exist")
      })
    ).toThrow("An Agent Ask file already exists for this request id with different content.");
  });

  it("still refuses structurally invalid Agent Asks without ever touching disk", () => {
    const dir = scratchRepo();
    expect(() =>
      runAgentAskDraftCommand({ request: "agent_ask: v1\nintent: log\ndesired_result: Missing the request id\n", dir })
    ).toThrow("Agent Ask request_id is required.");
    expect(existsSync(path.join(dir, ".arcadia", "asks"))).toBe(false);
  });
});

/**
 * Issue #886: `scripts/arcadia` changes directory into Arcadia's own (main)
 * checkout before running, so a relative `--file` resolved against
 * `process.cwd()` named a file in that runtime checkout, never in the
 * candidate worktree the agent was standing in. Calling the handlers directly
 * hid this, because no parser ran; these drive the real CLI parser with the
 * runtime directory set to the main checkout, as the launcher leaves it.
 */
describe("Agent Ask --file through the real CLI parser", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const askFor = (requestId: string, project: string, desiredResult: string) =>
    `agent_ask: v1\nrequest_id: ${requestId}\nproject: ${project}\nintent: log\ndesired_result: ${desiredResult}\n`;
  const asksIn = (repo: string) => path.join(repo, ".arcadia", "asks");
  const same = (actual: string | null | undefined, expected: string) => expect(realpathSync(actual!)).toBe(realpathSync(expected));

  function gitRepo(repo: string, slug: string): string {
    mkdirSync(repo, { recursive: true });
    writeFileSync(path.join(repo, "PROJECT.md"), `---\narcadia: v1\ntype: project\nslug: ${slug}\n---\n\n# ${slug}\n`, "utf8");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "ask-test@example.invalid");
    git(repo, "config", "user.name", "Ask Test");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", `Add ${slug}`);
    return repo;
  }

  /** The runtime (main) checkout, a linked candidate worktree of it, and a different Project's repository. */
  function cliFixture(root = scratchRepo()) {
    const main = gitRepo(path.join(root, "main"), "demo");
    const candidate = path.join(root, "candidate");
    git(main, "worktree", "add", "-q", "-b", "claude/candidate", candidate);
    const other = gitRepo(path.join(root, "other"), "other");
    const workspace = path.join(root, "workspace");
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      for (const [name, repoPath] of [["Demo", main], ["Other", other]] as const) {
        const project = upsertProject(db, {
          name, mission: "Test Agent Ask files.", goal: "Read the caller's file.",
          status: "active", currentMilestone: "Files", nextAction: "Keep going.", workClassification: "agent"
        });
        upsertProjectMetadata(db, { projectId: project.id, repoPath });
      }
    });
    return { root, main, candidate, other, workspace, mainHead: git(main, "rev-parse", "HEAD") };
  }

  type CliResult = { ok: true; data: any } | { ok: false; error: { code: string; message: string } };

  /** Run `arcadia <args> --json` the way the launcher does: cwd = runtime, ARCADIA_INVOKED_FROM = where the operator stood. */
  async function runCli(args: string[], from: string, runtime: string): Promise<CliResult> {
    const previousCwd = process.cwd();
    const previousInvokedFrom = process.env.ARCADIA_INVOKED_FROM;
    let stdout = "";
    let stderr = "";
    const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
    const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr += String(chunk); return true; });
    process.env.ARCADIA_INVOKED_FROM = from;
    process.chdir(runtime);
    try {
      await buildProgram().parseAsync(["node", "arcadia", ...args, "--json"]);
    } finally {
      process.chdir(previousCwd);
      if (previousInvokedFrom === undefined) delete process.env.ARCADIA_INVOKED_FROM;
      else process.env.ARCADIA_INVOKED_FROM = previousInvokedFrom;
      out.mockRestore();
      err.mockRestore();
      process.exitCode = undefined;
    }
    return stdout.trim() ? JSON.parse(stdout) : JSON.parse(stderr);
  }

  function expectMainUntouched(fixture: ReturnType<typeof cliFixture>): void {
    expect(git(fixture.main, "status", "--porcelain")).toBe("");
    expect(git(fixture.main, "rev-parse", "HEAD")).toBe(fixture.mainHead);
    expect(existsSync(asksIn(fixture.main))).toBe(false);
  }

  function proposalCount(workspace: string, requestId: string): number {
    return withDatabase(workspace, (db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM agent_ask_proposals WHERE request_id = ?").get(requestId) as { count: number }).count);
  }

  it("reads a relative --file from the main checkout when that is where it was run", async () => {
    const fixture = cliFixture();
    writeFileSync(path.join(fixture.main, "ask.yaml"), askFor("file-from-main", "demo", "Drafted in main"), "utf8");
    const result = await runCli(["agent-ask", "draft", "--file", "ask.yaml", "--workspace", fixture.workspace], fixture.main, fixture.main);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    same(result.data.path, path.join(asksIn(fixture.main), "agent-ask-file-from-main.yaml"));
    expect(result.data.written).toBe("created");
    expect(result.data.workspaceStatus).toBe("previewed");
    expect(result.data.preview.proposal.normalized.desiredResult).toBe("Drafted in main");
  });

  it("reads, validates and previews a relative --file from the linked candidate worktree, leaving the runtime main checkout untouched", async () => {
    const fixture = cliFixture();
    const relative = ".arcadia/asks/agent-ask-file-from-candidate.yaml";
    mkdirSync(asksIn(fixture.candidate), { recursive: true });
    writeFileSync(path.join(fixture.candidate, relative), askFor("file-from-candidate", "demo", "Drafted in the candidate"), "utf8");

    const drafted = await runCli(["agent-ask", "draft", "--file", relative, "--workspace", fixture.workspace], fixture.candidate, fixture.main);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    same(drafted.data.path, path.join(fixture.candidate, relative));
    expect(drafted.data.written).toBe("unchanged");
    expect(drafted.data.workspaceStatus).toBe("previewed");
    expect(drafted.data.preview.proposal.normalized.desiredResult).toBe("Drafted in the candidate");
    // Settlement archives only a source whose directory is this repository's own `.arcadia/asks/`.
    same(path.dirname(drafted.data.preview.proposal.sourcePath), asksIn(fixture.candidate));

    const previewed = await runCli(["agent-ask", "preview", "--file", relative, "--workspace", fixture.workspace], fixture.candidate, fixture.main);
    expect(previewed.ok).toBe(true);
    if (!previewed.ok) return;
    expect(previewed.data.proposal.normalized.requestId).toBe("file-from-candidate");
    same(previewed.data.proposal.sourcePath, path.join(fixture.candidate, relative));
    expectMainUntouched(fixture);
  });

  it("never substitutes a same-named file from the runtime main checkout", async () => {
    const fixture = cliFixture();
    // Committed in main after the candidate branched, so only main has `main-only.yaml`,
    // and both have a different `ask.yaml`.
    writeFileSync(path.join(fixture.main, "ask.yaml"), askFor("same-name-main", "demo", "Main's copy"), "utf8");
    writeFileSync(path.join(fixture.main, "main-only.yaml"), askFor("main-only", "demo", "Only in main"), "utf8");
    git(fixture.main, "add", ".");
    git(fixture.main, "commit", "-qm", "Main-only Asks");
    fixture.mainHead = git(fixture.main, "rev-parse", "HEAD");
    writeFileSync(path.join(fixture.candidate, "ask.yaml"), askFor("same-name-candidate", "demo", "Candidate's copy"), "utf8");

    const drafted = await runCli(["agent-ask", "draft", "--file", "ask.yaml", "--workspace", fixture.workspace], fixture.candidate, fixture.main);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(drafted.data.requestId).toBe("same-name-candidate");
    same(drafted.data.path, path.join(asksIn(fixture.candidate), "agent-ask-same-name-candidate.yaml"));

    for (const command of ["draft", "preview"]) {
      const missing = await runCli(["agent-ask", command, "--file", "main-only.yaml", "--workspace", fixture.workspace], fixture.candidate, fixture.main);
      expect(missing).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
      if (!missing.ok) expect(missing.error.message).toContain("does not exist");
    }
    expect(proposalCount(fixture.workspace, "main-only")).toBe(0);
    expect(proposalCount(fixture.workspace, "same-name-main")).toBe(0);
    expectMainUntouched(fixture);
  });

  it("reads a relative --file from a different Project's repository", async () => {
    const fixture = cliFixture();
    writeFileSync(path.join(fixture.other, "ask.yaml"), askFor("file-from-other", "other", "Drafted in another Project"), "utf8");
    const result = await runCli(["agent-ask", "draft", "--file", "ask.yaml", "--workspace", fixture.workspace], fixture.other, fixture.main);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    same(result.data.path, path.join(asksIn(fixture.other), "agent-ask-file-from-other.yaml"));
    expect(result.data.preview.proposal.normalized.project).toBe("other");
    expectMainUntouched(fixture);
  });

  it("fails closed on a nonexistent path, writing nothing", async () => {
    const fixture = cliFixture();
    for (const command of ["draft", "preview"]) {
      const result = await runCli(["agent-ask", command, "--file", "no-such-ask.yaml", "--workspace", fixture.workspace], fixture.candidate, fixture.main);
      expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
      if (!result.ok) expect(result.error.message).toMatch(/^Invalid --file path: .*no-such-ask\.yaml does not exist\.$/);
    }
    for (const command of ["draft", "preview"]) {
      const blank = await runCli(["agent-ask", command, "--file", " ", "--workspace", fixture.workspace], fixture.candidate, fixture.main);
      expect(blank).toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "--file needs a path to an Agent Ask file inside the caller's repository." }
      });
    }
    expect(existsSync(asksIn(fixture.candidate))).toBe(false);
    expectMainUntouched(fixture);
  });

  it("fails closed on a path or symlink resolving outside the caller's repository, reading and writing nothing", async () => {
    const fixture = cliFixture();
    const sibling = path.join(fixture.root, "outside.yaml");
    writeFileSync(sibling, askFor("outside-sibling", "demo", "Outside every repository"), "utf8");
    writeFileSync(path.join(fixture.main, "main-ask.yaml"), askFor("outside-main", "demo", "Main's file"), "utf8");
    git(fixture.main, "add", ".");
    git(fixture.main, "commit", "-qm", "Main Ask");
    fixture.mainHead = git(fixture.main, "rev-parse", "HEAD");
    symlinkSync(sibling, path.join(fixture.candidate, "linked-outside.yaml"));
    symlinkSync(path.join(fixture.main, "main-ask.yaml"), path.join(fixture.candidate, "linked-main.yaml"));

    const attempts = [
      ["--file", "../outside.yaml"],
      ["--file", sibling],
      ["--file", path.join(fixture.main, "main-ask.yaml")],
      ["--file", "linked-outside.yaml"],
      ["--file", "linked-main.yaml"],
      // An explicit --dir is honoured only for a file inside it.
      ["--file", "linked-main.yaml", "--dir", fixture.candidate],
      ["--file", "../outside.yaml", "--dir", fixture.main]
    ];
    for (const command of ["draft", "preview"]) {
      for (const attempt of attempts) {
        const result = await runCli(["agent-ask", command, ...attempt, "--workspace", fixture.workspace], fixture.candidate, fixture.main);
        expect(result, `${command} ${attempt.join(" ")}`).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
        if (!result.ok) expect(result.error.message).toContain("resolves outside the caller's repository");
      }
    }
    expect(proposalCount(fixture.workspace, "outside-sibling")).toBe(0);
    expect(proposalCount(fixture.workspace, "outside-main")).toBe(0);
    expect(existsSync(asksIn(fixture.candidate))).toBe(false);
    expect(readFileSync(sibling, "utf8")).toBe(askFor("outside-sibling", "demo", "Outside every repository"));
    expectMainUntouched(fixture);

    // The same main file is accepted when the caller says main is the repository.
    const inMain = await runCli(["agent-ask", "preview", "--file", "main-ask.yaml", "--dir", fixture.main, "--workspace", fixture.workspace], fixture.main, fixture.main);
    expect(inMain.ok).toBe(true);
  });

  it("refuses a reused request id with different content in the candidate, even when main holds that id with the same content", async () => {
    const fixture = cliFixture();
    const id = "reused-id";
    mkdirSync(asksIn(fixture.main), { recursive: true });
    writeFileSync(path.join(asksIn(fixture.main), `agent-ask-${id}.yaml`), askFor(id, "demo", "Second attempt"), "utf8");
    git(fixture.main, "add", ".");
    git(fixture.main, "commit", "-qm", "Main holds the id");
    fixture.mainHead = git(fixture.main, "rev-parse", "HEAD");
    mkdirSync(asksIn(fixture.candidate), { recursive: true });
    const placed = path.join(asksIn(fixture.candidate), `agent-ask-${id}.yaml`);
    writeFileSync(placed, askFor(id, "demo", "First attempt"), "utf8");
    writeFileSync(path.join(fixture.candidate, "retry.yaml"), askFor(id, "demo", "Second attempt"), "utf8");

    const result = await runCli(["agent-ask", "draft", "--file", "retry.yaml", "--workspace", fixture.workspace], fixture.candidate, fixture.main);
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", message: "An Agent Ask file already exists for this request id with different content." } });
    expect(readFileSync(placed, "utf8")).toBe(askFor(id, "demo", "First attempt"));
    expect(proposalCount(fixture.workspace, id)).toBe(0);
    expect(git(fixture.main, "status", "--porcelain")).toBe("");
    expect(git(fixture.main, "rev-parse", "HEAD")).toBe(fixture.mainHead);
  });

  it("contains realpaths under a symlinked temp root and places a subdirectory draft at the repository toplevel", async () => {
    const real = scratchRepo();
    const linked = path.join(scratchRepo(), "linked-root");
    symlinkSync(real, linked);
    const fixture = cliFixture(linked);
    const subdirectory = path.join(fixture.candidate, "src", "nested");
    mkdirSync(subdirectory, { recursive: true });
    writeFileSync(path.join(subdirectory, "ask.yaml"), askFor("from-subdirectory", "demo", "Drafted from a subdirectory"), "utf8");

    const drafted = await runCli(["agent-ask", "draft", "--file", "ask.yaml", "--workspace", fixture.workspace], subdirectory, fixture.main);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(drafted.data.path).toBe(path.join(fixture.candidate, ".arcadia", "asks", "agent-ask-from-subdirectory.yaml"));
    expect(realpathSync(drafted.data.path).startsWith(realpathSync(real))).toBe(true);
    expect(existsSync(path.join(subdirectory, ".arcadia"))).toBe(false);

    const previewed = await runCli(["agent-ask", "preview", "--file", "ask.yaml", "--workspace", fixture.workspace], subdirectory, fixture.main);
    expect(previewed.ok).toBe(true);
    expectMainUntouched(fixture);
  });
});
