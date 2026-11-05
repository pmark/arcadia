import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Approval } from "../lib/approvals";
import { todoHrefOf, todoKeyOf, todoItemUrl } from "../lib/approvals";
import type { DecisionCardView } from "../lib/decision-cards";
import type { DecisionCardMeta } from "../lib/decision-cards-server";
import { DecisionAnswerView, decisionRecordUrl, type DecisionAnswerViewProps } from "./decision-answer";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => <a href={href} {...rest}>{children as never}</a> }));

const row = (over: Partial<Approval> = {}): Approval => ({
  kind: "decision", id: "0042", project: "alpha", title: "Which port should the service use?", detail: "Use 8080", gateQuestion: "approval_boundary",
  options: [{ label: "Use 8080", consequence: "Binds 8080 from the row.", recommended: true }, { label: "Use 9090", consequence: "Binds 9090 from the row.", recommended: false }],
  evidence: [], sourceEvidence: [], cost: "Deterministic", createdAt: "2026-10-01", readOnly: false, blocking: false, staleReason: null, answer: null, answerVia: [], origin: null,
  todoKey: todoKeyOf("decision", "alpha", "0042"), href: todoHrefOf("decision", "alpha", "0042"), requestId: null, aliases: [], acceptable: null, acceptWhy: null, buildPacket: false,
  ...over
});
const view = (over: Partial<DecisionCardView> = {}): DecisionCardView => ({
  card: {
    schema: "arcadia-decision-card-v1", id: "decision-k.alpha.0042", kind: "decision", what: "Answer Decision k.alpha.0042: Which port should the service use?", verb: "answer",
    options: [{ id: "option-1", label: "Use 8080", consequence: "Binds 8080 from the card." }, { id: "option-2", label: "Use 9090", consequence: "Binds 9090 from the card." }],
    evidence: [], pins: { stateHash: "a".repeat(64) }, expires: "2030-01-01T00:00:00Z", policy_match: null, receipt: null
  },
  pressable: { "option-1": "v1|option=option-1|state=aaa", "option-2": "v1|option=option-2|state=aaa" },
  notExecutableReason: null, duplicates: { kind: "decision", project: "alpha", id: "0042" }, actionsHref: null,
  ...over
});
const meta: DecisionCardMeta = { id: "0042", question: "Which port should the service use?", gateQuestion: "approval_boundary", recommendation: "Use 8080", recommendedLabels: ["Use 8080"], relativePath: "docs/decisions/0042.md", updated: "2026-10-13" };

const props = (over: Partial<DecisionAnswerViewProps> = {}): DecisionAnswerViewProps => ({
  project: "alpha", id: "0042", row: row(), rowSettled: true, view: view(), meta, cardLoaded: true, cardFailed: false, refusal: null,
  pendingId: null, outcome: undefined, onPress: () => undefined, rowPendingId: null, onRowAct: () => undefined, rowMessage: null, rowError: null, rowNote: null,
  ...over
});
const render = (over: Partial<DecisionAnswerViewProps> = {}) => renderToStaticMarkup(<DecisionAnswerView {...props(over)} />);

