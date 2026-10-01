import { describe, expect, it } from "vitest";
import { assertLocalBrowserAuditReady, localBrowserAuditBlocker } from "../src/sessions/localBrowserAuditReadiness.js";

describe("local browser measurement preflight", () => {
  it("refuses PPN's actual measurement criterion before a Codex launch", () => {
    const action = { acceptanceCriteria: ["Using the same route set and measurement settings, mobile and desktop Lighthouse results are recorded for Performance, Accessibility, Best Practices, and SEO."], references: [] };
    expect(() => assertLocalBrowserAuditReady("codex", action)).toThrow(/local_browser_audit_unavailable/);
    expect(localBrowserAuditBlocker("codex-cli", action)).toContain("operator-approved bounded audit route");
  });
  it("supports an explicit capability reference without interpreting prose", () => {
    expect(localBrowserAuditBlocker("codex", { acceptanceCriteria: ["Render all routes."], references: ["capability/local-browser-audit"] })).toContain("#847");
  });
  it.each(["Rendered audit is recorded.", "Rendered audits are recorded.",
    "A headless browser audit is recorded.", "Headless browser audits are recorded."])(
    "refuses singular and plural measurement criteria: %s", criterion => {
      const action = { acceptanceCriteria: [criterion], references: [] };
      expect(() => assertLocalBrowserAuditReady("codex", action)).toThrow(/local_browser_audit_unavailable/);
    });
  it("leaves static checks, audit implementation tests and other providers alone", () => {
    expect(localBrowserAuditBlocker("codex", { acceptanceCriteria: ["The Lighthouse parser rejects malformed fixtures."], references: [] })).toBeNull();
    expect(localBrowserAuditBlocker("claude", { acceptanceCriteria: ["Lighthouse results are recorded."], references: [] })).toBeNull();
  });
});
