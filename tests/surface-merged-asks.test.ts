import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitBlobSha } from "../src/ask/surfaceMergedAsks.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("gitBlobSha", () => {
  it.each(["sha1", "sha256"])("matches git hash-object in a %s repository", (format) => {
    const repo = mkdtempSync(path.join(tmpdir(), `arcadia-blob-${format}-`));
    dirs.push(repo);
    execFileSync("git", ["init", "--quiet", `--object-format=${format}`, repo]);
    const content = Buffer.from("agent_ask: v1\nintent: log\n");
    const file = path.join(repo, "ask.yaml");
    writeFileSync(file, content);
    const expected = execFileSync("git", ["hash-object", file], { cwd: repo, encoding: "utf8" }).trim();
    expect(gitBlobSha(content, expected)).toBe(expected);
  });
});
