# Rollout And Operations

## Local Development Setup

1. Keep the feature disabled by default.
2. Add local config files with endpoint labels and environment variable names, not secrets.
3. Use a fake server for normal tests.
4. Use optional local LiteLLM only when explicitly configured.

## Secrets Handling

Provider credentials stay in LiteLLM or environment variables. Arcadia stores only references such as `LITELLM_ARCADIA_KEY`. Do not write secrets to SQLite, Artifacts, Logs, dashboard snapshots, or test fixtures.

## Health Checks

Health should report:

- feature enabled/disabled,
- config present/missing,
- endpoint reachable/unreachable,
- auth present/missing,
- alias availability when the endpoint supports it,
- last successful request,
- last failure summary.

## Diagnostics And Logs

Use Arcadia events for summaries and request records for durable metadata. Store correlation IDs and LiteLLM request IDs. Redact request bodies by default in diagnostics unless an Artifact is intentionally created.

## Budget Monitoring

Treat LiteLLM as budget enforcement. Arcadia should record reported usage/cost and show recent high-cost requests, denied paid fallback, and unknown-cost calls.

## Rollback

Rollback should be simple:

1. Disable the feature flag.
2. Remove or unset the LiteLLM auth reference.
3. Leave historical request metadata intact.
4. Revert CLI/dashboard exposure only if it causes operator confusion.

## Gradual Rollout

1. Disabled by default.
2. Enabled with fake executor only.
3. Enabled for one internal Arcadia Project with local LiteLLM.
4. Enabled for one non-critical Project.
5. Expose a local adapter contract for companion apps.
6. Consider future companion app use after validation and cost data are reliable.

## Operator Runbook

- Check `arcadia intelligence health --json`.
- If unhealthy, inspect local config and LiteLLM process status.
- If requests are denied, run `arcadia intelligence show <id> --json` and inspect policy reason.
- If costs are unexpected, disable the feature and inspect LiteLLM budgets/virtual keys.
- If validation fails, inspect the Artifact or output summary and contract version.
- If credentials are missing, set the environment variable or keep the request Needs Mark.
