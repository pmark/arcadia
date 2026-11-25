import { describe, expect, it } from "vitest";
import { classifyClaudeAuthStatus } from "../src/qa/reviewerReplay.js";

const classify = (status: unknown) => classifyClaudeAuthStatus(JSON.stringify(status));

describe("classifyClaudeAuthStatus", () => {
  it.each(["claude.ai", "oauth_token"])("treats a first-party %s login as a subscription", (method) => {
    expect(classify({ loggedIn: true, authMethod: method, apiProvider: "firstParty" })).toEqual({ kind: "subscription", method });
  });

  it("reports a signed-in status that does not spend a subscription, with unknown for absent fields", () => {
    expect(classify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })).toEqual({
      kind: "not_subscription",
      method: "api_key",
      provider: "firstParty",
    });
    expect(classify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "bedrock" })).toEqual({
      kind: "not_subscription",
      method: "claude.ai",
      provider: "bedrock",
    });
    expect(classify({ loggedIn: true })).toEqual({ kind: "not_subscription", method: "unknown", provider: "unknown" });
  });

  it("treats anything but boolean true for loggedIn as signed out", () => {
    expect(classify({ loggedIn: "true" })).toEqual({ kind: "signed_out" });
    expect(classify({})).toEqual({ kind: "signed_out" });
  });

  it("treats non-JSON and null output as unreadable", () => {
    expect(classifyClaudeAuthStatus("not json")).toEqual({ kind: "unreadable" });
    expect(classifyClaudeAuthStatus("null")).toEqual({ kind: "unreadable" });
  });
});
