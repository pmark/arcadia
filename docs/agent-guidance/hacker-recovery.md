# Hacker recovery: change the diagnosis, preserve the boundaries

Hacker mode is bounded recovery from procedural fixation: challenge an assumed
route, find the smallest existing authorized path, prove it works, then resume
the task. It is not a model, permission switch, security bypass or new runner.
The operator selected recovery as a specialization of existing roles, recorded
in [the Project Log](../../MISSION_LOG.md) by Agent Ask
`record-hacker-existing-role-choice-20261014`. Decision 0100's seven-role
taxonomy stays unchanged. An assigned Lead diagnoses; an authorized implementer
is the sole repair writer. Hacker is a mode, not a registered role ID: do not
pass `--role hacker` to the CLI.

## Mode contract

- Responsibility: turn a stuck authorized repair into a verified recovery path
  and bounded repair, or an exact actionable blocker.
- Keep the assigned role, identity, attempt lineage, supervision and candidate
  custody. The mode adds no delegation or independent-review eligibility and
  never launches or admits a Session. A separately authorized helper uses an
  existing eligible role under Decision 0114; never two writers.
- Keep the assignment's authorized model, effort and remaining allowance. Use
  light-tier read-only diagnosis when sufficient and authorized. Actual
  provider/model/effort comes from the runtime binding; unknown values remain
  unknown. The mode supplies no independent model default or spend allowance.
- Required artifacts: failed receipt and hypothesis, verified route or blocker,
  preservation/custody evidence, regressions and repair when authorized, final
  head's independent review/checks, reusable prevention in the owning procedure.
- Activation ends at verified continuation or the finite pass deadline. Return
  help to the Lead; never self-renew an allowance or manufacture a successor.

The original taxonomy proposal is archived after the operator's choice; it is
not an outstanding registration prerequisite. Source guidance, installed skill
adoption and automatic invocation remain separate. No automatic trigger wiring
or new executor is established by this contract.

## Activation: agents and supervisors must change strategy

Enter recovery analysis on the first persistent workflow refusal. **Two
attempts with the same refusal and no changed precondition require Hacker
mode before another attempt.** An explicit stop-the-line/red-alert request
activates it immediately. Repeated discussion of the same refusal also counts;
a different command spelling or another agent repeating it is not progress.
A supervisor must identify this pattern and require the bounded recovery below
within its assignment, instead of commissioning another unchanged retry.
This does not automatically authorize spawning, messaging, spending or takeover.

## One bounded pass

Use the existing assignment's finite budget and deadline. Cap the first diagnosis
at ten minutes and three plausible routes, or the assignment's smaller limit;
these are ceilings, not a new allowance. If no inference allowance exists, read
deterministic evidence and request the exact missing allowance. Do not restart
the clock by replacing the agent.

1. Bind the request, failure receipt, current revision, original candidate,
   live owner, protected data, last proven progress and actual model/effort.
   Distinguish a direct operator Issue repair from governed Action continuation.
   Search Notes To Self and load the indexed procedure for that classification.
2. Separate facts from assumptions. A route refusing `reservation_missing`
   proves the binding is absent for that route; it does not prove every host
   route is unsupported. Conversely, a credential or security refusal is a
   boundary, not a challenge to evade. State what evidence would change either
   diagnosis.
3. Inventory only existing supported host/API/CLI routes. Check prerequisites
   read-only first, then choose the smallest authorized route. Compare a fresh
   isolated repair candidate with resuming a retained candidate; preserve the
   latter's commits, dirty files and ignored data. Do not reconstruct Go
   operations, fabricate enrollment, edit SQLite or build substitute brokers.
   A permission refusal is never resolved by switching tools to evade it.
   An initial sandbox denial may use the host's ordinary permission-request
   mechanism for the same supported operation; proceed only if granted.
4. Verify the chosen route's actual receipt, base revision, candidate and sole
   writer before edits. If custody of the chosen candidate cannot be proven,
   do not mutate it; continue read-only diagnosis or assess a separately
   authorized candidate with verified sole-writer custody. A supported
   alternative must satisfy the same task and boundaries, not quietly weaken
   acceptance, tests, review or branch protection.
5. Hand one implementer a finite repair scope with failing regressions first.
   Other agents are read-only; the Lead pauses edits. Review the final head
   independently and retain required checks. An unsupported route ends with its
   exact refusal, missing prerequisite and smallest operator unblocker, not a
   claim that an unavailable capability exists.

At the pass deadline report either a verified route and next useful step or the
precise blocker. Another pass requires materially new evidence or changed
preconditions within remaining authority/budget. Evidence gain, a failing test,
a preserved commit or a verified route counts as progress; more chatter does not.
Record elapsed time and measured usage when available, otherwise `unknown`.

## Learned example: PPN Issue 292

After PR280 merged, the retained candidate lacked a manual Go reservation.
Repeated enrollment/advance attempts treated a directly requested offline repair
as current-Action continuation. The reservation refusal was accurate; the
inference that no repair path existed was wrong. The existing operator-directed
Issue + PR procedure and Codex host `create_worktree` API supplied a fresh
candidate pinned to merged main, preserving the retained candidate. Exactly one
writer added output-safety regressions, repaired the script, and independent
final-head review preceded PR293's approved merge.

Evidence: [Issue292](https://github.com/pmark/private-practice-now/issues/292),
[PR293](https://github.com/pmark/private-practice-now/pull/293), merge
`e4faaa399c85fe2a3b52d528d332cee857c71134`. This verified route required no
Arcadia host-source repair. It is not a universal remedy for missing custody,
unsupported host APIs, permissions or genuine production prerequisites.
Production remained Off; credentials, real email, external collectors,
Turnstile and live inquiry tests were outside scope. The Action and pointer
were not completed or advanced.

## Complementary simplification

After a verified recovery, use [code simplification](code-simplification.md)
only for an assigned cleanup or concrete maintainability finding. Existing
planner/critic/implementer responsibilities suffice. Protect the urgent repair's
scope and acceptance; defer broader cleanup with a named revival trigger.

## Hand-back and prevention

Persist the failed receipt, incorrect assumption, route tested, exact successful
command/API and receipt, protected candidate, validation and stop boundary in
the existing report/Notes To Self paths. Separate verified remedy from theory.
Fix the owning procedure or guard so the next supervisor sees the classification
and trigger before repeating the failure; capture missing capabilities through
Agent Asks. No second memory store, watcher, automatic launch or service install.

For assignment protocol use [arcadia-hacker](../../.agents/skills/arcadia-hacker/SKILL.md).
Mode assignment, model selection, launch/admission and permissions remain
separate facts; the Hacker label proves none of them.
