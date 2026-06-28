# Policy And Routing

## Deterministic Evaluation Order

Policy should evaluate in this order and record each decision:

1. Validate request shape, capability, Project, and output contract.
2. Resolve explicit Project policy overrides.
3. Check idempotency and cache.
4. Check disabled feature flag and capability allowlist.
5. Check approval gates: paid fallback, external service use, credentials, and premium tier.
6. Check local deterministic tools.
7. Check cached result.
8. Check local model availability.
9. Check included-plan or local executor eligibility.
10. Check low-cost cloud model through LiteLLM.
11. Check premium cloud model through LiteLLM.
12. Return Needs Mark when no compliant executor is available or approval is required.

This preserves Arcadia's execution preference:

1. deterministic local tools,
2. cached results,
3. local models,
4. approved included-plan or local executors where technically feasible,
5. low-cost cloud models,
6. premium cloud models,
7. Needs Mark.

## Allowed Executor Classes

- `deterministic_local_tool`
- `cache`
- `local_model`
- `external_gateway_cloud_model`
- `future_codex_style_executor`
- `needs_mark`

These classes are Arcadia policy labels. Provider and model names remain behind configuration.

## Paid Fallback Policy

Paid fallback must be denied unless all are true:

- The request cost policy allows paid execution.
- Project policy allows the requested quality tier.
- A configured budget remains available according to LiteLLM or local Arcadia policy cache.
- The executor health check is passing.
- Any required approval gate is approved.

If cost cannot be estimated and paid execution is required, route to Needs Mark unless Project policy explicitly permits unknown low-cost usage.

## Approval Gates

Use existing approval gate concepts where possible:

- `credentials_required` when LiteLLM authentication is missing.
- `financial_action` for paid fallback or premium tier.
- `production_data_access` if a request includes sensitive production data.

Do not hide approvals in config. If an override changes routing from local-only to paid, the request result should explain that policy caused the route.

## No Compliant Executor

When no compliant executor is available, create a denied or Needs Mark result with:

- requested capability,
- Project,
- policy version,
- evaluated executor classes,
- denial reason,
- next Action if human input can unblock it.

Do not silently retry with a more expensive model.

## Project Overrides

Project overrides should be explicit, inspectable config such as `config/intelligence-policy.json`. Overrides may allow or deny capabilities, quality tiers, paid fallback, and max cost. Overrides must not name provider keys or provider-specific models in companion-app requests.

## Acceptance Criteria

- The same request and config produce the same routing decision.
- A denied request records no executor call.
- Paid fallback never occurs without an explicit allow path.
- Missing LiteLLM config routes to Needs Mark or unavailable, not provider-specific errors.
- Policy decisions can be listed and inspected by Project.
