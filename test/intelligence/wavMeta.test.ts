import { describe, expect, it } from "vitest";
import {
  audioMimeTypeToExtension,
  parseWavMetadata,
  sniffAudioMimeType,
} from "../../src/intelligence/speech/wavMeta.js";
import { makeWavFixture } from "./testSupport.js";

describe("wavMeta", () => {
  it("sniffs a RIFF/WAVE payload as audio/wav", () => {
    expect(sniffAudioMimeType(makeWavFixture({}))).toBe("audio/wav");
    expect(audioMimeTypeToExtension("audio/wav")).toBe("wav");
  });

  it("returns application/octet-stream for non-WAV bytes", () => {
    expect(sniffAudioMimeType(Buffer.from("not audio at all"))).toBe("application/octet-stream");
    expect(sniffAudioMimeType(Buffer.alloc(4))).toBe("application/octet-stream");
  });

  it("parses duration, sample rate, and channels from the WAV header", () => {
    const wav = makeWavFixture({ sampleRateHz: 24_000, channels: 1, seconds: 1, bitsPerSample: 16 });
    const meta = parseWavMetadata(wav);
    expect(meta).toBeDefined();
    expect(meta?.sampleRateHz).toBe(24_000);
    expect(meta?.channels).toBe(1);
    expect(meta?.bitsPerSample).toBe(16);
    expect(meta?.durationSeconds).toBeCloseTo(1, 3);
  });

  it("computes a shorter duration for a shorter clip and stereo channels", () => {
    const wav = makeWavFixture({ sampleRateHz: 48_000, channels: 2, seconds: 0.25 });
    const meta = parseWavMetadata(wav);
    expect(meta?.channels).toBe(2);
    expect(meta?.sampleRateHz).toBe(48_000);
    expect(meta?.durationSeconds).toBeCloseTo(0.25, 3);
  });

  it("returns undefined for undecodable bytes", () => {
    expect(parseWavMetadata(Buffer.from("definitely not a wav file"))).toBeUndefined();
    expect(parseWavMetadata(Buffer.alloc(0))).toBeUndefined();
  });
});
