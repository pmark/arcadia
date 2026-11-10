---
arcadia: v1
type: plan
slug: guard-against-paid-usage
project: arcadia
status: draft
milestone: Guard against paid usage
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-10
actions:
  - id: build-arcadia-spend-check
    title: "Implement arcadia spend check: a pure assessSpendRisk(env, probes) library plus the CLI, reusing proveSubscriptionAuth, that never prints a secret value."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-build-arcadia-spend-check-2026-11-10c; no further action.
    expected_artifact: Evidence satisfying Agent Ask build-arcadia-spend-check
    clarification: clarified
    confidence: high
    source: Agent Ask plan-guard-against-paid-usage-20261109-b
    why: "Agents and scripts need one deterministic, local receipt for spend risk instead of reading banners, which caused the 2026-11-08 false alarm."
    acceptance_criteria:
      - arcadia spend check [--provider claude|codex|opencode|all] [--launch-env current|stripped] [--model <id>] --json prints verdict clear, risk or unknown with per-provider codes and exits 0, 3 or 4 respectively.
      - Table-driven fixtures cover each risk code from the report (api_key_in_launch_env, third_party_provider, api_key_helper, not_subscription_auth, extra_usage_enabled, purchased_credits_available, paid_model_route) with a risk verdict.
      - A fixture with claude.ai/firstParty auth, no billing variables, extra usage off and the banner text "Claude API" present gives clear (the false-alarm regression).
      - A missing claude binary gives unknown, and no output contains the fixture's secret sentinel value.
    depends_on: []
    decisions: []
    references: ["docs/reports/spend-safety-investigation-2026-11-09.md", "https://github.com/pmark/arcadia/issues/2373", "https://github.com/pmark/arcadia/issues/2375"]
  - id: enforce-spend-check-at-launch-and-admission
    title: "Enforce the spend check in production and relay: admission refuses paid, sign-in preflight uses assessSpendRisk, Session and relay launches strip billing variables, and start-run.sh P0 runs the check."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Enforce the spend check in production and relay: admission refuses paid, sign-in preflight uses assessSpendRisk, Session and relay launches strip billing variables, go --launch and the Intelligence CLI executors refuse on risk or unknown, and start-run.sh P0 runs the check."
    expected_artifact: Evidence satisfying Agent Ask enforce-spend-check-at-launch-and-admission
    clarification: clarified
    confidence: high
    source: Agent Ask amend-guard-against-paid-usage-review-r1-20261110
    why: "Today admission admits paid usage and launches inherit billing variables, so one environment change could bill unattended work."
    acceptance_criteria:
      - "tests/provider-capacity-admission.test.ts asserts a paid capacity policy gives admitted: false, including operator_config and attestation receipts whose policy is paid, and Codex purchased credits."
      - checkProviderSignIn uses assessSpendRisk, so a non-subscription auth method, a Codex login that is not ChatGPT, or a non-opencode-go/ OpenCode model refuses the launch, with a test for each.
      - A launch test with a fixture ANTHROPIC_API_KEY shows the argv carries env -u ANTHROPIC_API_KEY and the launch is refused on a risk or unknown verdict.
      - A relay renew test shows a risk verdict means no claim and no tmux launch.
      - go --launch and the Intelligence CLI executors refuse on a risk or unknown verdict, with a test for each.
      - scripts/start-run.sh P0 calls arcadia spend check --launch-env stripped and refuses on risk or unknown.
      - The PR records arcadia production status showing managed production Inactive on the head that merges.
    depends_on: [build-arcadia-spend-check]
    decisions: []
    references: ["docs/reports/spend-safety-investigation-2026-11-09.md", "https://github.com/pmark/arcadia/issues/2372", "https://github.com/pmark/arcadia/issues/2373", "https://github.com/pmark/arcadia/issues/2374"]
  - id: alert-on-verified-spend-risk-and-require-receipts
    title: Run the spend check on each liveness tick, page once per risk episode, send unknown to the digest only, and add the no-claims-without-a-receipt rule to shared guidance.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-alert-on-verified-spend-risk-2026-11-10; no further action.
    expected_artifact: Evidence satisfying Agent Ask alert-on-verified-spend-risk-and-require-receipts
    clarification: clarified
    confidence: high
    source: Agent Ask amend-guard-against-paid-usage-review-r1-20261110
    why: "Monitoring should alarm only on verified spend risk and never on banners, and agents need one rule for claiming or ruling out spend."
    acceptance_criteria:
      - A decideLiveness-style unit test shows clear to risk pages once, risk to risk is silent, risk to clear sends a recovery line, and unknown never pages.
      - "docs/agents-context.md and the regenerated AGENTS.md state that no agent may claim or rule out spend without an arcadia spend check receipt, and pnpm check:agent-guidance passes with size budgets intact."
      - The arcadia-signal skill states the same receipt rule in its .agents/skills and .claude/skills copies.
      - coordinator-handoff-design.md says "uses subscription allocation" where it said "spends money".
    depends_on: [build-arcadia-spend-check]
    decisions: []
    references: ["docs/reports/spend-safety-investigation-2026-11-09.md", "https://github.com/pmark/arcadia/issues/2375"]
  - id: pin-opencode-to-go-models
    title: Pin OpenCode to opencode-go/ models in the binding validator and helper briefs.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-pin-opencode-to-go-models-2026-11-10-r2; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-opencode-to-go-models
    clarification: clarified
    confidence: high
    source: Agent Ask plan-guard-against-paid-usage-20261109-b
    why: "Other OpenCode model prefixes route through paid providers."
    acceptance_criteria:
      - The binding validator refuses opencode/ and huggingface/ model ids and accepts opencode-go/ ids, with a test for each.
      - Helper brief guidance names opencode-go/ as the only allowed OpenCode prefix.
    depends_on: []
    decisions: []
    references: ["docs/reports/spend-safety-investigation-2026-11-09.md", "https://github.com/pmark/arcadia/issues/2377"]
  - id: refuse-paid-intelligence-routes-by-default
    title: "Make resolveRoute refuse every requiresPaidUsage route unless config names an approved Decision, and set action.advice to allowPaidUsage: false, following the operator's answer to the standing no-spend Decision."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-refuse-paid-intelligence-routes-by-default-20261110; no further action.
    expected_artifact: Evidence satisfying Agent Ask refuse-paid-intelligence-routes-by-default
    clarification: clarified
    confidence: high
    source: Agent Ask amend-guard-against-paid-usage-review-r1-20261110
    why: "Paid Intelligence routes can be enabled by config alone today, with no Decision behind them; whether 0126's PR TLDR route survives is the operator's Decision, never the builder's."
    acceptance_criteria:
      - "A resolveRoute test shows a paid route with allowPaidUsage: true and no bound Decision gives paid_usage_not_allowed."
      - A registry test shows no enrichment sets allowPaidUsage.
      - The PR TLDR route bound to Decision 0126 still resolves as before, with a test, and the PR changes no Decision document.
    depends_on: []
    decisions: []
    references: ["docs/reports/spend-safety-investigation-2026-11-09.md", "https://github.com/pmark/arcadia/issues/2376"]
questions: []
decisions: []
---

# Guard against paid usage

Created as an inactive draft from accepted Agent Ask plan-guard-against-paid-usage-20261109-b; creation changed no pointer. Current activation is recorded in frontmatter.
