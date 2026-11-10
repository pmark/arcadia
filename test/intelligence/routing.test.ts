import { describe, expect, it } from "vitest";
import {
  buildDefaultRoutes,
  loadIntelligenceConfig,
} from "../../src/intelligence/config/defaults.js";
import type { IntelligenceRouteEntry } from "../../src/intelligence/config/types.js";
import { resolveIntelligenceRoute } from "../../src/intelligence/routing/resolveRoute.js";

describe("resolveIntelligenceRoute", () => {
  it("registers Claude Code text routes in the gateway defaults", () => {
    const config = loadIntelligenceConfig({});

    expect(config.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "arcadia.text.generate.local.fast.claude-code",
        executor: "claude-code-cli",
        requiresPaidUsage: false,
      }),
      expect.objectContaining({
        id: "arcadia.text.generate.local.standard.claude-code",
        executor: "claude-code-cli",
        requiresPaidUsage: false,
      }),
    ]));
    expect(config.claudeCodeCli?.command).toBe("claude");
  });

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

  it("selects Claude Code independently from local LLM and Codex", () => {
    const routes = buildDefaultRoutes({
      localTextRoute: "arcadia-default",
      codexTextRoute: "codex-cli",
      claudeCodeTextRoute: "claude-code-cli",
    });

    const resolution = resolveIntelligenceRoute(
      {
        capability: "text.generate",
        execution: "local-required",
        executionTarget: "claude-code",
        profile: "standard",
      },
      routes,
      { allowPaidUsage: false },
    );

    expect(resolution.ok && resolution.route.executor).toBe("claude-code-cli");
    expect(resolution.ok && resolution.route.routeId).toBe(
      "arcadia.text.generate.local.standard.claude-code",
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
      { allowPaidUsage: true, approvedPaidUsageDecisions: ["0126"] },
    );

    // No Decision is bound to the paid image route: refused even though the
    // request allows paid usage and an unrelated Decision is approved.
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe("paid_usage_not_allowed");
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

  it("resolves image generation and editing to the local ComfyUI route", () => {
    const routes = buildDefaultRoutes({ comfyUiImageRoute: "comfyui" });

    for (const capability of ["image.generate", "image.edit"] as const) {
      const resolution = resolveIntelligenceRoute(
        { capability, execution: "local-required", profile: "quality" },
        routes,
        { allowPaidUsage: false },
      );

      expect(resolution.ok).toBe(true);
      if (resolution.ok) {
        expect(resolution.route.executor).toBe("comfyui");
        expect(resolution.route.location).toBe("local");
      }
    }
  });

  it("keeps configured image backend route IDs unique", () => {
    const routes = buildDefaultRoutes({ codexImageRoute: "codex-cli", comfyUiImageRoute: "comfyui" });
    const ids = routes.map((route) => route.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("arcadia.image.generate.local.quality");
    expect(ids).toContain("arcadia.image.generate.local.quality.comfyui");
    expect(ids).toContain("arcadia.image.edit.local.quality.comfyui");
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

  describe("paid routes are refused unless an approved Decision is bound", () => {
    const request = {
      capability: "text.generate",
      execution: "cloud-required",
      profile: "fast",
    } as const;
    const paidRoute = (paidUsageDecision?: string) => [
      {
        id: "arcadia.text.generate.cloud.fast",
        capability: "text.generate" as const,
        location: "cloud" as const,
        profile: "fast" as const,
        liteLlmRoute: "cloud-text",
        enabled: true,
        requiresPaidUsage: true,
        ...(paidUsageDecision === undefined ? {} : { paidUsageDecision }),
      },
    ];

    it("gives paid_usage_not_allowed for allowPaidUsage true with no bound Decision", () => {
      const resolution = resolveIntelligenceRoute(request, paidRoute(), {
        allowPaidUsage: true,
        approvedPaidUsageDecisions: ["0126"],
      });
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) {
        expect(resolution.code).toBe("paid_usage_not_allowed");
      }
    });

    it("refuses when no approved list is supplied at all", () => {
      const resolution = resolveIntelligenceRoute(request, paidRoute("0126"), {
        allowPaidUsage: true,
      });
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.code).toBe("paid_usage_not_allowed");
    });

    it.each(["", "   ", "\t", "9999", " 0126", "0126 "])(
      "refuses bound Decision id %j that is empty, whitespace or not approved",
      (id) => {
        const resolution = resolveIntelligenceRoute(request, paidRoute(id), {
          allowPaidUsage: true,
          approvedPaidUsageDecisions: ["0126", "", "   "],
        });
        expect(resolution.ok).toBe(false);
        if (!resolution.ok) expect(resolution.code).toBe("paid_usage_not_allowed");
      },
    );

    it("still refuses a bound approved Decision when allowPaidUsage is false", () => {
      const resolution = resolveIntelligenceRoute(request, paidRoute("0126"), {
        allowPaidUsage: false,
        approvedPaidUsageDecisions: ["0126"],
      });
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.code).toBe("paid_usage_not_allowed");
    });

    it("resolves a paid route bound to an approved Decision", () => {
      const resolution = resolveIntelligenceRoute(request, paidRoute("0126"), {
        allowPaidUsage: true,
        approvedPaidUsageDecisions: ["0126"],
      });
      expect(resolution.ok).toBe(true);
    });

    it("leaves requiresPaidUsage false routes unaffected", () => {
      const routes = buildDefaultRoutes({ localTextRoute: "arcadia-default" });
      for (const options of [
        { allowPaidUsage: false },
        { allowPaidUsage: true },
        { allowPaidUsage: false, approvedPaidUsageDecisions: [] },
      ]) {
        const resolution = resolveIntelligenceRoute(
          { capability: "text.generate", execution: "local-required", profile: "fast" },
          routes,
          options,
        );
        expect(resolution.ok).toBe(true);
      }
    });

    it("keeps the PR TLDR route (cloud fast, Decision 0126) resolving as before", () => {
      const config = loadIntelligenceConfig({
        ARCADIA_LITELLM_CLOUD_TEXT_ROUTE: "arcadia-cloud-text",
      });
      const fast = config.routes.find((r) => r.id === "arcadia.text.generate.cloud.fast");
      expect(fast?.paidUsageDecision).toBe("0126");
      const resolution = resolveIntelligenceRoute(
        {
          capability: "text.generate",
          execution: "cloud-required",
          profile: "fast",
          executionTarget: "cloud",
        },
        config.routes,
        {
          allowPaidUsage: true,
          approvedPaidUsageDecisions: config.approvedPaidUsageDecisionIds,
        },
      );
      expect(resolution.ok).toBe(true);
      if (resolution.ok) {
        expect(resolution.route.routeId).toBe("arcadia.text.generate.cloud.fast");
        expect(resolution.route.liteLlmRoute).toBe("arcadia-cloud-text");
        expect(resolution.route.requiresPaidUsage).toBe(true);
      }
      // Only the fast route is bound; other cloud text profiles stay refused.
      for (const profile of ["standard", "quality"] as const) {
        const other = resolveIntelligenceRoute(
          { capability: "text.generate", execution: "cloud-required", profile },
          config.routes,
          {
            allowPaidUsage: true,
            approvedPaidUsageDecisions: config.approvedPaidUsageDecisionIds,
          },
        );
        expect(other.ok).toBe(false);
        if (!other.ok) expect(other.code).toBe("paid_usage_not_allowed");
      }
    });
  });
});
