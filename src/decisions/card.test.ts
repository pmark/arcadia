import { describe, expect, it } from "vitest";
import {
  DECISION_CARD_EXCLUDED_KINDS,
  DECISION_CARD_SCHEMA,
  checkPins,
  parseCardExpiry,
  validateDecisionCard,
  type DecisionCardErrorCode,
} from "./card.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const FUTURE = "2026-10-13T12:00:00Z";

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DECISION_CARD_SCHEMA,
    id: "card-1",
    kind: "pr-merge",
    what: "Merge PR 1 into main.",
    options: [
      { id: "go", label: "Merge", consequence: "main advances; the PR closes." },
      { id: "hold", label: "Hold", consequence: "Nothing changes; the card stays open." },
    ],
    evidence: [{ label: "PR", url: "https://github.com/pmark/arcadia/pull/1" }],
    verb: "merge",
    pins: { headSha: "abc123" },
    expires: FUTURE,
    policy_match: null,
    receipt: null,
    ...over,
  };
}

function codes(input: unknown): DecisionCardErrorCode[] {
  const r = validateDecisionCard(input, { now: NOW });
  return r.ok ? [] : r.errors.map((e) => e.code);
}

describe("fixtures per verb", () => {
  const fixtures: Record<string, Record<string, unknown>> = {
    merge: base(),
    run: base({
      id: "card-run",
      kind: "operator-script",
      verb: "run",
      what: "Run the environment-wall reset script.",
      pins: { previewFingerprint: "sha256:aa" },
      receipt: "runs/receipts/card-run.json",
    }),
    answer: base({
      id: "card-answer",
      kind: "decision",
      verb: "answer",
      what: "Answer Decision 0123.",
      pins: { stateHash: "state-1" },
    }),
    veto: base({
      id: "card-veto",
      kind: "docs-only-merge",
      verb: "veto",
      what: "Merge docs-only PR unless vetoed.",
      defaultAction: "go",
      policy_match: "policy-docs-only",
    }),
  };
  for (const [verb, card] of Object.entries(fixtures)) {
    it(`${verb} validates`, () => {
      const r = validateDecisionCard(card, { now: NOW });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.card.verb).toBe(verb);
    });
  }
});

describe("required rejections", () => {
  it("missing consequence", () => {
    const o = [{ id: "a", label: "A" }];
    expect(codes(base({ options: o }))).toContain("missing_consequence");
    expect(codes(base({ options: [{ id: "a", label: "A", consequence: "  " }] }))).toContain(
      "missing_consequence",
    );
  });
  it("no pins / empty pins / empty-string pin", () => {
    expect(codes(base({ pins: undefined }))).toContain("no_pins");
    expect(codes(base({ pins: {} }))).toContain("no_pins");
    expect(codes(base({ pins: { headSha: "" } }))).toEqual(["empty_pin"]);
    expect(codes(base({ pins: { headSha: "   " } }))).toEqual(["empty_pin"]);
  });
  it("unknown verb, empty what", () => {
    expect(codes(base({ verb: "delete" }))).toContain("unknown_verb");
    expect(codes(base({ verb: "constructor" }))).toContain("unknown_verb");
    expect(codes(base({ what: " " }))).toContain("empty_what");
    expect(codes(base({ what: undefined }))).toContain("empty_what");
  });
  it("policy_match of wrong type or empty", () => {
    for (const v of [1, {}, [], "", true, undefined]) {
      expect(codes(base({ policy_match: v }))).toContain("bad_policy_match");
    }
  });
  it("duplicate option ids", () => {
    const o = [
      { id: "a", label: "A", consequence: "x" },
      { id: "a", label: "B", consequence: "y" },
    ];
    expect(codes(base({ options: o }))).toContain("duplicate_option_id");
  });
  it("wrong schema string", () => {
    expect(codes(base({ schema: "arcadia-decision-card-v2" }))).toContain("bad_schema");
  });
});

