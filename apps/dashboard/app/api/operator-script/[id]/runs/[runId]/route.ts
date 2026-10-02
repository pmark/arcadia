import { access, open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { LIBRARY_PATH, processIsRunning, SAFE_ID, type OperatorScriptRun } from "../../../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_RUN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_OUTPUT_BYTES = 64 * 1024;

async function readTail(file: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const size = (await stat(file)).size;
    const start = Math.max(0, size - MAX_OUTPUT_BYTES);
    handle = await open(file, "r");
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return `${start > 0 ? "…" : ""}${buffer.toString("utf8")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    const { id, runId } = await context.params;
    if (!SAFE_ID.test(id) || !SAFE_RUN_ID.test(runId)) {
      return NextResponse.json({ error: "A valid operator-script and run id are required." }, { status: 400 });
    }

    const library = await realpath(LIBRARY_PATH);
    const runDirectory = path.join(LIBRARY_PATH, "runs", "operator", id, runId);
    const resolvedRunDirectory = await realpath(runDirectory);
    if (!resolvedRunDirectory.startsWith(`${library}${path.sep}runs${path.sep}operator${path.sep}${id}${path.sep}`)) {
      return NextResponse.json({ error: "The requested run is outside the operator-script library." }, { status: 404 });
    }
    await access(path.join(resolvedRunDirectory, "run.json"));
    const run = JSON.parse(await readFile(path.join(resolvedRunDirectory, "run.json"), "utf8")) as OperatorScriptRun & { pid?: number };
    if (run.schema !== "arcadia-operator-script-run-v1" || run.scriptId !== id || run.runId !== runId) {
      return NextResponse.json({ error: "The operator-script run record is invalid." }, { status: 500 });
    }
    const descriptor = JSON.parse(await readFile(path.join(resolvedRunDirectory, "descriptor.json"), "utf8")) as {
      id?: string;
      title: string;
      problem: string;
      desired_effect: string;
      authority: { does: string[]; never_does: string[] };
      success: { effect: string; next: string };
      failure: { effect: string; next: string };
      repeatable?: boolean;
    };

    const stale = run.status === "running" && run.pid !== undefined && !processIsRunning(run.pid);
    const visibleRun = stale
      ? { ...run, status: "failed" as const, finishedAt: run.finishedAt ?? new Date().toISOString(), exitCode: run.exitCode ?? null, message: "The launcher stopped before recording a terminal result." }
      : run;
    if (stale) {
      await writeFile(path.join(resolvedRunDirectory, "run.json"), JSON.stringify(visibleRun, null, 2) + "\n");
    }
    return NextResponse.json({
      script: {
        id: descriptor.id ?? id,
        title: descriptor.title,
        problem: descriptor.problem,
        desiredEffect: descriptor.desired_effect,
        authority: descriptor.authority,
        success: descriptor.success,
        failure: descriptor.failure,
        repeatable: descriptor.repeatable === true
      },
      run: visibleRun,
      output: {
        stdout: await readTail(path.join(resolvedRunDirectory, "stdout.log")),
        stderr: await readTail(path.join(resolvedRunDirectory, "stderr.log"))
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "That operator-script run was not found." }, { status: 404 });
    }
    console.error("Could not read operator-script run.", error);
    return NextResponse.json({ error: "The operator-script result is unavailable." }, { status: 500 });
  }
}
