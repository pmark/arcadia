# Implementation Backlog

## First Implementation Mission

Mission 1 is the exact first implementation mission: add disabled-by-default Intelligence Gateway config loading and health reporting with no executor calls.

## Mission 1: Config And Health Skeleton

- Responsibility: Codex
- Objective: Add local config loading and `arcadia intelligence health --json`.
- Scope: config types, loader, command, CLI registration, tests.
- Likely files: `src/commands/intelligence.ts`, `src/cli.ts`, `src/workspace/paths.ts`, `tests/intelligence-gateway.test.ts`, optional default config docs.
- Acceptance criteria: command reports disabled/missing config/healthy fake config; secrets are not printed.
- Tests: unit tests for config parsing and CLI JSON.
- Risks: accidentally implying LiteLLM is installed.
- Non-goals: executor calls, migrations, dashboard UI.

## Mission 2: Capability Module And Migrations

- Responsibility: Codex
- Objective: Add `intelligence` capability module and metadata tables.
- Scope: module declaration, migrations, repository helpers.
- Likely files: `src/capabilities/intelligence/module.ts`, `src/capabilities/intelligence/repository.ts`, `src/capabilities/registry.ts`, tests.
- Acceptance criteria: initialized workspace has capability tables after database open; module appears in dashboard capabilities.
- Tests: migration/idempotency tests.
- Risks: schema churn.
- Non-goals: LiteLLM calls.

## Mission 3: Request Contract And Validator

- Responsibility: Codex
- Objective: Implement `structured_text.generate` request validation and `structured_text_list_v1` result validation.
- Scope: TypeScript types, parser, validator, fixtures.
- Likely files: `src/capabilities/intelligence/contracts.ts`, tests.
- Acceptance criteria: invalid requests/results fail before Artifact creation.
- Tests: unit tests with valid and invalid fixtures.
- Risks: overfitting to Rebuster.
- Non-goals: direct Rebuster integration.

## Mission 4: Policy Evaluator

- Responsibility: Codex
- Objective: Implement deterministic routing policy with dry-run result.
- Scope: policy config, Project overrides, executor class decision, denial reasons.
- Likely files: `src/capabilities/intelligence/policy.ts`, `config/defaults/*`, tests.
- Acceptance criteria: evaluation order is tested; paid fallback denial prevents executor call.
- Tests: policy unit tests.
- Risks: hidden behavior through overrides.
- Non-goals: provider routing.

## Mission 5: Request Submit With Fake Executor

- Responsibility: Codex
- Objective: Submit a request through policy and fake executor, then record accepted/failed metadata.
- Scope: command, repository writes, Artifact and Log creation.
- Likely files: `src/commands/intelligence.ts`, `src/capabilities/intelligence/actions.ts`, tests.
- Acceptance criteria: valid fake response creates request, execution, Artifact, event, and Log.
- Tests: temporary workspace integration tests.
- Risks: storing too much raw prompt data.
- Non-goals: LiteLLM HTTP.

## Mission 6: LiteLLM HTTP Adapter

- Responsibility: Codex
- Objective: Add OpenAI-compatible HTTP executor behind config.
- Scope: request translation, timeout, auth header, response parsing, usage capture.
- Likely files: `src/capabilities/intelligence/litellm.ts`, tests.
- Acceptance criteria: fake HTTP server proves success, failure, timeout, invalid result.
- Tests: fake server integration tests.
- Risks: leaking auth or provider payloads.
- Non-goals: installing LiteLLM.

## Mission 7: CLI List And Show

- Responsibility: Codex
- Objective: Add request inspection commands.
- Scope: `show`, `list`, filters, human renderers.
- Likely files: `src/commands/intelligence.ts`, `src/cli.ts`, tests.
- Acceptance criteria: operators can inspect policy, provenance, validation, Artifacts, and cost.
- Tests: CLI response tests.
- Risks: unstable JSON shape.
- Non-goals: dashboard changes.

## Mission 8: Dashboard Snapshot

- Responsibility: Codex
- Objective: Expose gateway health and recent Intelligence Request summaries.
- Scope: snapshot types, dashboard UI section.
- Likely files: `src/dashboard/snapshot.ts`, `apps/dashboard/lib/types.ts`, `apps/dashboard/components/dashboard-ui.tsx`, tests.
- Acceptance criteria: snapshot shows health, blocked requests, recent failures, high-cost work.
- Tests: dashboard snapshot test.
- Risks: turning dashboard into provider admin.
- Non-goals: prompt playground.

## Mission 9: Optional Local LiteLLM Validation

- Responsibility: Autonomous
- Objective: Document and test optional local LiteLLM verification path.
- Scope: docs, skipped-by-default integration test.
- Likely files: `docs/plans/arcadia-intelligence-gateway/`, `tests/intelligence-litellm.integration.test.ts`.
- Acceptance criteria: tests skip unless env vars are set; no paid credentials required.
- Tests: skipped default plus fake path.
- Risks: environment-specific failures.
- Non-goals: Docker or managed LiteLLM install.

## Mission 10: Companion App Contract Draft

- Responsibility: Needs Mark
- Objective: Decide the first companion-app ingress shape after the local slice works.
- Scope: adapter contract documentation only.
- Likely files: `docs/ADAPTER_CONTRACT.md`, possibly this plan package.
- Acceptance criteria: Mark approves whether CLI JSON is enough or a local HTTP adapter is needed.
- Tests: none until implementation.
- Risks: premature Rebuster coupling.
- Non-goals: Rebuster implementation.
