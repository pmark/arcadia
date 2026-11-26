import { describe, expect, it } from "vitest";
import { attemptWasReviewerUnavailable, isRepairNeverStarted } from "../src/sessions/roleLineage.js";

const attempt = (status: string, receipt: string | null) => ({ status, terminal_receipt_json: receipt });
const neverStarted = (value: unknown) => JSON.stringify({ repairNeverStarted: value });
const unavailable = (value: unknown) => JSON.stringify({ reviewerUnavailable: value });

describe("review attempt receipt flags", () => {
  it("counts a failed attempt with repairNeverStarted true as a never-started repair", () => {
    expect(isRepairNeverStarted(attempt("failed", neverStarted(true)))).toBe(true);
  });

  it("counts a failed attempt with a non-empty reviewerUnavailable string as an unavailable reviewer", () => {
    expect(attemptWasReviewerUnavailable(attempt("failed", unavailable("no reviewer")))).toBe(true);
  });

  it("rejects attempts that are not failed", () => {
    for (const status of ["completed", "running"]) {
      expect(isRepairNeverStarted(attempt(status, neverStarted(true)))).toBe(false);
      expect(attemptWasReviewerUnavailable(attempt(status, unavailable("no reviewer")))).toBe(false);
    }
  });

  it("rejects a missing, non-JSON or JSON null receipt", () => {
    for (const receipt of [null, "not json", "null"]) {
      expect(isRepairNeverStarted(attempt("failed", receipt))).toBe(false);
      expect(attemptWasReviewerUnavailable(attempt("failed", receipt))).toBe(false);
    }
  });

  it("rejects flags of the wrong type or an empty value", () => {
    expect(isRepairNeverStarted(attempt("failed", neverStarted("true")))).toBe(false);
    expect(attemptWasReviewerUnavailable(attempt("failed", unavailable("")))).toBe(false);
    expect(attemptWasReviewerUnavailable(attempt("failed", unavailable(true)))).toBe(false);
  });
});
