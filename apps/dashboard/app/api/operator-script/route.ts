import { assertProjectLibraryEntry, OperatorScriptContractError, validateOperatorScriptContract } from "../../../../../src/operatorActions/libraryContract.js";
import { matchRetirement, parseRetirementManifest } from "../../../../../src/operatorActions/libraryRetirements.js";
import retirementManifest from "../../../../../src/operatorActions/legacyRetirements.json";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";
import { loadOperatorScriptReceipt } from "../../../lib/operatorScriptReceipt";
import { loadLatestRunReceipts, type RunReceiptSummary } from "../../../lib/operatorRunReceipts";
import { operatorScriptRunnerSource } from "../../../lib/operatorScriptRunner";
import { discoverProjectOperatorLibraries, parseOperatorScriptKey, projectLibraryKey, projectLibraryStateDir } from "../../../../../src/operatorActions/projectLibraries.js";
import { delegatedPressMarker, StartRunDelegationError, type DelegatedPress } from "../../../../../src/operatorActions/startRunDelegation.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// /runs reads the main checkout's library, never a worktree's copy.
export const LIBRARY_PATH =
  process.env.ARCADIA_OPERATOR_SCRIPT_LIBRARY?.trim() ||
  path.join(os.homedir(), "Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts");
export const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A bare id (Arcadia's library) or `<project>--<id>` (that registered Project's own library). */
export const SAFE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

/**
 * One library entry, resolved from its key. `library` holds the descriptor and script; `stateLibrary`
 * holds run state, launches and receipts (`runs/`). For Arcadia's library they are the same directory;
 * a Project's state lives beside Arcadia's library, never inside the Project's checkout.
 */
export interface LibraryEntry { key: string; id: string; project: string | null; library: string; stateLibrary: string }

/** Every library the dashboard reads: Arcadia's, then each registered Project's own. */
export function operatorLibraries(): { project: string | null; library: string; stateLibrary: string }[] {
  const projects = discoverProjectOperatorLibraries(LIBRARY_PATH).libraries
    .map(({ project, path: library }) => ({ project, library, stateLibrary: projectLibraryStateDir(LIBRARY_PATH, project) }));
  return [{ project: null, library: LIBRARY_PATH, stateLibrary: LIBRARY_PATH }, ...projects];
}

/** Resolve a key to its own library only; an unknown Project or malformed key is a missing entry. */
export function resolveLibraryEntry(key: string): LibraryEntry {
  const parsed = SAFE_KEY.test(key) ? parseOperatorScriptKey(key) : null;
  if (!parsed) throw new Error("Invalid operator-script id.");
  if (parsed.project === null) return { key, id: parsed.id, project: null, library: LIBRARY_PATH, stateLibrary: LIBRARY_PATH };
  const found = discoverProjectOperatorLibraries(LIBRARY_PATH).libraries.find((library) => library.project === parsed.project);
  if (!found) throw Object.assign(new Error(`No registered Project library for ${parsed.project}.`), { code: "ENOENT" });
  return { key, id: parsed.id, project: parsed.project, library: found.path, stateLibrary: projectLibraryStateDir(LIBRARY_PATH, parsed.project) };
}

const statePath = (entry: LibraryEntry) => path.join(entry.stateLibrary, "runs", "state");
const launchesPath = (entry: LibraryEntry) => path.join(entry.stateLibrary, "runs", "operator");
const STALE_LOCK_MS = 30_000;

export interface OperatorScriptState {
  status: "running" | "succeeded" | "failed";
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  message?: string;
  runId?: string;
}

export interface OperatorScriptRun {
  schema: "arcadia-operator-script-run-v1";
  runId: string;
  scriptId: string;
  /** Decision 0163: present only on Rowan's delegated press; an operator press carries no marker. */
  press?: DelegatedPress;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  message?: string;
  runDirectory: string;
  descriptor: {
    title: string;
    problem: string;
    desiredEffect: string;
    authority: { does: string[]; never_does: string[] };
    success: { effect: string; next: string };
    failure: { effect: string; next: string };
  };
  files: { stdout: string; stderr: string; descriptor: string; state: string };
}

const RETIREMENTS = parseRetirementManifest(retirementManifest);

