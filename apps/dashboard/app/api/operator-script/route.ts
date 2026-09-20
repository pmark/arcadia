import { constants } from "node:fs";
import { access, mkdir, open, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";
import { operatorScriptRunnerSource } from "../../../lib/operatorScriptRunner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIBRARY_PATH = "/Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts";
const STATE_PATH = path.join(LIBRARY_PATH, "runs", "state");
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STALE_LOCK_MS = 30_000;

interface OperatorScriptDescriptor {
  schema: "arcadia-operator-script-v1";
  id: string;
  title: string;
  script: string;
  problem: string;
  desired_effect: string;
  authority: { does: string[]; never_does: string[] };
  success: { effect: string; next: string };
  failure: { effect: string; next: string };
  repeatable?: boolean;
}

interface OperatorScriptState {
  status: "running" | "succeeded" | "failed";
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  message?: string;
}

/** Return whether a value is a non-empty string after trimming whitespace. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Return whether a value is an array containing only non-empty strings. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/** Load and validate an operator-script descriptor and its executable path. */
async function loadDescriptor(id: string): Promise<{ descriptor: OperatorScriptDescriptor; scriptPath: string }> {
  if (!SAFE_ID.test(id)) throw new Error("Invalid operator-script id.");
  const descriptorPath = path.join(LIBRARY_PATH, `${id}.json`);
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as OperatorScriptDescriptor;
  if (descriptor.schema !== "arcadia-operator-script-v1" || descriptor.id !== id || descriptor.script !== `${id}.sh`) {
    throw new Error("Operator-script descriptor does not match its library entry.");
  }
  if (
    !isNonEmptyString(descriptor.title) ||
    !isNonEmptyString(descriptor.problem) ||
    !isNonEmptyString(descriptor.desired_effect) ||
    !isStringList(descriptor.authority?.does) ||
    !isStringList(descriptor.authority?.never_does) ||
    !isNonEmptyString(descriptor.success?.effect) ||
    !isNonEmptyString(descriptor.success?.next) ||
    !isNonEmptyString(descriptor.failure?.effect) ||
    !isNonEmptyString(descriptor.failure?.next) ||
    (descriptor.repeatable !== undefined && typeof descriptor.repeatable !== "boolean")
  ) {
    throw new Error("Operator-script descriptor is incomplete.");
  }
  const scriptPath = await realpath(path.join(LIBRARY_PATH, descriptor.script));
  const libraryPath = await realpath(LIBRARY_PATH);
  if (path.dirname(scriptPath) !== libraryPath) throw new Error("Operator script resolves outside the library.");
  await access(scriptPath, constants.X_OK);
  return { descriptor, scriptPath };
}

async function loadState(id: string): Promise<OperatorScriptState | null> {
  try {
    return JSON.parse(await readFile(path.join(STATE_PATH, `${id}.json`), "utf8")) as OperatorScriptState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function processIsRunning(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function claimLaunch(id: string): Promise<string> {
  await mkdir(STATE_PATH, { recursive: true });
  const lockPath = path.join(STATE_PATH, `${id}.lock`);
  try {
    const handle = await open(lockPath, "wx");
    await handle.close();
    return lockPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const age = Date.now() - (await stat(lockPath)).mtimeMs;
    if (age <= STALE_LOCK_MS) throw new Error("OPERATOR_SCRIPT_ALREADY_CLAIMED", { cause: error });
    const state = await loadState(id);
    if (state?.status === "running" && processIsRunning(state.pid)) throw new Error("OPERATOR_SCRIPT_ALREADY_CLAIMED", { cause: error });
    await unlink(lockPath);
    const handle = await open(lockPath, "wx");
    await handle.close();
    return lockPath;
  }
}

/** List every valid operator script currently available in the library. */
export async function GET() {
  try {
    const entries = await readdir(LIBRARY_PATH);
    const ids = entries.filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5)).filter((id) => SAFE_ID.test(id));
    const scripts = await Promise.all(ids.map(async (id) => {
      try {
        const { descriptor } = await loadDescriptor(id);
        const recorded = await loadState(id);
        const state = recorded?.status === "running" && !processIsRunning(recorded.pid)
          ? { ...recorded, status: "failed" as const, message: "The launcher stopped before recording a result." }
          : recorded;
        return {
          id: descriptor.id,
          title: descriptor.title,
          desiredEffect: descriptor.desired_effect,
          authority: descriptor.authority,
          repeatable: descriptor.repeatable === true,
          state: state ?? { status: "available" }
        };
      } catch (error) {
        console.error(`Ignoring invalid operator-script library entry ${id}.`, error);
        return null;
      }
    }));
    return NextResponse.json({ scripts: scripts.filter((entry) => entry !== null) });
  } catch (error) {
    console.error("Could not read the operator-script library.", error);
    return NextResponse.json({ error: "The operator-script library is unavailable." }, { status: 500 });
  }
}

/** Validate and launch a requested operator script as a detached process. */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin operator-script requests are refused." }, { status: 403 });
  }
  let body: { id?: unknown };
  let lockPath: string | null = null;
  try {
    body = await request.json() as { id?: unknown };
  } catch {
    return NextResponse.json({ error: "A valid JSON body is required." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: "A valid operator-script id is required." }, { status: 400 });
  }
  try {
    const { descriptor, scriptPath } = await loadDescriptor(id);
    const state = await loadState(id);
    if (state?.status === "running" && processIsRunning(state.pid)) {
      return NextResponse.json({ error: `${descriptor.title} is already running.` }, { status: 409 });
    }
    if (state?.status === "succeeded" && descriptor.repeatable !== true) {
      return NextResponse.json({ error: `${descriptor.title} already completed and is no longer executable.` }, { status: 409 });
    }
    lockPath = await claimLaunch(id);
    const latestState = await loadState(id);
    if (latestState?.status === "running" && processIsRunning(latestState.pid)) {
      await unlink(lockPath);
      lockPath = null;
      return NextResponse.json({ error: `${descriptor.title} is already running.` }, { status: 409 });
    }
    if (latestState?.status === "succeeded" && descriptor.repeatable !== true) {
      await unlink(lockPath);
      lockPath = null;
      return NextResponse.json({ error: `${descriptor.title} already completed and is no longer executable.` }, { status: 409 });
    }
    const scriptStatePath = path.join(STATE_PATH, `${id}.json`);
    const child = spawn(process.execPath, ["-e", operatorScriptRunnerSource, scriptPath, scriptStatePath, lockPath], { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return NextResponse.json({ message: `${descriptor.title} started. Progress is recorded in the operator-script runs folder.` }, { status: 202 });
  } catch (error) {
    if (lockPath) {
      await writeFile(path.join(STATE_PATH, `${id}.json`), JSON.stringify({ status: "failed", finishedAt: new Date().toISOString(), exitCode: null, message: "The launcher could not start." }) + "\n");
      await unlink(lockPath).catch(() => undefined);
    }
    if (error instanceof Error && error.message === "OPERATOR_SCRIPT_ALREADY_CLAIMED") {
      return NextResponse.json({ error: "That operator action is already being started." }, { status: 409 });
    }
    console.error(`Could not launch operator script ${id}.`, error);
    return NextResponse.json({ error: "That operator script could not be started on the host. Check the dashboard service log." }, { status: 500 });
  }
}
