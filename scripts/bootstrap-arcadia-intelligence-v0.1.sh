#!/usr/bin/env bash
set -euo pipefail

# Arcadia Intelligence v0.1 bootstrap
#
# Run from the Arcadia repository root:
#   bash scripts/bootstrap-arcadia-intelligence-v0.1.sh
#
# This script is intentionally domain-neutral.
# It does not know anything about Rebuster, MIDI Opener, blogging, or any
# companion-app-specific schemas.
#
# It is safe to re-run. Existing files are not overwritten unless --force is used.

FORCE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

if [[ ! -f "package.json" ]]; then
  echo "Error: run this from the Arcadia repository root containing package.json."
  exit 1
fi

if [[ ! -d ".git" ]]; then
  echo "Warning: .git was not found. Continuing, but verify you are at the repository root."
fi

if [[ -f "pnpm-lock.yaml" ]]; then
  PACKAGE_MANAGER="pnpm"
elif [[ -f "yarn.lock" ]]; then
  PACKAGE_MANAGER="yarn"
elif [[ -f "bun.lockb" || -f "bun.lock" ]]; then
  PACKAGE_MANAGER="bun"
else
  PACKAGE_MANAGER="npm"
fi

SOURCE_ROOT="src"
TEST_ROOT="test"
DOCS_ROOT="docs/intelligence"
INTELLIGENCE_ROOT="${SOURCE_ROOT}/intelligence"

if [[ ! -d "${SOURCE_ROOT}" ]]; then
  mkdir -p "${SOURCE_ROOT}"
fi

if [[ ! -d "${TEST_ROOT}" ]]; then
  mkdir -p "${TEST_ROOT}"
fi

write_file() {
  local path="$1"

  if [[ -f "${path}" && "${FORCE}" -ne 1 ]]; then
    echo "Skipping existing file: ${path}"
    return
  fi

  mkdir -p "$(dirname "${path}")"
  cat > "${path}"
  echo "Wrote: ${path}"
}

mkdir -p \
  "${INTELLIGENCE_ROOT}/api" \
  "${INTELLIGENCE_ROOT}/client" \
  "${INTELLIGENCE_ROOT}/config" \
  "${INTELLIGENCE_ROOT}/db" \
  "${INTELLIGENCE_ROOT}/jobs" \
  "${INTELLIGENCE_ROOT}/litellm" \
  "${INTELLIGENCE_ROOT}/validation" \
  "${INTELLIGENCE_ROOT}/service" \
  "${TEST_ROOT}/intelligence" \
  "${DOCS_ROOT}" \
  "scripts"

write_file "${INTELLIGENCE_ROOT}/types.ts" <<'EOF'
/**
 * Generic Arcadia Intelligence v0.1 contracts.
 *
 * These types intentionally contain no companion-app domain knowledge.
 * A companion app owns its own capability names, input payload, output schema,
 * template contents, and workflow state.
 */

export type IntelligenceJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type OutputContract = {
  /**
   * Companion-app-owned identifier, for example:
   * "rebuster.candidate-list.v1"
   * "another-app.content-draft.v1"
   */
  schemaId: string;

  /**
   * Companion-app-owned schema version.
   */
  schemaVersion: number;

  /**
   * JSON Schema document supplied by the client or resolved by a future registry.
   */
  jsonSchema: JsonValue;

  /**
   * Stable digest calculated by the client or service for provenance.
   */
  schemaHash?: string;
};

export type PromptTemplateRef = {
  /**
   * Companion-app-owned identifier.
   */
  id: string;

  /**
   * Immutable version or content hash.
   */
  version: string;

  /**
   * Optional source path, URL, or artifact reference for provenance.
   */
  sourceRef?: string;
};

export type ExecutionPolicy = {
  /**
   * v0.1 supports one configured LiteLLM route only.
   * This remains generic so a later policy engine can evolve without breaking clients.
   */
  allowedRoutes?: string[];

  /**
   * v0.1 default: false.
   * No automatic paid fallback should occur.
   */
  allowPaidUsage: boolean;

  /**
   * v0.1 default: 1.
   */
  maxRetries: number;

  /**
   * Optional upper bound supplied by the companion app.
   */
  maxCostUsd?: number;
};

