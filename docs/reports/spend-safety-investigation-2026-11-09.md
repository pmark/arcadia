# Spend-safety investigation, 2026-11-09

Investigator: Mira (`arcadia-release-investigator`), a bounded read-only helper
under Signal 3. This is evidence and a plan only. It changes no code, grants no
authority and settles nothing.

Operator request, verbatim (2026-11-09): "I appreciate that safeguards around
spending, truly, but let's improve reliability in order to ensure no
unauthorized spending happens (and none is or will be authorized indefinitely),
and false alarms are rare or eliminated."

**Spend** here means money billed beyond a fixed subscription. That includes API
keys, Claude extra usage or usage credits, purchased Codex credits,
pay-as-you-go gateways and paid cloud model routes. Drawing on a weekly or
5-hour subscription allocation (Claude Max, ChatGPT/Codex, OpenCode Go) is
**usage**, not spend.

## Summary

1. **One spend path is live today.** The operator's Claude account has extra
   usage turned on (`~/.claude.json` → `oauthAccount.hasExtraUsageEnabled: true`,
   `billingType: stripe_subscription`). The installed CLI's own text says that
   with extra usage on, "paid extra usage covers the overflow (nothing will be
   cut off)". Any Claude Code session can therefore bill money once the plan
   window runs out, and no Arcadia guard covers that. Sessions include worker
   Sessions, interactive coordinators and helpers, subagents and cloud
   sessions. Only the operator can turn it off.
2. **The production gates would admit paid usage if a key appeared.**
   Capacity admission refuses `unknown` but admits `paid`. The sign-in gate
   checks only `loggedIn`. Launch environments are inherited, not stripped. No
   key is present today (verified below), so this is latent, not active.
3. **Tonight's alarm was a false positive.** Claude Code's plan label falls back
   to the literal "Claude API" whenever the process can't read a subscription
   type. Nobody had a deterministic check to run instead of reading the banner,
   and the counter-check didn't run in the pane's own environment.

## Path inventory

Severity: **Critical** means money can be billed today with no guard.
**High** means a latent path where one environment change would bill through
production gates. **Medium** means latent, needing a configuration change or a
deliberate click. **Low** means a guard exists or exposure is minimal.

