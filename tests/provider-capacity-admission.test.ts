import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CodingAgentAvailabilityRecord,
  CodingAgentAvailabilitySnapshot
} from "../src/codingAgents/availability.js";
import {
  CAPACITY_ADMISSION_LIMITS,
  CAPACITY_MAX_REFRESH_ATTEMPTS,
  buildProviderCapacityReceipt,
  capacityRefreshBackoffMs,
  evaluateCapacityAdmission,
  nextCapacityCheckAt,
  observeProviderCapacity,
  recordOperatorCapacityReceipt,
  selectCapacityAdmittedCodingAgent,
  type CapacityAdmissionDecision,
  type OperatorCapacityReceiptStore
} from "../src/codingAgents/capacity.js";
import { ExecutionProfileUnsatisfiedError } from "../src/codingAgents/providerAdapters.js";
import { withDatabase } from "../src/db/connection.js";
import { parseExecutionRequirement } from "../src/execution/profiles.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import {
  activateProduction,
  fingerprintProductionScope,
  issueAdmission,
  normalizeProductionScope
} from "../src/production/policy.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import adapters from "../config/defaults/provider-adapters.json";

const NOW = new Date("2026-09-06T12:00:00.000Z");

const profiles: CodingAgentProfile[] = [
  profile("codex_planning", "codex-cli", "planning", "read-only"),
  profile("codex_build", "codex-cli", "build", "workspace-write"),
  profile("claude_planning", "claude-code-cli", "planning", "read-only"),
  profile("claude_build", "claude-code-cli", "build", "workspace-write")
];

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  delete process.env.ARCADIA_CAPACITY_RECEIPTS_PATH;
  delete process.env.ANTHROPIC_API_KEY;
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-capacity-"));
  temporary.push(directory);
  return directory;
}

function workspace(): string {
  const target = path.join(scratch(), "workspace");
  initWorkspace(target);
  return target;
}

function profile(
  name: string,
  provider: string,
  purpose: "planning" | "build",
  sandbox: CodingAgentProfile["sandbox"]
): CodingAgentProfile {
  return { name, provider, package: "test", command: name, purpose, sandbox, args: [] };
}

function resolvedRequirement(profileName: string) {
  const result = parseExecutionRequirement(
    { schema: "arcadia.execution/v1", profile: profileName },
    "agent"
  );
  if (!result.resolved) throw new Error(JSON.stringify(result.issues));
  return result.resolved;
}

function record(
  providerId: string,
  overrides: Partial<CodingAgentAvailabilityRecord> = {}
): CodingAgentAvailabilityRecord {
  return {
    provider: providerId,
    providerId,
    profiles: profiles.filter((entry) => entry.provider === providerId).map((entry) => entry.name),
    availability: "available",
    observedTasks: 0,
    usageLimitedTasks: 0,
    budgetLimitedTasks: 0,
    remainingTokens: null,
    resetAt: null,
    context: null,
    rateLimits: [{ label: "5h", usedPercentage: 20, resetsAt: "2026-09-06T15:00:00.000Z" }],
    credits: null,
    bankedResets: [],
    planScope: null,
    capturedAt: NOW.toISOString(),
    telemetry: "test observation",
    ...overrides
  };
}

function snapshot(records: CodingAgentAvailabilityRecord[]): CodingAgentAvailabilitySnapshot {
  return { generatedAt: NOW.toISOString(), agents: records };
}

function decisionFor(
  providerId: string,
  overrides: Partial<CodingAgentAvailabilityRecord> = {},
  now = NOW
): CapacityAdmissionDecision {
  return evaluateCapacityAdmission(
    buildProviderCapacityReceipt({ providerId, profiles, record: record(providerId, overrides), now }),
    now
  );
}

