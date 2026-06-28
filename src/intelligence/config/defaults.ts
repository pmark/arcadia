import type { IntelligenceV01Config } from "./types.js";

export const intelligenceV01Defaults: IntelligenceV01Config = {
  defaultLiteLlmRoute: "arcadia-default",
  liteLlmBaseUrl: "http://127.0.0.1:4000",
  allowPaidUsage: false,
  maxRetries: 1,
  databasePath: ".arcadia/intelligence.sqlite",
  workerPollIntervalMs: 500,
};
