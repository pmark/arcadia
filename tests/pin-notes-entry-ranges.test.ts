import { describe, expect, it } from "vitest";

import { noteEntries, noteEntryRanges } from "../src/learning/lessons.js";

const notes = [
  "# Notes", "", "Intro", "",
  "## First entry", "body one", "",
  "## How the cache works", "cache text", "",
  "## Second", "body two", "### sub", "more",
].map((line) => `${line}\n`).join("");

describe("noteEntryRanges", () => {
  it("splits on ## headings, skipping the How the cache works heading", () => {
    expect(noteEntryRanges(notes)).toEqual([
      { start: 16, end: 76, text: "## First entry\nbody one\n\n## How the cache works\ncache text\n\n" },
      { start: 76, end: 108, text: "## Second\nbody two\n### sub\nmore\n" },
    ]);
  });

  it("ignores a ## line that starts with a space", () => {
    expect(noteEntryRanges(" ## a\n")).toEqual([]);
  });
});

describe("noteEntries", () => {
  it("drops a blank ## heading", () => {
    expect(noteEntries("##  \n## x\n")).toEqual(["## x\n"]);
  });

  it("returns no entries for text without headings", () => {
    expect(noteEntries("no headings")).toEqual([]);
  });
});
