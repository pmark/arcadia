import { describe, expect, it } from "vitest";

import { inlineText } from "../src/sessions/operatorQaPlan.js";

describe("inlineText", () => {
  it("collapses newlines, tabs, space runs and control characters to single spaces and trims", () => {
    const bel = String.fromCodePoint(7);
    expect(inlineText(`  one\ntwo\t\tthree   ${bel}  `)).toBe("one two three");
    expect(inlineText(`  one\n${bel}two   three  `)).toBe("one two three");
  });

  it("backslash-escapes Markdown characters and the backslash itself", () => {
    expect(inlineText("a*b_c`d[e]<f>|g~h\\i")).toBe("a\\*b\\_c\\`d\\[e\\]\\<f\\>\\|g\\~h\\\\i");
  });

  it("escapes only an ampersand that starts an entity", () => {
    expect(inlineText("&amp; &#38; AT&T")).toBe("\\&amp; \\&#38; AT&T");
  });

  it("breaks an @ mention with a zero-width space", () => {
    expect(inlineText("@octocat")).toBe(`@${String.fromCodePoint(0x200b)}octocat`);
  });
});
