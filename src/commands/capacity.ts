import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import {
  CAPACITY_ADMISSION_LIMITS,
  nextCapacityCheckAt,
  observeProviderCapacity,
  recordOperatorCapacityReceipt,
  refreshProviderCapacity,
  type CapacityAdmissionDecision,
  type CapacityWindow,
  type OperatorCapacityReceipt,
  type ProviderCapacityObservation
} from "../codingAgents/capacity.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";

export interface CapacityStatusOptions {
  workspace: string;
  refresh?: boolean;
  now?: Date;
}

export interface CapacityStatusData {
  observation: ProviderCapacityObservation;
  admittedProviders: string[];
  nextCheckAt: string | null;
  refresh: { attempted: boolean; attempts: number; elapsedMs: number; withinDeadline: boolean } | null;
  limits: typeof CAPACITY_ADMISSION_LIMITS;
}

export interface CapacityAttestOptions {
  workspace: string;
  provider: string;
  grantedBy: string;
  usagePolicy?: string;
  window?: string[];
  hours?: string;
  note?: string;
  now?: Date;
}

export interface CapacityAttestData {
  receipt: OperatorCapacityReceipt;
  unattendedProof: false;
}

/**
 * Read what each configured provider will tell this host about its own
 * allowance, and show the admission decision that follows. `--refresh` is the
 * only path that touches the network, and it refreshes observations only — no
 * governed state changes here, and no model is invoked to poll a quota.
 */
export async function runCapacityStatusCommand(
  options: CapacityStatusOptions
): Promise<CommandSuccess<CapacityStatusData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const registries = loadPhase3Registries(workspacePath);
  validatePhase3Registries(registries);
  const profiles = registries.codingAgents.profiles;
  const now = options.now ?? new Date();

  const refreshed = options.refresh
    ? await refreshProviderCapacity(profiles, { now })
    : null;
  const observation = refreshed?.observation ?? observeProviderCapacity(profiles, { now });

  const warnings: string[] = [];
  for (const decision of observation.providers) {
    if (!decision.admitted) warnings.push(decision.reason);
    else if (!decision.unattendedProof) warnings.push(decision.reason);
    if (decision.receipt.evidence === "simulated") {
      warnings.push(
        `${decision.receipt.providerLabel} capacity is SIMULATED on this run and is not proof of real provider behavior.`
      );
    }
  }
  if (refreshed && !refreshed.withinDeadline) {
    warnings.push(
      `Capacity refresh took ${refreshed.elapsedMs}ms, past the ${CAPACITY_ADMISSION_LIMITS.refreshDeadlineMs}ms deadline.`
    );
  }

  return createSuccess({
    command: "production.capacity",
    workspace: workspacePath,
    data: {
      observation,
      admittedProviders: observation.providers
        .filter((decision) => decision.admitted)
        .map((decision) => decision.providerId),
      nextCheckAt: nextCapacityCheckAt(observation.providers, now),
      refresh: refreshed
        ? {
            attempted: refreshed.attempted,
            attempts: refreshed.attempts,
            elapsedMs: refreshed.elapsedMs,
            withinDeadline: refreshed.withinDeadline
          }
        : null,
      limits: CAPACITY_ADMISSION_LIMITS
    },
    warnings
  });
}

/**
 * Record a bounded operator attestation for a provider this host cannot observe
 * automatically. It is an honest fallback and nothing more: it expires, it is
 * labeled attended everywhere it appears, and it never becomes proof that
 * unattended operation was demonstrated.
 */
export function runCapacityAttestCommand(
  options: CapacityAttestOptions
): CommandSuccess<CapacityAttestData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (!options.provider?.trim()) {
    throw validationError("An attestation needs --provider naming the coding-agent provider.", {
      field: "provider"
    });
  }
  if (!options.grantedBy?.trim()) {
    throw validationError("An attestation needs --granted-by naming who confirmed the capacity.", {
      field: "grantedBy"
    });
  }
  const usagePolicy = options.usagePolicy ?? "included";
  if (usagePolicy !== "included" && usagePolicy !== "paid") {
    throw validationError(
      "--usage-policy must be included or paid. Unknown usage is a refusal, not something to attest.",
      { field: "usagePolicy", value: usagePolicy }
    );
  }

  const hours = options.hours === undefined ? 1 : Number(options.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw validationError("--hours must be a positive number of hours.", {
      field: "hours",
      value: options.hours
    });
  }
  const requestedTtlMs = hours * 3_600_000;

  const windows = (options.window ?? []).map(parseWindow);
  if (windows.length === 0) {
    throw validationError(
      "An attestation needs at least one --window <label>:<usedPercent>[:<resetsAtIso>] " +
        "naming a window the provider actually reports.",
      { field: "window" }
    );
  }

  const receipt = recordOperatorCapacityReceipt({
    providerId: options.provider.trim(),
    grantedBy: options.grantedBy.trim(),
    usagePolicy,
    windows,
    ttlMs: requestedTtlMs,
    note: options.note ?? null,
    now: options.now
  });

  const warnings = [
    "This is an attended operator attestation. It is admissible and bounded; it is not proof of unattended operation."
  ];
  if (requestedTtlMs > CAPACITY_ADMISSION_LIMITS.operatorReceiptMaxTtlMs) {
    warnings.push(
      `Requested ${hours}h was capped at ${CAPACITY_ADMISSION_LIMITS.operatorReceiptMaxTtlMs / 3_600_000}h; ` +
        "an attestation never becomes standing proof."
    );
  }

  return createSuccess({
    command: "production.capacity.attest",
    workspace: workspacePath,
    data: { receipt, unattendedProof: false },
    warnings
  });
}

