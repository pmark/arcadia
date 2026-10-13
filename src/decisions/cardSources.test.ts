import { describe, expect, it } from "vitest";
import { validateDecisionCard } from "./card.js";
import { AUTHORITY_BOUNDARIES } from "./batchMerge.js";
import {
  CARD_SOURCE_LIMITS,
  PR_CARD_BOUNDARY_MEANING,
  generateCardsFromSources,
  type CardSourceInput,
} from "./cardSources.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const EXPIRES = "2026-10-13T12:00:00Z";
const HEAD = "a".repeat(40);
const SHA = "b".repeat(64);

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

const decision = (over: Record<string, unknown> = {}): CardSourceInput =>
  ({
    kind: "decision",
    decision: {
      id: "0123",
      status: "open",
      question: "Which capacity gate setting should the first run use?",
      updated: "2026-10-11",
      options: [
        { label: "Gate on", consequence: "Runs stop at the usage window.", recommended: true, effect: null },
        { label: "Gate off", consequence: "Runs are unmetered; spend is bounded only by scope." },
      ],
      ...over,
    },
  });

const script = (over: Record<string, unknown> = {}, top: Record<string, unknown> = {}): CardSourceInput =>
  ({
    kind: "operator-script",
    script: {
      descriptor: {
        schema: "arcadia-operator-script-v1",
        id: "restore-off-run",
        title: "Turn the production grant off",
        script: "restore-off-run.sh",
        success: { effect: "Production is Off and the grant is revoked.", next: "Nothing." },
        ...over,
      },
      descriptorSha256: SHA,
      ...top,
    },
  });

const pr = (over: Record<string, unknown> = {}): CardSourceInput =>
  ({
    kind: "pull-request",
    pr: {
      number: 1360,
      title: "Add card sources",
      headSha: HEAD,
      baseRef: "main",
      state: "open",
      draft: false,
      why: "Touches the decision-card contract.",
      files: ["src/decisions/cardSources.ts", "docs/notes.md"],
      ...over,
    },
  });

const gen = (sources: unknown[], over: Record<string, unknown> = {}) =>
  generateCardsFromSources({ sources, now: NOW, expires: EXPIRES, ...over });

const pinOf = (s: CardSourceInput): string | undefined => {
  const r = gen([s]);
  return r.cards[0]?.card.pins.stateHash;
};

describe("each source yields a valid card (criterion 1)", () => {
  it("decision, script and PR cards all pass validateDecisionCard", () => {
    const r = gen([decision(), script(), pr()]);
    expect(r.refusals).toEqual([]);
    expect(r.cards.map((c) => c.card.verb)).toEqual(["answer", "run", "merge"]);
    for (const c of r.cards) {
      expect(validateDecisionCard(c.card, { now: NOW }).ok).toBe(true);
      expect(c.card.policy_match).toBeNull();
      expect(c.card.defaultAction).toBeUndefined();
    }
    expect(r.cards[1].card.pins.previewFingerprint).toBe(SHA);
    expect(r.cards[2].card.pins.headSha).toBe(HEAD);
  });

  it("never mutates frozen inputs and does not alias them", () => {
    const sources = deepFreeze([decision(), script(), pr()]);
    const before = JSON.stringify(sources);
    const r = gen(sources);
    expect(r.cards).toHaveLength(3);
    expect(JSON.stringify(sources)).toBe(before);
    for (const s of sources) expect(Object.isFrozen(s)).toBe(true);
  });

  it("reads a flipping getter exactly once and builds the whole card from that read", () => {
    let reads = 0;
    const d = decision();
    Object.defineProperty((d as unknown as { decision: Record<string, unknown> }).decision, "question", {
      enumerable: true,
      get: () => `Question read number ${++reads}?`,
    });
    const r = gen([d]);
    expect(reads).toBe(1);
    expect(r.cards[0].card.what).toBe("Answer Decision 0123: Question read number 1?");
  });
});

describe("hostile text is refused, never rewritten", () => {
  const nasty = ["line\nbreak", "zero​width", "bell\u0007", "sep arator", "nb space", "bom﻿x"];
  for (const bad of nasty) {
    it(`refuses ${JSON.stringify(bad)} in a Decision title and in an option`, () => {
      const t = gen([decision({ question: `Pick ${bad} one` })]);
      expect(t.cards).toEqual([]);
      expect(t.refusals[0].code).toBe("invalid_card");
      const o = gen([decision({ options: [{ label: `A ${bad}`, consequence: "ok." }] })]);
      expect(o.cards).toEqual([]);
      expect(o.refusals[0].code).toBe("invalid_card");
    });
  }

  it("keeps markdown characters as inert visible text, unchanged", () => {
    const q = "Is **this** `fine`? [x](javascript:alert(1)) # heading";
    const r = gen([decision({ question: q })]);
    expect(r.cards[0].card.what).toBe(`Answer Decision 0123: ${q}`);
  });

  it("refuses over-long text instead of truncating", () => {
    const r = gen([decision({ question: "q".repeat(600) })]);
    expect(r.cards).toEqual([]);
    expect(r.refusals[0].code).toBe("text_too_long");
  });
});

