import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_MAP,
  UnknownVoiceError,
  loadVoiceMap,
  resolveVoice,
} from "../../src/intelligence/speech/voices.js";

describe("speech voices", () => {
  it("resolves a known semantic voiceId to its provider voice", () => {
    expect(resolveVoice("arcadia.narrator", DEFAULT_VOICE_MAP)).toBe("af_heart");
  });

  it("throws UnknownVoiceError (listing known voices) for an unmapped voiceId", () => {
    try {
      resolveVoice("arcadia.mystery", DEFAULT_VOICE_MAP);
      throw new Error("expected UnknownVoiceError");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownVoiceError);
      expect((error as UnknownVoiceError).message).toContain("arcadia.narrator");
    }
  });

  it("merges an env override over the defaults", () => {
    const map = loadVoiceMap('{"arcadia.narrator":"custom_voice","arcadia.host":"host_voice"}');
    expect(map["arcadia.narrator"]).toBe("custom_voice");
    expect(map["arcadia.host"]).toBe("host_voice");
    // Defaults not named in the override survive.
    expect(map["arcadia.narrator.warm"]).toBe("af_bella");
  });

  it("returns the defaults when no override is provided", () => {
    expect(loadVoiceMap(undefined)).toEqual(DEFAULT_VOICE_MAP);
    expect(loadVoiceMap("  ")).toEqual(DEFAULT_VOICE_MAP);
  });

  it("rejects malformed override JSON loudly", () => {
    expect(() => loadVoiceMap("{not json")).toThrow(/not valid JSON/);
    expect(() => loadVoiceMap('["array"]')).toThrow(/must be a JSON object/);
    expect(() => loadVoiceMap('{"arcadia.x":123}')).toThrow(/non-empty string/);
  });
});
