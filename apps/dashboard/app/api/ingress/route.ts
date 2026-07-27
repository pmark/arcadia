import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  describeIngressFiles,
  listIngressFiles
} from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await listIngressFiles();
    return NextResponse.json({
      ...response.data,
      files: response.data.files.map((file) => ({
        ...file,
        previewUrl: (file.kind === "image" || file.kind === "video") && file.downloadState !== "not_downloaded"
          ? `/api/ingress/file?path=${encodeURIComponent(file.relativePath)}`
          : null
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}

interface DescribeRequest {
  files?: unknown;
  description?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DescribeRequest;
    const files = Array.isArray(body.files)
      ? body.files.filter((file): file is string => typeof file === "string")
      : [];
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (files.length === 0 || !description) {
      return NextResponse.json(
        { error: "Select at least one file and describe the Action.", details: null },
        { status: 400 }
      );
    }

    const response = await describeIngressFiles({ files, description });
    return NextResponse.json({ message: "Ingress Action queued.", result: response.data });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : String(error),
      details: error instanceof ArcadiaCliError ? error.details : null
    },
    { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
  );
}
