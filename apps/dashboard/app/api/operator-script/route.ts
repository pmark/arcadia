import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { isSameOriginRequest } from "../../../lib/originGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCRIPT_ID = "request-arcadia-go-handoff";
const SCRIPT_PATH = "/Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts/request-arcadia-go-handoff.sh";

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
  if (body.id !== SCRIPT_ID) {
    return NextResponse.json({ error: `The only supported operator script is ${SCRIPT_ID}.` }, { status: 400 });
  }

  try {
    await access(SCRIPT_PATH, constants.X_OK);
    const child = spawn(SCRIPT_PATH, ["run"], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return NextResponse.json(
      { message: "Protected Go handoff started. The dashboard may briefly restart; progress is recorded in the operator-script runs folder." },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
