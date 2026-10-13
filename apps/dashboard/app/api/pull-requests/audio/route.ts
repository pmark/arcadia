import { NextResponse } from "next/server";
import { ArcadiaCliError, loadPullRequestDescription } from "../../../../lib/arcadia-cli";
import { preparePullRequestAudio } from "../../../../lib/pull-request-audio";
import { safeIntelligenceJob } from "../../../../lib/safe-intelligence-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;
function valid(input: unknown): input is { repository: string; number: number } {
  return !!input && typeof input === "object" && "repository" in input && typeof input.repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository) && "number" in input && Number.isSafeInteger(input.number) && Number(input.number) > 0;
}
function failure(error: unknown) { const status = error instanceof ArcadiaCliError ? error.statusCode : 502; return NextResponse.json({ error: status === 404 ? "PR source unavailable or repository not configured." : "Could not prepare TLDR audio." }, { status }); }

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = { repository: params.get("repository"), number: Number(params.get("number")) };
  if (!valid(input)) return NextResponse.json({ error: "Invalid PR repository or number." }, { status: 400 });
  try { return NextResponse.json({ source: await loadPullRequestDescription(input.repository, input.number) }); } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid PR request." }, { status: 400 }); }
  if (!valid(input)) return NextResponse.json({ error: "Invalid PR repository or number." }, { status: 400 });
  try { const result = await preparePullRequestAudio(input.repository, input.number); return NextResponse.json({ ...result, job: safeIntelligenceJob(result.job) }); } catch (error) { return failure(error); }
}
