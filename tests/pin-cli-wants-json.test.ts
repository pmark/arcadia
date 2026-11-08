import { describe, expect, it } from "vitest";

import { wantsJson } from "../src/cli/response.js";

describe("wantsJson", () => {
  it("is true when an exact --json argument is present", () => {
    expect(wantsJson(["--json"])).toBe(true);
    expect(wantsJson(["status", "--json", "extra"])).toBe(true);
  });

  it.each([[[]], [["--jsonx"]], [["json"]], [["--json=true"]]] as string[][][])(
    "is false for %j",
    (argv) => {
      expect(wantsJson(argv)).toBe(false);
    },
  );
});
