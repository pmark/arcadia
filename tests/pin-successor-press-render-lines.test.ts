import { describe, expect, it } from "vitest";
import { renderSuccessorLines } from "../src/commands/productionSuccessor.js";

type Data = Parameters<typeof renderSuccessorLines>[0];
const T = "2026-11-24T00:00:00.000Z";
const render = (outcome: object): string[] => renderSuccessorLines({ outcome } as Data, T);
const pressed = { kind: "pressed", card: "c1", runId: "r1" };
const refused = { kind: "refused", code: "X", message: "m", offIssued: false };

describe("successor press render lines", () => {
  it("prints one line for a pressed outcome, pluralising Actions and noting an Off", () => {
    expect(render({ ...pressed, actions: ["a"], offIssued: false })).toEqual([`${T} successor press: pressed c1 (1 Action) as run r1`]);
    expect(render({ ...pressed, actions: ["a", "b"], offIssued: true })).toEqual([`${T} successor press: pressed c1 (2 Actions) as run r1; issued the scope-complete Off first`]);
  });

  it("prints one line for a refused outcome, with the ping only when queued", () => {
    expect(render({ ...refused, pingId: null })).toEqual([`${T} successor press: refused (X): m`]);
    expect(render({ ...refused, pingId: "p1" })).toEqual([`${T} successor press: refused (X): m; queued ping p1`]);
  });

  it("prints nothing for a plain skip and one line when the skip issued an Off", () => {
    const skipped = { kind: "skipped", reason: "NO_READY_ACTIONS", detail: "d" };
    expect(render({ ...skipped, offIssued: false })).toEqual([]);
    expect(render({ ...skipped, offIssued: true })).toEqual([`${T} successor press: issued the scope-complete Off; skipped the press (NO_READY_ACTIONS)`]);
  });
});