| # | Path | Can it spend? | Current guard (evidence) | Gap | Severity |
|---|------|---------------|--------------------------|-----|----------|
| 1 | Claude account extra usage (overage), every Claude Code session | **Yes, today.** `hasExtraUsageEnabled: true`. CLI v2.1.311 strings: "Now using extra usage" and "overageStatus allowed … means paid extra usage covers the overflow". | Admission refuses a *new* unattended launch at ≥100% window use (`src/codingAgents/capacity.ts:497-509`). Nothing else. | Running Sessions, interactive coordinators, helpers, subagents and cloud sessions cross the window into paid overflow. Arcadia's usage read (`src/codingAgents/availability.ts:11`) drops the extra-usage block, so Claude `credits` is always `null` (`~/.arcadia/telemetry/coding-agent-usage.json`). | **Critical** |
| 2 | Worker Claude Sessions launched with `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | Yes, if a key reaches the launch environment. In `--print` mode Claude Code uses an API key from the environment. | `scripts/start-run.sh:643` refuses `ANTHROPIC_API_KEY` in the *executor's own* environment only, not the worker's. Capacity labels the provider `paid` (`capacity.ts:768-775`), but admission then admits it: only `unknown` is refused (`capacity.ts:490-495`, admit at `:526`). The sign-in gate reads only `loggedIn` (`src/codingAgents/signIn.ts:150-160, 204-208`). The Session `env` reset unsets operator variables only (`src/sessions/index.ts:1456-1459, 1492`). Verified now: worker and Intelligence plists set only `PATH`, `HOME` and `NODE_PATH`; the running worker (pid 74213) and Intelligence (pid 34649) carry no billing variables; `launchctl getenv` is empty for all four names. | Paid is admitted, not refused. No auth-method check. Billing variables aren't stripped by construction. `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, Bedrock, Vertex and `apiKeyHelper` aren't checked anywhere except the reviewer route. | **High** (latent) |
| 3 | Relay `arcadia coordinator renew` (#2250) | Yes, under the same conditions as #2, plus user settings. | Gates are `checkProviderSignIn` (only `loggedIn`) and capacity (admits `paid`) (`src/commands/coordinator.ts:299-305`, `src/coordinator/relay.ts:253-262`). The launch is `env` with additive variables only, so the child inherits the tmux server's environment (`relay.ts:285-291`). Nothing triggers it automatically yet (#2286). | Same as #2. Also, `~/.claude.json` `customApiKeyResponses.approved` holds 1 entry, so an interactive session would use that approved key without asking if it were exported. | **High** (latent; live once the tick is wired) |
| 4 | Ad hoc tmux, Terminal or desktop launches by agents (Signal, Rowan and helpers; the 2026-11-08 phone test) | Yes, through #1 always, and through an inherited key. | Guidance and memory only. No Arcadia gate. | No check runs before launch, and none runs in the pane's environment. | **Medium** |
| 5 | Codex Sessions (worker, reviewer, Intelligence `codex-cli` route) | Yes, with an API-key login or purchased credits. | `checkCodexSignIn` treats any exit 0 as signed in, including an API-key login (`signIn.ts:52-66`). Policy is `paid` only when no windows exist *and* `OPENAI_API_KEY` is set (`capacity.ts:784-798`). The Scout admission refuses paid usage and credits (`src/scout/runAdmission.ts:251, 263`); production admission does neither. Today: `codex login status` says "Logged in using ChatGPT"; credits `hasCredits: false`, balance 0. | Login method isn't checked. Purchased credits aren't refused. | **Medium** (latent) |
| 6 | OpenCode (Decision 0202 helpers, production binding `opencode-zen`) | Yes. `opencode auth list` shows two stored credentials, "OpenCode Go" (subscription) and "OpenCode" (Zen, pay-as-you-go), plus `HF_TOKEN` from the environment. | Production refuses OpenCode as `usage_policy_unknown` (`capacity.ts:490`). The binding pins `opencode-go/deepseek-v4.1-flash` (workspace `config/provider-adapters.json`). `checkProviderSignIn` returns `null` for OpenCode (`signIn.ts:39-43`). | Nothing enforces the `opencode-go/` prefix, so a helper choosing an `opencode/…` (Zen) or Hugging Face model would bill money. No auth check. | **Medium** |
| 7 | Intelligence paid cloud routes through LiteLLM (dashboard) | Yes, if a cloud route is configured. LiteLLM holds a live OpenAI provider key with no budget or fallback settings. | `resolveRoute` refuses a `requiresPaidUsage` route unless the request sets `allowPaidUsage` (`src/intelligence/routing/resolveRoute.ts:101-109`). Callers that set it: PR TLDR (`apps/dashboard/lib/pull-request-summary.ts:43-50`, Decision 0126), "action advice" (`apps/dashboard/lib/enrichment/registry.ts:150-155`, **no Decision found**) and the request form's paid checkbox (`apps/dashboard/components/intelligence/request-form.tsx:92-117`). Cloud routes exist only when `ARCADIA_LITELLM_CLOUD_*_ROUTE` is set (`src/intelligence/config/defaults.ts`, `resolveConfig`); verified unset in the running service. | One environment variable re-enables click-to-spend, including a paid caller no Decision covers. Decision 0126 is a standing paid authorization that conflicts with "none authorized indefinitely". | **Medium** (latent) |
| 8 | Direct LiteLLM callers that bypass Arcadia's router | Yes, for any client holding the proxy key. | None in the proxy: no `max_budget`, no spend limit (`litellm_config.docker.yaml` `general_settings`). | The paid-route gate lives only in Arcadia's router. Details are in the private hand-back, not in this public report. | **Medium** |
| 9 | Intelligence CLI text executors (`claude-code-cli`, `codex-cli` routes) | Through #1, and through an inherited key. | `spawn` inherits the whole service environment (`src/intelligence/claudeCode/textExecutor.ts:238`, `src/intelligence/codex/textExecutor.ts:225`). The service plist sets only `PATH` and `HOME` (verified). | No auth check and no environment allowlist. | **Low** |
| 10 | Independent reviewer route and the CLI self-refresh | Through #1 only. | Environment allowlists (`src/qa/prReview.ts:2489-2516`; `src/production/capacityPreAdmission.ts:44-59`) and `--setting-sources`. The reviewer replay proves subscription auth (`src/qa/reviewerReplay.ts:325-344`). | None beyond #1. **Reuse this as the model.** | **Low** |
| 11 | Worker Claude usage diagnostics (Decisions 0137–0199) | Through #1 only (one Haiku turn). | Environment allowlist, one-shot grants. | None beyond #1. | **Low** |
| 12 | Cloud sessions (Claude Code on the web, routines, ultra review, Codex cloud) | Through #1 only. Codex credits are 0. | Guidance only ("helpers run on host"). | None beyond #1. | **Low** |
| 13 | CI and GitHub Actions | No. The repository is public, has no repository secrets or variables, and `ci.yml` and `blog.yml` make no model calls. | Not needed. | None. | **None** |
| 14 | "Paid fallback" and "credential probe" (AGENTS.md) | Only as #2 or #3. | Capacity text says paid fallback is never enabled (`capacity.ts:503-506`); relay provider fallback is off (`docs/agent-guidance/coordinator-handoff-design.md:410-412`). | Admitting `paid` is a de facto paid fallback when a key is present. Same fix as #2. | (covered by #2) |

## False-alarm root cause

**Symptom.** On 2026-11-08 at 21:28Z, a tmux-launched `claude --remote-control`
pane showed "Opus 5.5 · Claude API". Signal 3 raised a spend alarm. Signal 4
ran `claude auth status`, which reported `authMethod: claude.ai` and
`apiProvider: firstParty`, and found no `ANTHROPIC_API_KEY` (#2316; Signal 4
log 21:28Z and 21:36Z).

**Causal chain (fact, from the installed CLI v2.1.311).** The banner's plan
label is

```
switch (subscriptionType) { case "enterprise": … case "team": … case "max": "Claude Max";
                            case "pro": "Claude Pro"; default: "Claude API" }
```

and `subscriptionType` is `null` when the process has no stored OAuth profile
with a plan. It is also `null` when `CLAUDE_CODE_OAUTH_TOKEN` (a long-lived
token) is in its environment, since `GL()` returns false for that token. The
desktop's provider table also maps first-party Anthropic to the display string
"Claude API". **"Claude API" is the label's fallback and the first-party
provider name. It isn't evidence of API billing.** This session, run with the
same binary, reports `subscriptionType: max`.

**Contributing causes.**

- No shared deterministic check existed, so an agent reasoned from a banner. The
  only subscription-proof code is private to the reviewer replay
  (`reviewerReplay.ts:325-344`).
- The counter-check ran in Signal 4's shell, not in the pane's environment. A
  tmux pane inherits the tmux *server's* environment, so even the "all clear"
  wasn't strictly a statement about the pane. Composition, not components.
- Vocabulary mixes usage with money. `coordinator-handoff-design.md:447` says
  launching sessions "spends money", and `:709` says probes "spend tokens".
  The status line's `cost.total_cost_usd` (for example `0.27` in
  `~/.arcadia/telemetry/claude-code.json`) is a notional per-session figure, not
  a bill.
