# Shared usage helper and #1662 recovery preparation — 2026-10-22

Operator-directed intake: #1693. No governed Action exists for this request.
Instruction: “Build the shared credential-aware usage helper for Codex, Claude Code and OpenCode, then prepare #1662’s QA recovery and tell me exactly what I need to approve. Keep production Off.”

## Delivered boundary

One shared CLI, `arcadia provider-usage --json`, works identically for callers in
Codex, Claude Code and OpenCode. No skill was added or modified, so no native
skill-discovery claim is made. Without refresh there is no credential/provider
read; cached Claude windows are explicitly credential-context-unverified.
`--refresh --claude-source auto|environment|file|keychain` performs one bounded
request per supported provider, using the existing readers. Explicit selection
never falls through after absence/denial. Source, known expiry, actual request
attempt, numeric HTTP status, transport/parse outcomes and observed windows are
safe output; tokens and token hashes are neither output nor persisted. Fresh
reads never write production telemetry or reuse its cooldown. OpenCode's shared
account-usage reader remains unsupported; no fabricated allowance is returned.
This is a diagnostic, not worker-context proof or admission.

The one-shot operator card `recover-qa-1662-20261022` readies only #1662 at
`cff844a22093fbbf4c0a29408502718ab91d047a` and uses the existing guarded QA
executor for one rerun (five-minute reviewer bound). It refuses Off, unknown
policy, unrelated scope, wrong provider/concurrency, moved head/body, non-green
CI, moved lineage, live attempts, unreviewed/dirty main, remote drift, expiry or
an already-created one-shot marker. It never activates production, resets
attempts, merges, installs, changes credentials or edits governed state.
It rechecks policy before readiness and QA; the canonical QA executor retains
its own admission and independent-review checks. Uncertain execution consumes
the card; preserve marker/receipts and diagnose instead of retrying it.

## Fresh evidence and remaining gates

- Main at start: `392f1ad6fe798c90c7baf684e47dbd84b69459fe`, clean.
- Production read 2026-10-22T16:40:31Z: `inactive_idle`, revision 79, epoch 44,
  zero live admissions. This preparation performs no activation or QA allocation.
- #1662 GitHub read: draft, exact head unchanged; all 15 CI jobs SUCCESS.
  The corrected body still names the exact head/base and five changed files.
  All conversation/review/inline feedback was read. Its older failure and the
  stale exhaustion wording remain preserved, not erased.
- Read-only lineage at this preparation: code-review next 6/limit 9;
  QA next 4/limit 7, four allocations remaining each. Code-review ordinal 5
  passed for the exact head. The body's fingerprint changed in the earlier
  repair: this does not itself establish reuse of the current code-review
  binding; canonical readiness/gate must revalidate it after activation.
  The recovery card requests QA only; it does not certify integration readiness.
- Existing repeatable START card was verified listed at the live
  `/api/operator-script`; its last run succeeded. It remains repeatable until
  2026-10-26T00:00Z, for three named Claude Actions, concurrency 1, 24-hour
  packet/integration delegation, unchanged 80% windows and 20% reserve.
  The production policy itself does not expire at 24 hours; STOP remains explicit.
- The new recovery card is a reviewed-source candidate, not a live-published
  button until this PR lands in main. Do not claim its presence in `/actions` yet.
- The prior worker-Keychain reading (2026-10-22T16:16Z) succeeded, but is no
  longer fresh launch-capacity proof. This shell's inherited token had returned
  403. No causal claim about the operator's desktop login is established.
- Automatic host approval review rejected the requested live helper test:
  reading the Keychain token and sending it to Anthropic needs specific approval.
  No credential was read/sent and no workaround was attempted. Hermetic tests
  establish behavior; live account verification remains unperformed.
- Prior combined replay at `873f3cfbb8a415be25b887b23dfeebd4222f8006` proved
  initial acceptance, injected failure, changed repair, simulated review/QA,
  local integration and next-Action acceptance/integration. It stopped on the
  inherited #1662 hold; it did not prove every pinned Action or live reviewers.
  #1682 still limits general confinement claims. Fresh immutable named-validator
  binding and pre-press process critique remain gates before a real press.

## Exact proposed operator sequence

1. Approve merging this credential-adjacent preparation PR. This installs no
   runtime and leaves production Off. The helper and recovery-card source become
   reviewable main history; no credential authority expands by merging.
2. Separately approve one live helper verification using the explicitly selected
   Claude Code Keychain access token solely at Anthropic's usage endpoint, plus
   the Codex app-server usage read. No inference, refresh-token exchange, token
   persistence, global environment changes or activation. It proves that selected
   source only. Recheck actual worker environment/source and capacity separately.
