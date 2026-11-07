import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import { upsertProject } from "../src/db/repositories.js";
import {
  buildNarrativeSummaryRequest,
  summarizeNarrativeDocs,
  type NarrativeSummarizer
} from "../src/docs/narrativeSummary.js";
import type { NarrativeDoc } from "../src/docs/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  workspaces.push(dir);
  return dir;
}

function workspaceWithProject(): { workspace: string; projectId: string } {
  const workspace = tempDir("arcadia-narrative-summary-");
  initWorkspace(workspace);
  const projectId = withDatabase(workspace, (db) => upsertProject(db, {
    name: "Alpha",
    mission: "Ship Alpha honestly.",
    status: "active",
    currentMilestone: "Tell the story",
    nextAction: "Summarize the architecture",
    workClassification: "agent"
  }).id);
  return { workspace, projectId };
}

/** A source repository holding one narrative document, written to disk. */
function repoWithArchitecture(body: string): { repo: string; doc: NarrativeDoc } {
  const repo = tempDir("arcadia-narrative-repo-");
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  const relativePath = "docs/architecture.md";
  const absolutePath = path.join(repo, relativePath);
  writeFileSync(absolutePath, `---\narcadia: v1\ntype: architecture\nproject: alpha\nslug: architecture\nupdated: 2026-11-01\n---\n\n${body}`, "utf8");
  const doc: NarrativeDoc = {
    type: "architecture",
    slug: "architecture",
    project: "alpha",
    updated: "2026-11-01",
    body,
    relativePath,
    absolutePath
  };
  return { repo, doc };
}

/**
 * `withDatabase` closes the connection as soon as its synchronous callback
 * returns, which is too early for an async summarization that still writes.
 * This keeps the connection open until the returned promise settles.
 */
async function withDatabaseAsync<T>(workspace: string, callback: (db: ReturnType<typeof openDatabase>) => Promise<T>): Promise<T> {
  const db = openDatabase(workspace);
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}

function fakeSummarizer(summary: string): NarrativeSummarizer & ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ summary, jobId: "job-test-1" })) as NarrativeSummarizer & ReturnType<typeof vi.fn>;
}

describe("narrative summary request", () => {
  it("is local-preferred, unpaid, and keyed on the source content hash", () => {
    const { doc } = repoWithArchitecture("The system is local-first.");
    const request = buildNarrativeSummaryRequest({
      project: { id: "project-alpha", name: "Alpha" },
      doc,
      sourceHash: "abc123"
    });

    expect(request).toMatchObject({
      operationId: "arcadia.docs.summarize-narrative",
      projectId: "project-alpha",
      capability: "text.generate",
      execution: "local-preferred",
      executionPolicy: { allowPaidUsage: false }
    });
    expect(request.idempotencyKey).toBe("narrative-summary:project-alpha:docs/architecture.md:abc123");
  });
});

describe("summarizeNarrativeDocs", () => {
  it("stores a narrative doc's summary as an Artifact and leaves the source document unchanged", async () => {
    const { workspace, projectId } = workspaceWithProject();
    const { repo, doc } = repoWithArchitecture("The system is local-first and deterministic.");
    const sourceBefore = readFileSync(doc.absolutePath, "utf8");
    const summarizer = fakeSummarizer("Local-first, deterministic system.");

    const outcomes = await withDatabaseAsync(workspace, (db) => summarizeNarrativeDocs({
      db,
      workspacePath: workspace,
      project: { id: projectId, slug: "alpha", name: "Alpha" },
      docs: [doc],
      summarizer
    }));

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ relativePath: "docs/architecture.md", status: "created" });
    expect(summarizer).toHaveBeenCalledTimes(1);

    const artifact = withDatabase(workspace, (db) => db.prepare(
      "SELECT artifact_type, status, path FROM artifacts WHERE id = ?"
    ).get(outcomes[0].artifactId) as { artifact_type: string; status: string; path: string });
    expect(artifact).toMatchObject({ artifact_type: "narrative_summary", status: "ready" });

    const stored = readFileSync(path.join(workspace, artifact.path), "utf8");
    expect(stored).toContain("Local-first, deterministic system.");
    expect(stored).toContain("source: docs/architecture.md");

    expect(readFileSync(doc.absolutePath, "utf8")).toBe(sourceBefore);
    expect(readFileSync(path.join(repo, "docs", "architecture.md"), "utf8")).not.toContain("Local-first, deterministic system.");
  });

  it("queues nothing for a document whose content is already summarized", async () => {
    const { workspace, projectId } = workspaceWithProject();
    const { doc } = repoWithArchitecture("Stable body.");
    const input = {
      workspacePath: workspace,
      project: { id: projectId, slug: "alpha", name: "Alpha" },
      docs: [doc]
    };
    const first = fakeSummarizer("Stable summary.");
    const second = fakeSummarizer("Should not run.");

    await withDatabaseAsync(workspace, (db) => summarizeNarrativeDocs({ db, ...input, summarizer: first }));
    const again = await withDatabaseAsync(workspace, (db) => summarizeNarrativeDocs({ db, ...input, summarizer: second }));

    expect(again[0]).toMatchObject({ status: "unchanged" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("refuses an empty summary instead of storing a blank Artifact", async () => {
    const { workspace, projectId } = workspaceWithProject();
    const { doc } = repoWithArchitecture("Some body.");

    await expect(withDatabaseAsync(workspace, (db) => summarizeNarrativeDocs({
      db,
      workspacePath: workspace,
      project: { id: projectId, slug: "alpha", name: "Alpha" },
      docs: [doc],
      summarizer: fakeSummarizer("   ")
    }))).rejects.toThrow("non-empty summary");

    const count = withDatabase(workspace, (db) => (db.prepare(
      "SELECT COUNT(*) AS n FROM artifacts WHERE artifact_type = 'narrative_summary'"
    ).get() as { n: number }).n);
    expect(count).toBe(0);
  });
});
