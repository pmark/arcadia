import { describe, expect, it } from "vitest";

import { createFailure } from "../src/cli/response.js";

type FailureError = Parameters<typeof createFailure>[1];

function validationError(details: Record<string, unknown>): FailureError {
  return {
    code: "VALIDATION_ERROR",
    message: "bad input",
    exitCode: 2,
    details
  } as unknown as FailureError;
}

describe("createFailure", () => {
  it("builds the envelope with the workspace and drops the exit code", () => {
    expect(createFailure("arcadia status", validationError({ field: "x" }), "/ws")).toEqual({
      ok: false,
      command: "arcadia status",
      workspace: "/ws",
      error: { code: "VALIDATION_ERROR", message: "bad input", details: { field: "x" } }
    });
  });

  it("leaves the workspace undefined when none is given", () => {
    const failure = createFailure("arcadia status", validationError({}));

    expect(failure.workspace).toBeUndefined();
    expect(failure).toEqual({
      ok: false,
      command: "arcadia status",
      error: { code: "VALIDATION_ERROR", message: "bad input", details: {} }
    });
  });
});
