import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { acceptRefreshedSummary, PullRequestAudio } from "./pull-request-audio";

describe("PullRequestAudio", () => {
  it("offers independent TLDR loading before any speech action", () => {
    const html = renderToStaticMarkup(<PullRequestAudio repository="owner/repo" number={2} />);
    expect(html).toContain("Load TLDR");
    expect(html).not.toContain("Play body");
    expect(html).not.toContain("Play TLDR");
  });

  it("rejects a completed TLDR when the PR source changed during generation", () => {
    const initial = { source: {} as never, sourceRevision: "old", job: null, summary: null };
    const refreshed = { source: {} as never, sourceRevision: "new", job: null, summary: null };
    expect(() => acceptRefreshedSummary(initial, refreshed)).toThrow("source changed");
  });
});
