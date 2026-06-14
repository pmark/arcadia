import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { ArcadiaCliError, resolveDashboardWorkspace } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXT_EXTENSIONS = new Set([".json", ".jsonl", ".log", ".md", ".txt", ".yaml", ".yml"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    const params = await context.params;
    const relativePath = params.path.join("/");
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
      return NextResponse.json({ error: "Invalid file path.", details: null }, { status: 400 });
    }

    const workspace = await resolveDashboardWorkspace();
    const absolutePath = path.resolve(workspace, relativePath);
    const relativeToWorkspace = path.relative(workspace, absolutePath);
    if (relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
      return NextResponse.json({ error: "File path is outside the Arcadia workspace.", details: null }, { status: 400 });
    }

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Path is not a file.", details: null }, { status: 404 });
    }

    const bytes = await readFile(absolutePath);
    return new Response(bytes, {
      headers: {
        "content-type": contentTypeForPath(absolutePath),
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "File not found.", details: null }, { status: 404 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ArcadiaCliError ? error.details : null
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}

function contentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text/plain; charset=utf-8";
  }

  return "application/octet-stream";
}