describe("DecisionAnswerView", () => {
  it("shows the question, each option with its consequence, and offers a way in", () => {
    const html = render();
    expect(html).toContain("Which port should the service use?");
    expect(html).toContain("Use 8080");
    expect(html).toContain("Binds 8080 from the card.");
    expect(html).toContain("Binds 9090 from the card.");
    expect(html).toContain("Recommended:");
    expect(html).toContain("Read the full record");
    expect(html).toContain("Tap one to read and answer.");
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
  });

  it("has no Answer button until an option has been chosen", () => {
    expect(render()).not.toContain('data-testid="decision-answer-button"');
    expect(render()).not.toContain("Answer: ");
  });

  it("keeps the whole text in the page, clamped only by CSS", () => {
    const long = `${"consequence ".repeat(80)}THE-END`;
    const question = `${"question words ".repeat(40)}done. The second sentence is here too.`;
    const html = render({ view: view({ card: { ...view().card, options: [{ id: "option-1", label: "Use 8080", consequence: long }] } }), meta: { ...meta, question } });
    expect(html).toContain("THE-END");
    expect(html).toContain("The second sentence is here too.");
    expect(html).toContain("line-clamp-4");
  });

  it("while the card is on its way, shows the row's text with no way to answer", () => {
    const html = render({ view: null, meta: null, cardLoaded: false });
    expect(html).toContain("Binds 8080 from the row.");
    expect(html).toContain("Getting the answer buttons ready...");
    expect(html).not.toContain("aria-pressed");
  });

  it("cannot be answered until the row's read has said whether this is stale", () => {
    const html = render({ rowSettled: false });
    expect(html).toContain("Checking whether this is still waiting on you...");
    expect(html).not.toContain("aria-pressed");
  });

  it("offers only what the card marks pressable", () => {
    const html = render({ view: view({ pressable: { "option-2": "v1|option=option-2|state=aaa" } }) });
    expect(html.match(/aria-pressed/g)).toHaveLength(1);
  });

  it("says why when no option can be pressed", () => {
    const html = render({ view: view({ pressable: {}, notExecutableReason: "This card cannot be executed from this page." }) });
    expect(html).toContain("This card cannot be executed from this page.");
    expect(html).not.toContain("aria-pressed");
  });

  it("marks blocking and stale, as the to-do row does", () => {
    const blocking = render({ row: row({ blocking: true }) });
    expect(blocking).toContain("Blocking");
    const stale = render({ row: row({ blocking: true, staleReason: "already answered" }) });
    expect(stale).toContain("Stale: already answered");
    expect(stale).not.toContain(">Blocking<");
  });

  it("shows the writer's refusal with its reason", () => {
    const html = render({ outcome: { ok: false, reason: "stale_state_hash", message: "The card changed after you were shown it." } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Refused (stale_state_hash): The card changed after you were shown it.");
  });

  it("confirms an answer and leaves nothing to press", () => {
    const html = render({ view: view({ pressable: {} }), outcome: { ok: true, message: "Answered decision-k.alpha.0042." } });
    expect(html).toContain("Answered");
    expect(html).not.toContain("aria-pressed");
  });

  it("shows a title-only Decision as just that, with no answer, and the full record", () => {
    const html = render({ row: row({ title: "Copy production model", detail: null, options: [], gateQuestion: null }), view: null, meta: { ...meta, question: "Copy production model", gateQuestion: null, recommendation: null, recommendedLabels: [] }, refusal: { id: "decision-k.alpha.0042", reason: "no_options", message: "The Decision offers no options to answer between." } });
    expect(html).toContain("Copy production model");
    expect(html).toContain("The record gives only this title, not a full question.");
    expect(html).toContain("offers no options to answer between");
    expect(html).toContain("Read the full record");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("decision-row-control");
    expect(html).not.toContain("Approve");
  });

  it("shows the record's recommendation when there are no options", () => {
    const html = render({ view: null, row: row({ options: [], detail: "Yes. Reactivate it." }), meta: { ...meta, recommendation: "Yes. Reactivate it.", recommendedLabels: [] }, refusal: { id: "x", reason: "no_options", message: "None." } });
    expect(html).toContain("The record recommends: Yes. Reactivate it.");
  });

  it("states a missing consequence rather than inventing one", () => {
    const html = render({ view: null, meta: null, cardFailed: true, row: row({ options: [{ label: "Now", consequence: null as never, recommended: false }] }) });
    expect(html).toContain("The record states no consequence for this option.");
  });

  it("keeps the row's existing control for a Decision refused a card, behind one tap", () => {
    const html = render({ view: null, refusal: { id: "decision-k.alpha.0042", reason: "duplicate_option_labels", message: "Two options match." } });
    expect(html).toContain("No pinned answer button here (duplicate_option_labels): ");
    expect(html).toContain("Two options match.");
    expect(html).toContain("Answer from the to-do card");
    expect(html).toMatch(/<details class="mt-1"><summary[^>]*>Answer from the to-do card/);
  });

  it("never moves a Decision to the unpinned control because a read failed", () => {
    const html = render({ view: null, meta: null, cardFailed: true });
    expect(html).toContain("so nothing can be pressed yet");
    expect(html).not.toContain("Answer from the to-do card");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("aria-pressed");
  });

  it("says when a kept refusal's Decision couldn't be read again, without hiding the refusal", () => {
    const html = render({ view: null, cardFailed: true, refusal: { id: "decision-k.alpha.0042", reason: "duplicate_option_labels", message: "Two options match." } });
    expect(html).toContain("may be out of date");
    expect(html).toContain("No pinned answer button here (duplicate_option_labels): ");
    expect(html).toContain("Answer from the to-do card");
  });

  it("explains a refusal even when there's no row to answer from", () => {
    const html = render({ row: null, view: null, refusal: { id: "decision-k.alpha.0042", reason: "text_too_long", message: "Too long." } });
    expect(html).toContain("No pinned answer button here (text_too_long): ");
    expect(html).not.toContain("Answer from the to-do card");
  });

  it("keeps a pinned card pressable through a failed poll", () => {
    const html = render({ cardFailed: true });
    expect(html.match(/aria-pressed/g)).toHaveLength(2);
    expect(html).not.toContain("so nothing can be pressed yet");
  });

  it("always shows the record's question, with a worded gate question only beside it", () => {
    const html = render({ meta: { ...meta, question: "Delete production database", gateQuestion: "Should we proceed?" } });
    expect(html).toContain("Delete production database");
    expect(html).toContain("The record gives only this title, not a full question.");
    expect(html).toContain("Its gate asks: Should we proceed?");
    expect(html.indexOf("Delete production database")).toBeLessThan(html.indexOf("Should we proceed?"));
  });

  it("doesn't leave an old refusal showing while another press is working", () => {
    const html = render({ pendingId: "decision-k.alpha.0042:option-1", outcome: { ok: false, reason: "stale_state_hash", message: "Old." } });
    expect(html).not.toContain("decision-refused");
  });

  it("offers nothing for a Decision the card read says is no longer open", () => {
    const html = render({ view: null, meta: null });
    expect(html).toContain("This Decision isn&#x27;t open any more.");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("Answer from the to-do card");
  });

  it("doesn't fetch or render the full record until it's asked for", () => {
    const html = render();
    expect(html).not.toContain('data-testid="decision-record"');
    expect(html).toContain('aria-expanded="false"');
  });
});

describe("addresses", () => {
  it("encodes every part of the small reads", () => {
    expect(todoItemUrl({ kind: "escalation:auth", project: "a b", id: "x/y" })).toBe("/api/todo-item?kind=escalation%3Aauth&project=a%20b&id=x%2Fy");
    expect(decisionRecordUrl("a b", "x/y")).toBe("/api/todo-item/decision/record?project=a%20b&id=x%2Fy");
  });
});

describe("the answer paths", () => {
  const repo = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, repo), "utf8");

  it("the short view's reads are GET handlers only", () => {
    for (const path of ["app/api/todo-item/route.ts", "app/api/todo-item/decision/route.ts", "app/api/todo-item/decision/record/route.ts"]) {
      const source = read(path);
      expect(source).toMatch(/export async function GET\(/);
      expect(source).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
      expect(source).not.toMatch(/approveDecision|settlePendingAgentAsk|startOperatorScript/);
    }
  });

  it("the press still sends exactly the card id and its pinned fingerprint", () => {
    const hook = read("hooks/use-decision-cards.ts");
    expect(hook).toContain('fetch("/api/decision-card", {');
    expect(hook).toContain("JSON.stringify({ cardId: view.card.id, fingerprint })");
  });
});
