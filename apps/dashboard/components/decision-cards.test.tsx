import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Approval } from "../lib/approvals";
import { decisionCardKey, hasDuplicateOptionLabels, legacyBadges, splitLegacyDecisions, type DecisionCardView } from "../lib/decision-cards";
import { DecisionCards, DecisionRecordsUnderCards } from "./decision-cards";

function row(project: string, id: string, extra: Partial<Approval> = {}): Approval {
  return {
    kind: "decision", id, project, title: `Decision ${id}`, detail: null, gateQuestion: "Is this gate open?",
    options: [{ label: "Go", consequence: "Ships it.", recommended: true }],
    evidence: [], sourceEvidence: [], cost: "Deterministic", createdAt: "2026-10-01", readOnly: false, blocking: false,
    staleReason: null, answer: null, answerVia: [], origin: null,
    todoKey: `decision:${project}:${id}`, href: `/todo/decision/${project}/${id}`, requestId: null, aliases: [],
    acceptable: null, acceptWhy: null, buildPacket: false,
    ...extra
  };
}

const view = (project: string, id: string, pressable: boolean): Pick<DecisionCardView, "duplicates" | "pressable"> => ({
  duplicates: { kind: "decision", project, id },
  pressable: pressable ? { "option-1": "v1|option=option-1|state=" + "a".repeat(64) } : {}
});

describe("legacy Decision rows under cards", () => {
  it("moves only Decisions with a pressable card, and keeps the rest exactly where they were", () => {
    const rows = [row("alpha", "0001"), row("alpha", "0002"), row("beta", "0003")];
    const split = splitLegacyDecisions(rows, [view("alpha", "0001", true), view("alpha", "0002", false)]);
    expect(split.underCards.map((r) => r.id)).toEqual(["0001"]);
    expect(split.remaining.map((r) => r.id)).toEqual(["0002", "0003"]);
  });

  it("keeps stale and gate information in the collapsed record, read-only", () => {
    const html = renderToStaticMarkup(<DecisionRecordsUnderCards approvals={[row("alpha", "0001", { staleReason: "answered elsewhere" })]} />);
    expect(html).toContain("<details");
    expect(html).toContain("Stale");
    expect(html).toContain("Is this gate open?");
    expect(html).not.toContain("Approve");
  });
});

describe("card id and label safety", () => {
  it("encodes (project, decision) pairs injectively", () => {
    const pairs: Array<[string, string]> = [["a.b", "c"], ["a", "b.c"], ["a-b", "c"], ["a", "b-c"], ["a_b", "c"], ["a", "b_c"], ["a_2eb", "c"], ["é", "c"], ["-a", "b"]];
    const keys = pairs.map(([p, d]) => decisionCardKey(p, d));
    expect(new Set(keys).size).toBe(pairs.length);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });

  it("matches the writer's trim and case-fold label comparison", () => {
    expect(hasDuplicateOptionLabels(["Use 8080", " use 8080"])).toBe(true);
    expect(hasDuplicateOptionLabels(["Use 8080", "Use 9090"])).toBe(false);
  });
});

describe("card header keeps the to-do row's blocking and stale state", () => {
  it("shows both badges on the card itself, not only inside the collapsed record", () => {
    const view: DecisionCardView = {
      card: {
        schema: "arcadia-decision-card-v1", id: "decision-k.alpha.0001", kind: "decision", what: "Answer it",
        options: [{ id: "option-1", label: "Go", consequence: "Ships it." }], evidence: [], verb: "answer",
        pins: { stateHash: "a".repeat(64) }, expires: "2030-01-01T00:00:00Z", policy_match: null, receipt: null
      },
      pressable: { "option-1": "v1|option=option-1|state=" + "a".repeat(64) },
      notExecutableReason: null,
      actionsHref: null,
      duplicates: { kind: "decision", project: "alpha", id: "0001" }
    };
    const badges = legacyBadges([row("alpha", "0001", { blocking: true, staleReason: "answered elsewhere" })]);
    const html = renderToStaticMarkup(<DecisionCards views={[view]} pendingId={null} outcomes={{}} onPress={() => undefined} badges={badges} />);
    expect(html).toContain("Blocking progress");
    expect(html).toContain("Stale: answered elsewhere");
  });
});
