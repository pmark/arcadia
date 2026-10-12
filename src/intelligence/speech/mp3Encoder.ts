import { execFile } from "node:child_process";
import { SpeechGenerationError, SpeechUnavailableError } from "./client.js";
import { sniffAudioMimeType } from "./wavMeta.js";

export interface Mp3Encoder {
  assertAvailable(): Promise<void>;
  encode(wav: Buffer): Promise<Buffer>;
}

/** CPU-only encoding. No provider fallback and no temporary audio server/files. */
export function createFfmpegMp3Encoder(command = process.env.ARCADIA_FFMPEG_COMMAND?.trim() || "ffmpeg"): Mp3Encoder {
  const run = (args: string[], input?: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: "buffer", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || !input) {
          reject(new SpeechUnavailableError("MP3 encoding requires a working FFmpeg executable on the Intelligence service PATH (or ARCADIA_FFMPEG_COMMAND).", "MP3_ENCODER_UNAVAILABLE"));
        } else {
          reject(new SpeechGenerationError("MP3_ENCODING_FAILED", "FFmpeg could not encode the narrated audio as MP3."));
        }
        return;
      }
      resolve(stdout);
    });
    child.stdin?.on("error", () => { /* exit callback reports a failed encoder */ });
    child.stdin?.end(input);
  });
  return {
    async assertAvailable() {
      const codecs = await run(["-hide_banner", "-encoders"]);
      if (!codecs.toString("utf8").includes("libmp3lame")) throw new SpeechUnavailableError("The Intelligence host FFmpeg lacks the libmp3lame encoder.", "MP3_ENCODER_UNAVAILABLE");
    },
    async encode(wav) {
      const bytes = await run(["-nostdin", "-v", "error", "-i", "pipe:0", "-map_metadata", "-1", "-ar", "24000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1"], wav);
      if (sniffAudioMimeType(bytes) !== "audio/mpeg") throw new SpeechGenerationError("MP3_ENCODING_FAILED", "Encoder output was not an MP3 file.");
      return bytes;
    },
  };
}