export function renderCapacityStatusSuccess(
  response: CommandSuccess<CapacityStatusData>
): string[] {
  const { observation, nextCheckAt, refresh } = response.data;
  const lines = ["Provider capacity admission", `  Observed: ${observation.generatedAt}`];
  if (observation.providers.some((decision) => decision.receipt.evidence === "simulated")) {
    lines.push("  SIMULATED capacity is present below and is not proof of real provider behavior.");
  }
  if (refresh) {
    lines.push(`  Refresh: ${refresh.attempts} attempt(s) in ${refresh.elapsedMs}ms`);
  }

  for (const decision of observation.providers) {
    lines.push("", `  ${decision.receipt.providerLabel} (${decision.providerId})`);
    lines.push(`    Admission: ${describeAdmission(decision)}`);
    lines.push(`    Reason: ${decision.reason}`);
    lines.push(`    Evidence: ${decision.receipt.evidence.toUpperCase()} via ${decision.receipt.source}`);
    lines.push(`    Account scope: ${decision.receipt.accountScope}`);
    lines.push(
      `    Usage policy: ${decision.receipt.usagePolicy} — ${decision.receipt.usagePolicyReason}`
    );
    lines.push(
      `    Observed: ${decision.receipt.observedAt ?? "never"} ` +
        `(${decision.receipt.freshness}, confidence ${decision.receipt.confidence})`
    );
    if (decision.receipt.windows.length > 0) {
      lines.push("    Windows:");
      for (const window of decision.receipt.windows) {
        lines.push(
          `      ${window.label}: ${window.usedPercentage}% used, resets ${window.resetsAt ?? "unknown"}`
        );
      }
    } else {
      lines.push("    Windows: none reported");
    }
    if (decision.receipt.planScope) {
      lines.push(`    Plan: ${decision.receipt.planScope}`);
    }
    if (decision.receipt.credits) {
      lines.push(
        `    Purchased credits: balance ${decision.receipt.credits.balance ?? "unknown"}` +
          `${decision.receipt.credits.unlimited ? " (unlimited)" : ""} — separate from included allowance, never spent here`
      );
    }
    if (decision.receipt.bankedResets.length > 0) {
      lines.push(`    Banked resets (never redeemed):`);
      for (const reset of decision.receipt.bankedResets) {
        lines.push(`      ${reset.status}: ${reset.title ?? reset.id}, expires ${reset.expiresAt ?? "unknown"}`);
      }
    }
    lines.push(`    Unsupported here: ${decision.receipt.unsupported.join(", ") || "none"}`);
  }

  lines.push("", `  Admitted providers: ${response.data.admittedProviders.join(", ") || "none"}`);
  lines.push(`  Next capacity check: ${nextCheckAt ?? "on the next refresh"}`);
  return lines;
}

export function renderCapacityAttestSuccess(
  response: CommandSuccess<CapacityAttestData>
): string[] {
  const { receipt } = response.data;
  return [
    `Recorded an attended capacity attestation for ${receipt.providerId}.`,
    `  Granted by: ${receipt.grantedBy}`,
    `  Usage policy: ${receipt.usagePolicy}`,
    `  Windows: ${receipt.windows.map((window) => `${window.label} ${window.usedPercentage}%`).join(", ")}`,
    `  Valid: ${receipt.recordedAt} → ${receipt.expiresAt}`,
    "  This is attended evidence. It admits work and expires; it is not unattended proof."
  ];
}

function describeAdmission(decision: CapacityAdmissionDecision): string {
  if (!decision.admitted) return `REFUSED (${decision.code})`;
  return decision.unattendedProof ? "admitted (unattended proof)" : "admitted (attended attestation)";
}

/** `<label>:<usedPercent>[:<resetsAtIso>]`, using the provider's own window label. */
function parseWindow(raw: string): CapacityWindow {
  // The reset timestamp is ISO and carries its own colons, so only the first
  // two separators are field boundaries.
  const match = /^([^:]+):([^:]+)(?::(.+))?$/.exec(raw.trim());
  const label = match?.[1];
  const usedPercentage = Number(match?.[2]);
  const resetsAt = match?.[3];
  if (!label?.trim() || !Number.isFinite(usedPercentage) || usedPercentage < 0 || usedPercentage > 100) {
    throw validationError(
      `--window must be <label>:<usedPercent>[:<resetsAtIso>] with a percentage from 0 to 100: ${raw}`,
      { field: "window", value: raw }
    );
  }
  if (resetsAt && !Number.isFinite(Date.parse(resetsAt))) {
    throw validationError(`--window reset time must be an ISO timestamp: ${resetsAt}`, {
      field: "window",
      value: raw
    });
  }
  return {
    label: label.trim(),
    usedPercentage,
    remainingPercentage: Math.round((100 - usedPercentage) * 100) / 100,
    resetsAt: resetsAt ?? null
  };
}
