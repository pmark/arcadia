import { describe, expect, it } from "vitest";
import { buildDefaultRoutes } from "../../src/intelligence/config/defaults.js";
import type { IntelligenceRouteEntry } from "../../src/intelligence/config/types.js";
import { resolveIntelligenceRoute } from "../../src/intelligence/routing/resolveRoute.js";

describe("resolveIntelligenceRoute", () => {
  it("resolves text.generate + local-required + fast to its configured local route", () => {
    const routes = buildDefaultRoutes({ localTextRoute: "arcadia-default" });

    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "local-required", profile: "fast" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.route.liteLlmRoute).toBe("arcadia-default");
      expect(resolution.route.routeId).toBe("arcadia.text.generate.local.fast");
      expect(resolution.route.location).toBe("local");
    }
  });

  it("resolves text.generate + local-preferred + standard locally when configured", () => {
    const routes = buildDefaultRoutes({ localTextRoute: "arcadia-default" });

    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "local-preferred", profile: "standard" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.route.liteLlmRoute).toBe("arcadia-default");
      expect(resolution.route.location).toBe("local");
    }
  });

  it("selects local LLM and Codex independently when both are configured", () => {
    const routes = buildDefaultRoutes({
      localTextRoute: "arcadia-default",
      codexTextRoute: "codex-cli",
    });

    const local = resolveIntelligenceRoute(
      {
        capability: "text.generate",
        execution: "local-required",
        executionTarget: "local",
        profile: "fast",
      },
      routes,
      { allowPaidUsage: false },
    );
    const codex = resolveIntelligenceRoute(
      {
        capability: "text.generate",
        execution: "local-required",
        executionTarget: "codex",
        profile: "fast",
      },
      routes,
      { allowPaidUsage: false },
    );

    expect(local.ok && local.route.executor).toBe("litellm");
    expect(codex.ok && codex.route.executor).toBe("codex-cli");
    expect(codex.ok && codex.route.routeId).toBe(
      "arcadia.text.generate.local.fast.codex",
    );
  });

  it("does not escalate text.generate + local-preferred + standard to cloud when local is absent", () => {
    const routes = buildDefaultRoutes({ cloudTextRoute: "arcadia-cloud" }); // no local route

    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "local-preferred", profile: "standard" },
      routes,
      { allowPaidUsage: true },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("local_route_unavailable");
      expect(resolution.message).not.toMatch(/arcadia-cloud/);
      expect(resolution.alternatives).toContainEqual({
        capability: "text.generate",
        execution: "cloud-required",
        profile: "standard",
      });
    }
  });

  it("resolves image.generate + cloud-required + quality to its configured cloud route", () => {
    const routes = buildDefaultRoutes({ cloudImageRoute: "arcadia-image" });

    const resolution = resolveIntelligenceRoute(
      { capability: "image.generate", execution: "cloud-required", profile: "quality" },
      routes,
      { allowPaidUsage: true },
    );

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.route.liteLlmRoute).toBe("arcadia-image");
      expect(resolution.route.location).toBe("cloud");
      expect(resolution.route.requiresPaidUsage).toBe(true);
    }
  });

  it("resolves image.generate + local-required + quality to Codex CLI when configured", () => {
    const routes = buildDefaultRoutes({ codexImageRoute: "codex-cli" });

    const resolution = resolveIntelligenceRoute(
      { capability: "image.generate", execution: "local-required", profile: "quality" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.route.routeId).toBe("arcadia.image.generate.local.quality");
      expect(resolution.route.location).toBe("local");
      expect(resolution.route.executor).toBe("codex-cli");
      expect(resolution.route.requiresPaidUsage).toBe(false);
    }
  });

  it("fails cloud-required when paid usage is disallowed and the route requires paid use", () => {
    const routes = buildDefaultRoutes({ cloudTextRoute: "arcadia-cloud" });

    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "cloud-required", profile: "standard" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("paid_usage_not_allowed");
    }
  });

  it("fails local-required when only cloud routes exist", () => {
    const routes = buildDefaultRoutes({ cloudTextRoute: "arcadia-cloud" });

    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "local-required", profile: "standard" },
      routes,
      { allowPaidUsage: true },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("local_route_unavailable");
      expect(resolution.alternatives).toContainEqual({
        capability: "text.generate",
        execution: "cloud-required",
        profile: "standard",
      });
    }
  });

  it("resolves audio.speech.generate + local-required + standard to its configured local speech route", () => {
    const routes = buildDefaultRoutes({ localSpeechRoute: "arcadia-speech" });

    const resolution = resolveIntelligenceRoute(
      { capability: "audio.speech.generate", execution: "local-required", profile: "standard" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.route.routeId).toBe("arcadia.audio.speech.generate.local.standard");
      expect(resolution.route.location).toBe("local");
      expect(resolution.route.executor).toBe("speech");
      expect(resolution.route.requiresPaidUsage).toBe(false);
      expect(resolution.route.liteLlmRoute).toBe("arcadia-speech");
    }
  });

  it("resolves audio.speech.generate with an explicit local executionTarget to the speech executor", () => {
    const routes = buildDefaultRoutes({ localSpeechRoute: "arcadia-speech" });

    const resolution = resolveIntelligenceRoute(
      {
        capability: "audio.speech.generate",
        execution: "local-required",
        executionTarget: "local",
        profile: "standard",
      },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok && resolution.route.executor).toBe("speech");
  });

  it("fails audio.speech.generate with route_not_configured when no speech route exists", () => {
    const routes = buildDefaultRoutes({ localTextRoute: "arcadia-default" });

    const resolution = resolveIntelligenceRoute(
      { capability: "audio.speech.generate", execution: "local-required", profile: "standard" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("route_not_configured");
    }
  });

  it("never escalates audio.speech.generate + local-preferred to a configured cloud speech route", () => {
    const routes = buildDefaultRoutes({ cloudSpeechRoute: "arcadia-cloud-speech" }); // no local speech route

    const resolution = resolveIntelligenceRoute(
      { capability: "audio.speech.generate", execution: "local-preferred", profile: "standard" },
      routes,
      { allowPaidUsage: true },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("local_route_unavailable");
      expect(resolution.message).not.toMatch(/arcadia-cloud-speech/);
      expect(resolution.alternatives).toContainEqual({
        capability: "audio.speech.generate",
        execution: "cloud-required",
        profile: "standard",
      });
    }
  });

  it("gates a cloud speech route behind paid-usage authorization", () => {
    const routes = buildDefaultRoutes({ cloudSpeechRoute: "arcadia-cloud-speech" });

    const resolution = resolveIntelligenceRoute(
      { capability: "audio.speech.generate", execution: "cloud-required", profile: "standard" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("paid_usage_not_allowed");
    }
  });

  it("fails with route_not_configured when the capability has no entries at all", () => {
    const routes = buildDefaultRoutes({ localTextRoute: "arcadia-default" });

    const resolution = resolveIntelligenceRoute(
      { capability: "audio.transcribe", execution: "local-preferred", profile: "standard" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("route_not_configured");
      expect(resolution.alternatives).toBeUndefined();
    }
  });

  it("fails with route_disabled when the matching entry is disabled", () => {
    const routes: IntelligenceRouteEntry[] = buildDefaultRoutes({
      localTextRoute: "arcadia-default",
    }).map((route) =>
      route.profile === "fast" ? { ...route, enabled: false } : route,
    );

    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "local-required", profile: "fast" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("route_disabled");
    }
  });

  it("never includes the literal LiteLLM alias or provider name in a failure message", () => {
    const routes = buildDefaultRoutes({
      localTextRoute: "arcadia-default",
      cloudTextRoute: "arcadia-cloud",
    });

    const resolution = resolveIntelligenceRoute(
      { capability: "text.generate", execution: "cloud-required", profile: "standard" },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.message).not.toMatch(/arcadia-cloud|gpt|openai/i);
    }
  });
});