/** True for a legacy entry pinned by hash in legacyRetirements.json: it is intentionally never listed or run, so it is not an error. */
async function isRetired(entry: LibraryEntry): Promise<boolean> {
  // The retirement manifest pins Arcadia's own legacy entries only.
  if (entry.project !== null || !RETIREMENTS.has(entry.id)) return false;
  const id = entry.id;
  try {
    return matchRetirement(RETIREMENTS, id, await readFile(path.join(entry.library, `${id}.json`)), await readFile(path.join(entry.library, `${id}.sh`))) !== undefined;
  } catch {
    return false;
  }
}

/** Load and validate an operator-script descriptor and its executable path. */
export async function loadDescriptor(key: string): Promise<{ descriptor: ReturnType<typeof validateOperatorScriptContract>; scriptPath: string; entry: LibraryEntry }> {
  const entry = resolveLibraryEntry(key);
  const { id, library } = entry;
  const libraryPath = await realpath(library);
  const descriptorPath = await realpath(path.join(library, `${id}.json`));
  const scriptPath = await realpath(path.join(library, `${id}.sh`));
  if (path.dirname(scriptPath) !== libraryPath || path.dirname(descriptorPath) !== libraryPath) throw new Error("Operator script resolves outside the library.");
  await access(scriptPath, constants.X_OK);
  const raw = JSON.parse(await readFile(descriptorPath, "utf8")) as unknown;
  // A Project library publishes an entry only by naming its own Project, and only with runners that are
  // Arcadia's wherever the entry lives; checked first, so an unpublished legacy entry is never validated.
  if (entry.project !== null) assertProjectLibraryEntry(raw, entry.project);
  const descriptor = validateOperatorScriptContract(raw, id, await readFile(scriptPath, "utf8"));
  return { descriptor, scriptPath, entry };
}

