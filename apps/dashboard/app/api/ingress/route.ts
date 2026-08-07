import { NextResponse } from "next/server";
import {
  ArcadiaCliError,
  captureIngressFiles,
  describeIngressFiles,
  loadIngressActivity,
  listIngressFiles
} from "../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [response, activity] = await Promise.all([listIngressFiles(), loadIngressActivity()]);
    return NextResponse.json({
      ...response.data,
      activity: activity.data,
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
    if (request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      const form = await request.formData();
      const descriptionValue = form.get("description");
      const description = typeof descriptionValue === "string" ? descriptionValue.trim() : "";
      const uploads = form.getAll("file").filter((value): value is File => value instanceof File && value.size > 0);
      if (uploads.length === 0) {
        return NextResponse.json({ error: "Attach at least one file.", details: null }, { status: 400 });
      }
      const response = await captureIngressFiles({
        description: description || undefined,
        files: await Promise.all(uploads.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })))
      });
      return NextResponse.json({ message: "Files queued for Arcadia ingress processing.", result: response.data });
    }
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
