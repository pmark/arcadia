import { ArtifactOpenError, readWorkspaceArtifact } from "../../../../../lib/workspace-artifact";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
};
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const receipt = query.get("receipt") ?? "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(id) || !receipt.trim() || receipt.length > 300 || [...query.keys()].some(key => key !== "receipt")) {
    return Response.json({ error: "An Artifact id and Ask receipt are required; file paths are not accepted." }, { status: 400, headers });
  }
  try {
    const { bytes, contentType } = await readWorkspaceArtifact(id, receipt);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-type": `${contentType}${contentType === "text/plain" ? "; charset=utf-8" : ""}`, "content-length": String(bytes.length) } });
  } catch (error) {
    return Response.json({ error: error instanceof ArtifactOpenError ? error.message : "The Artifact file could not be opened." }, { status: error instanceof ArtifactOpenError ? error.status : 503, headers });
  }
}
