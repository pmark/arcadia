import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { narratePullRequestBody } from "./arcadia-cli";

const execFileAsync = promisify(execFile);
export interface PullRequestAudio { bytes: Uint8Array<ArrayBuffer>; format: "mp3" | "wav" }
// Share in-flight requests, and bound synthesis to one PR at a time in this process.
let active: { key: string; promise: Promise<PullRequestAudio> } | null = null;
export class AudioBusyError extends Error {}

export async function generatePullRequestAudio(repository: string, number: number): Promise<PullRequestAudio> {
  const key = `${repository}#${number}`;
  if (active) {
    if (active.key === key) return active.promise;
    throw new AudioBusyError("Another PR is preparing audio. Try again when it finishes.");
  }
  const promise = synthesize(repository, number);
  active = { key, promise };
  try { return await promise; } finally { active = null; }
}

async function synthesize(repository: string, number: number): Promise<PullRequestAudio> {
  const directory = await mkdtemp(path.join(tmpdir(), "arcadia-pr-audio-"));
  const wav = path.join(directory, "body.wav");
  const mp3 = path.join(directory, "body.mp3");
  try {
    await narratePullRequestBody(repository, number, wav);
    try {
      await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "4", mp3], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      return { bytes: new Uint8Array(await readFile(mp3)), format: "mp3" };
    } catch (error) {
      // A host without an MP3 encoder can still play and download the original WAV.
      if (!(error instanceof Error)) throw error;
      return { bytes: new Uint8Array(await readFile(wav)), format: "wav" };
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
