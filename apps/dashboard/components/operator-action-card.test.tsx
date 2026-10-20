import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperatorActionCard, type OperatorScript } from "./operator-action-card";

const script = (extra: Partial<OperatorScript> = {}): OperatorScript => ({
  id: "alpha--settle-alpha-ask", project: "alpha", title: "Accept alpha Ask", problem: "It waits.", desiredEffect: "Settle it.",
  authority: { does: ["Settle exactly alpha-ask"], never_does: ["Merge"] }, repeatable: false, state: { status: "available" },
  modifiedAt: "2026-10-20T00:00:00.000Z", ...extra
});
const render = (s: OperatorScript) => renderToStaticMarkup(<OperatorActionCard script={s} launching={false} onLaunch={() => undefined} />);

describe("OperatorActionCard pinned settlement line", () => {
  it("states the pinned disposition, Project, proposal and placement from the pin, whatever the title says", () => {
    const rejected = render(script({ pinnedSettlement: { project: "alpha", proposal: "alpha-ask", disposition: "rejected", placement: null } }));
    expect(rejected).toContain('data-testid="operator-action-pin"');
    expect(rejected).toContain("alpha-ask");
    expect(rejected).toContain("REJECTED");
    expect(rejected).not.toContain("top of the queue");
    const accepted = render(script({ pinnedSettlement: { project: "alpha", proposal: "alpha-ask", disposition: "accepted", placement: "top" } }));
    expect(accepted).toContain("ACCEPTED");
    expect(accepted).toContain("at the top of the queue");
  });

  it("shows no pin line for an ordinary action", () => {
    expect(render(script())).not.toContain('data-testid="operator-action-pin"');
  });
});