export type IntelligenceRequest = {
  /**
   * Client-provided idempotency key.
   * Repeated submissions with the same key should return the same job.
   */
  idempotencyKey: string;

  /**
   * App-defined stable capability identifier.
   * Arcadia does not interpret its domain meaning.
   */
  capability: string;

  /**
   * App identity, for example "rebuster".
   */
  clientApp: string;

  /**
   * Arcadia project attribution.
   */
  projectId?: string;

  /**
   * Optional Arcadia mission attribution.
   */
  missionId?: string;

  /**
   * Arbitrary app-owned structured payload.
   */
  input: JsonValue;

  /**
   * App-owned output contract.
   */
  outputContract: OutputContract;

  /**
   * App-owned template identity and version.
   * The rendered prompt itself is not required in v0.1.
   */
  template: PromptTemplateRef;

  executionPolicy: ExecutionPolicy;
};

export type IntelligenceUsage = {
  modelRoute?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  measuredCostUsd?: number;
  durationMs?: number;
};

export type ValidationResult = {
  passed: boolean;
  errors?: string[];
};

export type IntelligenceJob = {
  id: string;
  status: IntelligenceJobStatus;

  request: IntelligenceRequest;

  selectedRoute?: string;

  result?: JsonValue;

  validation?: ValidationResult;

  usage?: IntelligenceUsage;

  error?: {
    code: string;
    message: string;
  };

  retryCount: number;

  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type SubmitIntelligenceRequestResponse = {
  job: IntelligenceJob;
  created: boolean;
};

export type RetryIntelligenceJobResponse = {
  job: IntelligenceJob;
};
EOF

write_file "${INTELLIGENCE_ROOT}/config/types.ts" <<'EOF'
export type IntelligenceV01Config = {
  /**
   * The single configured LiteLLM route allowed for v0.1.
   * Companion apps do not select providers or models.
   */
  defaultLiteLlmRoute: string;

  /**
   * LiteLLM proxy endpoint, usually localhost.
   */
  liteLlmBaseUrl: string;

  /**
   * v0.1 default should remain false.
   */
  allowPaidUsage: boolean;

  /**
   * v0.1 default should remain 1.
   */
  maxRetries: number;

  /**
   * Path or identifier for SQLite storage.
   * Codex should adapt this to existing Arcadia database conventions.
   */
  databasePath: string;

  /**
   * Job polling interval for the in-process worker.
   */
  workerPollIntervalMs: number;
};
EOF

write_file "${INTELLIGENCE_ROOT}/config/defaults.ts" <<'EOF'
import type { IntelligenceV01Config } from "./types.js";

export const intelligenceV01Defaults: IntelligenceV01Config = {
  defaultLiteLlmRoute: "arcadia-default",
  liteLlmBaseUrl: "http://127.0.0.1:4000",
  allowPaidUsage: false,
  maxRetries: 1,
  databasePath: ".arcadia/intelligence.sqlite",
  workerPollIntervalMs: 500,
};
EOF

write_file "${INTELLIGENCE_ROOT}/config/README.md" <<'EOF'
# Arcadia Intelligence Configuration

v0.1 intentionally supports one configured LiteLLM route.

Do not add provider-specific settings here.

The intended future configuration shape is:

- one local LiteLLM endpoint
- one approved route for generic structured generation
- paid fallback disabled
- one retry maximum
- SQLite-backed durable jobs

Codex should reconcile this configuration with Arcadia’s existing environment,
configuration, secrets, and database patterns before implementation.
EOF

write_file "${INTELLIGENCE_ROOT}/client/client.ts" <<'EOF'
import type {
  IntelligenceJob,
  IntelligenceRequest,
  RetryIntelligenceJobResponse,
  SubmitIntelligenceRequestResponse,
} from "../types.js";

export type ArcadiaIntelligenceClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export class ArcadiaIntelligenceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: ArcadiaIntelligenceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async submit(
    request: IntelligenceRequest,
  ): Promise<SubmitIntelligenceRequestResponse> {
    return this.request<SubmitIntelligenceRequestResponse>(
      "POST",
      "/api/intelligence/jobs",
      request,
    );
  }

  public async getJob(jobId: string): Promise<IntelligenceJob> {
    return this.request<IntelligenceJob>(
      "GET",
      `/api/intelligence/jobs/${encodeURIComponent(jobId)}`,
    );
  }

  public async retry(jobId: string): Promise<RetryIntelligenceJobResponse> {
    return this.request<RetryIntelligenceJobResponse>(
      "POST",
      `/api/intelligence/jobs/${encodeURIComponent(jobId)}/retry`,
    );
  }

  public async waitForCompletion(
    jobId: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<IntelligenceJob> {
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const startedAt = Date.now();

    while (true) {
      const job = await this.getJob(jobId);

      if (
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "blocked"
      ) {
        return job;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `Timed out waiting for Arcadia Intelligence job ${jobId}.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Arcadia Intelligence request failed: ${response.status} ${response.statusText}. ${text}`,
      );
    }

    return (await response.json()) as T;
  }
}
EOF

write_file "${INTELLIGENCE_ROOT}/client/index.ts" <<'EOF'
export { ArcadiaIntelligenceClient } from "./client.js";
export type { ArcadiaIntelligenceClientOptions } from "./client.js";
EOF

write_file "${INTELLIGENCE_ROOT}/db/repository.ts" <<'EOF'
import type {
  IntelligenceJob,
  IntelligenceRequest,
} from "../types.js";

/**
 * Storage seam only.
 *
 * Codex should implement this using Arcadia's existing SQLite access pattern.
 * Do not introduce a second ORM or a separate database unless the existing
 * repository structure makes that necessary.
 */
export interface IntelligenceJobRepository {
  findById(jobId: string): Promise<IntelligenceJob | undefined>;

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<IntelligenceJob | undefined>;

  createQueuedJob(request: IntelligenceRequest): Promise<IntelligenceJob>;

  claimNextQueuedJob(
    workerId: string,
    nowIso: string,
  ): Promise<IntelligenceJob | undefined>;

  completeJob(
    jobId: string,
    update: Pick<
      IntelligenceJob,
      "result" | "validation" | "usage" | "selectedRoute" | "completedAt"
    >,
  ): Promise<IntelligenceJob>;

  failJob(
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
  ): Promise<IntelligenceJob>;

  blockJob(
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
  ): Promise<IntelligenceJob>;

  retryJob(jobId: string, nowIso: string): Promise<IntelligenceJob>;
}
EOF

write_file "${INTELLIGENCE_ROOT}/db/migrations/001_intelligence_jobs.sql" <<'EOF'
-- Arcadia Intelligence v0.1
--
-- This is intentionally a starting point, not an instruction to introduce a
-- second database layer. Codex should adapt this migration to existing Arcadia
-- SQLite migration conventions.

CREATE TABLE IF NOT EXISTS intelligence_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,

  capability TEXT NOT NULL,
  client_app TEXT NOT NULL,
  project_id TEXT,
  mission_id TEXT,

  request_json TEXT NOT NULL,

  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'blocked')
  ),

  selected_route TEXT,

  result_json TEXT,
  validation_json TEXT,
  usage_json TEXT,

  error_code TEXT,
  error_message TEXT,

  retry_count INTEGER NOT NULL DEFAULT 0,

  lease_owner TEXT,
  lease_expires_at TEXT,

  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT NOT NULL
);
EOF

