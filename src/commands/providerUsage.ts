import { validationError } from "../cli/errors.js";
import { createSuccess } from "../cli/response.js";
import { readProviderUsage, type ProviderUsageDependencies } from "../codingAgents/providerUsage.js";
import type { ClaudeCredentialSource } from "../codingAgents/availability.js";

export async function runProviderUsageCommand(options: { refresh?: boolean; claudeSource?: string; opencodeSession?: string; opencodeExport?: string }, deps: ProviderUsageDependencies = {}) {
  if (options.opencodeSession !== undefined && options.opencodeExport !== undefined) {
    throw validationError("Choose either --opencode-session or --opencode-export.");
  }
  const source = options.claudeSource ?? "auto";
  if (!["auto", "environment", "file", "keychain"].includes(source)) {
    throw validationError("--claude-source must be auto, environment, file or keychain.");
  }
  return createSuccess({ command: "provider-usage", data: await readProviderUsage({
    refresh: options.refresh, claudeSource: source as ClaudeCredentialSource,
    opencodeSession: options.opencodeSession, opencodeExport: options.opencodeExport,
  }, deps), warnings: ["Diagnostic usage only; no production admission or worker credential-context proof. Explicit refresh makes at most one usage read per supported provider; no model call or credential change. Explicit OpenCode session/export reads contain only local token and reported model-cost telemetry; account allowance remains unknown."] });
}
