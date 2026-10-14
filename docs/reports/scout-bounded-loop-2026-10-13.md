# Bounded Luna scout checkpoint — 2026-10-13

The operator requested a bounded attempt → findings → repair → independently verified retry loop, keeping production Off and preserving current work. Decision 0128 records the limits; the inactive Scout Plan adds `bounded-luna-hello-world-loop` without activation or queue/pointer movement.

This checkpoint delivers isolation validation and records the budget policy; durable budget enforcement and live execution admission are not delivered. No current Scout Action is marked complete. The three prerequisites remain open until their full acceptance evidence exists.

## Recorded limits

At most three Luna/low live builder attempts, 90 seconds each; two repair cycles; 90 minutes from the first launch across restarts and source changes. Each repair uses one Luna/medium Implementer (20 minutes) and separate Luna code-reviewer and QA Sessions (five minutes each). No further delegation. Incremental paid spend ceiling is $0 using existing subscription access; no purchased credits, API billing, provider fallback or new infrastructure. Unknown monetary cost stays unknown. Scope expires 2026-10-18T00:00:00Z.

A retry needs a named failure, changed source and independent review/QA. Unchanged failures, missing authority/evidence, isolation violations, expiry, clock rollback, corruption, login/quota failure and exhausted limits stop. Source SHA and fixture root are per-attempt evidence, never counter-reset keys.

## Current evidence

- Product commit `15ea1fc59982e77dee41550cf7b3a39c92924fb2`: focused preflight tests 39/39, touched-file ESLint, TypeScript and diff checks passed. Independent review prompted physical live/fixture overlap checks, unreadable-path refusal and exact canonical Decision path equality.
- Original manifest digest `76ef8c3763a4d9b5b04761a510cf43e2896545b227f70f5506df9c1db48ed8b9`: all 48 files verified on a temporary copy; zero replay provider calls; recorded product result **No**. Verified observations and hypotheses remain separate. The original config uncertainty stays unresolved.
- The Decision-aware receipt is `bounded-decision-0128-isolation-only`, with `executionAuthorized: false`. A successful isolation check alone cannot launch Luna.
- R2 review could not clear earlier-valid-ledger rollback detection. The incomplete budget reservation API and CLI write path were removed. This checkpoint cannot initialize, reserve or enforce attempts/repairs; exact approved assignment, durable freshness evidence and launch-consumer integration remain required before any live attempt. No second state store was added.
- Root independently checked that the primary checkout was clean after an Implementer diagnostic mix-up; the three edits were in the assigned candidate. No recovery/reset was performed. Fetched main was already an ancestor of the candidate.

Private receipts contain the complete canonical role briefs, Implementer/Planner handbacks, replay, failed validation diagnostics and governing-command receipts. No config contents or provider logs belong in this public report. Native dispatch is not governed Session admission. Canonical specialist ledger serialization remains tracked in #1366; no legacy role is substituted for a canonical specialist.

## Remaining execution gap

[Issue #1389](https://github.com/pmark/arcadia/issues/1389) records a source-verified missing capability, not a failed live builder attempt. `review approve --execute` only queues a Run (`src/commands/review.ts:1326`); the supported `worker start` is refused in experiment workspaces (`src/workspace/experimentGuard.ts:365`) and starts a daemon. The generic headless-provider test seeds its Action directly and cannot prove Ask-to-completion. An ad hoc call to internal worker functions would bypass this boundary.

The registered proposal `scout-bounded-fixture-run-consumer-20261013` requests a canonical, bounded, single-Run fixture consumer using the existing execution engine, with production Off and no services, remote effects, live queue/pointer writes or replacement harness. Its receipt is `agentask_64f9dfdf79eab18c77`; it grants no execution authority.

Next source work is the approved exact-file scope/approval handoff repair (#1356/#1357), followed by shared Ask/To-do Run visibility (#1320). Live execution also requires resolution of #1389, exact assignment/ledger integration, current protected-state witnesses and independent review/QA. The original Plan's separately gated remote green-PR proof is not delivered by this source PR.

## Reproduce the existing public measurement

From the candidate root, run `pnpm fast-rehearsal -t 'Ask/To-do scout'`. Inspect the harness `report.json`: test exit zero means the expected queued/no-worker scenario was measured, not that Hello World was delivered. The Scout uses only Ask, Ask show and To-do; setup/approval transport and the deterministic validator stay outside that persona.

A live **Yes** requires exact 13-byte `HelloWorld.txt` (`Hello World!` and one newline), no other builder-owned file changes, a correlated completed Run and a ready/published Artifact. Approval, queued state, a standalone file or green source CI is **No** for that oracle.