write_file "${INTELLIGENCE_ROOT}/db/README.md" <<'EOF'
# Database Notes

v0.1 needs one durable job table.

Keep all request payloads and results as JSON columns until real usage demonstrates
a need for separate request, artifact, policy, quota, or usage-ledger tables.

The worker must use a lease or equivalent claim mechanism so that process restarts
do not leave jobs permanently running.
EOF

write_file "${INTELLIGENCE_ROOT}/validation/validateOutput.ts" <<'EOF'
import type {
  JsonValue,
  OutputContract,
  ValidationResult,
} from "../types.js";

/**
 * Generic validation seam.
 *
 * v0.1 should validate model output against the companion-app-supplied JSON
 * Schema. Codex should select the smallest compatible JSON Schema validator
 * already used by Arcadia, or add one only if necessary.
 */
export async function validateOutput(
  _value: JsonValue,
  _contract: OutputContract,
): Promise<ValidationResult> {
  throw new Error(
    "Arcadia Intelligence output validation is not implemented yet. " +
      "Codex should wire this to a generic JSON Schema validator.",
  );
}
EOF

write_file "${INTELLIGENCE_ROOT}/litellm/client.ts" <<'EOF'
import type {
  IntelligenceRequest,
  IntelligenceUsage,
  JsonValue,
} from "../types.js";

export type LiteLlmExecutionResult = {
  output: JsonValue;
  usage?: IntelligenceUsage;
};

