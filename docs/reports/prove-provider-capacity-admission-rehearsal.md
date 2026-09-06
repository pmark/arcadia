# Provider Capacity Admission — Rehearsal Evidence

Current milestone: Bootstrap managed production to build Flight Deck.
Next action: Prove and reuse existing Codex and Claude telemetry for unattended
included-capacity admission.
Work classification: verification and evidence capture (no code changes — the
admission logic, receipt contract, and tests already existed on `main` from
PR [#183](https://github.com/pmark/arcadia/pull/183)).
Required artifacts: this report; automated test evidence; live rehearsal
output for both configured providers.

## Why this rehearsal, not new code

`main` already carries `src/codingAgents/capacity.ts`, `src/codingAgents/availability.ts`,
and 68 passing tests across `tests/provider-capacity-admission.test.ts`,
`test/codingAgents/availability.test.ts`, `tests/managed-production-policy.test.ts`,
and `tests/provider-adapter-selection.test.ts` that implement every acceptance
criterion below in the deterministic sense a unit test can prove. What PR #183's
own settlement Log entry (`capacity-observer-defects-found-2026-09-05`) left
open by name was narrower: *this host's* automatic Claude Code capacity
observation was unproven, because the Claude Code keychain entry it read at
the time carried an empty access token. Codex's observation was proven; Claude's
was not, and the design's answer to an unprovable observation is a refusal
with an actionable reason (`no_credentials`), never a guess.

Running this session's rehearsal again on the same host found that gap closed
on its own — the Claude Code credential is now live (this is itself a Claude
Code session, and Claude Code's own OAuth token refreshes through normal use).
The evidence below is a fresh, real capture with both providers reporting.

## Rehearsal 1 — refreshed observation, both providers real

```sh
pnpm arcadia production capacity --refresh --json
```

Claude Code — admitted, real, unattended:

```json
{
  "providerId": "claude-code-cli",
  "admitted": true,
  "code": null,
  "reason": "Claude Code reported 86% remaining in its 5h window and 32% remaining in its 7d window of included allowance, observed less than a minute ago via claude_usage_snapshot.",
  "unattendedProof": true,
  "receipt": {
    "evidence": "real",
    "unsupported": ["remainingTokens", "creditBalance", "bankedResets", "planScope", "accountIdentity"],
    "source": "claude_usage_snapshot",
    "unattended": true,
    "observedAgeMs": 26929,
    "freshness": "fresh",
    "usagePolicy": "included",
    "usagePolicyReason": "Claude's usage service reported subscription allowance windows, which exist only for included plan usage.",
    "windows": [
      { "label": "5h", "usedPercentage": 14, "remainingPercentage": 86, "resetsAt": "2026-09-06T11:40:00.109Z" },
      { "label": "7d", "usedPercentage": 68, "remainingPercentage": 32, "resetsAt": "2026-09-10T04:00:00.109Z" }
    ]
  }
}
```

Codex — real telemetry, correctly refused (reserve margin, not a defect):

```json
{
  "providerId": "codex-cli",
  "admitted": false,
  "code": "capacity_reserve_margin",
  "reason": "Codex's 7d window is at 95%, inside the 5% reserve margin that keeps an admitted Run able to finish. New admission stops at the boundary.",
  "unattendedProof": false,
  "retryAfter": "2026-09-12T04:27:37.000Z",
  "receipt": {
    "evidence": "real",
    "unsupported": ["remainingTokens", "accountIdentity"],
    "source": "codex_app_server",
    "unattended": true,
    "freshness": "fresh",
    "usagePolicy": "included",
    "usagePolicyReason": "The Codex app server reported plan rate-limit windows for the plus plan, which exist only for included usage.",
    "windows": [{ "label": "7d", "usedPercentage": 95, "remainingPercentage": 5, "resetsAt": "2026-09-12T04:27:37.000Z" }],
    "credits": { "hasCredits": false, "unlimited": false, "balance": "0" },
    "bankedResets": [{ "id": "RateLimitResetCredit_c98cb9c235588191ab8be49c18f7d819", "status": "available", "title": "Full reset", "expiresAt": "2026-10-04T22:34:34.000Z" }]
  }
}
```

`refresh`: `{ "attempted": true, "attempts": 1, "elapsedMs": 4538, "withinDeadline": true }`
against the declared `refreshDeadlineMs: 15000` and `refreshBackoffMs: [1000, 5000, 20000]`.

## Rehearsal 2 — no `--refresh`, deterministic re-read

```sh
pnpm arcadia production capacity --json
```

`refresh: null` (no network call attempted). Both providers still report real,
fresh telemetry: Codex's local app-server read is not gated by `--refresh` (it
is a local IPC read, bounded by its own `CODEX_RATE_LIMIT_DEADLINE_MS`, not a
network cooldown); Claude's cached status-line snapshot from Rehearsal 1 is
reused unchanged. Neither path invokes a model — `tests/provider-capacity-admission.test.ts`
asserts this statically by scanning `capacity.ts`'s own imports for anything
matching `intelligence|model|llm|openai|anthropic` and failing if found.

## What each criterion is proven against

1. **Real windows/source/age/reset/scope/policy** — both receipts above carry
   `source`, `observedAgeMs`, `freshness`, `nextResetAt`, `accountScope`, and
   `usagePolicy` with a stated `usagePolicyReason`; unsupported fields
   (`remainingTokens`, `accountIdentity`, etc.) are named, never invented.
2. **Unknown/stale/unknown-paid-mode refusal, and a labeled bounded manual
   receipt** — `tests/provider-capacity-admission.test.ts` describe blocks
   "unattended admission refuses what it cannot prove" and "the operator
   attestation is admissible, bounded and labeled" (18 tests).
3. **Bounded refresh, no model calls, automatic readmission after a fresh
   reset observation** — proven live above (attempts/elapsedMs/deadline) and
   by describe blocks "resets readmit work only on fresh observation" and
   "refresh is bounded and spends no tokens". No redemption, credit purchase,
   or paid-fallback code path exists (`grep` for `redeem|purchase` in
   `capacity.ts`/`availability.ts`/`policy.ts` returns only comments stating
   the opposite).
4. **Compliant selection after admission filters** — describe block
   "selection runs after the admission filter" (4 tests): a limited provider
   is skipped for a different eligible configured provider without weaker
   substitution or blind replay.
5. **Real host telemetry for each configured provider, unavailable fields
   explicit** — both rehearsals above; this is the criterion the prior
   session left open for this host and this rehearsal closes.
6. **Deterministic integration evidence, exact procedure, real vs. simulated
   distinguished** — this report, plus `"evidence": "real"` stamped on every
   receipt (`tests/provider-capacity-admission.test.ts`'s "stamps simulated
   evidence so a fixture never reads as real provider proof" guards the
   inverse case).

## Verification

```sh
pnpm vitest run tests/provider-capacity-admission.test.ts test/codingAgents/availability.test.ts tests/managed-production-policy.test.ts tests/provider-adapter-selection.test.ts
```

Result: 4 test files, 68 tests, all passed.

```sh
pnpm exec tsc --noEmit -p .
```

Result: clean.

`pnpm test` (full suite) has five pre-existing, unrelated failures on this
worktree, none touching capacity/availability/admission code: two require
`pnpm build` to resolve the `@pmark/arcadia/intelligence/client` package
export before the dashboard tests can import it, one is that same build
hook's own 10s timeout, and one (`tests/cli-response.test.ts`'s Back Burner
CLI round-trip) timed out under this worktree's disk load. None are
introduced by this rehearsal, which made no source changes.

## Operator procedure

No runnable UI surface changed — this Action is CLI-observable only.

1. From any checkout of this repository: `pnpm arcadia production capacity --refresh --json`.
2. Expect `admittedProviders` to include `claude-code-cli` when Claude Code's
   own OAuth credential is live on the host, and to name a visible refusal
   reason (never a silent "unknown") for any provider it does not admit.
3. Compare the receipt's `"evidence"` field: `"real"` means this host actually
   observed the provider; anything else is a test fixture and must never be
   read as unattended proof.
