# Phase 1 — Bounded Loop Primitive + Image Consumer

> Depends on the verdicts and conflicts in [00-findings-and-conflicts.md](./00-findings-and-conflicts.md).
> Specification only — not implemented.

## Scope

A durable, bounded **Loop**: submit a prompt, generate an image, evaluate the
result, record an iteration, optionally continue up to a max iteration count,
and terminate. The primitive:

- backs each iteration with one existing `intelligence_jobs` row (reuses the
  worker, lease, retry, and ComfyUI executor — no new execution engine);
- emits typed domain **events** on iteration/terminal transitions;
- accepts `submitLoopFeedback({ loopId, text, source })` from any local ingress
  (CLI first), where feedback arriving mid-iteration is drained by the **next**
  iteration.

**No Discord code.** This phase builds only the seam (events + feedback intake).

## Non-goals

- No Discord, no admin UI, no R2/Asset store (later phases).
- No true cancel of an in-flight generation (ComfyUI has no interrupt hook;
  stop takes effect between iterations — conflict **C4**).
- No multi-worker/distributed execution; the single in-process lease worker stays.
- No new provider SDKs; generation stays on the configured `comfyui` route.
- No promotion to a domain `Artifact` yet unless Q1/C10 pulls it in.

## Reuse vs. add

**Reuse as-is:**
- `intelligence_jobs` + `IntelligenceWorker` ([jobs/worker.ts](../../../src/intelligence/jobs/worker.ts))
  and `submitIntelligenceRequest` ([service/jobService.ts](../../../src/intelligence/service/jobService.ts))
  for each per-iteration generation.
- `createComfyUiImageExecutor` ([comfyui/imageExecutor.ts](../../../src/intelligence/comfyui/imageExecutor.ts))
  and `IntelligenceArtifactStore` ([artifacts/store.ts](../../../src/intelligence/artifacts/store.ts))
  for image bytes.
- The generic `events` table + `coreApi.emitEvent(EmitEventInput)` ([coreApi.ts:44](../../../src/capabilities/coreApi.ts)).
- Feedback storage shape from `review_feedback` / `ask_feedback`.
- CLI envelope `createSuccess`/`createFailure` ([cli/response.ts](../../../src/cli/response.ts)).
- `createId()`, `nowIso()` id/time helpers.

**Add:**
- Two tables: `playground_loops`, `playground_loop_iterations`, plus
  `playground_loop_feedback` (schema below).
- A `PlaygroundLoopController` that drives the iteration state machine.
- An **evaluator** seam (see Q1). Default: text-only evaluator via a `text.*`
  route. Vision evaluation is an explicit, separately-scoped extension.
- `submitLoopFeedback()` service function + a CLI command group
  `arcadia playground loop …`.
- `PLAYGROUND_*` error codes.

## Concrete types & schema

Naming follows conflict **C1** (Loop, not Run). Table columns follow the
existing `TEXT status CHECK(...)`, ISO-timestamp, cascade-FK conventions
(mirroring `intelligence_jobs`).

