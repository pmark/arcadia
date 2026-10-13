import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildNextSteps, type NextStepsPr } from "../../../src/decisions/nextSteps";
import type { NextStepsResponse } from "../lib/next-steps-server";
import { NextSteps } from "./next-steps";

const sha = (c: string) => c.repeat(40);
function pr(number: number, over: Partial<NextStepsPr> = {}): NextStepsPr {
  const head = sha(String(number % 10));
  return {
    number, title: `PR ${number}`, headSha: head, baseRef: "main", headRef: `b-${number}`, isDraft: false, files: [`src/f${number}.ts`], changedFiles: 1,
    reviews: [{ verdict: "APPROVED", headSha: head, author: "r" }], checks: [{ name: "ci", conclusion: "SUCCESS" }], requiredChecks: ["ci"], ...over
  };
}
const response = (prs: NextStepsPr[], extra: Partial<NextStepsResponse> = {}, cap?: number): NextStepsResponse => ({
  ...buildNextSteps({ prs, cap }), unavailable: [], otherRepositories: 0, inventoryStale: false, repo: "pmark/arcadia", ...extra
});

describe("NextSteps", () => {
  it("shows one Do this now step with the exact click, the short pinned head and what it unblocks", () => {
    const html = renderToStaticMarkup(<NextSteps data={response([pr(11, { baseRef: "b-10" }), pr(10)])} />);
    expect(html.match(/Do this now/g)).toHaveLength(1);
    expect(html).toContain("Merge #10 on GitHub");
    expect(html).toContain('href="https://github.com/pmark/arcadia/pull/10"');
    expect(html).toContain("<code");
    expect(html).toContain("0000000");
    expect(html).toContain("Unblocks:");
  });

  it("a waiting step shows what it waits on and has no link or button", () => {
    const html = renderToStaticMarkup(<NextSteps data={response([pr(10), pr(11, { baseRef: "b-10" })])} />);
    const item = html.slice(html.indexOf('data-step-id="pr-11"'));
    expect(item).toContain("Waiting on: step pr-10");
    expect(item).not.toContain("<a ");
    expect(item).not.toContain("<button");
    expect(html).not.toContain("<button");
  });

  it("says production is moving and lists nothing else when no step is takeable", () => {
    const html = renderToStaticMarkup(<NextSteps data={response([pr(1, { isDraft: true })])} />);
    expect(html).toContain("Production is moving");
    expect(html).not.toContain("data-testid=\"next-steps-rest\"");
    expect(html).not.toContain("Do this now");
  });

  it("never claims production is moving when a source could not be read", () => {
    const data = response([], { moving: false, unavailable: ["pull_requests"] });
    const html = renderToStaticMarkup(<NextSteps data={data} />);
    expect(html).not.toContain("Production is moving");
    expect(html).toContain("Could not read: pull requests");
  });

  it("renders hostile titles as escaped text and reports the hidden count", () => {
    const hostile = pr(70, { title: "<img src=x onerror=alert(1)>\n‮evil" });
    const drafts = Array.from({ length: 6 }, (_, i) => pr(80 + i, { isDraft: true }));
    const html = renderToStaticMarkup(<NextSteps data={response([hostile, ...drafts], {}, 3)} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("‮");
    expect(html).toContain("more not shown");
  });
});
