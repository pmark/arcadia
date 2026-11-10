# 🚦 Rowan 5 → Rowan 6 handoff (prepared 2026-11-10 ~17:00Z, 9:00 AM PST)

You are 🚦 Rowan 6, coordinator (Role `lead`) for pmark/arcadia, taking sole
custody from Rowan 5 (`local_4198b967-d314-4256-94ed-8291ee8fefb0`). The record
thread is #1929.
- ⭐ Signal 7 (`local_15143c7c-ff38-46dd-9e99-d61e502e6057`) owns monitoring,
  wake-ups and the operator relay. Send it PR heads; don't poll.
- Write the operator's times in Pacific.
- Verify everything below live.
- **Approvals don't cross sessions.** The operator's words quoted here were given
  in Rowan 5's chat and are record, not new approval for you.

## State at handoff (verify live)
- Production is Inactive · Idle, revision 123, epoch 66. No START card exists.
- Main is `82b9bad9b` or later. Main CI is green through `c2859d022`. Services
  were restarted on `c2859d022`; later merges are records-only.
- start-run.sh on main hashes to `a7368fb6…` (changed by #2445). Any new START
  card must pin it, and START needs `start-run gate-check` in the main checkout,
  which is already present.
- `active_plan` still names the finished
  `record-run-unattended-test-pins-20261107-part-2`, with no `current_action`.

## Done since Rowan 4 → Rowan 5
- **B2 is complete.** Merged under 0182 C at independently reviewed heads:
  - #2435 (#1646);
  - #2439 (#2102, hardened twice);
  - #2444 (#1670);
  - #2446 (#1249, with the overwrite guard and remedy entry).

  #2445 (START gate-check, refs #2038) was merged on the operator's words.
  #2038 stays open for its reviewer-capacity remainder.
- **Item 2 CI:**
  - #2434 merged.
  - #2440 re-enabled the dashboard-live case and closed #2284 (operator 1A).
  - #2438, the #2129 stale-record fix, was merged on the operator's words.
- **Spend:** #2437 emptied the paid allowlist under Decision 0213 A (operator 3A).
- **Item 3:** Decision 0214 opened (#2442) and was answered **A**:
  - #2447, operator: "Yes, merge #2447";
  - the A itself came from the operator's "Merge both; 0214 A".

## In flight
- **#2453** (head `e016f6775`) adds the INACTIVE draft Plan
  `carry-out-decision-0214-answer-a-unattended-production-s-worker-may-merge-src`.
  The operator said "Yes, plan it" in Rowan 5's chat.
  - Review: round 1 APPROVE WITH NITS, then the nits were fixed by a governed
    amendment and the round 2 delta review is APPROVE.
  - It is records-only. **Merge it under 0182 C once CI is green and it is
    CLEAN**, if Rowan 5 hasn't already.
- **The Plan's Actions:**
  1. `implement-a-classifier-coverage-audit`, with a repeatable discovery scan
     over `src/**`;
  2. `implement-decision-0214-a-in-src`, which depends on 1.

  Activating the Plan is the operator's step, and each Action's PR is the
  operator's merge, because each changes what agents may do.

## Open loose ends
- CodeRabbit thread 4522647132 on merged #2446 is fixed in code but
  unresolved, because the auto-mode classifier denied the resolve.
- Pre-existing failure: tests/production-replay.test.ts "whole chain" fails
  with ENOTDIR in the dependency-bridge fixture, on main too. No Issue is filed
  yet; file one if it recurs.
- #2444 review nit 2: a held `self_settled_completion_refused` escalation
  raises no red alert. This predates #2444; it's a follow-up if the operator
  wants a loud alert.

## Known traps (verified this session)
- **`arcadia decision approve` commits to the MAIN checkout, even when run from
  a linked worktree.** docs/notes-to-self.md says otherwise and is stale.
  Remedy: cherry-pick the commit onto the candidate, then
  `git -C <main> reset --keep <origin/main sha>`. Lesson recorded.
- **`agent-ask settle`** for decision or plan intents commits inside the
  worktree, as expected. A draft Plan needs `--responsibility agent`.
- **A coordinator's own delta review is not independent.** Use a separate
  read-only critic, even for a two-line delta. Lesson recorded.
- **Reviewers can't run these tests from a `git archive` copy.** Brief them to
  use their own detached worktree, plus `node scripts/bridge-worktree-deps.mjs`.
- **Helpers and critics can leave background work holding a slot.**
  `TaskStop` them after they report. The overnight cap is 3 Sonnet helpers.
- **Identity:** put the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` prefix on the same
  command as every git commit. Claude heavy is Claudia Atlas; critics sign as
  Critic Claudia Mason.
- **Restart:** use `restart-arcadia-services` after fast-forwarding the clean
  main checkout. Only do it while production is Inactive.

— Claudia Atlas <claudia.atlas@agents.arcadia.local>
