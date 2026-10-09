import path from "node:path";
import { PROVIDER_ORDER, parseProviderList, runHeadlessProviderTest, type ProviderName } from "../src/operatorActions/headlessProviderTest.js";

// Entry point for the operator action test-headless-provider-single-action.
// Arguments: <run-directory> <run-id> <script-id> [--keep] [--providers codex,opencode,claude]
//            [--model-codex M] [--model-opencode M] [--model-claude M]
// Each flag has an environment equivalent for /runs, which passes no arguments: ARCADIA_HEADLESS_TEST_KEEP,
// ARCADIA_HEADLESS_TEST_PROVIDERS, ARCADIA_HEADLESS_TEST_MODEL_CODEX / _OPENCODE / _CLAUDE.
// Exit 0 when at least one provider passed; 2 for a usage error.
const usage = "usage: headless-provider-test.ts <run-directory> <run-id> <script-id> [--keep] [--providers codex,opencode,claude] [--model-codex M] [--model-opencode M] [--model-claude M]\n";
const [runDirectory, runId, scriptId, ...flags] = process.argv.slice(2);
if (!runDirectory || !runId || !scriptId) {
  process.stderr.write(usage);
  process.exit(2);
}

let keep = ["1", "true", "yes"].includes((process.env.ARCADIA_HEADLESS_TEST_KEEP ?? "").toLowerCase());
let providerText: string | undefined = process.env.ARCADIA_HEADLESS_TEST_PROVIDERS?.trim() || undefined;
const models: Partial<Record<ProviderName, string>> = {};
for (const provider of PROVIDER_ORDER) {
  const fromEnv = process.env[`ARCADIA_HEADLESS_TEST_MODEL_${provider.toUpperCase()}`]?.trim();
  if (fromEnv) models[provider] = fromEnv;
}
let providers: ProviderName[] | undefined;
try {
  for (let index = 0; index < flags.length; index += 1) {
    const [name, inline] = flags[index].split(/=(.*)/s, 2) as [string, string | undefined];
    const value = (): string => {
      const given = inline ?? flags[++index];
      if (given === undefined || given === "" || given.startsWith("--")) throw new Error(`${name} needs a value`);
      return given;
    };
    if (name === "--keep") keep = true;
    else if (name === "--providers") providerText = value();
    else if (PROVIDER_ORDER.some((provider) => name === `--model-${provider}`)) models[name.slice("--model-".length) as ProviderName] = value();
    else throw new Error(`unknown argument ${name}`);
  }
  providers = providerText ? parseProviderList(providerText) : undefined;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
  process.exit(2);
}

const timeout = Number(process.env.ARCADIA_HEADLESS_TEST_TIMEOUT_MS);
const outcome = await runHeadlessProviderTest({
  repoRoot: path.resolve(import.meta.dirname, ".."),
  runDirectory, runId, scriptId,
  keep,
  ...(providers ? { providers } : {}),
  ...(Object.keys(models).length > 0 ? { models } : {}),
  // The live-workspace snapshot is information only; tests turn it off so they never read a developer's live workspace.
  ...(process.env.ARCADIA_HEADLESS_TEST_LEAK_CHECK === "0" ? { liveLeakCheck: false } : {}),
  ...(Number.isFinite(timeout) && timeout > 0 ? { providerTimeoutMs: timeout } : {})
});
process.stdout.write(`Receipt: ${outcome.receiptPath}\n`);
process.exitCode = outcome.outcome === "succeeded" ? 0 : 1;
