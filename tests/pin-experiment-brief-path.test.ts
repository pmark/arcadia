import { describe, expect, it } from "vitest";

import { buildExperimentBriefRelativePath } from "../src/markdown/experimentBrief.js";

describe("buildExperimentBriefRelativePath", () => {
  it("joins the local date, project slug and slugified opportunity under artifacts/experiments", () => {
    expect(
      buildExperimentBriefRelativePath({
        projectSlug: "arcadia",
        opportunity: "Pinned Tests: Go!",
        date: new Date(2026, 10, 27, 12)
      })
    ).toBe("artifacts/experiments/2026-11-27-arcadia-pinned-tests-go-experiment-brief.md");
  });

  it("zero-pads the local month and day", () => {
    expect(
      buildExperimentBriefRelativePath({
        projectSlug: "arcadia",
        opportunity: "x",
        date: new Date(2026, 0, 2, 0, 30)
      })
    ).toBe("artifacts/experiments/2026-01-02-arcadia-x-experiment-brief.md");
  });
});
