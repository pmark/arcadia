import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { ArcadiaCliError, listIngressFiles } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export async function GET(request: Request) {
  try {
    const relativePath = new URL(request.url).searchParams.get("path")?.trim() ?? "";
    if (!relativePath || relativePath.includes("/") || relativePath.includes("\\") || relativePath.startsWith(".")) {
      return NextResponse.json({ error: "Invalid ingress file path.", details: null }, { status: 400 });
    }

    const listing = await listIngressFiles();
    const file = listing.data.files.find((candidate) => candidate.relativePath === relativePath);
    if (!file) {
      return NextResponse.json({ error: "Ingress file not found.", details: null }, { status: 404 });
    }

    const bytes = await readFile(file.file);
    return new Response(bytes, {
      headers: {
        "content-type": file.mimeType,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Ingress file not found.", details: null }, { status: 404 });
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { path?: unknown };
    const relativePath = typeof body.path === "string" ? body.path.trim() : "";
    if (!relativePath || relativePath.includes("/") || relativePath.includes("\\") || relativePath.startsWith(".")) {
      return NextResponse.json({ error: "Invalid ingress file path.", details: null }, { status: 400 });
    }

    const listing = await listIngressFiles();
    const file = listing.data.files.find((candidate) => candidate.relativePath === relativePath);
    if (!file) {
      return NextResponse.json({ error: "Ingress file not found.", details: null }, { status: 404 });
    }
    if (file.downloadState === "downloaded") {
      return NextResponse.json({ state: "downloaded", message: "File is already downloaded." });
    }

    await execFileAsync("/usr/bin/brctl", ["download", file.file], { timeout: 30_000 });
    return NextResponse.json({ state: "download_requested", message: "iCloud download requested." });
  } catch (error) {
    const execError = error as { stderr?: string; stdout?: string };
    const detail = [execError.stderr, execError.stdout].find((value) => value?.trim());
    return NextResponse.json(
      {
        error: detail?.trim() ?? (error instanceof Error ? error.message : String(error)),
        details: error instanceof ArcadiaCliError ? error.details : null
      },
      { status: 502 }
    );
  }
}
