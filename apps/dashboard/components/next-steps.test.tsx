import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildNextSteps, type NextStepsInput, type NextStepsPr } from "../../../src/decisions/nextSteps";
import type { NextStepsResponse } from "../lib/next-steps-server";
import { NextSteps } from "./next-steps";

const sha = (c: string) => c.repeat(40);
function pr(number: number, over: Partial<NextStepsPr> = {}): NextStepsPr {
  const head = sha(String(number % 10));
  return {
    number, title: `PR ${number}`, headSha: head, baseRef: "main", headRef: `b-${number}`, isDraft: false, files: [`src/f${number}.ts`], changedFiles: 1,
    reviews: [{ verdict: "APPROVED", headSha: head, author: "r" }], checks: [{ name: "ci", conclusion: "SUCCESS" }], requiredChecks: ["ci"],
    mergeStateStatus: "CLEAN", ...over
  };
}
const response = (input: NextStepsInput, extra: Partial<NextStepsResponse> = {}): NextStepsResponse => ({
  ...buildNextSteps(input), otherRepositories: 0, inventoryStale: false, inventoryCheckedAt: null, repo: "pmark/arcadia", heads: {}, ...extra
});
const render = (data: NextStepsResponse) => renderToStaticMarkup(<NextSteps data={data} />);

describe("NextSteps", () => {
  it("state now: one Do this now step with the exact click, the short pinned head and what it unblocks", () => {
    const html = render(response({ prs: [pr(11, { baseRef: "b-10" }), pr(10)] }));
    expect(html.match(/Do this now/g)).toHaveLength(1);
    expect(html).toContain("Merge #10 on GitHub");
    expect(html).toContain('href="https://github.com/pmark/arcadia/pull/10"');
    expect(html).toContain("<code");
    expect(html).toContain("0000000");
    expect(html).toContain("Unblocks:");
    expect(html).not.toContain("Production is moving");
  });

  it("state now: names a higher-priority pull request that is waiting", () => {
    const html = render(
      response({
        prs: [pr(1, { files: ["PROJECT.md"], checks: [{ name: "ci", conclusion: "FAILURE" }] }), pr(2)],
        queue: { currentActionId: "a", planPath: null, queued: [] }
      })
    );
    expect(html).toContain("Do this now");
    expect(html).toContain("#1 advances the active-Plan pointer but is waiting on required check ci");
  });

  it("a waiting step shows what it waits on and has no link or button", () => {
    const html = render(response({ prs: [pr(10), pr(11, { baseRef: "b-10" })] }));
    const item = html.slice(html.indexOf('data-step-id="pr-11"'));
    expect(item).toContain("Waiting on: step pr-10");
    expect(item).not.toContain("<a ");
    expect(item).not.toContain("<button");
    expect(html).not.toContain("<button");
  });

  it("state waiting: says nothing to click and lists every wait step, never 'moving'", () => {
    const html = render(response({ prs: [pr(1, { checks: [{ name: "ci", conclusion: "FAILURE" }] }), pr(2, { isDraft: true })] }));
    expect(html).toContain("Nothing for you to click; waiting on required check ci");
    expect(html).toContain('data-step-id="pr-1"');
    expect(html).toContain('data-step-id="pr-2"');
    expect(html).not.toContain("Production is moving");
    expect(html).not.toContain("Do this now");
    expect(html).not.toContain("<a ");
  });

  it("state moving: says production is moving and lists nothing else", () => {
    const html = render(response({ prs: [] }));
    expect(html).toContain("Production is moving");
    expect(html).not.toContain("next-steps-rest");
    expect(html).not.toContain("Do this now");
  });

  it("state unavailable: names the sources and never claims moving", () => {
    const html = render(response({ prs: [], unavailable: ["prs", "checks"] }));
    expect(html).toContain("Could not read: pull-request reviews and checks, the pull-request list");
    expect(html).not.toContain("Production is moving");
    expect(html).toContain('data-state="unavailable"');
  });

  it("shows a stale inventory with its last-read time", () => {
    const html = render(response({ prs: [pr(1)] }, { inventoryStale: true, inventoryCheckedAt: "2026-10-13T12:00:00.000Z" }));
    expect(html).toContain("PR list may be out of date: last read 2026-10-13T12:00:00.000Z");
  });

  it("renders hostile titles as escaped text and reports the hidden count", () => {
    const hostile = pr(70, { title: "<img src=x onerror=alert(1)>\n‮evil" });
    const drafts = Array.from({ length: 6 }, (_, i) => pr(80 + i, { isDraft: true }));
    const html = render(response({ prs: [hostile, ...drafts], cap: 3 }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("‮");
    expect(html).toContain("more not shown");
  });
});
