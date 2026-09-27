---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia (tidy and go) reconcile a problematic branch or worktree by checking whether its work already landed under a different identity, instead of stopping at "no remote copy" or "not launched through Arcadia" and handing the forensic work to whichever agent hits it next -- and can every such deletion be made unconditionally safe by archiving first, so the reliability bar for this feature is not "the classifier is always right" but "losing work is structurally impossible regardless"?
---

# Reconcile branches and worktrees by outcome, not identity

## Why this project needs it

One `arcadia go` session hit two separate instances of the same shape of
problem back to back, and both took multi-step manual forensic investigation
to resolve safely — the kind of investigation that should be a deterministic
check, not something re-derived by hand every time an agent stumbles into it.

**Incident 1 — a worktree `go` refused to touch.** `arcadia go` refused to
prepare a new worktree because an existing one
(`add-fixture-coding-agent-provider-20260927T045839819Z`) held uncommitted
changes and "was never launched through Arcadia, so its exit cannot be proven
terminal." The remedy it printed was "preserve it or discard it by hand."
Resolving that required: reading the worktree's git log, diffing its tip
commit against `main`, running `gh pr list --head <branch>` to find the PR,
confirming the PR was merged, and diffing the branch's commits against the
squash-merge commit on `main` to confirm no content was lost (GitHub squash
merges break commit-hash identity, so `git merge-base --is-ancestor` reports
`false` even when every line landed). Only after that chain of checks was it
safe to say the worktree was pure cruft.

**Incident 2 — `arcadia tidy --apply` surfaced two branches it wouldn't
touch.** Both were flagged only as "has 1 unmerged commit and no remote copy.
This is the only copy" — true, but not the question that mattered. Both
branches were single-commit forks recovering a drifted Agent Ask file. The
real question was whether the *effect* that Ask described had already
happened through the normal settlement pipeline under a different
`request_id` (Arcadia's own `-v2` recovery pattern does exactly this:
re-drafts and resettles under a new id, which orphans the original recovery
branch without ever merging it). Resolving that required reading each
branch's sole commit content, extracting the target Action id and acceptance
criteria, and grepping `MISSION_LOG.md` for a completion entry whose
criteria matched verbatim.

In both incidents, git ancestry (`merge-base --is-ancestor`) was the wrong
signal — it says "not merged" for content that unambiguously already shipped,
because Arcadia's own settlement conventions (squash merge, `-v2` resettlement
under a new id) legitimately break commit-hash lineage. The signal that
actually answered the safety question was **outcome equivalence**: does a
record already exist (a merged PR, a `MISSION_LOG.md` completion entry, a
settled Agent Ask) whose *content* — not commit hash — matches what this
branch would contribute. That check is mechanical and repeatable; it should
not require an agent to rediscover the method each time.

## What we would build locally

A `scripts/reconcile-branch.mjs` (or similar) that walks orphaned worktrees
and branches, tries to match each one's content against `gh pr list`,
`MISSION_LOG.md`, and settled `.arcadia/asks/` records, and prints a verdict —
essentially reimplementing a chunk of `tidy`'s own classification logic and
GitHub-state awareness from outside it, which is the exact local-reimplementation
failure mode Decision 0025 exists to prevent.

## What we're actually asking for

Extend `arcadia tidy` (and the `go` worktree-safety check it shares logic
with) with an **outcome-equivalence check** as a second classification pass,
run only on candidates that fail the existing identity check (no remote copy /
not ancestor of base):

1. For a branch/worktree whose **entire diff against its merge-base is
   confined to `.arcadia/asks/*.yaml`** (no other file touched), parse the
   Ask's `request_id` prefix and `target_ref`/Action id, and check
   `MISSION_LOG.md` for a completion entry against that same Action whose
   acceptance criteria match verbatim (or a settled Ask under a `-v2`/`-v3`
   sibling `request_id`). A branch whose diff includes anything beyond the
   Ask file does not qualify for this path — matching only the Ask's
   criteria would say nothing about whatever else the branch changed. Such a
   branch falls through to check 2, which covers the full diff.
2. For a branch with an associated GitHub PR, check the PR's merge state via
   `gh pr list --head <branch> --state all` (the default is open-only and
   would silently miss every merged PR, which is the case that matters here);
   if merged, diff the branch tip against the merge commit's tree (not its
   hash) to confirm no content is missing.
