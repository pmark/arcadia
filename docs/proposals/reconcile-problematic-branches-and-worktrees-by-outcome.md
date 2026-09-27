---
arcadia: v1
type: proposal
project: arcadia
question: Can `arcadia tidy` recognize a branch as safe to retire when its work shipped through Arcadia's own settlement pipeline (a completed Action, or the Ask itself already settled) rather than through git, as a fourth proof alongside the three `evaluateMerge` already has -- reusing its existing archive-tag-and-compare-and-swap deletion exactly as-is, with no new deletion mechanism and no new authority?
---

# Recognize settlement-equivalent branches, using tidy's existing archive-and-retire path

## Revision note

This proposal originally claimed a much larger gap than actually exists, and
an independent review (Opus, plus CodeRabbit on the first draft of this PR)
found that most of it was already built. That review is the reason this
document looks the way it does now. The corrected, narrow version follows;
see "What this proposal got wrong the first time" at the end for the record.

## Why this project needs it

`arcadia tidy --apply` flagged two branches it wouldn't touch:

```
Needs your attention (2) — nothing below was touched:
  ! Branch ask/recover-recovered-3563e94e has 1 unmerged commit and no remote copy. This is the only copy.
  ! Branch ask/recover-recovered-7ee04f15 has 1 unmerged commit and no remote copy. This is the only copy.
```

Both were single-commit branches whose only change was a recovered
`.arcadia/asks/*.yaml` file. Investigating them by hand
(`MISSION_LOG.md:764`, `MISSION_LOG.md:813`) showed both were long since
resolved, in two different ways that both fall outside what git can prove:

- Branch `ask/recover-recovered-3563e94e` carried a `complete` Ask targeting
  Action `place-session-naming-screenshot`. That Action was completed under a
  *different*, later-settled Ask (`complete-place-session-naming-screenshot-2026-09-25-v2`),
  with the same acceptance criteria. The branch's own Ask was superseded, not
  merged.
- Branch `ask/recover-recovered-7ee04f15` carried an `action` Ask (no
  `target_ref`) that itself creates the Action `fix-decision-approve-missing-commit`.
  That exact Ask, under its own `request_id`, was settled directly —
  `docs/plans/bootstrap-managed-production-to-build-flight-deck.md` records
  `source: Agent Ask fix-decision-approve-missing-commit-2026-09-25` on the
  Action it created. Nothing superseded it; it simply never needed to be
  merged as a branch, because Arcadia's settlement pipeline applies an Ask's
  effect directly to governed documents, not by merging the branch that
  proposed it.

`tidy`'s `evaluateMerge` (`src/commands/tidy.ts`) already proves a branch safe
three ways — ancestry, patch-equivalence (catches squash/rebase/cherry-pick),
and a verified PR-merge-commit — and already retires proven-safe branches
through `retireBranch`, which writes an `archive/tidy/<sha>` tag via
compare-and-swap before force-deleting, and prints the restore command inline
in its report. All of that is correct and needs no change. What none of the
three proofs can see is a branch whose content was never merged by git at
all, because Arcadia's own settlement pipeline — not a merge commit —
applied its effect. That is a real, structural blind spot, and it is the
entire scope of this proposal.

## What we're actually asking for

Add a **fourth proof**, `settlement-equivalent`, that `assessBranches` tries
only after `evaluateMerge` reports `merged: false`, and only for a branch
whose full diff against its merge-base touches **one or more files matching
`.arcadia/asks/*.yaml` and nothing else**. (A branch with any other file
changed does not qualify for this path at all — under-coverage here is worse
than no coverage, since it would misclassify real unrelated work as safe to
discard.)

For **every** `.arcadia/asks/*.yaml` file the branch adds or changes (a
branch can carry more than one Ask; each one needs its own evidence — a
single covered Ask does not clear the whole branch):

1. Parse that Ask's `request_id`, `intent`, and `target_ref`.
2. If `intent: complete` with a `target_ref` Action id: search
   `MISSION_LOG.md` for a "Completed `<project>/<action-id>`" entry whose
   `Result` acceptance-criteria text matches the Ask's own `evidence[].criterion`
   entries verbatim (covers both "this exact Ask was the one that settled it"
   and "a `-v2`/`-v3` sibling `request_id` settled the same Action later").
3. Otherwise (an `action`, `plan`, or other intent with no single completion
   target): search `MISSION_LOG.md` and governed plan documents under
   `docs/plans/` for evidence that this *exact* `request_id` was itself
   already settled (a Mission Log entry naming it, or a `source: Agent Ask
   <request_id>` citation on an Action it created).