describe("expiry", () => {
  it("past, invalid, missing", () => {
    expect(codes(base({ expires: "2026-10-12T11:59:59Z" }))).toContain("expired");
    expect(codes(base({ expires: "2026-10-12T12:00:00Z" }))).toContain("expired");
    for (const v of ["tomorrow", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-13", 5, null, NaN]) {
      expect(codes(base({ expires: v }))).toContain("bad_expires");
    }
  });
  it("requires an explicit offset and compares instants", () => {
    expect(codes(base({ expires: "2026-10-13T12:00:00" }))).toContain("bad_expires");
    // 12:30+01:00 is 11:30Z, which is before NOW (12:00Z): expired.
    expect(codes(base({ expires: "2026-10-12T12:30:00+01:00" }))).toContain("expired");
    // 12:30-01:00 is 13:30Z: valid.
    expect(codes(base({ expires: "2026-10-12T12:30:00-01:00" }))).toEqual([]);
    expect(codes(base({ expires: "2026-10-13T00:00:00+25:00" }))).toContain("bad_expires");
  });
  it("parseCardExpiry accepts leap day only in leap years", () => {
    expect(parseCardExpiry("2028-02-29T00:00:00Z")).not.toBeNull();
    expect(parseCardExpiry("2027-02-29T00:00:00Z")).toBeNull();
  });
});

describe("hostile input", () => {
  it("rejects unknown keys explicitly (top, option, evidence, pins)", () => {
    expect(codes(base({ extra: 1 }))).toEqual(["unknown_key"]);
    expect(codes(base({ pins: { headSha: "a", other: "b" } }))).toEqual(["unknown_key"]);
    expect(
      codes(base({ options: [{ id: "a", label: "A", consequence: "c", x: 1 }] })),
    ).toEqual(["unknown_key"]);
    expect(codes(base({ evidence: [{ label: "e", bogus: 1 }] }))).toEqual(["unknown_key"]);
  });
  it("rejects prototype-pollution keys from JSON.parse", () => {
    const polluted = JSON.parse(JSON.stringify(base()).replace("{", '{"__proto__":{"x":1},'));
    expect(codes(polluted)).toContain("unknown_key");
    const ctor = base({ constructor: { prototype: {} } });
    expect(codes(ctor)).toContain("unknown_key");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    const optPollute = JSON.parse(
      '{"id":"a","label":"A","consequence":"c","__proto__":{"y":1}}',
    );
    expect(codes(base({ options: [optPollute] }))).toContain("unknown_key");
  });
  it("does not read inherited properties", () => {
    const proto = { id: "inherited" };
    const card = Object.create(proto) as Record<string, unknown>;
    Object.assign(card, base());
    delete card.id;
    expect(codes(card)).toContain("bad_field");
  });
  it("rejects non-string, NaN, negative and non-object inputs", () => {
    for (const bad of [null, undefined, 5, "card", [], NaN]) {
      expect(codes(bad)).toEqual(["not_object"]);
    }
    expect(codes(base({ id: 5 }))).toContain("bad_field");
    expect(codes(base({ what: NaN }))).toContain("bad_field");
    expect(codes(base({ pins: { headSha: -1 } }))).toContain("bad_field");
    expect(codes(base({ pins: { headSha: NaN } }))).toContain("bad_field");
    expect(codes(base({ options: "nope" }))).toContain("no_options");
    expect(codes(base({ options: [] }))).toContain("no_options");
    expect(codes(base({ evidence: {} }))).toContain("bad_field");
    expect(codes(base({ receipt: 3 }))).toContain("bad_field");
  });
  it("caps huge strings and lists", () => {
    expect(codes(base({ what: "x".repeat(501) }))).toContain("too_long");
    expect(codes(base({ id: "x".repeat(129) }))).toContain("too_long");
    expect(codes(base({ pins: { headSha: "x".repeat(257) } }))).toContain("too_long");
    expect(codes(base({ expires: "9".repeat(10_000) }))).toContain("bad_expires");
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `o${i}`, label: "l", consequence: "c" }));
    expect(codes(base({ options: many }))).toContain("too_many_options");
  });
  it("rejects non-http evidence urls", () => {
    expect(codes(base({ evidence: [{ label: "x", url: "javascript:alert(1)" }] }))).toContain(
      "bad_field",
    );
  });
  it("does not mutate input", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    validateDecisionCard(input, { now: NOW });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("excluded kinds and defaultAction", () => {
  it("rejects policy_match on every excluded kind", () => {
    for (const kind of DECISION_CARD_EXCLUDED_KINDS) {
      expect(codes(base({ kind, policy_match: "policy-x" }))).toEqual([
        "policy_match_on_excluded_kind",
      ]);
      expect(codes(base({ kind, policy_match: null }))).toEqual([]);
    }
  });
  it("defaultAction only for veto on a non-excluded kind naming an option", () => {
    expect(codes(base({ verb: "veto", defaultAction: "go" }))).toEqual([]);
    expect(codes(base({ verb: "merge", defaultAction: "go" }))).toEqual([
      "default_action_not_allowed",
    ]);
    for (const kind of DECISION_CARD_EXCLUDED_KINDS) {
      expect(codes(base({ verb: "veto", kind, defaultAction: "go" }))).toEqual([
        "default_action_not_allowed",
      ]);
    }
    expect(codes(base({ verb: "veto", defaultAction: "nope" }))).toEqual([
      "default_action_unknown_option",
    ]);
    expect(codes(base({ verb: "veto", defaultAction: 7 }))).toEqual(["bad_field"]);
  });
});

describe("checkPins", () => {
  const card = {
    pins: { stateHash: "s1", headSha: "h1", previewFingerprint: "p1" },
    expires: FUTURE,
  };
  const cur = { stateHash: "s1", headSha: "h1", previewFingerprint: "p1" };
  it("passes when all pins match", () => {
    expect(checkPins(card, cur, NOW)).toEqual({ ok: true });
  });
  it("names each stale pin", () => {
    expect(checkPins(card, { ...cur, stateHash: "s2" }, NOW)).toEqual({
      ok: false,
      reason: "stale_state_hash",
      field: "stateHash",
    });
    expect(checkPins(card, { ...cur, headSha: "h2" }, NOW)).toMatchObject({
      reason: "stale_head_sha",
    });
    expect(checkPins(card, { ...cur, previewFingerprint: "p2" }, NOW)).toMatchObject({
      reason: "stale_preview_fingerprint",
    });
  });
  it("fails closed on missing current value, no pins and expiry", () => {
    expect(checkPins(card, { stateHash: "s1", headSha: "h1" }, NOW)).toMatchObject({
      reason: "missing_current_preview_fingerprint",
    });
    expect(checkPins(card, { ...cur, headSha: "" }, NOW)).toMatchObject({
      reason: "missing_current_head_sha",
    });
    expect(checkPins({ pins: {}, expires: FUTURE }, cur, NOW)).toMatchObject({ reason: "no_pins" });
    expect(checkPins(card, cur, new Date("2026-10-14T00:00:00Z"))).toEqual({
      ok: false,
      reason: "expired",
    });
  });
  it("only compares pins the card carries", () => {
    expect(checkPins({ pins: { headSha: "h1" }, expires: FUTURE }, { headSha: "h1" }, NOW).ok).toBe(
      true,
    );
  });
});
