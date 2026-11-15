import { describe, expect, it } from "vitest";

import { dashboardBase } from "../src/digests/report.js";

describe("dashboardBase", () => {
  it("trims whitespace and trailing slashes from http and https origins", () => {
    expect(dashboardBase("  https://arcadia.example/  ")).toBe("https://arcadia.example");
    expect(dashboardBase("http://localhost:3000///")).toBe("http://localhost:3000");
  });

  it.each(["", "   ", "ftp://arcadia.example", "not a url", null, undefined])(
    "returns null for %j",
    (value) => {
      expect(dashboardBase(value)).toBeNull();
    },
  );
});
