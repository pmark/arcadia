import { describe, expect, it } from "vitest";
import { ArcadiaError, validationError } from "../src/cli/errors.js";
import { preservationResponseError } from "../src/sessions/preservationTransport.js";

/**
 * The preservation response crosses the host-to-sandbox boundary as JSON, and
 * the caller re-raises whatever it carries (#717). The host used to flatten the
 * ArcadiaError to its message string, so the failing check's command, status
 * and skip reason never left the host-only evidence file and the broker
 * answered with `details: {}`. These tests pin the reader: the structured
 * shape the host now writes re-raises whole, and the flattened shape an
 * earlier release wrote still reads instead of rendering an object into the
 * message field.
 */

const STRUCTURED = {
  code: "VALIDATION_ERROR",
  message: "Declared preservation validation failed or was skipped.",
  exitCode: 2,
  details: {
    evidenceRef: "/host/workspace/artifacts/preservation/candidate-1/check-abc/validation.json",
    checks: [{ command: "node --test tests/marker.test.mjs", status: "skipped", skipReason: "Could not find 'tests/marker.test.mjs'" }]
  }
};

describe("preservationResponseError", () => {
  it("re-raises the structured host error with its details intact", () => {
    const error = preservationResponseError(STRUCTURED);
    expect(error).toBeInstanceOf(ArcadiaError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Declared preservation validation failed or was skipped.");
    expect(error.exitCode).toBe(2);
    expect(error.details).toEqual(STRUCTURED.details);
    const checks = (error.details as { checks: Array<{ command: string; status: string }> }).checks;
    expect(checks[0]?.command).toBe("node --test tests/marker.test.mjs");
    expect(checks[0]?.status).toBe("skipped");
  });

  it("reads the flattened message an earlier host release wrote", () => {
    const error = preservationResponseError("Declared preservation validation failed or was skipped.");
    expect(error).toBeInstanceOf(ArcadiaError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Declared preservation validation failed or was skipped.");
    expect(error.details).toEqual({});
  });

  it("does not render an object into the message field", () => {
    // The old broker passed the whole structured error as the message argument;
    // whatever the host wrote, the caller must never read "[object Object]".
    const error = preservationResponseError(STRUCTURED);
    expect(error.message).not.toContain("[object Object]");
    expect(typeof error.message).toBe("string");
  });

  it("fills a default code, message and exit code for a shapeless error", () => {
    const error = preservationResponseError(null);
    expect(error.code).toBe("UNEXPECTED_ERROR");
    expect(error.message).toBe("The host reported a preservation failure without a message.");
    expect(error.exitCode).toBe(2);
    expect(error.details).toEqual({});
  });

  it("keeps the validationError helper's own shape distinct", () => {
    // The direct helper is not routed through the transport reader.
    const direct = validationError("Direct refusal.", { evidenceRef: "/x" });
    expect(direct.details).toEqual({ evidenceRef: "/x" });
    expect(preservationResponseError(direct.message).details).toEqual({});
  });
});
