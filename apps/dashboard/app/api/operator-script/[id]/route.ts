import { NextResponse } from "next/server";
import { OperatorScriptContractError } from "../../../../../../src/operatorActions/libraryContract.js";
import { loadLatestRunReceiptFor } from "../../../../lib/operatorRunReceipts";
import { SAFE_KEY, describeScript, resolveLibraryEntry } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One operator action: its descriptor, run state and receipt, and nothing else. It reads only that
 * id's files, so the single-action page never pays for the library listing. Launching still goes
 * through POST /api/operator-script, which owns every validation.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!SAFE_KEY.test(id)) return NextResponse.json({ error: "A valid operator-script id is required." }, { status: 400 });
  try {
    const entry = resolveLibraryEntry(id);
    const script = await describeScript(id, await loadLatestRunReceiptFor(entry.stateLibrary, entry.id));
    if (!script) return NextResponse.json({ error: "That operator action is not available." }, { status: 404 });
    return NextResponse.json({ script });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof OperatorScriptContractError && ["UNPUBLISHED_PROJECT_ENTRY", "UNSUPPORTED_PROJECT_ENTRY"].includes(error.reason))) {
      return NextResponse.json({ error: "That operator action is not available." }, { status: 404 });
    }
    console.error(`Could not read operator script ${id}.`, error);
    return NextResponse.json({ error: "That operator action could not be read." }, { status: 500 });
  }
}
