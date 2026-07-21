import { NextResponse } from "next/server";
import { ArcadiaCliError, submitMissionControlReply } from "../../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ReplyRequest {
  text?: unknown;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as ReplyRequest;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Reply text is required." }, { status: 400 });
    }

    const response = await submitMissionControlReply({ nodeId: decodeURIComponent(id), text });
    return NextResponse.json(response.data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof ArcadiaCliError ? error.details : null
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}