3. Report each candidate as **reconciled** (safe to discard, with the
   evidence — PR URL, Mission Log entry — cited in the tidy report) or
   **needs attention** (unchanged from today) — never auto-delete. The
   destructive step stays exactly as gated as it is today (operator-run, or
   an agent action the auto-mode classifier still stops for); this only
   removes the forensic burden of deciding *which* branches are candidates
   for that step.

This is scoped to reconciliation-safety classification only. It does not
change who is authorized to delete a branch or remove a worktree, and it does
not touch `go`'s or `tidy`'s existing apply-time mutation logic.

## The reliability requirement: archive first, unconditionally

The operator reviewing this session's cleanup put the actual bar plainly:
*"reliability must be 100% every time... absolutely impossible to lose work."*
That bar cannot be met by making the outcome-equivalence check above more
thorough — checking PR merge state, Mission Log text, and Ask settlement
records is judgment over unbounded input (What if the PR description lies?
What if Mission Log phrasing drifts? What if two Actions share near-identical
acceptance text?), and no judgment process over unbounded input can be proven
correct in 100% of cases. Chasing that is the wrong target.

The right target is making a wrong judgment cost nothing. This session found
the mechanism by necessity: after deleting two orphan branches with
`git branch -D`, we confirmed their commits were still present as loose
objects with **no reflog entry** (branches don't get reflogs by default) and
**no fixed retention window** — they would have survived only until the next
opportunistic `git gc` decided to prune them, which is not a bounded or
predictable amount of time. That gap — real data, temporarily alive only by
the accident of not having been garbage-collected yet — is exactly what
"impossible to lose work" rules out. We closed it after the fact with
`git update-ref refs/arcadia/archived/<name>-<timestamp> <sha>`: an ordinary
ref, which `git gc` treats as a permanent root exactly like a branch or tag,
with no expiry.

**The proposed rule, stated as an invariant rather than a check:** no
automated or generated-script deletion of a branch or worktree branch may
happen without *first*, unconditionally, creating a `refs/arcadia/archived/`
ref pinning its tip commit — regardless of how confident the preceding
equivalence check was, regardless of whether a merged PR or Mission Log entry
was already found. Confidence in the classification only ever decides whether
to proceed to the (now costless) archive-and-delete step; it never substitutes
for taking it. A demonstrated, tested implementation of exactly this — a
`archive_and_delete_branch` helper, unconditional, idempotent, additive-only —
now lives at
`artifacts/generated/operator-scripts/lib/archive-before-delete.sh`. That path
is local to the machine that wrote it and intentionally **not part of this
diff**: `artifacts/generated/` is gitignored by existing convention (it is
`/runs`'s local execution state, not reviewed code), so it will not appear in
this PR and cannot be inspected from it directly — it is cited here as
existing, tested prior art, not as something this PR ships. Once this proposal
is accepted, the equivalent logic needs to live in Arcadia's own
implementation (`tidy`/`go`, in `src/`) to be the shared primitive both the
`tidy` extension and any future generated operator-script deletion route
through, rather than each caller re-deciding whether archiving is warranted
this time.

Retention of `refs/arcadia/archived/*` is deliberately not addressed here:
storage is cheap, an unreachable-but-archived ref costs nothing to keep
indefinitely, and pruning it is a separate, much lower-stakes decision that
can wait for its own trigger (disk pressure, ref-count noise in tooling) rather
than being designed pre-emptively now.

## UX: what the operator actually sees

`OPERATOR_CONTEXT.md` sets the bar this has to clear: low cognitive overhead,
ruthless brevity, and approval boundaries the operator sets once rather than
re-litigating per branch. Today's `arcadia tidy --apply` output already aims
there but falls short at exactly the moment this proposal targets — the
"needs your attention" tier states a git fact ("no remote copy") without
saying what was checked or what to do about it:

```
Needs your attention (2) — nothing below was touched:
  ! Branch ask/recover-recovered-3563e94e has 1 unmerged commit and no remote copy. This is the only copy.
```

That sentence is true and unhelpful. It reads as a warning but the actual
finding — that this branch's content already shipped elsewhere — is exactly
backwards from what the wording implies. An operator without deep git fluency
cannot act on it without either trusting it blindly or handing it to an agent
to re-derive the investigation this proposal exists to make unnecessary.

**Two report tiers, replacing today's single "needs your attention" bucket**,
each stating what tidy checked and what recovery looks like, since
"impossible to lose work" is only a real promise to a non-technical operator
if getting something back never requires reading git internals:

```
Reconciled and cleaned up (2) — already verified, archived, and removed:

  ✓ Branch ask/recover-recovered-3563e94e
    Why it's safe: this work already shipped. Mission Log confirms Action
    "place-session-naming-screenshot" completed 2026-09-25 with the same
    three acceptance criteria this branch's Agent Ask described.
    Undo: arcadia tidy restore ask-recover-recovered-3563e94e-20260927T154841Z

  ✓ Branch ask/recover-recovered-7ee04f15
    Why it's safe: Mission Log confirms Action
    "fix-decision-approve-missing-commit" completed 2026-09-25, closing
    Issue #645, with matching acceptance criteria.
    Undo: arcadia tidy restore ask-recover-recovered-7ee04f15-20260927T154841Z

Needs your decision (0) — tidy could not confirm these are already captured:
  _None this run._
```

Three rules this shape encodes:

1. **Every reported deletion already happened by the time it's shown**, and
   states why, in one plain sentence — not "1 unmerged commit," but the
   actual Mission Log entry or PR that makes it safe. This is only honest
   because of the archive-first invariant above: a report can say "cleaned
   up" instead of "proposed for cleanup" precisely because nothing was placed
   at risk by doing so automatically. Reconciled items no longer need an
   operator's individual sign-off, the same way `arcadia go`'s own
   worktree-safety check does not ask permission to leave a *provably* clean
   worktree alone — this is that same bar applied to a provably safe removal.
2. **Every deletion prints its own undo command, inline, in the same
   breath.** Not "see docs/notes-to-self.md," not "ask an agent to restore
   it" — a copy-pasteable command a non-technical operator can run without
   knowing what a git ref is. This is the actual point of the archive
   invariant: an archive nobody can retrieve without engineering help is not
   meaningfully different from a deletion.
3. **"Needs your decision" becomes an actual decision**, per the Constitution's
   picker convention (every option states its consequence), when tidy finds a
   candidate it cannot reconcile:

   ```
   Needs your decision (1):
     ! Branch some-branch — 1 commit, no remote copy, no matching PR or
       Mission Log entry found. This may be real, unrecovered work.
       [1] Keep it as-is — no risk, revisit later
       [2] Archive and remove — fully reversible; frees it from `tidy`'s
           attention list, same undo command as above
       [3] Show me what's in it — prints the commit's diff before you choose
   ```

   Option 2 is safe to offer even for *unreconciled* candidates, because
   archiving is unconditional and reversible regardless of confidence — the
   distinction between "reconciled" and "needs your decision" only ever
   controls whether tidy acts on its own or waits to be told, never whether
   the underlying operation is safe.

**A restore command**, `arcadia tidy restore <archived-ref-name>` (equivalent
to `git branch <original-name> refs/arcadia/archived/<archived-ref-name>` plus
a confirmation echo), is the load-bearing piece of this whole design. Without
it, "everything is backed up" is a promise only an engineer can redeem, which
fails the "most users" bar this proposal answers to. `arcadia tidy
--list-archived` (or a standing section in plain `arcadia tidy` output when
the list is non-empty) gives the same operator a way to browse what exists
without knowing `git for-each-ref refs/arcadia/archived/` is where to look.

If the original branch name already exists again by the time of a restore
(recreated independently, or restored once already), `git branch
<original-name> ...` refuses outright rather than overwriting anything — so
the failure mode is a clear error, not silent data loss. `tidy restore` should
surface that refusal plainly and offer the one safe alternative: restore under
a suffixed name (`<original-name>-restored`) and let the operator rename it
themselves once they've looked at both. It must never force-overwrite the
existing branch to make the original name available.

None of this changes behavior for a candidate tidy cannot reconcile today —
those still stop and wait, unchanged, unless the operator picks option 2
above. The UX change is additive: turn a dead-end git fact into a resolved
receipt with its own undo, wherever the evidence supports it.
