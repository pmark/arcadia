import type { JsonValue } from "../types.js";
import { SpeechGenerationError } from "./client.js";

export const MAX_SPEECH_TEXT_CHARS = 100_000;
export type SpeechInput = { text: string; voiceId: string; format: "wav" | "mp3"; speed?: number; language?: string; instructions?: string };

export function parseSpeechInput(input: JsonValue): SpeechInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SpeechGenerationError("SPEECH_INVALID_INPUT", "Speech input must contain text and voiceId.");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const voiceId = typeof input.voiceId === "string" ? input.voiceId.trim() : "";
  if (!text || text.length > MAX_SPEECH_TEXT_CHARS) throw new SpeechGenerationError("SPEECH_INVALID_INPUT", `Speech text must contain 1–${MAX_SPEECH_TEXT_CHARS} characters.`);
  if (!voiceId) throw new SpeechGenerationError("SPEECH_INVALID_INPUT", "Speech requires a non-empty voiceId.");
  const format = input.format === undefined ? "wav" : input.format;
  if (format !== "wav" && format !== "mp3") throw new SpeechGenerationError("SPEECH_INVALID_INPUT", "Speech format must be wav or mp3.");
  if (input.speed !== undefined && (typeof input.speed !== "number" || !Number.isFinite(input.speed) || input.speed < 0.25 || input.speed > 4)) throw new SpeechGenerationError("SPEECH_INVALID_INPUT", "Speech speed must be between 0.25 and 4.");
  return { text, voiceId, format, speed: typeof input.speed === "number" ? input.speed : undefined, language: typeof input.language === "string" ? input.language : undefined, instructions: typeof input.instructions === "string" ? input.instructions : undefined };
}