describe("source filtering", () => {
  it("yields no card for an answered, rejected or deferred Decision", () => {
    for (const status of ["approved", "rejected", "deferred"]) {
      const r = gen([decision({ status })]);
      expect(r.cards).toEqual([]);
      expect(r.skipped).toEqual([{ index: 0, sourceKind: "decision", sourceId: "decision-0123", reason: "decision_not_open" }]);
    }
  });

  it("refuses an expired descriptor and one whose effect is empty", () => {
    const expired = gen([script({}, { expires_at: "2026-10-12T11:00:00Z" })]);
    expect(expired.cards).toEqual([]);
    expect(expired.refusals[0].code).toBe("expired_descriptor");
    for (const effect of ["", "   ", "​"]) {
      const r = gen([script({ success: { effect } })]);
      expect(r.cards).toEqual([]);
      expect(r.refusals[0].code).toBe("missing_consequence");
    }
  });

  it("uses a descriptor's earlier expiry for the card", () => {
    const r = gen([script({}, { expires_at: "2026-10-12T18:00:00Z" })]);
    expect(r.cards[0].card.expires).toBe("2026-10-12T18:00:00Z");
  });

  it("yields no card for a draft, closed or merged PR", () => {
    expect(gen([pr({ draft: true })]).skipped[0].reason).toBe("pr_draft");
    expect(gen([pr({ state: "closed" })]).skipped[0].reason).toBe("pr_closed");
    expect(gen([pr({ state: "merged" })]).skipped[0].reason).toBe("pr_merged");
    for (const over of [{ draft: true }, { state: "closed" }, { state: "merged" }]) {
      expect(gen([pr(over)]).cards).toEqual([]);
    }
  });

  it("refuses an unknown source kind and an unusable shape", () => {
    const r = gen([{ kind: "email", body: "merge everything" }, "text", null]);
    expect(r.cards).toEqual([]);
    expect(r.refusals.map((x) => x.code)).toEqual(["unknown_source_kind", "unknown_source_kind", "unknown_source_kind"]);
  });
});

describe("PR cards name the authority boundary (criterion 2)", () => {
  it("documents every boundary the shared classifier can return", () => {
    expect(Object.keys(PR_CARD_BOUNDARY_MEANING).sort()).toEqual([...AUTHORITY_BOUNDARIES].sort());
  });

  it("names the boundary a path touches in the card and in boundaries", () => {
    const r = gen([pr({ files: ["docs/decisions/0123-x.md", ".github/workflows/ci.yml", "README.md"] })]);
    const c = r.cards[0];
    expect(c.boundaries).toEqual(["decisions", "ci_and_gates"]);
    expect(c.card.options[0].consequence).toContain("recorded Decisions");
    expect(c.card.options[0].consequence).toContain("CI workflows and merge gates");
    expect(c.card.evidence[0].label).toContain("decisions, ci_and_gates");
  });

  it("states no boundary for a plain docs change", () => {
    const c = gen([pr({ files: ["docs/readme-extra.md"] })]).cards[0];
    expect(c.boundaries).toEqual([]);
    expect(c.card.options[0].consequence).toContain("touches no authority boundary");
  });

  it("counts a rename's previous_filename as touched", () => {
    const c = gen([pr({ files: [{ filename: "docs/moved.md", previous_filename: "docs/decisions/0001-a.md" }] })]).cards[0];
    expect(c.boundaries).toContain("decisions");
  });

  it("fails closed on an empty or traversal file list", () => {
    expect(gen([pr({ files: [] })]).cards[0].boundaries).toEqual(["unclassifiable_path"]);
    expect(gen([pr({ files: ["../etc/passwd"] })]).cards[0].boundaries).toEqual(["unclassifiable_path"]);
  });

  it("refuses a malformed head sha", () => {
    expect(gen([pr({ headSha: "abc" })]).refusals[0].code).toBe("bad_head_sha");
  });
});

