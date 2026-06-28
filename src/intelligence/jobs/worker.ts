import type { IntelligenceV01Config } from "../config/types.js";
import type { IntelligenceJobRepository } from "../db/repository.js";
import type { LiteLlmClient } from "../litellm/client.js";

/**
 * v0.1 worker seam.
 *
 * Codex should implement:
 * - one in-process polling loop
 * - SQLite-backed job claiming with leases
 * - one configured LiteLLM route
 * - generic JSON Schema validation
 * - completed, failed, and blocked terminal states
 *
 * Do not add Redis, BullMQ, RabbitMQ, external workers, or multiple executors.
 */
export class IntelligenceWorker {
  public constructor(
    private readonly _repository: IntelligenceJobRepository,
    private readonly _liteLlmClient: LiteLlmClient,
    private readonly _config: IntelligenceV01Config,
  ) {}

  public async runOnce(): Promise<void> {
    throw new Error(
      "Arcadia Intelligence worker is not implemented yet. " +
        "Codex should implement the v0.1 durable job lifecycle here.",
    );
  }

  public start(): () => void {
    throw new Error(
      "Arcadia Intelligence worker start loop is not implemented yet.",
    );
  }
}