/**
 * Generic LiteLLM transport seam.
 *
 * This module must not know about companion-app domains, individual providers,
 * or provider SDKs. It should call the configured LiteLLM localhost endpoint.
 */
export interface LiteLlmClient {
  generateStructured(
    request: IntelligenceRequest,
    route: string,
  ): Promise<LiteLlmExecutionResult>;
}
EOF

write_file "${INTELLIGENCE_ROOT}/jobs/worker.ts" <<'EOF'
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
EOF

write_file "${INTELLIGENCE_ROOT}/api/routes.ts" <<'EOF'
/**
 * API seam for Arcadia Intelligence v0.1.
 *
 * Required endpoints:
 * - POST /api/intelligence/jobs
 * - GET /api/intelligence/jobs/:jobId
 * - POST /api/intelligence/jobs/:jobId/retry
 * - GET /api/intelligence/health
 *
 * Codex should implement this using the existing Arcadia HTTP framework or
 * Fastify if no stronger repository convention already exists.
 *
 * Do not add generic chat, provider, model-selection, admin, or prompt-playground
 * endpoints.
 */
export const intelligenceApiRoutes = {
  submitJob: "POST /api/intelligence/jobs",
  getJob: "GET /api/intelligence/jobs/:jobId",
  retryJob: "POST /api/intelligence/jobs/:jobId/retry",
  health: "GET /api/intelligence/health",
} as const;
EOF

write_file "${INTELLIGENCE_ROOT}/service/README.md" <<'EOF'
# Arcadia Intelligence v0.1 Service

The service is a generic local API and in-process worker.

It accepts app-defined structured generation requests and does not understand
their domain meaning.

The service owns:

- durable jobs
- route authorization
- one LiteLLM execution path
- result validation
- retry behavior
- generic status and error states

The service does not own:

- companion-app prompt content
- companion-app schemas
- companion-app workflow state
- provider-specific SDKs
- budgets, quotas, caching, image generation, Codex execution, or routing logic
  beyond the single configured LiteLLM route in v0.1.
EOF

write_file "${INTELLIGENCE_ROOT}/index.ts" <<'EOF'
export * from "./types.js";
export * from "./client/index.js";
export * from "./config/types.js";
export { intelligenceV01Defaults } from "./config/defaults.js";
EOF

write_file "${TEST_ROOT}/intelligence/contracts.test.ts" <<'EOF'
/**
 * Placeholder for Arcadia Intelligence v0.1 contract tests.
 *
 * Codex should adapt this to the repository's test framework.
 *
 * Minimum tests:
 * - generic request accepts arbitrary app-defined capability names
 * - generic request accepts arbitrary JSON input
 * - client does not contain companion-app domain assumptions
 * - status values remain stable
 * - execution policy defaults reject paid fallback
 */
export {};
EOF

write_file "${TEST_ROOT}/intelligence/e2e.test.ts" <<'EOF'
/**
 * Placeholder for Arcadia Intelligence v0.1 end-to-end tests.
 *
 * Codex should adapt this to the repository's test framework.
 *
 * Minimum end-to-end scenario:
 * 1. A synthetic companion app submits a generic structured generation request.
 * 2. The service persists a queued job.
 * 3. A fake LiteLLM transport returns JSON.
 * 4. Generic JSON Schema validation passes.
 * 5. The job becomes completed.
 * 6. The client retrieves the durable result.
 *
 * Also cover:
 * - LiteLLM unavailable -> blocked
 * - invalid result -> failed
 * - retry allowed once
 * - duplicate idempotency key returns existing job
 */
export {};
EOF

write_file "${DOCS_ROOT}/V0_1_SCOPE.md" <<'EOF'
# Arcadia Intelligence v0.1 Scope

## Purpose

Arcadia Intelligence v0.1 is a generic, local, SQLite-backed structured
generation service.

Any companion app can submit a structured request without Arcadia understanding
the app's domain.

## Included

- One generic structured generation request shape
- One generic output-contract shape
- One configured LiteLLM route
- SQLite-backed durable jobs
- In-process worker loop
- Generic JSON Schema validation
- Submit, status, retry, and health API endpoints
- Generic TypeScript client
- No paid fallback
- One retry maximum

## Explicitly excluded

