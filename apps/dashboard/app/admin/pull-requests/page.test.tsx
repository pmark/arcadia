import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PullRequestInventorySkeleton } from "../../../components/pull-request-inventory-skeleton";

describe("pull-request inventory loading state", () => {
  it("announces a stable card-shaped cold-load skeleton", () => {
    const html = renderToStaticMarkup(<PullRequestInventorySkeleton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading pull-request inventory"');
    expect(html).toContain("Scanning configured repositories for pull requests");
    expect(html.match(/min-h-48 animate-pulse/g)).toHaveLength(3);
  });
});