- The all clear was itself incomplete. With extra usage on (#1), a
  subscription session *can* bill money, so "subscription auth, therefore no
  spend" isn't sound today.

**Competing explanations ruled out.**

| Explanation | Evidence against | Residual |
|---|---|---|
| An API key in the pane's environment | Signal 4's shell had none; `launchctl getenv` is empty now; no tmux server is running now, so its environment can't be read. An API-key login would report `authMethod` other than `claude.ai`. | The pane's own environment was never read, and the pane is gone. That's why the check below runs in the launch environment. |
| `apiKeyHelper` in settings | None in user, project or local settings; no managed settings file. | None. |
| A third-party gateway (`ANTHROPIC_BASE_URL`) | The variable is set in this host session but to `https://api.anthropic.com` (first party). | A different value would matter, so the check covers it. |
| Bedrock or Vertex | No `CLAUDE_CODE_USE_*` variables. | None. |
| Remote Control forcing API billing | No evidence; the label logic doesn't consult Remote Control. | Banner read on v2.1.308; source read on v2.1.311 (assumed unchanged). |

## The deterministic check: `arcadia spend check`

One cheap, local, network-free command. Agents and scripts run it before they
claim spend or launch anything that could spend. It never prints a secret
value; only names, booleans and enumerated codes leave it.

```
arcadia spend check [--provider claude|codex|opencode|all] [--launch-env current|stripped] [--model <id>] --json
→ { verdict: "clear" | "risk" | "unknown", providers: [{ id, verdict, codes[], probes[] }], checkedAt }
exit 0 clear, 3 risk, 4 unknown
```

**Risk codes (each one names a mechanism; banners never appear).**

| Code | Read-only probe |
|---|---|
| `api_key_in_launch_env` | Presence of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY` or `CODEX_API_KEY` in the environment the child will get |
| `third_party_provider` | `CLAUDE_CODE_USE_BEDROCK`, `_VERTEX` or `_FOUNDRY` set, or `ANTHROPIC_BASE_URL` not `https://api.anthropic.com` |
| `api_key_helper` | `apiKeyHelper` in a settings source the launch loads |
| `not_subscription_auth` | `claude auth status --json` run **in the launch environment**: `authMethod` ∉ {`claude.ai`, `oauth_token`} or `apiProvider` ≠ `firstParty` (lifted from `reviewerReplay.ts:325-344`). For Codex, `codex login status` ≠ "Logged in using ChatGPT". |
| `extra_usage_enabled` | `~/.claude.json` `oauthAccount.hasExtraUsageEnabled === true` (with `profileFetchedAt` age) |
| `purchased_credits_available` | Codex `credits.hasCredits === true` in the usage telemetry |
| `paid_model_route` | OpenCode model id not prefixed `opencode-go/`; an Intelligence route with `requiresPaidUsage` that is enabled |

Warnings, which never alarm: `approved_custom_api_key` when
`customApiKeyResponses.approved` is non-empty, and `notional_cost_only`, which
documents that the status line cost is not a bill. `unknown` means a probe
couldn't run. It refuses a launch, but it's a digest item, never an urgent
alarm.

**Where it's enforced.**

1. **Launchers refuse on `risk` or `unknown`.** This covers
   `launchGuardedHostSession` through `checkProviderSignIn`
   (`src/sessions/launch.ts:266`), `go --launch` (`src/commands/go.ts:709`),
   relay `renew` (`src/commands/coordinator.ts:299`), `start-run.sh` P0
   (replacing the single variable test at `:643`) and the Intelligence CLI
   executors.
2. **Strip by construction.** Session and relay launches add `env -u` for every
   billing variable, and the check runs with `--launch-env stripped`, so its
   verdict describes the child's real environment.
3. **Admission refuses `paid`.** It also refuses `operator_config` and
   attestation receipts whose policy is `paid` (`capacity.ts:426-431, 490-531`).
4. **The liveness timer alerts only on verified risk.** Each liveness tick runs
   the check, which is local and cheap, and pages once per episode on a
   transition to `risk`, naming the code. `unknown` goes to the digest only.
5. **Guidance.** No agent may claim, or rule out, spend without a `spend check`
   receipt. Banners, `/cost`, the status line cost and model names aren't
   evidence. This goes in `docs/agents-context.md` (regenerate AGENTS.md) and
   the Signal skill.

## Plan: the vital few

| Order | Change (smallest testable correction) | Owner role | Acceptance test |
|---|---|---|---|
| 1 | **Turn off Claude extra usage** on the account (claude.ai → Settings → Usage). Confirm OpenCode Zen auto-reload is off and Codex credits stay 0. | Operator (account settings; agents can't) | After the profile refreshes, `~/.claude.json` shows `hasExtraUsageEnabled: false`; once change 2 lands, `arcadia spend check --provider claude` shows no `extra_usage_enabled`. |
| 2 | **`arcadia spend check`**: a pure library `assessSpendRisk(env, probes)` plus the CLI. Reuse `proveSubscriptionAuth`. | Implementer (standard), code-reviewer | Table-driven fixtures, one per code: `clear` for claude.ai/firstParty, no variables, extra usage off, **with banner text "Claude API" present** (the false-alarm regression); `risk` per code; `unknown` when `claude` is missing. Output contains no fixture secret sentinel. |
| 3 | **Enforce in production and relay.** Admission refuses `paid`; `checkProviderSignIn` uses `assessSpendRisk` (auth method, Codex ChatGPT login, OpenCode prefix); Session and relay `env -u` billing variables; `start-run.sh` P0 calls the check. | Implementer (standard), code-reviewer | `tests/provider-capacity-admission.test.ts` asserts `paid` → `admitted: false`. A launch test with a fixture `ANTHROPIC_API_KEY` shows the argv carries `-u ANTHROPIC_API_KEY` and the launch is refused. Relay test: a `risk` verdict means no claim and no tmux launch. |
| 4 | **Paid Intelligence callers off by default.** `resolveRoute` refuses every `requiresPaidUsage` route unless config names an approved Decision. Set `action.advice` to `allowPaidUsage: false`. PR TLDR follows the Decision below. | Implementer (light) after the Decision | `resolveRoute` test: a paid route with `allowPaidUsage: true` and no bound Decision gives `paid_usage_not_allowed`. Registry test: no enrichment sets `allowPaidUsage`. |
| 5 | **Liveness spend-risk observation and guidance.** Page once per `risk` episode; `unknown` goes to the digest. Add the "no claims without a receipt" rule. Fix the `coordinator-handoff-design.md` wording ("spends money" → "uses subscription allocation"). | Implementer (standard); Signal skill owner | `decideLiveness`-style unit test: `clear`→`risk` pages once, `risk`→`risk` is silent, `risk`→`clear` sends a recovery line, `unknown` never pages. Guidance test via the existing agent-guidance fingerprints. |
| 6 | **Pin OpenCode to `opencode-go/`** in the binding validator and helper briefs. | Implementer (light) | Validator refuses `opencode/…` and `huggingface/…` models; accepts `opencode-go/…`. |

Rowan coordinates the order: 1 (operator, now), then 2 → 3 (critical path),
then 4, 5 and 6 in any order. Changes 2 and 3 are ordinary reviewed PRs.
Change 3 changes launch refusals, so it should merge while production is Off.

## Standing policy Decision

**Yes, a Decision should record it.** Today Decision 0126 (2026-10-13) is a
standing paid authorization (Fast Text Cloud for PR TLDRs). Decisions 0118 and
0123 frame spend bounds, and nothing records the operator's 2026-11-09 words,
"none is or will be authorized indefinitely". A Decision makes the policy one
checked-in fact that code (change 4) and guidance (change 5) can cite. The
draft below was submitted as Agent Ask preview `agentask_c44f1cf06e38e30fe1`
(**preview only**, never settled):

- **A. A standing no-spend policy (recommended).** No paid usage of any kind is
  authorized, with no expiry: API keys, extra usage or usage credits, purchased
  credits, pay-as-you-go gateways and paid cloud routes. It supersedes 0126's
  paid PR TLDR route. Subscription allocations are usage, not spend. Any future
  spend needs a new Decision that names the amount, route and expiry.
- **B. The same, but keep 0126** as the sole exception.
- **C. Record nothing new;** rely on the Constitution's hard stop.

## What this investigation couldn't verify

- The pane's own environment on 2026-11-08 (the pane and tmux server are gone).
- Whether long context or fast mode on this plan draws from extra usage. The CLI
  has strings such as "Extra usage is required for long context", but plan
  rules weren't read.
- The OpenCode Zen balance and auto-reload, and current Claude extra-usage
  spend for the period. These are account pages only the operator can see.
- Whether any process outside the services checked holds a billing variable.

## Issues filed

| Issue | Gap | Plan change |
|---|---|---|
| #2371 | Claude extra usage is on (operator step plus telemetry) | 1 |
| #2372 | Capacity admission admits `paid` usage and purchased credits | 3 |
| #2373 | Sign-in preflight checks `loggedIn`, not the subscription | 2, 3 |
| #2374 | Session and relay launches inherit billing variables | 3 |
| #2375 | False alarms: `arcadia spend check`, liveness, guidance | 2, 5 |
| #2376 | Paid Intelligence routes; action advice has no Decision; LiteLLM has no budget | 4 |
| #2377 | OpenCode model prefix isn't pinned | 6 |

Decision Ask preview: `agentask_c44f1cf06e38e30fe1` (request id
`record-standing-no-spend-policy-2026-11-09`, intent `decision`, requested
authority `propose`, zero Project writes). It isn't settled.