3. Before any On request: refresh installed-main identity through the existing
   approved runtime-recovery surface, verify clean remote/main and live card
   publication, obtain genuinely fresh worker-context capacity under unchanged
   gates, revalidate immutable named checks and the pre-press critique. The
   helper source and this candidate card are not evidence those gates passed.
4. Only then approve/press the existing three-Action START card and the new
   one-shot recovery card. START turns production On and delegates bounded
   worker integration. Recovery readies #1662 and spends at most one QA
   allocation. They are separate effects; neither is approved by this report.
   STOP through the existing control if the run must end. Do not reset budgets,
   approve unrelated merges, change credentials or revive expired exceptions.

Remote surfaces (verify again after source publication):
- Production: http://arcadia-1.alpine-rattlesnake.ts.net:3020/production
- START: http://arcadia-1.alpine-rattlesnake.ts.net:3020/actions/grant-production-unattended-claude-clean-run-20261021
- Candidate recovery: http://arcadia-1.alpine-rattlesnake.ts.net:3020/actions/recover-qa-1662-20261022

## Validation and limits

Hermetic helper tests cover cache-vs-request truth, selected credential source,
1% utilization, HTTP 401/403/429/500, absent/expired credentials, malformed data,
transport/JSON distinction and no secret output. Recovery tests exercise Off,
launch context, expiry, scope and moved-lineage refusals before mutation.
Canonical QA remains unrun; no claim of live recovery or unattended acceptance.
Focused tests, lint, typecheck, build, card contract validation and independent
review evidence are recorded in the PR. Native usage invocation across three
agent applications was not performed; this is shared CLI behavior, not a native
plugin installation. No governed pointer, Action, queue or attempt was changed.

## Session evidence and friction

Raw receipts remain under `/private/tmp/arcadia-1693-*`, current #1662 evidence
under `/private/tmp/arcadia-1662-*-20261022.json` and `*-current.json`.
The initial work monitor returned a very large portfolio snapshot; future reads
should persist/filter the relevant Project rather than emitting all worktrees.
Two targeted source guesses missed filenames; imports then identified canonical
`src/qa/prReview.ts` and `src/sessions/roleLineage.ts`. Compiler narrowing in the
new refusal guard required explicit `return refuse(...)`; failed compiler receipts
were retained before successful rerun. The live credential probe was rejected
before execution; no unchanged retry occurred.

Instruction retrieval (UTF-8 source bytes; sections used as recorded above):

- `CONSTITUTION.md` — 3320 bytes.
- `PROJECT.md` — 31687 bytes.
- `.arcadia/AGENT_CONTEXT_POLICY.md` — 539 bytes.
- `.arcadia/repo-context.md` — 703 bytes.
- `.arcadia/context-policy.json` — 870 bytes.
- `docs/agent-guidance/index.json` — 10914 bytes.
- `docs/agent-guidance/continuation.md` — 7256 bytes.
- `docs/agent-guidance/learning.md` — 2458 bytes.
- `docs/agent-guidance/operator-directed-work.md` — 4494 bytes.
- `docs/agent-guidance/agent-asks.md` — 23384 bytes.
- `docs/working-copy-safety.md` — 16202 bytes.
- `docs/agent-guidance/git-identity.md` — 5248 bytes.
- `docs/agent-guidance/pull-requests.md` — 21758 bytes.
- `docs/agent-guidance/principles.md` — 14124 bytes.
- `docs/agent-guidance/operator-actions.md` — 17246 bytes.
- `docs/agent-guidance/chat-titles.md` — 5310 bytes.
- `docs/agent-guidance/session-roles-and-briefs.md` — 6949 bytes.
- `docs/agent-guidance/process-critic-brief.md` — 2682 bytes.
- `docs/arcadia-semantics.md` — 15647 bytes.
- `docs/agent-guidance/arcadia-repository.md`: Orientation, Arcadia Semantics, Model Selection, Operator Guide, PR QA Plan, Working-Copy Safety, Claude Code specifics.
- Active Plan: exact current Action `cover-mail-ack-receipt-kind-collision`; open, clarified, agent-owned; no overlap with this operator-directed helper.
- `docs/notes-to-self.md`: credential/usage, workspace resolution, sandbox-write recovery, isolated dependencies, pre-press gate. Learn query returned no matches; retained checkpoint lesson remains cited.
- Skills: arcadia-guardrail, arcadia-release-manager and its checkpoint/production-run-playbook references; arcadia-role and arcadia-process-critic retrieved for review boundaries.
