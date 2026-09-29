import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("production activate's revision flag (Issue #609)", () => {
  it("is named for the preview field it echoes back, and keeps the old spelling as a hidden alias", () => {
    const production = buildProgram().commands.find((command) => command.name() === "production");
    const activate = production?.commands.find((command) => command.name() === "activate");
    expect(activate).toBeDefined();

    // `production preview --json` reports `data.preview.expectedRevision`; the
    // flag that carries it back now parses to exactly that name.
    const flag = activate!.options.find((option) => option.long === "--expected-revision");
    expect(flag?.attributeName()).toBe("expectedRevision");
    expect(activate!.helpInformation()).toContain("--expected-revision <n>");

    // Existing callers of the earlier spelling keep working, without it being
    // advertised as a second way to say the same thing.
    const legacy = activate!.options.find((option) => option.long === "--expect-revision");
    expect(legacy).toBeDefined();
    expect(activate!.helpInformation()).not.toContain("--expect-revision");
  });
});
