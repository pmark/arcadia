import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runLearnCaptureCommand, runLearnCorrectCommand, runLearnExportCommand,
  runLearnImportNotesCommand, runLearnImportHistoryCommand, runLearnCacheMaintainCommand, runLearnRestoreCommand, runLearnSearchCommand,
  runLearnShowCommand
} from "../src/commands/learn.js";
import { withDatabase } from "../src/db/connection.js";
import { exactTextHash } from "../src/learning/lessons.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { parseJson, runCli } from "./cli-response-fixture.js";

const workspaces: string[] = [];
afterEach(() => workspaces.splice(0).forEach((workspace) => rmSync(workspace, { recursive: true, force: true })));
function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-learn-"));
  workspaces.push(directory);
  initWorkspace(directory);
  return directory;
}

describe("arcadia learn", () => {
  it("keeps more than the Notes cache capacity searchable and exact on replay", () => {
    const ws = workspace();
    for (let index = 0; index < 26; index += 1) runLearnCaptureCommand({ workspace: ws, scope: "project:one", text: `## Lesson ${index}\nkeys: lesson-${index}\nKeep   exact whitespace ${index}.`, evidence: [`evidence ${index}`] });
    const first = runLearnCaptureCommand({ workspace: ws, scope: "project:one", text: "## Lesson 0\nkeys: lesson-0\nKeep   exact whitespace 0.", evidence: ["extra evidence"] });
    expect(first.data.created).toBe(false);
    expect(runLearnSearchCommand({ workspace: ws, scope: "project:one", query: "whitespace 0" }).data.lessons).toHaveLength(1);
    expect(first.data.lesson.current?.text_hash).toBe(exactTextHash("## Lesson 0\nkeys: lesson-0\nKeep   exact whitespace 0."));
    expect(first.data.lesson.current?.evidence).toEqual(["evidence 0", "extra evidence"]);
  });

  it("preserves a correction chain, retired search, and scope isolation", () => {
    const ws = workspace();
    const captured = runLearnCaptureCommand({ workspace: ws, scope: "project:one", text: "First advice", provenance: "operator_statement" });
    const corrected = runLearnCorrectCommand({ workspace: ws, scope: "project:one", id: captured.data.lesson.id, text: "Second advice", provenance: "observation" });
    expect(corrected.data.lesson.versions?.map((version) => version.freshness)).toEqual(["current", "superseded"]);
    expect(runLearnSearchCommand({ workspace: ws, scope: "project:one", query: "First advice" }).data.lessons[0]?.id).toBe(captured.data.lesson.id);
    expect(() => runLearnShowCommand({ workspace: ws, scope: "project:two", id: captured.data.lesson.id })).toThrow(/scope/i);
    const replay = runLearnCaptureCommand({ workspace: ws, scope: "project:one", text: "First advice", evidence: ["replay evidence"] });
    expect(replay.data.lesson.current?.text).toBe("Second advice");
    expect(replay.data.lesson.versions?.find((version) => version.text === "First advice")?.evidence).toContain("replay evidence");
  });

  it("imports exact Notes entries as stale historical evidence and restores every version", () => {
    const ws = workspace();
    const imported = runLearnImportNotesCommand({ workspace: ws, scope: "project:one", markdown: "# Notes To Self\n\n## How the cache works\nignore\n\n## Durable entry\nkeys: import\nExact  body\n" });
    expect(imported.data.imported).toBe(1);
    const lesson = runLearnShowCommand({ workspace: ws, scope: "project:one", id: imported.data.lessonIds[0] }).data.lesson;
    expect(lesson.current?.freshness).toBe("stale");
    const changed = runLearnCorrectCommand({ workspace: ws, scope: "project:one", id: lesson.id, text: "Fresh replacement" }).data.lesson;
    const exported = runLearnExportCommand({ workspace: ws, scope: "project:one" }).data;
    const target = workspace();
    expect(runLearnRestoreCommand({ workspace: target, scope: "project:one", payload: exported }).data.restored).toBe(1);
    const restored = runLearnShowCommand({ workspace: target, scope: "project:one", id: changed.id }).data.lesson;
    expect(restored.versions?.map((version) => version.id)).toEqual(changed.versions?.map((version) => version.id));
    withDatabase(target, (db) => expect((db.prepare("SELECT COUNT(*) AS count FROM lesson_receipts").get() as { count: number }).count).toBeGreaterThan(0));
  });

  it("imports every Notes entry before an explicit receipt-verified cache eviction", () => {
    const ws = workspace();
    const markdown = "## Entry one\nkeys: one\nbody one\n\n## Entry two\nkeys: two\nbody two\n";
    const planned = runLearnCacheMaintainCommand({ workspace: ws, scope: "project:one", markdown });
    expect(planned.data.entryCount).toBe(2);
    expect(planned.data.updatedMarkdown).toBeNull();
    const first = runLearnSearchCommand({ workspace: ws, scope: "project:one", query: "body one" }).data.lessons[0];
    const evicted = runLearnCacheMaintainCommand({ workspace: ws, scope: "project:one", markdown, evictId: first.id });
    expect(evicted.data.updatedMarkdown).not.toContain("body one");
    expect(runLearnSearchCommand({ workspace: ws, scope: "project:one", query: "body one" }).data.lessons[0]?.id).toBe(first.id);
    expect(() => runLearnCacheMaintainCommand({ workspace: ws, scope: "project:one", markdown: "not an entry" })).toThrow(/no importable/i);
  });

  it("retains bounded available history and refuses malformed restore graphs", () => {
    const ws = workspace();
    const history = runLearnImportHistoryCommand({ workspace: ws, scope: "project:one", shallow: true, snapshots: [
      { revision: "old", sourceRef: "git:old:docs/notes-to-self.md", markdown: "## Historical\nkeys: history\nold text\n" },
      { revision: "new", sourceRef: "git:new:docs/notes-to-self.md", markdown: "## Historical\nkeys: history\nold text\n" }
    ] });
    expect(history.warnings).toContain("Git history is shallow; unavailable parent history was not recovered.");
    const retained = runLearnSearchCommand({ workspace: ws, scope: "project:one", query: "old text" }).data.lessons[0];
    expect(retained.current?.observations).toHaveLength(2);
    const invalid = { schema: "arcadia-lessons-v1" as const, lessons: [{ ...retained, current_version_id: "lessonVersion_outside" }] };
    expect(() => runLearnRestoreCommand({ workspace: workspace(), scope: "project:one", payload: invalid })).toThrow(/current-version/i);
    const mismatchedCurrent = {
      schema: "arcadia-lessons-v1" as const,
      lessons: [{ ...retained, current: { ...retained.current!, text: "untrusted replacement" } }]
    };
    const target = workspace();
    expect(() => runLearnRestoreCommand({ workspace: target, scope: "project:one", payload: mismatchedCurrent })).toThrow(/current version/i);
    expect(runLearnExportCommand({ workspace: target, scope: "project:one" }).data.lessons).toHaveLength(0);
    const cyclic = {
      schema: "arcadia-lessons-v1" as const,
      lessons: [{ ...retained, versions: retained.versions!.map((version) => ({
        ...version,
        supersedes_version_id: version.id
      })) }]
    };
    expect(() => runLearnRestoreCommand({ workspace: workspace(), scope: "project:one", payload: cyclic })).toThrow(/current-version|exact-content/i);
    expect(() => runLearnRestoreCommand({ workspace: workspace(), scope: "project:two", payload: { schema: "arcadia-lessons-v1", lessons: [retained] } })).toThrow(/different scope/i);
  });

  it("exercises CLI parsing, Project-scope inference, and invalid enum refusal in a disposable repository", () => {
    const ws = workspace();
    const repo = mkdtempSync(path.join(tmpdir(), "arcadia-learn-cli-"));
    workspaces.push(repo);
    mkdirSync(path.join(repo, "docs"), { recursive: true });
    writeFileSync(path.join(repo, "PROJECT.md"), "---\narcadia: v1\ntype: project\nslug: \"fixture\"\nname: Fixture\nstatus: active\ngoal: Test\nupdated: 2026-10-15\n---\n", "utf8");
    mkdirSync(path.join(repo, "nested"), { recursive: true });
    const notesPath = path.join(repo, "docs", "notes-to-self.md");
    const notes = "## Cache race fixture\nkeys: cache race\nDo not overwrite concurrent bytes.\n";
    writeFileSync(notesPath, notes, "utf8");
    const captured = runCli(["learn", "CLI keeps exact text", "--workspace", ws, "--json"], {}, { cwd: path.join(repo, "nested") });
    expect(captured.status).toBe(0);
    expect(parseJson(captured.stdout).data.lesson.scope_key).toBe("project:fixture");
    const invalid = runCli(["learn", "bad enum", "--workspace", ws, "--provenance", "unknown", "--json"], {}, { cwd: repo });
    expect(invalid.status).toBe(2);
    const imported = runCli(["learn", "import-notes", "--file", "../docs/notes-to-self.md", "--workspace", ws, "--json"], {}, { cwd: path.join(repo, "nested") });
    expect(imported.status).toBe(0);
    const cacheId = parseJson(imported.stdout).data.lessonIds[0];
    const applied = runCli(["learn", "cache-maintain", "--file", "../docs/notes-to-self.md", "--evict", cacheId, "--apply", "--workspace", ws, "--json"], {}, { cwd: path.join(repo, "nested") });
    expect(applied.status, applied.stderr).toBe(0);
    expect(readFileSync(notesPath, "utf8")).not.toBe(notes);
  });

  it("imports available Notes Git history through the CLI in a disposable repository", () => {
    const ws = workspace();
    const repo = mkdtempSync(path.join(tmpdir(), "arcadia-learn-history-"));
    workspaces.push(repo);
    mkdirSync(path.join(repo, "docs"), { recursive: true });
    writeFileSync(path.join(repo, "PROJECT.md"), "---\narcadia: v1\ntype: project\nslug: fixture\nname: Fixture\nstatus: active\ngoal: Test\nupdated: 2026-10-15\n---\n", "utf8");
    writeFileSync(path.join(repo, "docs", "notes-to-self.md"), "## Old lesson\nkeys: old\nold retained text\n", "utf8");
    for (const args of [["init"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "Test"], ["add", "."], ["commit", "-m", "old notes"]]) spawnSync("git", args, { cwd: repo });
    writeFileSync(path.join(repo, "docs", "notes-to-self.md"), "## New lesson\nkeys: new\nnew retained text\n", "utf8");
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "new notes"], { cwd: repo });
    const imported = runCli(["learn", "import-history", "--file", "docs/notes-to-self.md", "--workspace", ws, "--json"], {}, { cwd: repo });
    expect(imported.status).toBe(0);
    expect(parseJson(imported.stdout).data.snapshots).toBe(2);
    expect(runLearnSearchCommand({ workspace: ws, scope: "project:fixture", query: "old retained" }).data.lessons).toHaveLength(1);
  });
});