describe("the provider capacity receipt", () => {
  it("records the provider's own supported windows, source, age, reset, scope and usage policy", () => {
    const receipt = buildProviderCapacityReceipt({
      providerId: "codex-cli",
      profiles,
      record: record("codex-cli", {
        capturedAt: "2026-09-06T11:55:00.000Z",
        rateLimits: [
          { label: "5h", usedPercentage: 12.5, resetsAt: "2026-09-06T15:00:00.000Z" },
          { label: "7d", usedPercentage: 40, resetsAt: "2026-09-10T00:00:00.000Z" }
        ]
      }),
      now: NOW
    });

    expect(receipt).toMatchObject({
      version: 1,
      providerId: "codex-cli",
      source: "codex_app_server",
      accountScope: "Local Codex account signed in on this host",
      observedAt: "2026-09-06T11:55:00.000Z",
      observedAgeMs: 5 * 60_000,
      confidence: "observed",
      freshness: "fresh",
      usagePolicy: "included",
      nextResetAt: "2026-09-06T15:00:00.000Z"
    });
    expect(receipt.windows).toEqual([
      { label: "5h", usedPercentage: 12.5, remainingPercentage: 87.5, resetsAt: "2026-09-06T15:00:00.000Z" },
      { label: "7d", usedPercentage: 40, remainingPercentage: 60, resetsAt: "2026-09-10T00:00:00.000Z" }
    ]);
  });

  it("invents no comparable window and names what this host cannot report", () => {
    const receipt = buildProviderCapacityReceipt({
      providerId: "claude-code-cli",
      profiles,
      record: record("claude-code-cli", {
        rateLimits: [{ label: "5h", usedPercentage: 8, resetsAt: null }]
      }),
      now: NOW
    });

    expect(receipt.windows.map((window) => window.label)).toEqual(["5h"]);
    expect(receipt.unsupported).toContain("creditBalance");
    expect(receipt.unsupported).toContain("bankedResets");
  });

  it("separates included from paid rather than reducing both to one balance", () => {
    expect(decisionFor("claude-code-cli").receipt.usagePolicy).toBe("included");

    process.env.ANTHROPIC_API_KEY = "test-key";
    const paid = decisionFor("claude-code-cli");
    expect(paid.receipt.usagePolicy).toBe("paid");
    expect(paid.receipt.usagePolicyReason).toContain("API");
  });

  it("keeps purchased credits and banked resets separate from included allowance", () => {
    const receipt = buildProviderCapacityReceipt({
      providerId: "codex-cli",
      profiles,
      record: record("codex-cli", {
        credits: { hasCredits: false, unlimited: false, balance: "0" },
        bankedResets: [
          { id: "reset-1", status: "available", title: "Full reset", expiresAt: "2026-09-20T00:00:00.000Z" }
        ],
        planScope: "plus"
      }),
      now: NOW
    });

    expect(receipt.credits).toEqual({ hasCredits: false, unlimited: false, balance: "0" });
    expect(receipt.bankedResets).toHaveLength(1);
    expect(receipt.planScope).toBe("plus");
    expect(receipt.usagePolicy).toBe("included");
    expect(receipt.usagePolicyReason).toContain("plus");
    // Reported fields stop being listed as unsupported; the rest still are.
    expect(receipt.unsupported).not.toContain("creditBalance");
    expect(receipt.unsupported).not.toContain("bankedResets");
    expect(receipt.unsupported).toContain("accountIdentity");
  });

  it("names an available banked reset when exhausted, and refuses to redeem it", () => {
    const decision = decisionFor("codex-cli", {
      rateLimits: [{ label: "7d", usedPercentage: 100, resetsAt: "2026-09-12T00:00:00.000Z" }],
      bankedResets: [
        { id: "reset-1", status: "available", title: "Full reset", expiresAt: "2026-09-20T00:00:00.000Z" }
      ]
    });

    expect(decision).toMatchObject({ admitted: false, code: "capacity_exhausted" });
    expect(decision.reason).toContain("deliberately not redeemed");
  });

  it("stamps simulated evidence so a fixture never reads as real provider proof", () => {
    // The suite runs under VITEST, which is itself grounds for `simulated`.
    expect(decisionFor("codex-cli").receipt.evidence).toBe("simulated");
    const real = buildProviderCapacityReceipt({
      providerId: "codex-cli",
      profiles,
      record: record("codex-cli"),
      now: NOW,
      evidence: "real"
    });
    expect(real.evidence).toBe("real");
  });
});

