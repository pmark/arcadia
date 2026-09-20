import { constants } from "node:fs";
import { access, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIBRARY_PATH = "/Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts";
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

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
    !isNonEmptyString(descriptor.failure?.next)
  ) {
    throw new Error("Operator-script descriptor is incomplete.");
  }
  const scriptPath = await realpath(path.join(LIBRARY_PATH, descriptor.script));
  const libraryPath = await realpath(LIBRARY_PATH);
  if (path.dirname(scriptPath) !== libraryPath) throw new Error("Operator script resolves outside the library.");
  await access(scriptPath, constants.X_OK);
  return { descriptor, scriptPath };
}

export async function GET() {
  try {
    const entries = await readdir(LIBRARY_PATH);
    const ids = entries.filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5)).filter((id) => SAFE_ID.test(id));
    const scripts = await Promise.all(ids.map(async (id) => {
      try {
        const { descriptor } = await loadDescriptor(id);
        return { id: descriptor.id, title: descriptor.title, desiredEffect: descriptor.desired_effect, authority: descriptor.authority };
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

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin operator-script requests are refused." }, { status: 403 });
  }
  let body: { id?: unknown };
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
    const child = spawn(scriptPath, ["run"], { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return NextResponse.json({ message: `${descriptor.title} started. Progress is recorded in the operator-script runs folder.` }, { status: 202 });
  } catch (error) {
    console.error(`Could not launch operator script ${id}.`, error);
    return NextResponse.json({ error: "That operator script could not be started on the host. Check the dashboard service log." }, { status: 500 });
  }
}
