# Intelligence coding-agent routing, 2026-11-10

Investigator: Ellis, acting as a read-only investigator at the operator's
request (the Mira session could not be started over Remote Control). This is
evidence and a recommendation only. It changes no code, grants no authority
and settles nothing.

Operator goal (2026-11-10): Rebuster should ask Arcadia Intelligence for
quality text generation and let Arcadia pick an available coding agent (Codex,
Claude Code or OpenCode). Today Rebuster's spec generation fails.

## Why it fails today

Rebuster's job `ijob_f16c09bd175b4e359a` (2026-11-10 17:14Z) asked for
`execution: cloud-required`, `profile: quality`, `allowPaidUsage: true`.
`resolveIntelligenceRoute` refused it: `PAID_USAGE_NOT_ALLOWED`, "no approved
Decision is bound to it" (`src/intelligence/routing/resolveRoute.ts:132-141`).
`APPROVED_PAID_USAGE_DECISION_IDS` is empty by Decision 0213
(`src/intelligence/config/defaults.ts`), so every paid route is refused. Not an
outage: `GET /api/intelligence/health` shows LiteLLM reachable with the proxy key
accepted, and a free local test job completed. Rebuster showed "temporarily
unavailable, retry" for a policy refusal; see finding 1.

## What works today with no Arcadia change

- `executionTarget: "codex" | "claude-code"` with `execution: "local-required"`
  resolves to the local coding-agent text routes
  `arcadia.text.generate.local.{fast,standard}.{codex,claude-code}`
  (`defaults.ts` `codexTextRouteEntries` / `claudeCodeTextRouteEntries`;
  `resolveRoute.ts:87-111`). Free, structured output supported, output validated
  against the caller's JSON Schema (`worker.ts`).
- Only `fast` and `standard` exist locally (`LOCAL_TEXT_PROFILES`). There is no
  local `quality` text route, so a "quality" request can only resolve to paid cloud.
- Jobs are asynchronous (submit, then poll). Both CLI executors time out at
  120 s (`defaults.ts` `DEFAULT_*_CLI.timeoutMs`); concurrency 3 each.
- Billing environment variables are already stripped from the agent children
  (`stripBillingEnv`, both text executors).
- Live now: Codex available; Claude Code telemetry stale ("sign-in on the worker
  host needs renewing"), so a Claude Code job may block until renewed; OpenCode
  unknown (`arcadia intelligence usage`).

So Rebuster can be fixed today by requesting `local-required`, profile
`standard`, target `codex` then `claude-code`. Quality will be that of the
agent's default model, because of finding 2.

## Findings, ranked by what changes dispatch behavior

1. **Errors do not say whether a retry can help.** A blocked job carries a
   `code` and `message` only. The same status `blocked` covers a policy refusal
   (`PAID_USAGE_NOT_ALLOWED`, route not configured), a transient dependency
   (`LITELLM_UNAVAILABLE`), and an unavailable agent (`CODEX_CLI_UNAVAILABLE`,
   `CLAUDE_CODE_CLI_UNAVAILABLE`) (`worker.ts` catch block). The retry endpoint
   resets any failed or blocked job (`db/repository.ts`) and spends the one
   allowed retry, so retrying a policy refusal cannot succeed. A client cannot
   tell them apart without string matching, which is how a refusal became
   "temporarily unavailable". Fix: add `category` (`policy_refused`, `transient`,
   `misconfigured`, `invalid_output`) and `retryable` to the job error contract
   and make retry refuse non-retryable jobs. Size S. No authority needed.
2. **`profile` is cosmetic for coding agents.** It is written into the prompt
   text (`codex/textExecutor.ts:216`, `claudeCode/textExecutor.ts:228`) but the
   CLIs run with fixed arguments and no model or effort flag
   (`DEFAULT_CODEX_CLI`, `DEFAULT_CLAUDE_CODE_CLI`). Arcadia already has the
   machinery to make it real: `src/codingAgents/modelTiers.ts` maps a tier
   (`light|standard|heavy`) to a concrete model and effort for `codex`, `claude`
   and `opencode` (OpenCode pinned to `opencode-go/`), and
   `reasoningEffort.ts` translates the effort per CLI. Mapping
   `fast→light`, `standard→standard`, `quality→heavy` and adding a local
   `quality` coding-agent route gives Rebuster a real quality tier at no cash
   cost. `defaults.ts` says adding a profile is a deliberate decision. Size M.
   Risk: heavy models draw more of the weekly subscription allowance (see
   decisions).
3. **No "any coding agent" target, and configuration is not availability.**
   `availableExecutions()` (`client/client.ts:293`) reads the static route
   registry from `/health`, not whether Codex is signed in, rate limited or
   out of allowance. Arcadia already measures that
   (`src/codingAgents/availability.ts`: `available | unknown | usage_limited |
   budget_limited`; `signIn.ts`; `providerUsage.ts`), but Intelligence routing
   does not use it. Add `executionTarget: "coding-agent"`, resolved
   deterministically by Arcadia: an operator-set preference order filtered by
   live availability, subscription logins only, no silent profile change, the
   chosen agent recorded in `selectedRoute`. Also expose live availability per
   capability and profile on the health route (or a new read-only route) so a
   client can show why nothing is available. Size M. This is the operator's
   idea; it fits the existing rule that Arcadia, not the companion app, decides.
4. **Timeouts are one-size.** 120 s for every profile; a heavy-tier spec may
   exceed it and fail with `CODEX_CLI_TIMEOUT`. Make the timeout per profile.
   Size S, ships with finding 2.
5. **OpenCode is a registry value, not an Intelligence executor.** The tier
   registry and usage code know it, but the executor union is
   `litellm | codex-cli | claude-code-cli | comfyui | speech`
   (`resolveRoute.ts:22`). A third text executor is Size M-L and needs the
   Go-plan pin (the spend investigation found Zen is pay-as-you-go). Defer until
   1 to 3 are done; its trigger is Codex and Claude Code both limited often.
6. **Subscription use is not free.** `costClass: "free"` means no cash, but the
   agents share weekly allowance with production workers. Rebuster calls could
   starve a production run. No per-client or per-day ceiling exists in
   Intelligence.

## Recommended first slice

One Arcadia Action: findings 1, 2 and 4 plus live availability on health (the
read-only half of 3). Then the `coding-agent` target as a second Action.
Rebuster's interim fix (local, standard, codex then claude-code) can ship
independently now and later switches to the new target by changing one
preference constant. Paid cloud stays refused under Decision 0213; nothing here
needs spend.

Tests: resolver unit tests for each target and availability state; a worker test
that a policy refusal is non-retryable and retry refuses it; a profile-to-model
mapping test with a fake CLI asserting the argument vector; a fixture-only
end-to-end job per agent.

## Decisions for the operator

- **Allowance ceiling:** a per-day or per-client cap on Intelligence use of
  Codex and Claude Code, and whether Intelligence coding-agent jobs pause while
  managed production is Active. (Recommend: a small per-day cap and no pause for
  light and standard, pause for heavy.)
- **Quality tier:** accept `quality→heavy` (Opus or GPT-6.1-sol class) for
  Rebuster, knowing it uses more allowance.
- **Claude Code sign-in:** renew it, or accept Codex-only until then.
- **OpenCode:** wanted now or deferred, and on which plan.

## Evidence limits

Read-only. Read the code at `origin/main` 0496512eb, the live `/health`,
`intelligence usage` and `list-jobs`. Ran one free local text job (completed). Did
not run a coding-agent job, so Codex and Claude Code output quality and the 120 s
limit for a real spec are unmeasured.
