import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlanAsksResponse } from "../../../lib/plan-picker-actions";

let asks: PlanAsksResponse = { project: "arcadia", plan: "plan-g", asks: [] };
vi.mock("../use-read", () => ({ useRead: () => ({ kind: "ready", data: asks }) }));
import { PlanActions, WithheldPlanActions } from "./plan-actions";
import { PlanAsks } from "./plan-asks";
import { PLAN_ACTIONS, planActionConsequence, planAskRequestId } from "../../../lib/plan-picker-actions";

const buttons = (html: string) => [...html.matchAll(/<button[^>]*data-kind="([^"]+)"[^>]*>/g)].map(m => ({ kind: m[1], disabled: / disabled=""/.test(m[0]) }));

describe("PlanActions", () => {
  it("offers Queue next, Archive, Annotate and Request change; the two without a governed Ask are disabled", () => {
    const html = renderToStaticMarkup(<PlanActions project="arcadia" plan="plan-g" planName="Plan G" />);
    expect(buttons(html)).toEqual([
      { kind: "queue-next", disabled: true }, { kind: "archive", disabled: true },
      { kind: "annotate", disabled: false }, { kind: "request-change", disabled: false }
    ]);
  });

  it("states each action's consequence in one sentence", () => {
    for (const action of PLAN_ACTIONS) expect(planActionConsequence(action.kind, "Plan G")).toMatch(/^[^.]+\.$/);
    const withheld = renderToStaticMarkup(<WithheldPlanActions />);
    expect(withheld).toContain("Queue next:");
    expect(withheld).toContain("Archive:");
  });

  it("shows the consequence before anything is written", () => {
    const html = renderToStaticMarkup(<PlanActions project="arcadia" plan="plan-g" planName="Plan G" initial={{ kind: "write", ask: "annotate", requestId: "workspace-annotate-plan-g-1" }} />);
    expect(html).toContain("What happens:");
    expect(html).toContain(planActionConsequence("annotate", "Plan G").replace(/'/g, "&#x27;"));
    expect(html).toContain(">Preview<");
    expect(html).not.toContain(">Submit<");
  });

  it("shows the composed Ask's effects and says nothing is recorded until Submit", () => {
    const check = { mode: "check" as const, consequence: "c", ask: {}, effects: ["update plan plan/plan-g"], requiredDecisions: [] };
    const html = renderToStaticMarkup(<PlanActions project="arcadia" plan="plan-g" planName="Plan G" initial={{ kind: "review", ask: "request-change", requestId: "workspace-request-change-plan-g-1", check }} />);
    expect(html).toContain("update plan plan/plan-g");
    expect(html).toContain("Nothing is recorded yet");
    expect(html).toContain(">Submit<");
  });

  it("makes request ids the route accepts", () => {
    const id = planAskRequestId("request-change", "draft-an-inactive-plan-of-four-bounded-actions-that-make-the-arcadia-workspace", new Date("2026-11-24T18:00:00.123Z"), "ab12");
    expect(id).toBe("workspace-request-change-draft-an-inactive-plan-of-four-bounded-actions-t-20261124t180000z-ab12");
    expect(id).toMatch(/^workspace-(annotate|request-change)-[a-z0-9][a-z0-9-]{0,80}$/);
  });
});

describe("PlanAsks", () => {
  it("lists the Plan's Asks in the order read (newest first) with their state", () => {
    asks = { project: "arcadia", plan: "plan-g", asks: [
      { proposalId: "a2", requestId: "workspace-request-change-plan-g-2", intent: "plan", targetRef: "plan/plan-g", desiredResult: "Split it.", rationale: null, createdAt: "2026-11-24T02:00:00Z", state: "pending", disposition: null, settledAt: null },
      { proposalId: "a1", requestId: "workspace-annotate-plan-g-1", intent: "proposal", targetRef: "plan/plan-g", desiredResult: "A note.", rationale: null, createdAt: "2026-11-24T01:00:00Z", state: "settled", disposition: "accepted", settledAt: "2026-11-24T03:00:00Z" }
    ] };
    const html = renderToStaticMarkup(<PlanAsks project="arcadia" plan="plan-g" revision={0} />);
    expect(html.indexOf("Split it.")).toBeLessThan(html.indexOf("A note."));
    expect(html).toContain("Pending");
    expect(html).toContain("Settled · accepted");
    expect(html).toContain("Change request");
    expect(html).toContain("Annotation");
  });

  it("says so when no Ask targets the Plan", () => {
    asks = { project: "arcadia", plan: "plan-g", asks: [] };
    expect(renderToStaticMarkup(<PlanAsks project="arcadia" plan="plan-g" revision={0} />)).toContain("No Ask targets this Plan yet.");
  });
});