```sql
CREATE TABLE IF NOT EXISTS playground_loops (
  id                TEXT PRIMARY KEY,             -- createId("playgroundLoop")
  prompt            TEXT NOT NULL,
  client_app        TEXT NOT NULL,               -- ingress/app label, mirrors intelligence_jobs.client_app
  project_id        TEXT,                        -- optional Arcadia attribution
  max_iterations    INTEGER NOT NULL,            -- bounded loop cap
  status            TEXT NOT NULL CHECK (
    status IN ('running', 'completed', 'stopped', 'failed')
  ),
  stop_requested_at TEXT,                         -- set by a stop command; honored between iterations
  terminal_reason   TEXT,                         -- 'max_iterations' | 'accepted' | 'stopped' | 'error'
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS playground_loop_iterations (
  id                TEXT PRIMARY KEY,             -- createId("loopIteration")
  loop_id           TEXT NOT NULL,
  iteration_index   INTEGER NOT NULL,             -- 1-based
  intelligence_job_id TEXT,                        -- the generation job for this iteration
  effective_prompt  TEXT NOT NULL,               -- base prompt + folded-in feedback
  status            TEXT NOT NULL CHECK (
    status IN ('generating', 'evaluating', 'completed', 'failed', 'blocked')
  ),
  evaluation_score  REAL,                         -- optional, evaluator-defined
  evaluation_rationale TEXT,                       -- human-readable "why"
  error_code        TEXT,
  error_message     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (loop_id, iteration_index),
  FOREIGN KEY (loop_id) REFERENCES playground_loops(id) ON DELETE CASCADE,
  FOREIGN KEY (intelligence_job_id) REFERENCES intelligence_jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS playground_loop_feedback (
  id                TEXT PRIMARY KEY,             -- createId("loopFeedback")
  loop_id           TEXT NOT NULL,
  text              TEXT NOT NULL,
  source            TEXT NOT NULL,               -- ingress label: 'cli' | 'discord' | 'http' | 'admin'
  consumed_by_iteration_id TEXT,                  -- NULL until drained by an iteration
  created_at        TEXT NOT NULL,
  FOREIGN KEY (loop_id) REFERENCES playground_loops(id) ON DELETE CASCADE,
  FOREIGN KEY (consumed_by_iteration_id) REFERENCES playground_loop_iterations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_playground_loops_status ON playground_loops(status);
CREATE INDEX IF NOT EXISTS idx_playground_loop_iterations_loop ON playground_loop_iterations(loop_id);
CREATE INDEX IF NOT EXISTS idx_playground_loop_feedback_loop ON playground_loop_feedback(loop_id);
```

TypeScript contracts (mirroring `types.ts` / discriminated-result conventions):

```ts
export type PlaygroundLoopStatus = "running" | "completed" | "stopped" | "failed";
export type PlaygroundIterationStatus =
  | "generating" | "evaluating" | "completed" | "failed" | "blocked";
export type PlaygroundTerminalReason =
  | "max_iterations" | "accepted" | "stopped" | "error";

export interface PlaygroundLoop {
  id: string;
  prompt: string;
  clientApp: string;
  projectId?: string;
  maxIterations: number;
  status: PlaygroundLoopStatus;
  terminalReason?: PlaygroundTerminalReason;
  createdAt: string;
  updatedAt: string;
}

export interface PlaygroundLoopIteration {
  id: string;
  loopId: string;
  iterationIndex: number;
  intelligenceJobId?: string;
  effectivePrompt: string;
  status: PlaygroundIterationStatus;
  evaluation?: { score?: number; rationale?: string };
  artifacts: IntelligenceArtifactRecord[];   // reuse the real type from types.ts
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export interface SubmitLoopFeedbackInput {
  loopId: string;
  text: string;
  source: "cli" | "discord" | "http" | "admin";
}

// Evaluator seam — default impl is text-only (Q1). A vision impl is a separate,
// explicitly-scoped extension that also requires a multimodal transport.
export interface LoopEvaluator {
  evaluate(input: {
    loop: PlaygroundLoop;
    iteration: PlaygroundLoopIteration;
    artifacts: IntelligenceArtifactRecord[];
  }): Promise<{ score?: number; rationale: string; accept: boolean }>;
}
```

