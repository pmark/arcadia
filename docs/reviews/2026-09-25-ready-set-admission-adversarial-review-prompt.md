# Adversarial review prompt: ready-set admission and pipelining

Paste this whole file as the task for an independent coding agent (Codex,
Claude Code, opencode, or any other). Run it with a *different* agent/model
than the one that produced the design, and run it more than once if you can
afford several — different agents and different seeds surface different
failure modes. The goal is to find reasons this is unsafe or wrong, not to
confirm it is fine.

---

## Your role

You are an adversarial reviewer, not a collaborator. Do not fix anything and
do not soften findings to be diplomatic. Assume the author was competent and
still made a specific, locatable mistake — your job is to find it. A review
that returns "looks good" without having tried hard to break the design is a
failed review. If you truly find nothing after genuinely trying every angle
below, say so explicitly and say what you tried.

Do not trust the design documents' own claims about safety. Where a document
says "this needs no proof run" or "nothing else has to change," treat that as
a claim to disprove, not a fact to repeat back.

## What you are reviewing

Arcadia is adding **ready-set admission with pipelining** to its managed
production worker — the mechanism that lets it dispatch coding-agent Sessions
across repositories with less operator involvement. Read these in order:

1. `docs/proposals/portfolio-parallel-execution.md` — the design.
2. `docs/decisions/0071-decide-whether-to-reopen-decision-0023-and-adopt-ready-set-admission-for.md`
   — the ratified Decision, superseding
   `docs/decisions/0023-work-pointer-under-concurrency.md`.
3. `docs/decisions/0070-decide-whether-an-action-s-completion-settles-after-its-pr-merges-applied.md`
   and `docs/decisions/0066-record-when-arcadia-should-widen-beyond-one-coding-agent-session-per-repository.md`
   — the two Decisions this design leans on without re-litigating.
4. `docs/managed-production-readiness.md` — current state, in particular the
   "Concurrency" and "The gates" sections.
5. The three Actions this design produced, in
   `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`:
   `resolve-cross-plan-dependency-ids`, `admit-ready-set-across-repositories`
   (six acceptance criteria, the sixth added after the fact — read it
   closely), and `pipeline-independent-actions-while-pr-unmerged`.
6. The code these Actions will touch:
   `src/ask/settlement.ts` (`selectNextAfterCompletion`, the settlement path),
   `src/scheduling/order.ts` (`canonicalOrder`, dependency resolution),
   `src/production/tick.ts` (the production tick, admission loop),
   `src/production/policy.ts` (`ProductionScope`, `maxConcurrentSessions`,
   scope validation).

None of the three Actions has been implemented yet — you are reviewing a
*design*, encoded as acceptance criteria, before code exists. Point at
specific acceptance-criterion text or specific existing code, not vibes.

## The context you need to know but should not simply accept

The operator's own stated worry, verbatim: pushing for concurrent processing
before proving the sequential single-Action unattended loop is unwise,
because debugging a race is much harder once several sessions can hit it at
once, and because the exact mechanism this design changes
(`current_action`, settlement, claim release) is the one thing the sequential
proof (`prove-two-action-unattended-production`, currently deferred) exists
to validate. In response, a sixth acceptance criterion was added to
`admit-ready-set-across-repositories`: activating a production policy scope
with `maxConcurrentSessions` greater than 1 must be refused, citing
`prove-two-action-unattended-production` by id, until that Action's status is
`done`.

**Do not accept that this criterion actually resolves the concern.** That is
exactly the kind of self-congratulatory design note you should be most
suspicious of. Attack it directly (see below).

## Specific things to try to break

For each, either find a concrete failure scenario (bad input, race, ordering,
a way to bypass the gate) or explicitly conclude you tried and it holds, and
say what you tried.

1. **Is the maxConcurrentSessions gate actually enforced at every path that
   matters, or only at one?** Find every place a `ProductionScope` gets
   constructed or activated (`arcadia production activate`, any programmatic
   path, any test fixture, any default). Is there a way to reach a running
   worker with `maxConcurrentSessions > 1` without passing through the
   validated activation path — a stale policy row, a direct DB write, a
   config default, a migration? A gate checked in one CLI command and
   bypassable everywhere else is not a gate.

2. **TOCTOU on the gate itself.** Between checking
   `prove-two-action-unattended-production`'s status and admitting a Session
   under the raised limit, can the Action's status change (get reverted,
   re-opened, split) in a way that leaves a stale "safe to be concurrent"
   state? Is the check done once at activation time and then trusted forever,
   or re-checked per tick? If once, what happens if the Action's completion
   is later found to be wrong and the Action reopens?