4. The branch is `settlement-equivalent` only if every Ask file found in step
   0 clears step 2 or 3. One uncovered Ask file means the whole branch falls
   through to today's unchanged "unmerged... no remote copy" reporting.

A branch classified `settlement-equivalent` is handed to the **exact same**
`retireBranch` function `merged` branches already use — same
`archive/tidy/<sha>` tag, same compare-and-swap delete
(`deleteBranchRefIfUnchanged`), same inline restore line in the report. This
proposal adds no new deletion mechanism, no new archive namespace, and no new
generated-script helper: reusing `retireBranch` unchanged is the entire point,
since a second, parallel archive-and-delete path is exactly the kind of local
reimplementation Decision 0025 warns against, and the first draft of this
proposal did precisely that with a helper that turned out to have real
correctness bugs (silent data loss on a name collision, no propagation of a
failed archive) that `retireBranch`'s existing compare-and-swap design does
not have.

Because this reuses `retireBranch` exactly, it inherits its existing
authority envelope: `tidy --apply` already retires proven-`merged` branches
without a per-branch approval prompt today, because the archive tag makes it
information-preserving. `settlement-equivalent` claims no new authority
beyond that same, already-granted class of action — it only adds a second way
to reach the same "proven safe to retire" verdict `merged` already means.

## Explicitly out of scope

- **Dirty or untracked worktree content.** `tidy` already never touches a
  dirty worktree, and this proposal does not change that. The original
  incident that motivated this thread also involved a worktree with an
  untracked file, destroyed by `git worktree remove --force` with nothing
  archived — that is a real gap, but it is a *worktree-removal* gap
  unrelated to branch classification, and folding it in here would blur two
  different problems. If it recurs, it should be its own proposal, scoped to
  requiring `tidy`'s worktree-removal path to refuse (or snapshot) dirty
  state, the same way it already refuses for branches.
- **`go`'s worktree-safety refusal not consulting `tidy` at all.** The
  worktree in that same incident was, separately, fully provable as merged by
  `evaluateMerge`'s existing patch-equivalence/PR-merge-commit proofs — `go`
  simply never asked `tidy` before refusing and pointing at manual
  investigation. That is a real, independent, narrower opportunity (teach
  `go`'s worktree-safety check to consult `evaluateMerge` before refusing on
  launch-provenance grounds) but it is a `go`-side integration question, not
  a branch-classification gap, and is left for its own proposal.
- **`evaluateMerge`'s PR-proof not checking the local branch tip against the
  PR's actual merged head** — a real, narrow, pre-existing correctness gap,
  filed as
  [pmark/arcadia#736](https://github.com/pmark/arcadia/issues/736) rather
  than bundled here, since it applies to the existing `pull-request` proof
  and has nothing to do with settlement-equivalence.

## What this proposal got wrong the first time

The original version of this document (and PR #734's first pushed commit)
claimed `tidy` had no archive-before-delete mechanism and no squash-merge
detection, and proposed building both from scratch, including a standalone
`archive-before-delete.sh` helper described as "tested." An independent Opus
review, given full access to the repository, found:

- `tidy.ts`'s `retireBranch`/`evaluateMerge` already implement
  archive-before-force-delete (via a compare-and-swap `archive/tidy/<sha>`
  tag) and three-way merge proof (ancestry, patch-equivalence, verified
  PR-merge-commit), and `START_HERE.md` already documents this. The proposal
  was reinventing shipped functionality without having read it first.
- The standalone helper had a real silent-data-loss bug (a branch-name
  collision after slash-to-dash normalization skipped archiving but still
  deleted) and no test suite backing the "tested" claim beyond one
  happy-path check.
- The stated safety guarantee ("losing work is structurally impossible") was
  overstated: it never covered dirty/untracked worktree content, which is
  exactly what was at risk in the incident that motivated it.
- The proposed UX ("reconciled items no longer need an operator's individual
  sign-off") contradicted `CONSTITUTION.md`'s hard stop on deletion without a
  Decision. This revision resolves that by claiming no new authority at all
  — reusing `retireBranch`'s already-granted authority instead of asserting a
  new one.
- Several git-mechanics claims were simply wrong (this repo has
  `core.logallrefupdates=true`; the "loose objects" cited were actually
  already packed), and one of the two motivating branches was
  mischaracterized (assumed superseded by a `-v2` Ask when it was actually
  settled directly under its own `request_id` — corrected above).

CodeRabbit's review of that first draft independently caught two more real
gaps folded into this version: a branch can carry more than one Ask file (the
original design checked only "the Ask," singular), and any deletion path
needs an explicit compare-and-swap on the archived tip, not an unconditional
force-delete — both already true of `retireBranch`, which is exactly why this
revision reuses it rather than re-deriving its guarantees.
