import { NextResponse } from "next/server";
import { ArcadiaCliError, loadPullRequestDetails } from "../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const repository = params.get("repository") ?? "";
  const number = Number(params.get("number"));
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(number) || number <= 0) {
    return NextResponse.json({ error: "Invalid PR repository or number." }, { status: 400 });
  }
  try { return NextResponse.json(await loadPullRequestDetails(repository, number), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: "Could not load details from a configured repository." }, { status: error instanceof ArcadiaCliError ? error.statusCode : 502 }); }
}
