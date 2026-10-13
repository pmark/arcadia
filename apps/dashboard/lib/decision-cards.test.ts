import { describe, expect, it } from "vitest";
import type { DecisionCard } from "../../../src/decisions/card";
import { evaluatePress, optionFingerprint, parseFingerprint, parsePressBody } from "./decision-cards";

const S = "a".repeat(64);
const H = "b".repeat(40);
const P = "c".repeat(64);
const NOW = new Date("2026-10-13T12:00:00Z");

function card(pins: DecisionCard["pins"], expires = "2026-10-13T13:00:00Z"): DecisionCard {
  return {
    schema: "arcadia-decision-card-v1",
    id: "pr-7",
    kind: "pr-merge",
    what: "x",
    options: [{ id: "merge", label: "Merge", consequence: "Merges." }],
    evidence: [],
    verb: "merge",
    pins,
    expires,
    policy_match: null,
    receipt: null
  };
}

describe("evaluatePress", () => {
  const current = card({ stateHash: S, headSha: H, previewFingerprint: P });
  const press = (fingerprint: string) => evaluatePress([current], { cardId: "pr-7", fingerprint }, NOW);

  it("accepts the exact pinned fingerprint", () => {
    expect(press(optionFingerprint(current, "merge"))).toMatchObject({ ok: true, optionId: "merge" });
  });

  it("names each stale pin kind", () => {
    expect(press(optionFingerprint(card({ stateHash: "d".repeat(64), headSha: H, previewFingerprint: P }), "merge"))).toMatchObject({ ok: false, reason: "stale_state_hash" });
    expect(press(optionFingerprint(card({ stateHash: S, headSha: "e".repeat(40), previewFingerprint: P }), "merge"))).toMatchObject({ ok: false, reason: "stale_head_sha" });
    expect(press(optionFingerprint(card({ stateHash: S, headSha: H, previewFingerprint: "f".repeat(64) }), "merge"))).toMatchObject({ ok: false, reason: "stale_preview_fingerprint" });
  });

  it("refuses a changed pin set, an unknown option, a malformed fingerprint and an expired card", () => {
    expect(press(optionFingerprint(card({ stateHash: S }), "merge"))).toMatchObject({ ok: false, reason: "pin_set_changed" });
    expect(press(optionFingerprint(current, "hold"))).toMatchObject({ ok: false, reason: "option_not_offered" });
    expect(press("v1|option=merge")).toMatchObject({ ok: false, reason: "bad_fingerprint" });
    expect(evaluatePress([card({ stateHash: S }, "2026-10-13T11:00:00Z")], { cardId: "pr-7", fingerprint: optionFingerprint(card({ stateHash: S }), "merge") }, NOW)).toMatchObject({ ok: false, reason: "expired" });
  });
});

describe("press parsing", () => {
  it("round-trips a fingerprint and refuses duplicate or unknown parts", () => {
    const fp = optionFingerprint(card({ stateHash: S, headSha: H }), "merge");
    expect(parseFingerprint(fp)).toEqual({ optionId: "merge", pins: { stateHash: S, headSha: H } });
    expect(parseFingerprint(`${fp}|state=${S}`)).toBeNull();
    expect(parseFingerprint(`${fp}|extra=1`)).toBeNull();
  });

  it("accepts exactly cardId and fingerprint", () => {
    expect(parsePressBody({ cardId: "a", fingerprint: "b" })).toMatchObject({ ok: true });
    expect(parsePressBody({ cardId: "a", fingerprint: "b", option: "c" })).toMatchObject({ ok: false, reason: "unknown_key" });
    expect(parsePressBody(["a"])).toMatchObject({ ok: false, reason: "malformed_body" });
  });
});