describe("unattended admission refuses what it cannot prove", () => {
  it("refuses unknown capacity with a visible reason instead of assuming it is free", () => {
    const decision = decisionFor("codex-cli", { rateLimits: [], capturedAt: null });

    expect(decision).toMatchObject({ admitted: false, code: "capacity_unknown" });
    expect(decision.reason).toContain("never as unlimited or free");
  });

  it("refuses a stale observation past the freshness limit, and says what the host reported", () => {
    const decision = decisionFor("codex-cli", {
      capturedAt: new Date(NOW.getTime() - CAPACITY_ADMISSION_LIMITS.observationFreshnessMs - 1).toISOString(),
      rateLimits: [{ label: "5h", usedPercentage: 10, resetsAt: null }],
      telemetry: "no Codex credential was readable on this host"
    });

    expect(decision).toMatchObject({ admitted: false, code: "capacity_stale" });
    expect(decision.reason).toContain("freshness limit");
    // Why the observation is old is the actionable half; "wait" and "sign in
    // again" are different instructions and must not read the same.
    expect(decision.reason).toContain("no Codex credential was readable on this host");
  });

  it("refuses when included versus paid mode could not be established", () => {
    const decision = decisionFor("gemini-cli");

    expect(decision).toMatchObject({ admitted: false, code: "usage_policy_unknown" });
    expect(decision.reason).toContain("will not promise zero spend it cannot prove");
  });

  it("refuses a spent window and names the observed reset to wait for", () => {
    const decision = decisionFor("codex-cli", {
      rateLimits: [{ label: "5h", usedPercentage: 100, resetsAt: "2026-09-06T15:00:00.000Z" }]
    });

    expect(decision).toMatchObject({
      admitted: false,
      code: "capacity_exhausted",
      retryAfter: "2026-09-06T15:00:00.000Z"
    });
    expect(decision.reason).toContain("credits are never purchased");
  });

  it("stops new admission at the reserve margin so an admitted Run can finish", () => {
    const inside = decisionFor("codex-cli", {
      rateLimits: [{ label: "5h", usedPercentage: 96, resetsAt: "2026-09-06T15:00:00.000Z" }]
    });
    const outside = decisionFor("codex-cli", {
      rateLimits: [{ label: "5h", usedPercentage: 94, resetsAt: "2026-09-06T15:00:00.000Z" }]
    });

    expect(inside).toMatchObject({ admitted: false, code: "capacity_reserve_margin" });
    expect(outside.admitted).toBe(true);
  });
});

describe("resets readmit work only on fresh observation", () => {
  const exhausted = {
    capturedAt: "2026-09-06T11:00:00.000Z",
    rateLimits: [{ label: "5h", usedPercentage: 100, resetsAt: "2026-09-06T11:30:00.000Z" }]
  };

  it("treats an elapsed reset as staleness, never as renewed allowance", () => {
    const afterReset = decisionFor("codex-cli", exhausted, new Date("2026-09-06T11:45:00.000Z"));

    expect(afterReset).toMatchObject({
      admitted: false,
      code: "capacity_stale",
      refreshRequired: true
    });
    expect(afterReset.reason).toContain("An elapsed reset is not proof of renewed allowance");
  });

  it("readmits automatically once a fresh observation shows the renewed window", () => {
    const refreshed = decisionFor(
      "codex-cli",
      {
        capturedAt: "2026-09-06T11:44:00.000Z",
        rateLimits: [{ label: "5h", usedPercentage: 3, resetsAt: "2026-09-06T16:30:00.000Z" }]
      },
      new Date("2026-09-06T11:45:00.000Z")
    );

    expect(refreshed.admitted).toBe(true);
    expect(refreshed.unattendedProof).toBe(true);
  });

  it("points a waiting caller at the observed reset instead of a poll interval", () => {
    const waiting = decisionFor("codex-cli", {
      rateLimits: [{ label: "5h", usedPercentage: 100, resetsAt: "2026-09-06T15:00:00.000Z" }]
    });

    expect(nextCapacityCheckAt([waiting], NOW)).toBe("2026-09-06T15:00:00.000Z");
    expect(nextCapacityCheckAt([decisionFor("codex-cli")], NOW)).toBeNull();
  });
});

describe("refresh is bounded and spends no tokens", () => {
  it("caps attempts with a finite backoff schedule", () => {
    expect(CAPACITY_MAX_REFRESH_ATTEMPTS).toBe(CAPACITY_ADMISSION_LIMITS.refreshBackoffMs.length);
    expect(capacityRefreshBackoffMs(0)).toBe(1_000);
    expect(capacityRefreshBackoffMs(CAPACITY_MAX_REFRESH_ATTEMPTS)).toBeNull();
  });

  it("invokes no model: the capacity module reaches nothing that can call one", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/codingAgents/capacity.ts", import.meta.url)),
      "utf8"
    );
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);

    expect(imports.sort()).toEqual([
      "../intent/registries.js",
      "./adapters.js",
      "./availability.js",
      "./availability.js",
      "./providerAdapters.js",
      "./providerAdapters.js",
      "node:fs",
      "node:os",
      "node:path"
    ]);
    expect(imports.some((entry) => /intelligence|model|llm|openai|anthropic/i.test(entry))).toBe(false);
  });
});

