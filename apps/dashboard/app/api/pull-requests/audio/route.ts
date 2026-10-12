import { NextResponse } from "next/server";
import { loadOutstandingPullRequests } from "../../../../lib/arcadia-cli";
import { AudioBusyError, generatePullRequestAudio } from "../../../../lib/pull-request-audio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 360;

export async function POST(request: Request) {
  let input: { repository?: unknown; number?: unknown };
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: "A PR repository and number are required." }, { status: 400 });
  }
  if (!input || typeof input.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository) || !Number.isSafeInteger(input.number) || Number(input.number) < 1) {
    return NextResponse.json({ error: "Invalid PR repository or number." }, { status: 400 });
  }
  try {
    const inventory = await loadOutstandingPullRequests();
    if (!inventory.data.snapshot.pullRequests.some(pr => pr.repository.toLowerCase() === String(input.repository).toLowerCase())) {
      return NextResponse.json({ error: "This repository is not in the open PR inventory. Select a PR from a repository shown on this page." }, { status: 404 });
    }
    const audio = await generatePullRequestAudio(input.repository, Number(input.number));
    return new Response(audio.bytes, {
      headers: {
        "content-type": audio.format === "mp3" ? "audio/mpeg" : "audio/wav",
        "content-disposition": `attachment; filename="pr-${Number(input.number)}-body.${audio.format}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare PR audio." }, { status: error instanceof AudioBusyError ? 409 : 502 });
  }
}
