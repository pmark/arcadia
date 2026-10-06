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
  let audioFormat: number | undefined;
  let blockAlign: number | undefined;

  // Sub-chunks begin after the 12-byte RIFF/WAVE header. Each is an 8-byte
  // header (4-char id + uint32 LE size) followed by `size` bytes, padded to an
  // even boundary.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.subarray(offset, offset + 4).toString("latin1");
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;

    if (chunkSize > bytes.length - bodyOffset) {
      return undefined;
    }

    if (chunkId === "fmt " && bodyOffset + 16 <= bytes.length) {
      audioFormat = bytes.readUInt16LE(bodyOffset);
      channels = bytes.readUInt16LE(bodyOffset + 2);
      sampleRateHz = bytes.readUInt32LE(bodyOffset + 4);
      byteRate = bytes.readUInt32LE(bodyOffset + 8);
      blockAlign = bytes.readUInt16LE(bodyOffset + 12);
      bitsPerSample = bytes.readUInt16LE(bodyOffset + 14);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }

    // Advance past this chunk (chunks are word-aligned: pad odd sizes by 1).
    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (
    sampleRateHz === undefined ||
    channels === undefined ||
    bitsPerSample === undefined ||
    dataBytes === undefined ||
    audioFormat !== 1 ||
    blockAlign === undefined ||
    sampleRateHz <= 0 ||
    channels <= 0 ||
    bitsPerSample <= 0
  ) {
    return undefined;
  }

  const expectedBlockAlign = (channels * bitsPerSample) / 8;
  const expectedByteRate = sampleRateHz * expectedBlockAlign;
  if (
    !Number.isInteger(expectedBlockAlign) ||
    expectedBlockAlign <= 0 ||
    byteRate !== expectedByteRate ||
    blockAlign !== expectedBlockAlign ||
    dataBytes % blockAlign !== 0
  ) {
    return undefined;
  }

  return {
    durationSeconds: dataBytes / expectedByteRate,
    sampleRateHz,
    channels,
    bitsPerSample,
  };
}

/** Format facts plus the raw PCM `data` chunk bytes of a WAV payload. */
export type WavDataChunk = {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  data: Buffer;
};

/**
 * Extracts the raw PCM `data` chunk and format facts from a WAV payload. Same
 * safety contract as `parseWavMetadata`: undefined for non-WAV or degenerate
 * headers, and the returned `data` is clamped to the bytes actually present so
 * a truncated file yields the audio we hold rather than a declared size we
 * cannot back. Used to concatenate several generated clips into one file.
 */
export function extractWavData(bytes: Buffer): WavDataChunk | undefined {
  if (!isWav(bytes)) {
    return undefined;
  }

  let sampleRateHz: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let audioFormat: number | undefined;
  let blockAlign: number | undefined;
  let data: Buffer | undefined;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.subarray(offset, offset + 4).toString("latin1");
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;

    if (chunkSize > bytes.length - bodyOffset) {
      return undefined;
    }

    if (chunkId === "fmt " && bodyOffset + 16 <= bytes.length) {
      audioFormat = bytes.readUInt16LE(bodyOffset);
      channels = bytes.readUInt16LE(bodyOffset + 2);
      sampleRateHz = bytes.readUInt32LE(bodyOffset + 4);
      blockAlign = bytes.readUInt16LE(bodyOffset + 12);
      bitsPerSample = bytes.readUInt16LE(bodyOffset + 14);
    } else if (chunkId === "data") {
      data = bytes.subarray(bodyOffset, bodyOffset + chunkSize);
    }

    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (
    sampleRateHz === undefined ||
    channels === undefined ||
    bitsPerSample === undefined ||
    data === undefined ||
    audioFormat !== 1 ||
    blockAlign === undefined ||
    sampleRateHz <= 0 ||
    channels <= 0 ||
    bitsPerSample <= 0
  ) {
    return undefined;
  }

  const expectedBlockAlign = (channels * bitsPerSample) / 8;
  if (
    !Number.isInteger(expectedBlockAlign) ||
    expectedBlockAlign <= 0 ||
    blockAlign !== expectedBlockAlign ||
    data.byteLength % blockAlign !== 0
  ) {
    return undefined;
  }

  return { sampleRateHz, channels, bitsPerSample, data };
}

/**
 * Builds a canonical 44-byte-header PCM WAV (`RIFF`/`WAVE`/`fmt `/`data`) from
 * raw PCM data and format facts. Deliberately emits no extra chunks, so a
 * concatenated narration file is deterministic and free of provider-specific
 * metadata.
 */
export function buildWav(input: WavDataChunk): Buffer {
  const { sampleRateHz, channels, bitsPerSample, data } = input;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRateHz * blockAlign;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.byteLength, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.byteLength, 40);

  return Buffer.concat([header, data]);
}