describe("the operator attestation is admissible, bounded and labeled", () => {
  it("admits work while never claiming to be unattended proof", () => {
    process.env.ARCADIA_CAPACITY_RECEIPTS_PATH = path.join(scratch(), "receipts.json");
    recordOperatorCapacityReceipt({
      providerId: "gemini-cli",
      grantedBy: "operator",
      usagePolicy: "included",
      windows: [{ label: "daily", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
      ttlMs: 3_600_000,
      now: NOW
    });

    const observed = observeProviderCapacity(
      [...profiles, profile("gemini_build", "gemini-cli", "build", "workspace-write")],
      { now: NOW, snapshot: snapshot([]) }
    );
    const gemini = observed.providers.find((entry) => entry.providerId === "gemini-cli")!;

    expect(gemini.admitted).toBe(true);
    expect(gemini.unattendedProof).toBe(false);
    expect(gemini.receipt.source).toBe("operator_receipt");
    expect(gemini.reason).toContain("not proof of unattended operation");
  });

  it("caps the lifetime it can be written with, so it never becomes standing proof", () => {
    process.env.ARCADIA_CAPACITY_RECEIPTS_PATH = path.join(scratch(), "receipts.json");
    const receipt = recordOperatorCapacityReceipt({
      providerId: "gemini-cli",
      grantedBy: "operator",
      usagePolicy: "included",
      windows: [{ label: "daily", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
      ttlMs: 30 * 24 * 3_600_000,
      now: NOW
    });

    expect(Date.parse(receipt.expiresAt) - NOW.getTime())
      .toBe(CAPACITY_ADMISSION_LIMITS.operatorReceiptMaxTtlMs);
  });

  it("refuses once it has expired", () => {
    const store: OperatorCapacityReceiptStore = {
      version: 1,
      receipts: {
        "gemini-cli": {
          providerId: "gemini-cli",
          grantedBy: "operator",
          usagePolicy: "included",
          windows: [{ label: "daily", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
          note: null,
          recordedAt: "2026-09-06T06:00:00.000Z",
          expiresAt: "2026-09-06T10:00:00.000Z"
        }
      }
    };

    const observed = observeProviderCapacity(
      [profile("gemini_build", "gemini-cli", "build", "workspace-write")],
      { now: NOW, snapshot: snapshot([]), operatorReceipts: store }
    );

    expect(observed.providers[0]).toMatchObject({ admitted: false, code: "manual_receipt_expired" });
  });

  it("never talks over a live automatic observation", () => {
    const store: OperatorCapacityReceiptStore = {
      version: 1,
      receipts: {
        "codex-cli": {
          providerId: "codex-cli",
          grantedBy: "operator",
          usagePolicy: "included",
          windows: [{ label: "5h", usedPercentage: 1, remainingPercentage: 99, resetsAt: null }],
          note: null,
          recordedAt: NOW.toISOString(),
          expiresAt: "2026-09-06T16:00:00.000Z"
        }
      }
    };

    const observed = observeProviderCapacity(profiles, {
      now: NOW,
      snapshot: snapshot([record("codex-cli", {
        rateLimits: [{ label: "5h", usedPercentage: 100, resetsAt: "2026-09-06T15:00:00.000Z" }]
      })]),
      operatorReceipts: store
    });
    const codex = observed.providers.find((entry) => entry.providerId === "codex-cli")!;

    expect(codex.receipt.source).toBe("codex_app_server");
    expect(codex).toMatchObject({ admitted: false, code: "capacity_exhausted" });
  });
});

describe("selection runs after the admission filter", () => {
  const requirement = resolvedRequirement("routine_implementation");

  function availability(): CodingAgentAvailabilitySnapshot {
    return snapshot([record("codex-cli"), record("claude-code-cli")]);
  }

  it("moves to a different eligible configured provider when one is limited", () => {
    const capacity = [
      decisionFor("codex-cli", {
        rateLimits: [{ label: "5h", usedPercentage: 100, resetsAt: "2026-09-06T15:00:00.000Z" }]
      }),
      decisionFor("claude-code-cli")
    ];

    const selection = selectCapacityAdmittedCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement,
      purpose: "build",
      availability: availability(),
      capacity,
      preferredProvider: "codex-cli"
    });

    expect(selection.configuration.provider).toBe("claude-code-cli");
    expect(selection.capacity.admitted).toBe(true);
    expect(selection.substitution?.preferredProvider).toBe("codex-cli");
    expect(selection.substitution?.resumeGuidance).toContain("must not be replayed");
    expect(selection.refused["codex-cli"]).toContain("spent");
  });

  it("preserves the capability floor rather than substituting something weaker", () => {
    const capacity = [
      decisionFor("codex-cli", {
        rateLimits: [{ label: "5h", usedPercentage: 100, resetsAt: null }]
      }),
      decisionFor("claude-code-cli", {
        rateLimits: [{ label: "5h", usedPercentage: 100, resetsAt: null }]
      })
    ];

    expect(() => selectCapacityAdmittedCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement,
      purpose: "build",
      availability: availability(),
      capacity,
      preferredProvider: "codex-cli"
    })).toThrowError(ExecutionProfileUnsatisfiedError);
  });

  it("reports no substitution when the preferred provider still has capacity", () => {
    const selection = selectCapacityAdmittedCodingAgent({
      profiles,
      adapters: adapters as never,
      requirement,
      purpose: "build",
      availability: availability(),
      capacity: [decisionFor("codex-cli"), decisionFor("claude-code-cli")],
      preferredProvider: "codex-cli"
    });

    expect(selection.configuration.provider).toBe("codex-cli");
    expect(selection.substitution).toBeNull();
  });
});

describe("managed production admission requires proven capacity", () => {
  function activated(): string {
    const target = workspace();
    const scope = normalizeProductionScope({
      intent: "Finish the bootstrap Plan without a per-Action relay.",
      projects: ["demo"],
      plans: ["demo/queue-plan"],
      actions: ["demo/migrate"],
      providers: ["codex-cli", "claude-code-cli"],
      maxConcurrentSessions: 2,
      mechanicalTransitions: []
    });
    withDatabase(target, (db) =>
      activateProduction(db, {
        requestId: "grant-capacity",
        scope,
        scopeFingerprint: fingerprintProductionScope(scope),
        grantedBy: "operator"
      })
    );
    return target;
  }

  function admit(target: string, requestId: string, capacity: CapacityAdmissionDecision | undefined) {
    return withDatabase(target, (db) =>
      issueAdmission(db, {
        requestId,
        actionKey: "demo/migrate",
        projectSlug: "demo",
        planSlug: "queue-plan",
        provider: capacity?.providerId ?? "codex-cli",
        capacity: capacity as CapacityAdmissionDecision
      })
    );
  }

  it("refuses an admission carrying no capacity decision at all", () => {
    const outcome = admit(activated(), "adm-no-capacity", undefined);

    expect(outcome).toMatchObject({ admitted: false, code: "capacity_unproven" });
    expect(outcome.admitted).toBe(false);
  });

  it("refuses capacity proven for a different provider than the one that would run", () => {
    const outcome = withDatabase(activated(), (db) =>
      issueAdmission(db, {
        requestId: "adm-mismatch",
        actionKey: "demo/migrate",
        projectSlug: "demo",
        planSlug: "queue-plan",
        provider: "claude-code-cli",
        capacity: decisionFor("codex-cli")
      })
    );

    expect(outcome).toMatchObject({ admitted: false, code: "capacity_unproven" });
  });

  it("surfaces the capacity reason verbatim when capacity refused the provider", () => {
    const refused = decisionFor("codex-cli", { rateLimits: [], capturedAt: null });
    const outcome = admit(activated(), "adm-refused", refused);

    expect(outcome).toMatchObject({ admitted: false, code: "capacity_refused" });
    expect(outcome.admitted === false && outcome.reason).toBe(refused.reason);
  });

  it("admits in-scope work once capacity is proven for that provider", () => {
    const outcome = admit(activated(), "adm-proven", decisionFor("codex-cli"));

    expect(outcome.admitted).toBe(true);
  });
});
