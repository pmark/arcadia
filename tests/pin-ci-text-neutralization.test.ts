import { describe, expect, it } from "vitest";
import { neutralizeCiText } from "../src/production/reviewRepair.js";

describe("neutralizeCiText", () => {
  it("keeps tab and newline, blanks NUL, DEL and carriage return, swaps backticks and breaks mentions", () => {
    expect(neutralizeCiText("a\u0000b\tc\nd`e`@f\u007f\r")).toBe("a b\tc\nd'e'@\u{200b}f  ");
  });
});
