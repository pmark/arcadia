/**
 * Minimal, dependency-free WAV inspection. Generated speech from
 * OpenAI-compatible providers (MLX-Audio/Kokoro, LiteLLM) is requested as WAV
 * in this milestone, so this only needs to be good enough to confirm the bytes
 * are a decodable RIFF/WAVE payload and read duration/sample-rate/channels from
 * the header. Unknown or corrupt bytes yield "application/octet-stream" and
 * undefined metadata, which the worker treats as a hard, safe failure (rather
 * than persisting an undecodable artifact).
 *
 * This is the audio analog of artifacts/imageMeta.ts and deliberately avoids a
 * media-processing dependency (or an ffprobe subprocess) to keep inspection
 * deterministic and hermetic.
 */

export type WavMetadata = {
  durationSeconds: number;
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
};

/** Returns "audio/wav" for a RIFF/WAVE payload, else "application/octet-stream". */
export function sniffAudioMimeType(bytes: Buffer): string {
  if (isWav(bytes)) {
    return "audio/wav";
  }
  return "application/octet-stream";
}

export function audioMimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}

function isWav(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WAVE"
  );
}

/**
 * Reads sample rate, channels, bits-per-sample, and duration from a WAV
 * payload by walking its RIFF sub-chunks. Returns undefined when the bytes are
 * not a valid WAV, the required `fmt `/`data` chunks are missing, or the header
 * values are degenerate (so callers can fail safely instead of trusting a
 * corrupt artifact).
 */
export function parseWavMetadata(bytes: Buffer): WavMetadata | undefined {
  if (!isWav(bytes)) {
    return undefined;
  }

  let sampleRateHz: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let dataBytes: number | undefined;
  let byteRate: number | undefined;

  // Sub-chunks begin after the 12-byte RIFF/WAVE header. Each is an 8-byte
  // header (4-char id + uint32 LE size) followed by `size` bytes, padded to an
  // even boundary.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.subarray(offset, offset + 4).toString("latin1");
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;

    if (chunkId === "fmt " && bodyOffset + 16 <= bytes.length) {
      channels = bytes.readUInt16LE(bodyOffset + 2);
      sampleRateHz = bytes.readUInt32LE(bodyOffset + 4);
      byteRate = bytes.readUInt32LE(bodyOffset + 8);
      bitsPerSample = bytes.readUInt16LE(bodyOffset + 14);
    } else if (chunkId === "data") {
      // Clamp the declared size to what is actually present, so a truncated
      // file reports the duration of the bytes we hold rather than a lie.
      dataBytes = Math.min(chunkSize, bytes.length - bodyOffset);
    }

    // Advance past this chunk (chunks are word-aligned: pad odd sizes by 1).
    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (
    sampleRateHz === undefined ||
    channels === undefined ||
    bitsPerSample === undefined ||
    dataBytes === undefined ||
    sampleRateHz <= 0 ||
    channels <= 0 ||
    bitsPerSample <= 0
  ) {
    return undefined;
  }

  const effectiveByteRate =
    byteRate && byteRate > 0 ? byteRate : (sampleRateHz * channels * bitsPerSample) / 8;
  if (effectiveByteRate <= 0) {
    return undefined;
  }

  return {
    durationSeconds: dataBytes / effectiveByteRate,
    sampleRateHz,
    channels,
    bitsPerSample,
  };
}
