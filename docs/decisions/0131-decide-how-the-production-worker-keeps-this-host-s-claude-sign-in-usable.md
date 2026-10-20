---
arcadia: v1
type: decision
id: "0131"
slug: decide-how-the-production-worker-keeps-this-host-s-claude-sign-in-usable
project: arcadia
status: approved
question: Decide how the production worker keeps this host's Claude sign-in usable through idle periods without the operator at the host, amending Decision 0130's read-only credential use.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Let the worker run the Claude CLI's own minimal call so the CLI refreshes its own sign-in
options:
  - label: Let the worker run the Claude CLI's own minimal call so the CLI refreshes its own sign-in
    consequence: "When the stored access token is rejected (usage read 401), the worker runs one bounded headless claude call at most once per 30 minutes: haiku, one turn, no tools, no MCP, no user settings or hooks, only a minimal allowlisted environment (never an API key, so it cannot bill one), stdin closed, killed after 60 seconds. It then retries the usage read once. The Claude CLI itself refreshes and rotates the keychain sign-in and stores the result; Arcadia never exchanges or writes a token. Each call uses a negligible amount of included Claude usage, counted in the 5-hour window. Residual risk: if one of your own Claude Code sessions refreshes at the same instant, the CLI's own cross-process handling decides; Arcadia cannot prove it never signs that session out. If the call fails, the launch is refused and you get one ping, as today. Unattended runs survive overnight and post-STOP idle with no host action."
    recommended: true
  - label: Give the worker a long-lived token from claude setup-token
    consequence: "A one-time host step by you creates a token valid for about a year, stored for the worker only. Your interactive sign-in is untouched. It is not yet verified that the usage endpoint accepts this inference-scoped token: if it does not, the capacity gate stays stale and runs remain blocked. It also needs you at the host once, which you are not today."
    recommended: false
  - label: Keep the read-only usage check and the one-time ping (today's behaviour)
    consequence: Nothing new touches the credential. Every idle stretch longer than the access token's life still blocks unattended launches until someone uses Claude Code on this host. While you are offsite, each such stall waits for your return, so 24/7 unattended production is not reachable on Claude.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-10-20
answer: Let the worker run the Claude CLI's own minimal call so the CLI refreshes its own sign-in
decided: 2026-10-20
---

# Decision 0131: Decide how the production worker keeps this host's Claude sign-in usable through idle periods without the operator at the host, amending Decision 0130's read-only credential use.

## Options

- **Let the worker run the Claude CLI's own minimal call so the CLI refreshes its own sign-in** (recommended): When the stored access token is rejected (usage read 401), the worker runs one bounded headless claude call at most once per 30 minutes: haiku, one turn, no tools, no MCP, no user settings or hooks, only a minimal allowlisted environment (never an API key, so it cannot bill one), stdin closed, killed after 60 seconds. It then retries the usage read once. The Claude CLI itself refreshes and rotates the keychain sign-in and stores the result; Arcadia never exchanges or writes a token. Each call uses a negligible amount of included Claude usage, counted in the 5-hour window. Residual risk: if one of your own Claude Code sessions refreshes at the same instant, the CLI's own cross-process handling decides; Arcadia cannot prove it never signs that session out. If the call fails, the launch is refused and you get one ping, as today. Unattended runs survive overnight and post-STOP idle with no host action.
- **Give the worker a long-lived token from claude setup-token**: A one-time host step by you creates a token valid for about a year, stored for the worker only. Your interactive sign-in is untouched. It is not yet verified that the usage endpoint accepts this inference-scoped token: if it does not, the capacity gate stays stale and runs remain blocked. It also needs you at the host once, which you are not today.
- **Keep the read-only usage check and the one-time ping (today's behaviour)**: Nothing new touches the credential. Every idle stretch longer than the access token's life still blocks unattended launches until someone uses Claude Code on this host. While you are offsite, each such stall waits for your return, so 24/7 unattended production is not reachable on Claude.

## Rationale

Issue #1616 (also #1559): only the Claude CLI refreshes and stores the OAuth tokens, and only when it makes an API call. The worker's usage read is read-only under Decision 0130, so after any idle stretch longer than the access token's life, every unattended launch is refused until someone uses Claude Code at the host. The operator is offsite, so they cannot take that host step. Seen at the 2026-10-20 RE-RUN press: Active but capacity_refused, last reading 05:25Z. claude auth status still reports loggedIn true and does not refresh. Supersedes proposal decide-worker-claude-cli-self-refresh-20261020: revised consequences after the independent review of PR #1618. Proven live 2026-10-20: one such call moved the usage read from 401 to ok.

Proposed by Agent Ask decide-worker-claude-cli-self-refresh-r2-20261020.
