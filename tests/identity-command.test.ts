import { describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { renderIdentityResolveSuccess, runIdentityResolveCommand } from "../src/commands/identity.js";

describe("arcadia identity resolve", () => {
  it("resolves an identity directly from --tier without needing a model", () => {
    const response = runIdentityResolveCommand({ agent: "claude", tier: "standard" });
    expect(response.data).toEqual({
      agent: "claude",
      tier: "standard",
      name: "Claudia Mason",
      email: "claudia.mason@agents.arcadia.local",
      gitConfigArgs: ["-c", "user.name=Claudia Mason", "-c", "user.email=claudia.mason@agents.arcadia.local"]
    });
  });

  it("resolves an identity from a bundled model when no --tier is given", () => {
    const response = runIdentityResolveCommand({ agent: "claude", model: "opus", effort: null });
    expect(response.data.name).toBe("Claudia Atlas");
  });

  it("falls back to reasoning effort when the model does not resolve to a bundled tier", () => {
    const response = runIdentityResolveCommand({ agent: "codex", model: "some-custom-model", effort: "high" });
    expect(response.data.name).toBe("Cody Atlas");
  });

  it("refuses an unknown agent", () => {
    expect(() => runIdentityResolveCommand({ agent: "chatgpt", tier: "standard" })).toThrow(ArcadiaError);
  });

  it("refuses when neither --tier nor --model is given", () => {
    expect(() => runIdentityResolveCommand({ agent: "claude" })).toThrow(ArcadiaError);
  });

  it("renders a copy-pasteable git -c invocation", () => {
    const response = runIdentityResolveCommand({ agent: "claude", tier: "standard" });
    const lines = renderIdentityResolveSuccess(response);
    expect(lines[0]).toBe("Claudia Mason <claudia.mason@agents.arcadia.local>");
    expect(lines[1]).toBe('git -c user.name="Claudia Mason" -c user.email="claudia.mason@agents.arcadia.local" commit ...');
  });
});
