import { describe, expect, it } from "vitest";
import { parseFailedBatchClearance } from "../src/operatorActions/startRunDerive.js";

const fix = { pullRequest: "https://example.test/pr/1", commit: "abc123", reproduction: "pnpm test" };
const record = { cause: "stale handoff", premortem: "docs/premortem.md", fix };
const parse = (value: unknown) => parseFailedBatchClearance(JSON.stringify(value));

describe("parseFailedBatchClearance", () => {
  it("returns exactly cause, premortem and fix from a record with extra keys", () => {
    expect(parse({ ...record, extra: 1, fix: { ...fix, note: "x" } })).toEqual(record);
  });

  it("returns null for null and unparseable JSON", () => {
    expect(parseFailedBatchClearance(null)).toBeNull();
    expect(parseFailedBatchClearance("{not json")).toBeNull();
  });

  it("returns null for a blank premortem, a non-string cause or a missing fix", () => {
    expect(parse({ ...record, premortem: "   " })).toBeNull();
    expect(parse({ ...record, cause: 7 })).toBeNull();
    expect(parse({ cause: record.cause, premortem: record.premortem })).toBeNull();
  });

  it.each(["pullRequest", "commit", "reproduction"] as const)("returns null when fix.%s is missing", (key) => {
    const { [key]: _omitted, ...rest } = fix;
    expect(parse({ ...record, fix: rest })).toBeNull();
  });
});
