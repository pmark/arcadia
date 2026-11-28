import { describe, expect, it } from "vitest";

import { assertAllowedValue } from "../src/domain/constants.js";

const STATUSES = ["open", "done"] as const;

describe("assertAllowedValue", () => {
  it.each(["open", "done"])("accepts %j", (value) => {
    expect(() => assertAllowedValue("Status", value, STATUSES)).not.toThrow();
  });

  it.each(["Open", " open", "", "closed"])("rejects %j with the allowed list", (value) => {
    expect(() => assertAllowedValue("Status", value, STATUSES)).toThrow(
      new Error("Status must be one of: open, done")
    );
  });

  it("names no values when the allowed list is empty", () => {
    expect(() => assertAllowedValue("Kind", "x", [])).toThrow(new Error("Kind must be one of: "));
  });
});