**Events** (reuse the generic `events` table, `source_module = "playground"`;
`event_type` values are the loop's typed vocabulary):

| `event_type` | Emitted when | Key `payload_json` fields |
|---|---|---|
| `playground.loop.started` | loop created | `loopId`, `prompt`, `maxIterations` |
| `playground.iteration.started` | iteration enters `generating` | `loopId`, `iterationId`, `iterationIndex`, `effectivePrompt` |
| `playground.iteration.completed` | iteration reaches `completed` | `loopId`, `iterationId`, `iterationIndex`, `artifactIds`, `evaluation` |
| `playground.iteration.failed` | iteration `failed`/`blocked` | `loopId`, `iterationId`, `error` |
| `playground.feedback.received` | `submitLoopFeedback` persists a row | `loopId`, `feedbackId`, `source` |
| `playground.loop.terminated` | loop reaches a terminal state | `loopId`, `status`, `terminalReason`, `iterationCount` |

## State transitions & terminal states

**Loop:** `running → { completed | stopped | failed }` (all three terminal).
- `completed` — evaluator returned `accept: true` (`terminal_reason='accepted'`)
  **or** `iteration_index` reached `max_iterations` (`terminal_reason='max_iterations'`).
- `stopped` — a stop request was honored between iterations (`terminal_reason='stopped'`).
- `failed` — an iteration terminated `failed` under the loop's failure policy
  (`terminal_reason='error'`).

**Iteration:** `generating → evaluating → completed`; or `→ failed`
(execution/validation error) / `→ blocked` (environment unavailable, e.g.
`COMFYUI_UNAVAILABLE`). `completed | failed | blocked` are terminal for an
iteration. Iteration terminal status is derived from the backing
`intelligence_jobs` terminal status (`completed` / `failed` / `blocked`) plus the
evaluation step.

**Controller loop (per iteration):** drain unconsumed feedback → check
`stop_requested_at` → build `effective_prompt` → submit generation
`intelligence_jobs` row → await terminal job status → run evaluator → record
iteration + emit events → decide continue/terminate. This is the forced shape
from conflict **C4**.

## Error codes

Per-module `PLAYGROUND_*` codes on typed `Error` subclasses (Intelligence-layer
convention, area 7). Follow the **blocked vs failed** rule.

| Code | Class of failure | Iteration status |
|---|---|---|
| `PLAYGROUND_LOOP_NOT_FOUND` | unknown `loopId` (service/CLI) | — |
| `PLAYGROUND_INVALID_MAX_ITERATIONS` | `max_iterations` ≤ 0 or above the cap | — (rejected at create) |
| `PLAYGROUND_LOOP_NOT_RUNNING` | feedback/stop on a terminal loop | — |
| `PLAYGROUND_GENERATION_BLOCKED` | backing job blocked (`COMFYUI_UNAVAILABLE`, …) | `blocked` |
| `PLAYGROUND_GENERATION_FAILED` | backing job failed (`COMFYUI_TIMEOUT`, `VALIDATION_FAILED`, …) | `failed` |
| `PLAYGROUND_EVALUATION_FAILED` | evaluator threw / unreachable route | `failed` |
| `PLAYGROUND_EVALUATION_UNSUPPORTED` | vision evaluator requested but transport/route missing (**C5**) | `blocked` |

Reuse — do not re-wrap — the backing job's `error.code` in `error_message` for
provenance.

## Test plan

Vitest, `test/intelligence/` conventions (temp-workspace SQLite, deterministic).

- **Unit — controller:** feedback drained by the *next* iteration only; stop
  honored between iterations, never mid-generation; `max_iterations` terminal;
  evaluator `accept:true` short-circuits; 1-based `iteration_index` monotonic and
  unique.
- **Unit — feedback service:** `submitLoopFeedback` on a terminal loop →
  `PLAYGROUND_LOOP_NOT_RUNNING`; unknown loop → `PLAYGROUND_LOOP_NOT_FOUND`;
  `source` label persisted verbatim.
- **Unit — events:** exactly one terminal `playground.loop.terminated` per loop;
  event payloads carry the documented keys; events land in `events` with
  `source_module="playground"`.
- **Integration — fake ComfyUI:** stub the ComfyUI HTTP endpoints (plain
  `node:http`, per the `api/server.ts:28` precedent) to exercise a full 3-iteration
  loop persisting real `intelligence_job_artifacts` under a temp workspace.
- **Integration — blocked path:** ComfyUI unreachable → iteration `blocked`,
  loop failure policy, no partial artifact left on disk.
- **Failure/idempotency:** resubmitting the same generation idempotency key does
  not double-create a job (reuses `submitIntelligenceRequest` behavior).

## Open questions (this phase)

- **Q1** (blocking): text-only vs vision evaluator (**C5**). Default assumed
  text-only; vision is a separate prerequisite.
- **Q4:** one `intelligence_jobs` row per iteration (assumed) vs direct executor call.
- **Q5:** feedback ingress CLI-only vs CLI+HTTP; confirm `source` is a label.
- **Q6:** is "stop between iterations" sufficient, or is true cancel required?
- **Loop failure policy:** does one `failed` iteration fail the whole loop, or
  does the loop continue to `max_iterations`? (Recommend: configurable, default
  continue-on-failure with the loop `failed` only if *all* iterations fail.)
- **C10:** should "keep this iteration" mint a domain `Artifact` now, or wait
  for Phase 3?
