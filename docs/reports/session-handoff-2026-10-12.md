# Session handoff: 2026-10-12 simulated production run -> next Lead session

Status: written at the end of the first long Lead session so the next session
starts from a brief, not from chat history (see `session-roles-and-briefs.md`).
Tracking Issue: #1284. Living notes: `production-simulation-living-notes.md`.
Strategy: `docs/strategy/autonomous-production-strategy.md`.

## Goal (operator, 2026-10-12)
Autonomous production plus totally streamlined operator input: attention is
precious, the system handles any situation resiliently and learns. The
operator's route is: Discord ping -> /todo -> one button. Every operator touch
becomes a pinned decision card.

## State at hand-off
- Active Plan (PROJECT.md): `every-production-session-is-bounded-by-a-platform-token-ceiling-and-an-in`.
  Done in it: replay scenario, session ledger, token ceiling, roles guidance,
  probe (slice), docs-sync lock (slice). Pending: `one-click-clear-every-blocker-kind`
  (PR #1309 CLEAN, waits for the operator), remainders
  `attach-the-session-probe-result-to-the-reconcile-receipt` and
  `stage-pointer-with-queue-reorder-and-reproduce-live-lock`.
- Old batch Plan (draft): A12 split, A5 and A6 complete. A3
  (`name-every-production-stall-with-a-one-click-fix`) is merged as a first slice
  but could not be recorded as a `split`: a split in a draft Plan fails with
  "queue anchor not found". Record it when that Plan is active or when the split
  placement works in a draft Plan. Its remainder text: replay the literal 21:10Z
  log and cover scope drift and capacity stalls. `refuse-a-session-before-launch-when-its-sandbox-cannot-write`
  is superseded by the in-Session probe; retire it with a card.
- Draft Plans ready: decision cards (11 Actions incl. `card-veto-verb`,
  `record-operator-touch-receipts`, `batch-merge-decision-card`) and resilience
  (5 Actions). Neither is active.
- Production: Inactive; red alert `ra-2bcf88b68759` untouched; governance-overlap
  Plan is draft with its Action unharmed.
- The operator is merging Codex-authored PRs himself (planning rules among them,
  e.g. checkable acceptance criteria) and will say when done.

## Update (end of session)
Codex PRs, #1309 and #1318 are merged. The decision-cards Plan activation is
settled and queued (first Action `decision-card-contract`, queue `orderValid`
true); it ships in the activation PR and needs one operator merge. Steps 1 to 3
below are done; start at step 4 after that PR merges and local main is synced
(merge origin/main; if a replayed settle conflicts, take origin/main's file).
Consider moving `batch-merge-decision-card` right behind
`cards-from-existing-sources` with a canonical queue arrange.

## Next steps, in order
1. Wait for the operator's "Codex PRs merged" message. Then `git fetch`, merge
   origin/main into the main checkout, and re-run `arcadia docs sync --project arcadia`
   and `arcadia advance queue --json` (require orderValid true).
2. Ping the operator for PR #1309 (one-click clears) if it is still open;
   one ping, exact click, consequence.
3. Activate the decision-cards Plan: the Ask is drafted
   (`activate-decision-cards-plan-2026-10-12`, preview fingerprint in the PR body);
   settle from the main checkout with
   `--activate --action decision-card-contract --model gpt-5.6-terra --effort medium --top`,
   then repair queue order with the canonical arrange if `orderValid` is false,
   re-author the settle commit, open a PR, ping the operator once.
4. Run `decision-card-contract`, then `batch-merge-decision-card`, then
   `card-veto-verb` as Sonnet Drivers with fresh adversarial Reviewers. Every guard
   or validator Action gets the adversarial strings in its brief and the lint and
   dashboard import-graph checks (see the brief template).
5. After the cards land, build `record-operator-touch-receipts`, then activate
   the resilience Plan and run `define-situation-registry` first.
6. Each session ends with a ledger row in `session-ledger.jsonl`.

## Operating rules that held tonight
- One ping per needed action (`arcadia ping --kind attention --link <PR>`).
- An agent never authors and activates a Plan in one stretch; the operator
  approves Plans, never instances of mechanical work.
- Reviewers found real defects in every guard or validator PR; do not skip them.
- Authority-adjacent PRs (production policy, approval text, permission allow rules,
  mutating dashboard routes) wait for the operator.

## Known traps (see the living notes for the full table)
- Re-author settle commits with `cherry-pick -n` plus `commit` and the env set;
  `--reset-author` and `cherry-pick` keep the operator's name unless the author env is set.
- Split remainder ids are limited to about 64 characters.
- Drivers: create the named branch first (`git branch -f <name> HEAD`), lint touched
  files, run the dashboard import-graph check, run fast-rehearsal from the worktree root.

## Update (Lead session 2, 2026-10-12 late)
- #1348 merged. #1349 files the `decision-card-contract` completion (pointer to
  `cards-from-existing-sources`); it waits for the operator's merge.
- #1353 holds a reviewed slice of `batch-merge-decision-card` (3 review rounds,
  guard documented as not a trust root). Remaining for that Action: `/todo`
  route and button (blocker-clear pattern, needs a `lib/arcadia-cli` helper),
  published descriptor and launcher via the operator-script library, ping
  queueing. Record it as a `split` after #1349 merges (the Action must be in the
  active Plan queue); remainder text: route, descriptor, ping.
- `one-click-clear-every-blocker-kind` completion is held: criterion 2 partly
  met (scope stops link to /production; the clear route calls the CLI). Needs the
  split fix for inactive Plans or an operator ruling.
- Next Lead: after the two merges, sync main, file the batch-merge split, then
  `cards-from-existing-sources`. Brief rule learned: put "operator-only is
  host-side, the script is not a trust root" in every operator-script brief.

## Update (Lead session 3, 2026-10-13, overnight)
- Merged: #1349, #1353, #1358 (split of batch-merge; remainders
  `wire-the-batch-merge-card-route`, `publish-the-batch-merge-descriptor-and`).
- Open for the operator: the `cards-from-existing-sources` completion PR (advances
  the pointer to `todo-actions-render-cards`; `src/decisions/cardSources.ts`, 4
  review rounds, READY). Merge it first.
- Residuals shipped (low, in the PR): a malformed string PR number does not block a
  clean numeric card for the same PR; sources beyond the 1000-source read window are
  counted only (`truncated`), so consumers must honour `truncated`.
- Next Lead after that merge: `todo-actions-render-cards` (queue shows `attention`;
  read why before launching), then the two batch-merge remainders (route is
  authority-adjacent: it waits for the operator). Put "dedup and id keys use the
  classifier's own normaliser and `cardIdOf`" into every card-generator brief.

## Update (Lead session 4, 2026-10-13)
- Merged: #1359, #1362 (the `/todo` next-steps Action). Open for the operator: the
  `todo-actions-render-cards` completion PR (new mutating route
  `/api/decision-card`, writer preconditions `--expect-status/-updated/-options/
  -no-pointer-move` in `decision approve`). Read the route header comment first.
- Known limits shipped: run cards execute only when the script is the derived next
  action; a defer whose target is the current Action is refused from a card and must
  be answered from the CLI; PR cards render but merge/veto have no button (the batch
  merge route is its own Action); the last fix was Lead-verified, not re-reviewed.
- Next: `todo-next-steps-route-to-forward` (the operator's /todo route-to-done
  directive). It consumes `cardSources.ts`, `orderStack`, and needs PR facts from
  `gh` (inject, keep the module pure). The read-only list may merge on green; any
  button waits for the operator.
