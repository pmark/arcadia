import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveReadyWorkspace } from "../../../../../../../../src/cli/workspace";
import { withDatabase } from "../../../../../../../../src/db/connection";
import { getProjectMetadata } from "../../../../../../../../src/db/repositories";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".yaml", ".yml", ".json"]);

/**
 * A project's own repository documentation, opened read-only from the
 * Dashboard.
 *
 * Deliberately separate from `/api/file/[...path]`, which serves paths under
 * the Arcadia workspace root (mission logs, artifacts). A plan referencing
 * `docs/client-intake.md` means a file in the *Project's* repository — a
 * different, per-project root that only this project's own recorded
 * `repo_path` may resolve against. The id in the URL is the only client
 * input that selects a root; the root itself is always looked up server-side,
 * never accepted from the request, so a caller can read only inside the one
 * repository that project already owns.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; path: string[] }> }) {
  try {
    const { id, path: pathSegments } = await context.params;
    const relativePath = pathSegments.join("/");
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
      return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
    }

    const { workspacePath } = resolveReadyWorkspace();
    const repoPath = withDatabase(workspacePath, (db) => getProjectMetadata(db, id)?.repo_path ?? null);
    if (!repoPath) {
      return NextResponse.json({ error: "This Project has no repository path configured." }, { status: 404 });
    }

    const absolutePath = path.resolve(repoPath, relativePath);
    const relativeToRepo = path.relative(repoPath, absolutePath);
    if (relativeToRepo.startsWith("..") || path.isAbsolute(relativeToRepo)) {
      return NextResponse.json({ error: "File path is outside the Project repository." }, { status: 400 });
    }

    const extension = path.extname(absolutePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) {
      return NextResponse.json({ error: "Only text documentation files can be opened from here." }, { status: 400 });
    }

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Path is not a file." }, { status: 404 });
    }

    const bytes = await readFile(absolutePath);
    return new Response(bytes, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
