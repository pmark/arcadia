import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PullRequestAudio } from "./pull-request-audio";

describe("PullRequestAudio", () => {
  it("offers independent TLDR loading before any speech action", () => {
    const html = renderToStaticMarkup(<PullRequestAudio repository="owner/repo" number={2} />);
    expect(html).toContain("Load TLDR");
    expect(html).not.toContain("Play body");
    expect(html).not.toContain("Play TLDR");
  });
});
