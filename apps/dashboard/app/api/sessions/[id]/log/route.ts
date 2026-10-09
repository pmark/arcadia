import { NextResponse } from "next/server";
import { readSessionLogTail } from "../../../../../lib/session-log";
import { resolveDashboardWorkspace } from "../../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only tail of `<workspace>/.arcadia/sessions/<id>.log`, the per-Session
 * output record. `?offset=<bytes>` returns only what was appended since that
 * offset, so a 4-second poll moves kilobytes, not the whole file. A missing
 * file is a normal answer (`available: false`): Sessions launched before
 * headless recording write none.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const offsetParam = new URL(request.url).searchParams.get("offset");
    const offset = offsetParam === null ? null : Number(offsetParam);
    if (offset !== null && (!Number.isInteger(offset) || offset < 0)) {
      return NextResponse.json({ error: "offset must be a whole number of bytes.", details: null }, { status: 400 });
    }
    const workspace = await resolveDashboardWorkspace();
    const tail = await readSessionLogTail(workspace, id, offset);
    if (!tail.ok) return NextResponse.json({ error: tail.error, details: null }, { status: 400 });
    return NextResponse.json(tail.value, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), details: null }, { status: 500 });
  }
}
