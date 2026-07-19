/**
 * Semantic Arcadia voice identifiers.
 *
 * Companion apps (e.g. Rebuster) select a stable, provider-neutral `voiceId`
 * such as "arcadia.narrator". Arcadia maps it to a concrete provider voice name
 * (e.g. Kokoro's "af_heart") at execution time. Provider voice names are never
 * part of the public contract, so a provider or model swap does not ripple out
 * to companion apps.
 *
 * The default map targets Kokoro voices (the reference MLX-Audio model). An
 * operator can override or extend it via ARCADIA_SPEECH_VOICE_MAP (a JSON object
 * of semantic id -> provider voice). An unknown `voiceId` is a typed failure —
 * Arcadia never forwards an unrecognized id to the provider as a raw voice name.
 */
export type VoiceMap = Record<string, string>;

export const DEFAULT_VOICE_MAP: VoiceMap = {
  "arcadia.narrator": "af_heart",
  "arcadia.narrator.warm": "af_bella",
  "arcadia.narrator.crisp": "am_michael",
};

/** Thrown when a request's semantic voiceId has no mapping in the active voice map. */
export class UnknownVoiceError extends Error {
  public constructor(
    public readonly voiceId: string,
    public readonly knownVoiceIds: string[],
  ) {
    super(
      `voiceId "${voiceId}" is not a known Arcadia voice. ` +
        `Known voices: ${knownVoiceIds.join(", ") || "(none configured)"}.`,
    );
    this.name = "UnknownVoiceError";
  }
}

/**
 * Resolves a semantic Arcadia voiceId to a provider voice name using the given
 * map. Throws UnknownVoiceError (never guesses or passes the raw id through).
 */
export function resolveVoice(voiceId: string, map: VoiceMap): string {
  const provider = map[voiceId];
  if (!provider) {
    throw new UnknownVoiceError(voiceId, Object.keys(map).sort());
  }
  return provider;
}

/**
 * Parses an ARCADIA_SPEECH_VOICE_MAP override and merges it over the defaults.
 * A malformed value throws so misconfiguration surfaces loudly at startup
 * rather than silently disabling voices.
 */
export function loadVoiceMap(raw: string | undefined): VoiceMap {
  if (!raw || !raw.trim()) {
    return { ...DEFAULT_VOICE_MAP };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `ARCADIA_SPEECH_VOICE_MAP is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("ARCADIA_SPEECH_VOICE_MAP must be a JSON object of voiceId -> provider voice.");
  }
  const override: VoiceMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`ARCADIA_SPEECH_VOICE_MAP entry "${key}" must map to a non-empty string.`);
    }
    override[key] = value;
  }
  return { ...DEFAULT_VOICE_MAP, ...override };
}
