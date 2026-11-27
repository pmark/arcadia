import { describe, expect, it } from "vitest";

import { redactSecrets } from "../src/sessions/validationEvidence.js";

describe("redactSecrets", () => {
  it.each([
    ["API_KEY=abcdefgh1234", "API_KEY=[redacted]"],
    ["DB_PASSWORD = abcdefgh12", "DB_PASSWORD = [redacted]"],
    ['SECRET="abcdefgh" and more', "SECRET=[redacted] and more"],
    ["Authorization: Bearer abcdefghijklmnop1234", "Authorization: Bearer [redacted]"]
  ])("redacts %j", (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it.each(["TOKEN=abc", "Bearer short", "key=abcdefghijkl", "all 12 tests passed"])("leaves %j unchanged", (input) => {
    expect(redactSecrets(input)).toBe(input);
  });
});
