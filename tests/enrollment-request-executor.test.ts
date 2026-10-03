import { afterEach, expect, it, vi } from "vitest";
import { executeHostEnrollmentRequest } from "../src/sessions/enrollmentRequestExecutor.js";
import type { EnrollmentRequestMode } from "../src/sessions/enrollmentRequestProtocol.js";

afterEach(() => vi.unstubAllEnvs());

it("runs the real fixed host child and returns a structured refusal for a non-enum mode before any host work", async () => {
  vi.stubEnv("CODEX_SANDBOX", "");
  const result = await executeHostEnrollmentRequest(
    "/nonexistent-enrollment-source", "claude", "enroll:claude:runtime-0001", "claude:runtime-0001",
    "sh -c true" as EnrollmentRequestMode
  );
  expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", details: { code: "invalid_enrollment_mode" } } });
});

it("refuses child execution from the coding sandbox", () => {
  vi.stubEnv("CODEX_SANDBOX", "seatbelt");
  expect(() => executeHostEnrollmentRequest("/unused", "codex", "enroll:codex:runtime-0001", "codex:runtime-0001", "prepare"))
    .toThrow("must run on the host");
});
