import { describe, expect, it } from "vitest";

import { stripMarkdownForSpeech } from "../src/intelligence/text/markdown.js";

describe("stripMarkdownForSpeech", () => {
  it("removes markup while keeping words and snake_case", () => {
    expect(
      stripMarkdownForSpeech(
        "# Title\n\n**Bold** and `code` see [docs](http://x) ![img](y)\n- item\n> quote\nsnake_case_name",
      ),
    ).toBe("Title\n\nBold and code see docs\nitem\nquote\nsnake_case_name");
  });

  it("unwraps fenced code blocks but keeps their words", () => {
    expect(stripMarkdownForSpeech("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
  });
});
