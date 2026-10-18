import { NextResponse } from "next/server";
import { loadLatestRunReceiptFor } from "../../../../lib/operatorRunReceipts";
import { LIBRARY_PATH, SAFE_ID, describeScript } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One operator action: its descriptor, run state and receipt, and nothing else. It reads only that
 * id's files, so the single-action page never pays for the library listing. Launching still goes
 * through POST /api/operator-script, which owns every validation.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "A valid operator-script id is required." }, { status: 400 });
  try {
    const script = await describeScript(id, await loadLatestRunReceiptFor(LIBRARY_PATH, id));
    if (!script) return NextResponse.json({ error: "That operator action is not available." }, { status: 404 });
    return NextResponse.json({ script });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "That operator action is not available." }, { status: 404 });
    console.error(`Could not read operator script ${id}.`, error);
    return NextResponse.json({ error: "That operator action could not be read." }, { status: 500 });
  }
}
