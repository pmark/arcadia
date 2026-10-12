import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ narrate: vi.fn(), encode: vi.fn() }));
vi.mock("./arcadia-cli", () => ({ narratePullRequestBody: mocks.narrate }));
vi.mock("node:child_process", () => ({ execFile: mocks.encode }));
import { generatePullRequestAudio } from "./pull-request-audio";

afterEach(() => vi.resetAllMocks());

describe("PR audio", () => {
  it("converts local narration to MP3 and removes temporary files", async () => {
    let wavPath = "";
    mocks.narrate.mockImplementation(async (_repo, _number, wav) => { wavPath = wav; await writeFile(wav, "WAV"); });
    mocks.encode.mockImplementation((_command, args, _options, callback) => {
      void writeFile(args.at(-1), "MP3").then(() => callback(null, "", ""));
    });
    const result = await generatePullRequestAudio("pmark/arcadia", 12);
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.bytes).toString()).toBe("MP3");
    expect(mocks.narrate).toHaveBeenCalledWith("pmark/arcadia", 12, expect.stringContaining("body.wav"));
    expect(mocks.encode.mock.calls[0][0]).toBe("ffmpeg");
    expect(existsSync(wavPath)).toBe(false);
  });
  it("returns WAV when the host has no encoder", async () => {
    mocks.narrate.mockImplementation(async (_repo, _number, wav) => { await writeFile(wav, "WAV"); });
    mocks.encode.mockImplementation((_command, _args, _options, callback) => callback(new Error("ENOENT")));
    const result = await generatePullRequestAudio("pmark/arcadia", 12);
    expect(result.format).toBe("wav");
    expect(Buffer.from(result.bytes).toString()).toBe("WAV");
  });
  it("shares concurrent requests for the same PR and refuses other synthesis until completion", async () => {
    let release!: () => void;
    mocks.narrate.mockImplementation(async (_repo, _number, wav) => {
      await new Promise<void>(resolve => { release = resolve; });
      await writeFile(wav, "WAV");
    });
    mocks.encode.mockImplementation((_command, _args, _options, callback) => callback(new Error("ENOENT")));
    const first = generatePullRequestAudio("pmark/arcadia", 12);
    const second = generatePullRequestAudio("pmark/arcadia", 12);
    await expect(generatePullRequestAudio("pmark/arcadia", 13)).rejects.toThrow("Another PR");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    expect(await first).toBe(await second);
    expect(mocks.narrate).toHaveBeenCalledTimes(1);
  });
  it("propagates synthesis failures and permits a retry", async () => {
    mocks.narrate.mockRejectedValue(new Error("Local speech unavailable"));
    await expect(generatePullRequestAudio("pmark/arcadia", 12)).rejects.toThrow("Local speech unavailable");
    await expect(generatePullRequestAudio("pmark/arcadia", 13)).rejects.toThrow("Local speech unavailable");
  });
});