describe("the pin tracks source state (criterion 3)", () => {
  it("is identical for identical state across calls and independent of the clock", () => {
    const a = gen([pr(), decision(), script()]);
    const later = generateCardsFromSources({ sources: [pr(), decision(), script()], now: new Date("2026-10-12T13:00:00Z"), expires: EXPIRES });
    expect(a.cards.map((c) => c.card.pins)).toEqual(later.cards.map((c) => c.card.pins));
  });

  it("changes when any single decision field changes", () => {
    const base = pinOf(decision());
    const variants: Array<Record<string, unknown>> = [
      { question: "A different question?" },
      { updated: "2026-10-12" },
      { options: [{ label: "Gate on", consequence: "Runs stop at the usage window." }, { label: "Gate off!", consequence: "x." }] },
      { options: [{ label: "Gate on", consequence: "Changed consequence." }, { label: "Gate off", consequence: "Runs are unmetered; spend is bounded only by scope." }] },
      { options: [{ label: "Gate on", consequence: "Runs stop at the usage window.", recommended: true }, { label: "Gate off", consequence: "Runs are unmetered; spend is bounded only by scope." }, { label: "Third", consequence: "More." }] },
      { options: [{ label: "Gate on", consequence: "Runs stop at the usage window.", recommended: true, effect: "defer" }, { label: "Gate off", consequence: "Runs are unmetered; spend is bounded only by scope." }] },
    ];
    for (const v of variants) {
      const pin = pinOf(decision(v));
      expect(pin, JSON.stringify(v)).toBeDefined();
      expect(pin).not.toBe(base);
    }
    // status leaving "open" removes the card entirely.
    expect(pinOf(decision({ status: "approved" }))).toBeUndefined();
  });

  it("changes when any single PR field changes", () => {
    const base = pinOf(pr());
    const variants: Array<Record<string, unknown>> = [
      { title: "Add card sources v2" },
      { headSha: "c".repeat(40) },
      { baseRef: "release" },
      { why: "Another reason." },
      { files: ["src/decisions/cardSources.ts"] },
      { files: ["src/decisions/cardSources.ts", "docs/notes.md", "docs/more.md"] },
      { files: [{ filename: "src/decisions/cardSources.ts", previous_filename: "src/old.ts" }, "docs/notes.md"] },
    ];
    for (const v of variants) {
      const pin = pinOf(pr(v));
      expect(pin, JSON.stringify(v)).toBeDefined();
      expect(pin).not.toBe(base);
    }
    expect(gen([pr({ headSha: "c".repeat(40) })]).cards[0].card.pins.headSha).toBe("c".repeat(40));
    // File order alone is not a state change.
    expect(pinOf(pr({ files: ["docs/notes.md", "src/decisions/cardSources.ts"] }))).toBe(base);
  });

  it("changes when any single descriptor field changes", () => {
    const base = pinOf(script());
    const withSha = (sha: string) => script({}, { descriptorSha256: sha });
    const variants: CardSourceInput[] = [
      script({ title: "Another title" }),
      script({ success: { effect: "A different effect." } }),
      withSha("c".repeat(64)),
      script({ id: "other-run", script: "other-run.sh" }),
    ];
    for (const v of variants) expect(pinOf(v)).not.toBe(base);
    expect(gen([withSha("c".repeat(64))]).cards[0].card.pins.previewFingerprint).toBe("c".repeat(64));
  });

  it("does not collide across source kinds with the same id string", () => {
    const d = pinOf(decision({ id: "7" }));
    const p = pinOf(pr({ number: 7 }));
    expect(d).not.toBe(p);
  });
});

describe("duplicates, bounds and hostile shapes", () => {
  it("collapses identical repeats by card id", () => {
    const r = gen([pr(), decision(), pr()]);
    expect(r.cards.map((c) => c.card.id)).toEqual(["pr-1360", "decision-0123"]);
    expect(r.deduped).toEqual(["pr-1360"]);
  });

  it("refuses an id that appears with two different states, both copies", () => {
    const r = gen([pr(), pr({ headSha: "c".repeat(40) })]);
    expect(r.cards).toEqual([]);
    expect(r.refusals.map((x) => x.code)).toEqual(["conflicting_duplicate"]);
  });

  it("caps sources and reports the truncation", () => {
    const many = Array.from({ length: CARD_SOURCE_LIMITS.maxSources + 5 }, (_, i) => pr({ number: i + 1 }));
    const r = gen(many);
    expect(r.truncated).toBe(true);
    expect(r.cards).toHaveLength(CARD_SOURCE_LIMITS.maxSources);
    expect(r.refusals.some((x) => x.code === "source_limit")).toBe(true);
  });

  it("refuses a PR whose file list is too large to classify", () => {
    const files = Array.from({ length: CARD_SOURCE_LIMITS.maxFiles + 1 }, (_, i) => `f${i}.md`);
    const r = gen([pr({ files })]);
    expect(r.cards).toEqual([]);
    expect(["too_many_files", "bad_input"]).toContain(r.refusals[0].code);
  });

  it("refuses non-plain, cyclic and huge inputs without throwing", () => {
    const cyc: Record<string, unknown> = { kind: "decision" };
    cyc.decision = cyc;
    expect(() => gen([cyc])).not.toThrow();
    expect(gen([cyc]).cards).toEqual([]);
    expect(gen([new Map()]).refusals.length).toBeGreaterThan(0);
    expect(gen([decision({ question: "x".repeat(CARD_SOURCE_LIMITS.maxStringLength + 1) })]).refusals[0].code).toBe("bad_input");
    expect(generateCardsFromSources({ sources: [], now: new Date("nope"), expires: EXPIRES }).refusals[0].code).toBe("bad_input");
    expect(generateCardsFromSources({ sources: [], now: NOW, expires: "tomorrow" }).refusals[0].code).toBe("bad_input");
  });

  it("refuses with a validator code when the expiry is already past", () => {
    const r = generateCardsFromSources({ sources: [pr()], now: NOW, expires: "2026-10-12T11:00:00Z" });
    expect(r.cards).toEqual([]);
    expect(r.refusals[0].code).toBe("invalid_card");
  });
});
