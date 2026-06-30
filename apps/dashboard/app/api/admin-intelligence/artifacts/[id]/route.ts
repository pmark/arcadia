import { getIntelligenceClient } from "../../../../../lib/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const artifact = await getIntelligenceClient().getArtifact(`/api/intelligence/artifacts/${encodeURIComponent(id)}`);
    return new Response(artifact.bytes, {
      headers: { "content-type": artifact.contentType },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load artifact.";
    const status = /404/.test(message) ? 404 : 502;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
}
