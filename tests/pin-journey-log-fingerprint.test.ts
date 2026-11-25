import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { journeyLogFingerprint } from "../src/production/journeyLog.js";

const sha = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

describe("journeyLogFingerprint", () => {
  it("fingerprints an escalation by kind alone", () => {
    const a = journeyLogFingerprint("escalation", "stuck", "first message", "r");
    const b = journeyLogFingerprint("escalation", "stuck", "other message", null);
    expect(a).toBe(sha(["stuck"]));
    expect(b).toBe(a);
  });

  it.each(["launch_refusal", "review_repair"] as const)("fingerprints %s by kind, message and remedy", (source) => {
    const base = journeyLogFingerprint(source, "k", "m", "r");
    expect(base).toBe(sha(["k", "m", "r"]));
    expect(journeyLogFingerprint(source, "k", "m2", "r")).not.toBe(base);
    expect(journeyLogFingerprint(source, "k", "m", null)).not.toBe(base);
    expect(journeyLogFingerprint(source, "k", "m", null)).toBe(sha(["k", "m", null]));
  });
});
