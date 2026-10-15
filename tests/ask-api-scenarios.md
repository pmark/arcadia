# Conversational workspace: Ask API scenario suite

Run from the repository root:

```sh
pnpm exec vitest run tests/ask-api-scenarios.test.ts tests/ask-api-boundaries.test.ts tests/ask-trail.test.ts
pnpm exec eslint tests/ask-api-scenarios.test.ts tests/ask-api-boundaries.test.ts apps/dashboard/app/api/ask/route.ts apps/dashboard/lib/arcadia-cli.ts
```

## What is real

`ask-api-scenarios.test.ts` invokes the existing Next `POST /api/ask` and
`GET /api/ask/show?id=…` handlers with standard Request/Response objects. The
normal dashboard bridge spawns the **source CLI** and serializes its response;
real deterministic Ask classification, persistence and read-only trace queries
run against a fresh disposable workspace per test. No successful receipt is
stubbed. This tests route + bridge + CLI + database, without starting a Next
HTTP server or calling the operator's workspace, providers or production.

The scenarios prove:

- A Project-related request returns a nonempty reply derived from its actual
  result, stable capture/request/Ask IDs, and related Action/Plan IDs and status.
  Repeating the same request ID is ignored with the same capture and recovery
  guidance; reopening it returns the single original Ask and its records.
- The same receipt can be reopened using capture, request or Ask ID, including
  the original text, classification reason and related entities.
- A clarification exposes its Decision; a deferred idea exposes its Back Burner
  item. Neither lookup includes the other's outcomes.
- A fixture Run attached to an actual captured Action can be read while queued,
  running, awaiting review, and failed. Waiting reasons and current status stay
  visible. No artifact is fabricated while queued/running; an explicitly linked
  ready artifact becomes visible with its ID, status and evidence path. A second
  unlinked artifact does not leak into that Run.
- An unknown receipt returns a client error and accepted-identifier remedy.

Run state transitions and the ready SVG are **test fixture operations**, not
worker execution or generated work. The suite proves projection of real stored
state, not end-to-end Ask approval, scheduling, worker progress or successful
creation. Existing `tests/ask-trail.test.ts` adds promotion, approval-result,
partial-capture recovery and ambiguous historical-link regression coverage.

`ask-api-boundaries.test.ts` replaces only the subprocess seam to test faults
and scheduling deterministically: blank/nontext requests, missing IDs,
malformed/nonobject JSON, service errors with remedies, unexpected errors, and a
lookup completing while an unrelated submission is deliberately blocked. The
concurrency check uses an event-loop checkpoint, not a wall-clock latency SLA.
It cannot prove storage/process/worker independence under production load.

The dashboard trace type now reuses the authoritative core `AskTrailData`, so
Run/artifact evidence and partial-capture recovery fields are also visible to
typed UI consumers. Tests access those fields through the dashboard type.

Malformed JSON and nonobject bodies previously returned server errors. The
bounded accompanying route fix returns 400 before invoking intake; unexpected
service errors still return 500, and structured CLI status/details survive.

## Responsiveness evidence and limits

Each run prints every successful local submission/lookup duration in ms. Timing
includes handler work, real CLI startup, JSON serialization and local SQLite.
Fixture initialization is outside the measurement. The first sample is a cold-ish
source subprocess; later samples still spawn a new process but may benefit from
filesystem/transpilation caches. There is no controlled cold-cache benchmark.

Initial local sample, Node v22.23.1, macOS arm64: 13 successful operations took
959–1734 ms each (four submissions and nine lookups); three files/25 tests
passed in 19.90 s before adding retry/nonobject regressions. This is observation,
not a performance guarantee, statistically useful percentile, or production
measurement. The bridge defaults to source/tsx CLI; production's built CLI may
have a materially different startup cost. No fake timers or arbitrary default elapsed
time assertions are used. To gate a chosen local request budget explicitly:

```sh
ARCADIA_ASK_API_SUBMIT_BUDGET_MS=2500 ARCADIA_ASK_API_READ_BUDGET_MS=2000 pnpm exec vitest run tests/ask-api-scenarios.test.ts
```

Those example thresholds are illustrative test inputs, not recommendations
or a production SLA. Each successful request must meet its configured budget;
unset variables report timings only. Nonpositive/nonfinite values fail clearly.

Before choosing a UI latency budget, measure an authorized deployed server with
its actual CLI mode, concurrent readers/submissions and provider/worker load.
Record time to acknowledgement, first useful reply and subsequent status read
separately. Trigger that check when the preview/API deployment is available;
this suite does not authorize production traffic or lifecycle mutations.

## UI readiness boundaries

- Submission currently accepts text and request ID, not selected Project/Plan/
  Action IDs. A navigation selection alone does not prove routing context reaches
  Ask. The Project scenario names Arcadia in its text explicitly. Trigger a
  context-contract follow-up when implementing the scoped composer.
- Duplicate submission receipts return an ignored result with the existing capture,
  not the original Action/Plan payload. The UI must follow that capture through
  `ask/show` rather than interpreting missing fields as lost work.
- The synchronous POST exposes a durable receipt only after the CLI completes.
  A fast acknowledgement/poll token during a slow intake is not provided here.
  Decide that contract if measured submit latency exceeds the interaction budget.
- Trace IDs/status/evidence references are useful navigation inputs, not resolved
  UI URLs or proof an artifact is downloadable. Dedicated entity views and
  artifact delivery need their own route/access checks before UI release.
- The suite is not a full portfolio-tree contract, multimedia-ingress test,
  authentication test, browser rendering test or streaming conversation test.
  Add each at the point its first real MVP journey needs it.

## Validation receipt

- Lead rerun: `pnpm exec vitest run tests/ask-api-scenarios.test.ts tests/ask-api-boundaries.test.ts tests/ask-trail.test.ts` passed all 29 tests, exit 0, 27.55 s. Fourteen actual handler/source-CLI operations measured 1315–2299 ms, including subprocess startup. No live HTTP server or provider call was measured.
- Focused ESLint and core TypeScript checks passed. Full `pnpm build` passed, including repository lint, core compilation and Discord adapter compilation.
- `pnpm dashboard:build` passed compilation, lint/type validity and page generation after the core package was built. An earlier standalone dashboard typecheck before that build failed; its raw receipt is retained at `/tmp/arcadia-ask-api-dashboard-tsc.txt`. It is not the final build result.
- The optional read budget was checked with the invalid value zero: the selected scenario failed with the expected positive-finite configuration error. This is a deliberate negative check, not a passing latency target.
- Session-ledger validation and `git diff --check` passed. Current-head independent review and all required CI checks remain separate PR gates.
