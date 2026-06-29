/**
 * Minimal, dependency-free image format sniffing. Generated images from
 * LiteLLM-backed providers are almost always PNG or JPEG, so this only
 * needs to be good enough for those — unknown formats fall back to
 * "application/octet-stream" and undefined dimensions, both of which are
 * acceptable per the generic artifact contract (dimensions are optional).
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImageMimeType(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("latin1") === "GIF87a") {
    return "image/gif";
  }
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("latin1") === "GIF89a") {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export function mimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

/** Reads width/height from a PNG's IHDR chunk. Returns undefined for any other format. */
export function parseImageDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  return undefined;
}
