import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { executeHostGo } from "../src/sessions/goRequestExecutor.js";

afterEach(() => vi.unstubAllEnvs());

it("runs the real host child and returns a structured canonical refusal", async () => {
  vi.stubEnv("CODEX_SANDBOX", "");
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-go-child-"));
  try {
    const result = await executeHostGo(path.join(root, "missing"), "claude");
    expect(result).toMatchObject({ ok: false, error: {
      code: "VALIDATION_ERROR", exitCode: 2, message: expect.stringContaining("does not exist"),
      details: { path: path.join(root, "missing") }
    } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("refuses child execution from the coding sandbox", () => {
  vi.stubEnv("CODEX_SANDBOX", "seatbelt");
  expect(() => executeHostGo("/unused", "codex")).toThrow("must run on the host");
});
