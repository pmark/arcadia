import { getIntelligenceClient } from "../../../../../lib/intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mobile Safari's <audio>/<video> elements require the server to support
 * HTTP Range requests (a 206 response to a `Range:` header) — without it,
 * playback fails outright even though a plain download of the same URL
 * works fine. Parses a single "bytes=start-end" / "bytes=start-" /
 * "bytes=-suffixLength" range against a known total length. Returns
 * undefined for a missing/unparseable header (caller falls back to a full
 * 200 response) and null for a range outside the file (caller sends 416).
 */
function parseRange(rangeHeader: string | null, totalLength: number): { start: number; end: number } | null | undefined {
  if (!rangeHeader) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return undefined;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return undefined;

  let start: number;
  let end: number;
  if (startStr === "") {
    // Suffix range: last N bytes.
    const suffixLength = Number(endStr);
    start = Math.max(0, totalLength - suffixLength);
    end = totalLength - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? totalLength - 1 : Math.min(Number(endStr), totalLength - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || start >= totalLength) {
    return null;
  }
  return { start, end };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const artifact = await getIntelligenceClient().getArtifact(`/api/intelligence/artifacts/${encodeURIComponent(id)}`);
    const totalLength = artifact.bytes.byteLength;
    const range = parseRange(request.headers.get("range"), totalLength);

    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${totalLength}`, "accept-ranges": "bytes" },
      });
    }

    if (range === undefined) {
      return new Response(artifact.bytes, {
        headers: {
          "content-type": artifact.contentType,
          "content-length": String(totalLength),
          "accept-ranges": "bytes",
        },
      });
    }

    const { start, end } = range;
    return new Response(artifact.bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        "content-type": artifact.contentType,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${totalLength}`,
        "accept-ranges": "bytes",
      },
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
