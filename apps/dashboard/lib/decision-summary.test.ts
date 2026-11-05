import { describe, expect, it } from "vitest";
import { decisionCardKey, decodeIdPart, encodeIdPart } from "./decision-cards";
import { decisionTodoHrefFromHash, optionClampLines, splitFirstSentence, summarizeDecision } from "./decision-summary";

describe("summarizeDecision", () => {
  it("uses the record's question and options, word for word", () => {
    const summary = summarizeDecision({
      question: "Which port should the service use?",
      options: [
        { id: "option-1", label: "Use 8080", consequence: "Binds 8080 on the next restart." },
        { id: "option-2", label: "Use 9090", consequence: "Binds 9090 on the next restart. [effect: defer]" }
      ],
      recommendedLabels: ["Use 8080"]
    });
    expect(summary).toEqual({
      kind: "question",
      headline: "Which port should the service use?",
      rest: null,
      gateQuestion: null,
      recommendation: null,
      options: [
        { id: "option-1", label: "Use 8080", consequence: "Binds 8080 on the next restart.", recommended: true },
        { id: "option-2", label: "Use 9090", consequence: "Binds 9090 on the next restart. [effect: defer]", recommended: false }
      ]
    });
  });

  it("leads with the first sentence and keeps the rest", () => {
    // A real open Decision's question, including the abbreviation-like "#847s".
    const question = "Decide whether to activate exactly one bounded Docker host audit, and accept the host-route substitute for Issue #847s named-profile-only check. No activation or PPN measurement has occurred.";
    const summary = summarizeDecision({ question });
    expect(summary.headline).toBe("Decide whether to activate exactly one bounded Docker host audit, and accept the host-route substitute for Issue #847s named-profile-only check.");
    expect(summary.rest).toBe("No activation or PPN measurement has occurred.");
    expect(`${summary.headline} ${summary.rest}`).toBe(question);
  });

  it("marks a bare title rather than dressing it up as a question", () => {
    expect(summarizeDecision({ question: "Copy production model" })).toMatchObject({ kind: "title", headline: "Copy production model" });
  });

  it("says there is no question only when the record holds no text, and invents nothing", () => {
    for (const question of [null, undefined, "", "   "]) {
      expect(summarizeDecision({ question })).toMatchObject({ kind: "none", headline: null, rest: null });
    }
  });

  it("shows a placeholder or a markdown-looking question as written, because the pin binds it", () => {
    expect(summarizeDecision({ question: "TBD" })).toMatchObject({ kind: "title", headline: "TBD" });
    expect(summarizeDecision({ question: "## Heading words here for this one" }).headline).toBe("## Heading words here for this one");
  });

  it("never lets a gate question stand in for the question", () => {
    const summary = summarizeDecision({ question: "Delete production database", gateQuestion: "Should we proceed?" });
    expect(summary).toMatchObject({ kind: "title", headline: "Delete production database", gateQuestion: "Should we proceed?" });
    expect(summarizeDecision({ question: null, gateQuestion: "Should we proceed?" })).toMatchObject({ kind: "none", headline: null, gateQuestion: "Should we proceed?" });
  });

  it("adds a gate question only in words, and only when the question is thin", () => {
    expect(summarizeDecision({ question: "Publish", gateQuestion: "approval_boundary" }).gateQuestion).toBeNull();
    expect(summarizeDecision({ question: "Should we publish the notes today?", gateQuestion: "Other words?" }).gateQuestion).toBeNull();
  });

  it("never drops very long text", () => {
    const sentence = "A very long question that keeps going ".repeat(400).trim();
    const summary = summarizeDecision({ question: sentence, options: [{ label: "L".repeat(5000), consequence: "C".repeat(50_000) }] });
    // One enormous sentence stays whole; only CSS clamps it on screen.
    expect(summary.headline).toBe(sentence);
    expect(summary.rest).toBeNull();
    expect(summary.options[0].label).toHaveLength(5000);
    expect(summary.options[0].consequence).toHaveLength(50_000);
  });

  it("shows a missing consequence as missing and skips an option with no label", () => {
    const summary = summarizeDecision({ question: "Which one do you want?", options: [{ label: "A", consequence: null }, { label: "B", consequence: "   " }, { label: "", consequence: "Orphan." }] });
    expect(summary.options.map((option) => [option.label, option.consequence])).toEqual([["A", null], ["B", null]]);
  });

  it("carries the recommendation only when there are no options to carry it", () => {
    expect(summarizeDecision({ question: "Accept the proof?", recommendation: "Yes." }).recommendation).toBe("Yes.");
    expect(summarizeDecision({ question: "Accept the proof?", recommendation: "Yes.", options: [{ label: "Yes", consequence: "Goes." }] }).recommendation).toBeNull();
  });

  it("is deterministic", () => {
    const input = { question: "One sentence here. Another sentence here.", options: [{ label: "A", consequence: "B" }] };
    expect(summarizeDecision(input)).toEqual(summarizeDecision(input));
  });
});

