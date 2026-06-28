# Decisions Needed

## LiteLLM Operating Assumption

Options:

- Use an externally managed local LiteLLM Proxy.
- Add a repo-managed local dev setup later.

Recommended default: externally managed local LiteLLM Proxy. It keeps this phase documentation and implementation local-first without adding Docker or runtime operations.

Impact of deferring: implementation can proceed with fake OpenAI-compatible tests and health/config hooks. Real local integration waits.

Can proceed safely: yes.

## Paid Fallback Default

Options:

- Deny paid fallback by default.
- Allow low-cost paid fallback by default for selected Projects.

Recommended default: deny paid fallback by default. Require explicit Project policy and, for early rollout, a Decision before paid execution.

Impact of deferring: implementation can proceed with local/fake/no-paid paths.

Can proceed safely: yes.

## Raw Prompt And Output Retention

Options:

- Store raw prompts/outputs as Artifacts when requested.
- Store only summaries and hashes by default.

Recommended default: store hashes and summaries by default; create Artifacts only for accepted structured outputs or explicit debug mode.

Impact of deferring: implementation can proceed with conservative storage and add retention options later.

Can proceed safely: yes.

## Companion App Ingress

Options:

- Use CLI JSON initially.
- Add a local HTTP adapter after the vertical slice.

Recommended default: CLI JSON initially. It matches existing dashboard and adapter patterns.

Impact of deferring: Rebuster integration remains out of scope, and the first slice remains testable.

Can proceed safely: yes.
