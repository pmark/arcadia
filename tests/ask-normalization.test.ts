import { describe, expect, it } from "vitest";
import { normalizeAskInput } from "../src/intake/normalization.js";

describe("ask input normalization", () => {
  it.each([
    [
      'pnpm arcadia ask "Plan and implement Publishing support for Pinterest for Rebuster project"',
      "Plan and implement Publishing support for Pinterest for Rebuster project",
      "pnpm_arcadia_ask"
    ],
    [
      "pnpm arcadia ask 'Plan and implement Publishing support for Pinterest for Rebuster project'",
      "Plan and implement Publishing support for Pinterest for Rebuster project",
      "pnpm_arcadia_ask"
    ],
    [
      'arcadia ask "Plan and implement Publishing support for Pinterest for Rebuster project"',
      "Plan and implement Publishing support for Pinterest for Rebuster project",
      "arcadia_ask"
    ],
    [
      "arcadia ask 'Plan and implement Publishing support for Pinterest for Rebuster project'",
      "Plan and implement Publishing support for Pinterest for Rebuster project",
      "arcadia_ask"
    ]
  ] as const)("strips supported CLI ask wrapper %s", (rawInput, askText, wrapper) => {
    expect(normalizeAskInput(rawInput)).toEqual({
      rawInput,
      askText,
      wrapper
    });
  });

  it("leaves plain ask text unchanged", () => {
    const rawInput = "Plan and implement Publishing support for Pinterest for Rebuster project";
    expect(normalizeAskInput(rawInput)).toEqual({
      rawInput,
      askText: rawInput,
      wrapper: null
    });
  });
});