export async function loadState(key: string): Promise<OperatorScriptState | null> {
  const entry = resolveLibraryEntry(key);
  try {
    return JSON.parse(await readFile(path.join(statePath(entry), `${entry.id}.json`), "utf8")) as OperatorScriptState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeStateAtomically(entry: LibraryEntry, state: OperatorScriptState): Promise<void> {
  const destination = path.join(statePath(entry), `${entry.id}.json`);
  const temporary = path.join(statePath(entry), `${entry.id}.tmp-${process.pid}-${Date.now()}.json`);
  await writeFile(temporary, JSON.stringify(state) + "\n");
  await rename(temporary, destination);
}

export function processIsRunning(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function claimLaunch(key: string): Promise<string> {
  const entry = resolveLibraryEntry(key);
  await mkdir(statePath(entry), { recursive: true });
  const lockPath = path.join(statePath(entry), `${entry.id}.lock`);
  try {
    const handle = await open(lockPath, "wx");
    await handle.close();
    return lockPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const age = Date.now() - (await stat(lockPath)).mtimeMs;
    if (age <= STALE_LOCK_MS) throw new Error("OPERATOR_SCRIPT_ALREADY_CLAIMED", { cause: error });
    const state = await loadState(key);
    if (state?.status === "running" && processIsRunning(state.pid)) throw new Error("OPERATOR_SCRIPT_ALREADY_CLAIMED", { cause: error });
    await unlink(lockPath);
    const handle = await open(lockPath, "wx");
    await handle.close();
    return lockPath;
  }
}

/**
 * One library entry as the list and the single-action page show it, or null when it is retired.
 * Shared so /actions and /actions/<id> can never disagree about an action's state.
 */
export async function describeScript(key: string, runReceipt: RunReceiptSummary | null) {
  const target = resolveLibraryEntry(key);
  if (await isRetired(target)) return null;
  const { descriptor, entry } = await loadDescriptor(key);
  const recorded = await loadState(key);
  const receipt = await loadOperatorScriptReceipt(entry.stateLibrary, entry.id);
  const state = recorded?.status === "running" && !processIsRunning(recorded.pid)
    ? { ...recorded, status: "failed" as const, message: "The launcher stopped before recording a result." }
    : recorded;
  const scriptMtime = (await stat(path.join(entry.library, `${entry.id}.sh`))).mtime.toISOString();
  const updatedAt = state?.finishedAt ?? state?.startedAt ?? scriptMtime;
  return {
    // The key is what /actions links and POSTs; for Arcadia's own library it is the bare id.
    id: entry.key,
    project: entry.project,
    kind: descriptor.kind,
    title: descriptor.title,
    problem: descriptor.problem,
    desiredEffect: descriptor.desired_effect,
    authority: descriptor.authority,
    success: descriptor.success,
    failure: descriptor.failure,
    repeatable: descriptor.repeatable === true,
    nextAfter: descriptor.next_after ?? null,
    // The pin itself, not the descriptor's prose: what the press actually settles.
    pinnedSettlement: descriptor.agentAskSettlement && descriptor.agentAsk
      ? { project: descriptor.agentAskSettlement.project, proposal: descriptor.agentAsk.proposal,
          disposition: descriptor.agentAskSettlement.disposition, placement: descriptor.agentAskSettlement.placement }
      : null,
    lastRunReceipt: runReceipt,
    state: state?.status === "running" ? state : receipt
      ? { ...state, status: receipt.status === "running" && !processIsRunning(receipt.pid) ? "failed" : receipt.status,
          message: receipt.status === "running" && !processIsRunning(receipt.pid) ? "The bounded runner stopped; retry this exact action to recover its canonical receipt." : receipt.message }
      : state ?? { status: "available" },
    receipt,
    updatedAt,
    modifiedAt: scriptMtime
  };
}

/** List every valid operator script currently available in the library. */
export async function GET() {
  try {
    const [arcadia, ...projects] = operatorLibraries();
    const listLibrary = async ({ project, library, stateLibrary }: typeof arcadia) => {
      const ids = (await readdir(library)).filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5)).filter((id) => SAFE_ID.test(id));
      const runReceipts = await loadLatestRunReceipts(stateLibrary);
      return Promise.all(ids.map(async (id) => {
        const key = project === null ? id : projectLibraryKey(project, id);
        try {
          return await describeScript(key, runReceipts.get(id) ?? null);
        } catch (error) {
          // A Project's unpublished or unsupported entry is skipped quietly; anything else is logged.
          if (!(error instanceof OperatorScriptContractError && ["UNPUBLISHED_PROJECT_ENTRY", "UNSUPPORTED_PROJECT_ENTRY"].includes(error.reason))) {
            console.error(`Ignoring invalid operator-script library entry ${key}.`, error);
          }
          return null;
        }
      }));
    };
    // Arcadia's library must be readable; one unreadable Project library never blanks the page.
    const scripts = [
      ...(await listLibrary(arcadia)),
      ...(await Promise.all(projects.map((project) => listLibrary(project).catch((error) => {
        console.error(`Could not read the ${project.project} operator-script library.`, error);
        return [];
      })))).flat()
    ];
    return NextResponse.json({ scripts: scripts.filter((entry): entry is NonNullable<typeof entry> => entry !== null).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) });
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
  let body: { id?: unknown; delegation?: unknown };
  let lockPath: string | null = null;
  let runRecordPath: string | null = null;
  let initialRun: OperatorScriptRun | null = null;
  try {
    body = await request.json() as { id?: unknown; delegation?: unknown };
  } catch {
    return NextResponse.json({ error: "A valid JSON body is required." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!SAFE_KEY.test(id) || !parseOperatorScriptKey(id)) {
    return NextResponse.json({ error: "A valid operator-script id is required." }, { status: 400 });
  }
  let entry: LibraryEntry | null = null;
  try {
    const loaded = await loadDescriptor(id);
    const { descriptor, scriptPath } = loaded;
    entry = loaded.entry;
    // Decision 0163: Rowan's press of a delegated START card is recorded as delegated, never as the operator's.
    let press: DelegatedPress | null;
    try { press = delegatedPressMarker(descriptor, body.delegation); }
    catch (error) {
      if (error instanceof StartRunDelegationError) return NextResponse.json({ error: error.message, reason: error.code }, { status: 409 });
      throw error;
    }
    const state = await loadState(id);
    const receipt = await loadOperatorScriptReceipt(entry.stateLibrary, entry.id);
    if ((state?.status === "running" && processIsRunning(state.pid)) || (receipt?.status === "running" && processIsRunning(receipt.pid))) {
      return NextResponse.json({ error: `${descriptor.title} is already running.` }, { status: 409 });
    }
    if ((state?.status === "succeeded" || receipt?.status === "succeeded") && descriptor.repeatable !== true) {
      return NextResponse.json({ error: `${descriptor.title} already completed and is no longer executable.` }, { status: 409 });
    }
    lockPath = await claimLaunch(id);
    const latestState = await loadState(id);
    const latestReceipt = await loadOperatorScriptReceipt(entry.stateLibrary, entry.id);
    if ((latestState?.status === "running" && processIsRunning(latestState.pid)) || (latestReceipt?.status === "running" && processIsRunning(latestReceipt.pid))) {
      await unlink(lockPath);
      lockPath = null;
      return NextResponse.json({ error: `${descriptor.title} is already running.` }, { status: 409 });
    }
    if ((latestState?.status === "succeeded" || latestReceipt?.status === "succeeded") && descriptor.repeatable !== true) {
      await unlink(lockPath);
      lockPath = null;
      return NextResponse.json({ error: `${descriptor.title} already completed and is no longer executable.` }, { status: 409 });
    }
    const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").toLowerCase()}-${randomUUID()}`;
    const runDirectory = path.join(launchesPath(entry), entry.id, runId);
    await mkdir(runDirectory, { recursive: true });
    const descriptorSnapshotPath = path.join(runDirectory, "descriptor.json");
    runRecordPath = path.join(runDirectory, "run.json");
    const scriptStatePath = path.join(statePath(entry), `${entry.id}.json`);
    const relativeRunDirectory = path.relative(entry.stateLibrary, runDirectory);
    const descriptorSnapshot = {
      title: descriptor.title,
      problem: descriptor.problem,
      desiredEffect: descriptor.desired_effect,
      authority: descriptor.authority,
      success: descriptor.success,
      failure: descriptor.failure
    };
    const startedAt = new Date().toISOString();
    initialRun = {
      schema: "arcadia-operator-script-run-v1",
      runId,
      scriptId: id,
      ...(press ? { press } : {}),
      status: "running",
      startedAt,
      runDirectory: relativeRunDirectory,
      descriptor: descriptorSnapshot,
      files: { stdout: `${relativeRunDirectory}/stdout.log`, stderr: `${relativeRunDirectory}/stderr.log`, descriptor: `${relativeRunDirectory}/descriptor.json`, state: `${relativeRunDirectory}/run.json` }
    };
    await writeFile(descriptorSnapshotPath, JSON.stringify({ ...descriptor, authority: descriptor.authority }, null, 2) + "\n");
    await writeFile(runRecordPath, JSON.stringify(initialRun, null, 2) + "\n");
    // Shared runners keep their receipts in this entry's state library (outside any Project checkout).
    const child = spawn(process.execPath, ["-e", operatorScriptRunnerSource, scriptPath, runRecordPath, scriptStatePath, lockPath, runDirectory, runId, descriptorSnapshotPath], {
      detached: true, stdio: "ignore", env: { ...process.env, ARCADIA_OPERATOR_SCRIPT_STATE_DIR: entry.stateLibrary }
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return NextResponse.json({ runId, scriptId: id, status: "running", message: `${descriptor.title} started.` }, { status: 202 });
  } catch (error) {
    if (runRecordPath && initialRun) {
      await writeFile(runRecordPath, JSON.stringify({ ...initialRun, status: "failed", finishedAt: new Date().toISOString(), exitCode: null, message: "The launcher could not start." }, null, 2) + "\n").catch(() => undefined);
    }
    if (lockPath && entry) {
      await writeStateAtomically(entry, { status: "failed", finishedAt: new Date().toISOString(), exitCode: null, message: "The launcher could not start." });
      await unlink(lockPath).catch(() => undefined);
    }
    if (error instanceof Error && error.message === "OPERATOR_SCRIPT_ALREADY_CLAIMED") {
      return NextResponse.json({ error: "That operator action is already being started." }, { status: 409 });
    }
    if (error instanceof OperatorScriptContractError) {
      return NextResponse.json({ error: error.message, reason: error.reason, next: error.next }, { status: 409 });
    }
    console.error(`Could not launch operator script ${id}.`, error);
    return NextResponse.json({ error: "That operator script could not be started on the host. Check the dashboard service log." }, { status: 500 });
  }
}