3. **Can `prove-two-action-unattended-production` reach `status: done`
   without actually proving what the gate assumes it proves?** Look at the
   `split` and `complete` Agent Ask intents. Could a `split` narrow this
   Action's acceptance criteria to something trivial, mark that slice done,
   and leave the real proof in a remainder Action with a different id — so
   the gate's `status: done` check on the *original* id passes for the wrong
   reason, or fails to find the real proof under a new id?

4. **The "unknown dependency blocks" fix — does it introduce a livelock or a
   silent stall?** `resolve-cross-plan-dependency-ids`'s acceptance says an
   unresolved id produces a `dependency_unresolved` wait reason "instead of
   being treated as satisfied." What happens when a dependency id is simply a
   typo, or names an Action that was renamed or deleted? Does
   `dependency_unresolved` ever escalate to `needs_operator`, or can an
   Action sit silently unready forever with no operator visibility? Compare
   against how `needs_operator` is surfaced elsewhere in this Plan.

5. **Cross-Plan dependency resolution ambiguity.** The design resolves
   `depends_on` ids first within the same Plan, then across Plans as
   `plan/<slug>#<action-id>`. What happens when two different Plans each
   declare an Action with the *same* bare id, and a third Action's
   `depends_on` names that bare id? Which one wins? Is the resolution order
   documented anywhere a person implementing this would actually see it, or
   only in this review prompt?

6. **Does "current_action becomes a derived projection... recomputed and
   written only by the host settler" actually eliminate the #505/#507 race
   class, or move it?** Decision 0070 makes the host settler the single
   serial writer for completions merged on `main`. But `admit-ready-set-across-repositories`
   also wants the *scheduler* (the production tick) to recompute and write
   this projection every tick. Are the tick and the host settler ever the
   same process, at the same time, writing the same field, without a shared
   serialization point? If they are different processes, what stops a
   stale tick's projection write from landing after a newer settlement's?

7. **SQLite write contention under real concurrency.** The design assumes
   "one SQLite workspace database... plenty for tens of writers" per the
   proposal. With `maxConcurrentSessions` actually raised (once the gate
   opens), and several ticks, settlements, and claim writes happening
   concurrently, does `busy_timeout=15000` actually hold under worst-case
   contention, or does raising concurrency multiply lock-retry failures in a
   way nobody has load-tested? Is there an existing test that exercises this
   at more than 2-3 concurrent writers?

8. **The repository lease's unique partial index has no TTL or heartbeat**
   (noted in the proposal itself, `docs/proposals/portfolio-parallel-execution.md`
   §2). Cross-repository concurrency multiplies the number of leases held at
   once. Does a single stalled/crashed Session now block an entire
   repository's lane for longer, with no other repository affected — or does
   a leaked lease anywhere degrade the whole ready-set computation (e.g., an
   O(n) scan that chokes, or a shared resource that a stuck lease starves)?

9. **`touches:` scope for pipelining (the third Action, still behind the
   proof) — is declared scope trustworthy?** The design explicitly says "an
   Action with no declared `touches:` is treated as touching the whole
   repository," which is the safe default. But is there any code path where
   a *missing* `touches:` field is silently treated as empty (touches
   nothing) rather than as "touches everything," which would invert the
   safety property? This does not need the proof to matter — check it now
   while the acceptance criteria are still just text, before anyone
   implements the opposite of what's intended.

10. **Does the sixth acceptance criterion actually address the operator's
    concern, or just the letter of it?** The operator's worry was about
    debugging difficulty when concurrent sessions can hit a latent race
    together. The gate stops *production* from running concurrently. But
    does anything stop a *test suite* or *local dev harness* from exercising
    `maxConcurrentSessions > 1` before the proof, in a way that could mask or
    misrepresent bugs that only manifest under real worker/DB/tmux
    conditions? Is "the proof passed" actually load-bearing evidence of
    concurrency safety, or does the proof only exercise two *sequential*
    dependent Actions in one candidate (re-read
    `prove-two-action-unattended-production`'s acceptance criteria in the
    Plan — does it test concurrency at all, or only sequencing across
    Sessions)? If the proof doesn't actually exercise concurrent admission,
    gating on it may be a well-intentioned criterion that doesn't test what
    it's supposed to guard.

11. **Anything not on this list.** The list above is a starting point, not a
    checklist to satisfy. If you find a sharper failure mode by reading the
    actual settlement/tick/policy code, report that instead of padding out
    weak findings against every numbered item.

## What to hand back

For each finding: the file and line or acceptance-criterion text it attacks,
the concrete scenario that breaks it (inputs, ordering, timing — not "this
seems risky"), and severity (blocks proceeding / should fix before building /
worth noting). End with one clear verdict:

- **Proceed as designed**, or
- **Proceed, but only after naming exactly which acceptance criteria need to
  change first**, or
- **Hold — build the sequential proof first**, with the specific reason the
  gate you found does not actually mitigate the operator's concern.

Do not hedge the verdict into a non-answer. Pick one.