- Rebuster-specific code
- MIDI Opener-specific code
- Blogging-specific code
- Codex CLI execution
- Multiple providers or model routes
- Automatic fallback
- Budgets and quotas
- Caching
- Image generation
- Prompt registry
- Artifact store beyond durable result JSON
- Dashboard UI
- Webhooks, streaming, and subscriptions
- Separate packages
- Redis, BullMQ, RabbitMQ, or distributed workers
- Microservices
- Generic chat endpoints
- Agent frameworks

## Architectural rule

Companion apps own:

- capability names
- input payloads
- JSON Schemas
- prompt templates
- domain validation beyond JSON Schema
- workflow state
- judgment and publishing

Arcadia Intelligence owns:

- durable job execution
- one approved model route
- generic validation
- status transitions
- retry behavior
- provenance fields
- operational errors

## v0.1 success criterion

A second hypothetical companion app can use the same Arcadia client and service
without requiring any Arcadia code changes for that app's domain concepts.
EOF

write_file "${DOCS_ROOT}/CODEX_HANDOFF.md" <<'EOF'
# Codex Handoff: Arcadia Intelligence v0.1

The bootstrap established a domain-neutral skeleton.

Your job is to inspect the existing Arcadia repository and implement the v0.1
vertical slice using repository conventions.

Do not rewrite this into packages, microservices, provider adapters, agent
frameworks, or a generalized AI platform.

## Required behavior

Implement a generic Arcadia Intelligence service that:

1. Accepts a companion-app-defined structured generation request.
2. Persists a durable SQLite job.
3. Uses a client-supplied idempotency key.
4. Runs an in-process worker with a restart-safe SQLite lease.
5. Sends the request through one configured LiteLLM route.
6. Validates output against the app-supplied JSON Schema.
7. Stores the validated result and generic provenance metadata in the job.
8. Returns queued, running, completed, failed, or blocked states.
9. Supports one retry maximum.
10. Blocks clearly when LiteLLM is unavailable.
11. Does not know anything about Rebuster or any other companion-app domain.
12. Does not automatically use paid fallback.

## Required API

- POST /api/intelligence/jobs
- GET /api/intelligence/jobs/:jobId
- POST /api/intelligence/jobs/:jobId/retry
- GET /api/intelligence/health

## Required client API

- submit(request)
- getJob(jobId)
- retry(jobId)
- waitForCompletion(jobId)

## Implementation constraints

- Prefer existing Arcadia server, database, migration, config, and test patterns.
- Use Fastify only if Arcadia does not already have an established compatible API pattern.
- Use SQLite as the source of truth.
- Use LiteLLM over localhost.
- Do not add provider SDKs.
- Do not add Codex execution yet.
- Do not add budgets, quotas, caching, artifact services, dashboards, or image support.
- Do not add a domain-specific capability registry.
- Do not embed any app-specific schema or prompt into Arcadia.

## Required tests

At minimum:

- submit creates one queued job
- duplicate idempotency key returns the same job
- worker moves queued -> running -> completed
- valid fake LiteLLM output completes the job
- invalid output fails validation
- unavailable LiteLLM blocks the job
- retry works once and rejects further retries
- a synthetic second app with unrelated capability/schema works unchanged
- client can poll until terminal status

## Deliverables

- Working implementation
- Database migration integrated with Arcadia conventions
- Configured LiteLLM client
- API route integration
- In-process worker lifecycle integration
- Test coverage
- Updated local development documentation
- Brief implementation report listing files changed, tests run, and deferred work
EOF

write_file "scripts/README-arcadia-intelligence-bootstrap.md" <<'EOF'
# Arcadia Intelligence Bootstrap

This scaffold creates a generic v0.1 foundation for Arcadia Intelligence.

Run:

    bash scripts/bootstrap-arcadia-intelligence-v0.1.sh

Use `--force` only when intentionally replacing generated scaffold files.

After running the bootstrap, give Codex:

    docs/intelligence/CODEX_HANDOFF.md

The bootstrap deliberately avoids installing packages or modifying existing server
entry points because Codex must first align the implementation with Arcadia's
actual repository conventions.
EOF

echo
echo "Arcadia Intelligence v0.1 bootstrap complete."
echo
echo "Detected package manager: ${PACKAGE_MANAGER}"
echo
echo "Next:"
echo "1. Review docs/intelligence/V0_1_SCOPE.md"
echo "2. Review docs/intelligence/CODEX_HANDOFF.md"
echo "3. Give Codex the handoff document and ask it to implement v0.1 using existing repo conventions."
echo
echo "No dependencies, provider credentials, server entry points, or existing Arcadia behavior were changed."