describe("splitFirstSentence", () => {
  it.each([
    ["Ship it? Then say so.", "Ship it?", "Then say so."],
    ["Use the e.g. form for this. Then stop.", "Use the e.g. form for this.", "Then stop."],
    ["Bump to v1.2 and go. Then stop.", "Bump to v1.2 and go.", "Then stop."],
    ["See PR. 2095 for it. Then stop.", "See PR. 2095 for it.", "Then stop."],
    ["No boundary at all", "No boundary at all", null],
    ["Trailing stop only.", "Trailing stop only.", null]
  ])("%s", (text, head, rest) => {
    expect(splitFirstSentence(text)).toEqual({ head, rest });
  });
});

describe("optionClampLines", () => {
  it("tightens as options increase, so a Decision fits one screen", () => {
    expect([1, 2, 3, 4, 7].map(optionClampLines)).toEqual([4, 4, 3, 2, 2]);
  });
});

describe("decisionTodoHrefFromHash", () => {
  it("opens the Decision a next-step link names, as nextSteps.ts encodes it", () => {
    const cardId = `decision-${decisionCardKey("private-practice-now", "0036")}`;
    expect(decisionTodoHrefFromHash(`#card-${encodeURIComponent(cardId)}`)).toBe("/todo/decision/private-practice-now/0036");
    expect(decisionTodoHrefFromHash("#card-decision-k.arcadia.0079")).toBe("/todo/decision/arcadia/0079");
  });

  it("round-trips project and id characters that the card key escapes", () => {
    const cardId = `decision-${decisionCardKey("a_b.c", "x/y z")}`;
    expect(decisionTodoHrefFromHash(`#card-${encodeURIComponent(cardId)}`)).toBe("/todo/decision/a_b.c/x%2Fy%20z");
  });

  it.each([
    "",
    "#",
    "#todo-decision-alpha-0001",
    "#card-",
    "#card-script-rotate-logs",
    "#card-decision:arcadia/0140",
    "#card-decision-k.arcadia",
    "#card-decision-k.arcadia.0079.extra",
    "#card-decision-k._zz.0079",
    "#card-decision-k.-bad.0079",
    "#card-%E0%A4%A"
  ])("leaves %s to the list", (hash) => {
    expect(decisionTodoHrefFromHash(hash)).toBeNull();
  });
});

describe("decodeIdPart", () => {
  it.each(["alpha", "a_b", "a.b", "x/y z", "-leading", "née", "0079"])("inverts encodeIdPart for %s", (value) => {
    expect(decodeIdPart(encodeIdPart(value))).toBe(value);
  });

  it.each(["", "_", "_z1", "_2", "-lead", "a_2Db", "_ff"])("refuses %s, which encodeIdPart could not have made", (part) => {
    expect(decodeIdPart(part)).toBeNull();
  });
});
