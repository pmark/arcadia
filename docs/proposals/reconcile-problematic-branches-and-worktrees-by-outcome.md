---
arcadia: v1
type: proposal
project: arcadia
question: Can `arcadia tidy`'s report line for a branch it cannot prove merged add an advisory note when Arcadia's own settlement records suggest the branch's effect already shipped through a completed Action or a directly-settled Ask -- purely informational, with no change to tidy's verdict, no retirement, and no new deletion authority of any kind?
---

# Note settlement-equivalent evidence in tidy's report -- report only, no new deletion authority

## Revision note

This proposal has been rewritten twice in response to independent review, and
both revisions are kept below for the record rather than erased, because the
pattern across them is the actual lesson. The current version asks for far
less than either predecessor: an advisory annotation only, with no change to
what `tidy` deletes or retires. See "What this proposal got wrong" at the end
for the full account of both prior drafts.

## Why this project needs it

`arcadia tidy --apply` flagged two branches it wouldn't touch:

```
Needs your attention (2) — nothing below was touched:
  ! Branch ask/recover-recovered-3563e94e has 1 unmerged commit and no remote copy. This is the only copy.
  ! Branch ask/recover-recovered-7ee04f15 has 1 unmerged commit and no remote copy. This is the only copy.
```

Both were single-commit branches whose only change was a recovered
`.arcadia/asks/*.yaml` file. Investigating them by hand
(`MISSION_LOG.md:764`, `MISSION_LOG.md:813`) took several steps and showed
both were long since resolved, in two different ways that git cannot see:

- Branch `ask/recover-recovered-3563e94e` carried a `complete` Ask targeting
  Action `place-session-naming-screenshot`. That Action was completed under a
  *different*, later `request_id`
  (`complete-place-session-naming-screenshot-2026-09-25-v2`), with the same
  acceptance criteria.
- Branch `ask/recover-recovered-7ee04f15` carried an `action` Ask (no
  `target_ref`) that itself creates Action `fix-decision-approve-missing-commit`.
  That exact Ask was settled directly, under its own `request_id` — the plan
  document it created the Action in records `source: Agent Ask
  fix-decision-approve-missing-commit-2026-09-25`.

Neither branch's content is, or ever will be, present on `main`: Arcadia's
settlement pipeline applies an Ask's *effect* to governed documents directly;
it does not merge the branch that proposed it. `tidy`'s three existing merge
proofs (`evaluateMerge` in `src/commands/tidy.ts`: ancestry, patch-equivalence,
verified PR-merge-commit) are all, correctly, about content reaching `main`,
so none of them can or should call a branch like this "merged." That is not a
bug in `tidy` — `START_HERE.md:1613` states the actual safety rule plainly:
*"nothing is removed unless its working tree is clean and every branch change
is proven present on the base branch."* A settlement-equivalent branch fails
that test by construction, and should keep failing it. This proposal does not
ask `tidy` to retire such a branch. It asks for a better report line while
`tidy` continues to leave it alone.

## What we're actually asking for

When `tidy` reports a branch as unmerged, and that branch's full diff is
confined to one or more `.arcadia/asks/*.yaml` files **added or changed** (a
deleted or renamed Ask file disqualifies the branch from this check entirely
— there is nothing to look up evidence for, and a deletion-only diff must not
pass an "every Ask has evidence" check vacuously by having no Ask to check),
have it also check — best-effort, informationally — whether Arcadia's own
settlement records show the Ask(s) already took effect, and if so, append
that evidence to the existing report line rather than changing the verdict:

```
Unmerged branches (1) — never touched by tidy:
  · ask/recover-recovered-7ee04f15 — 1 commit on ask/recover-recovered-7ee04f15
    not on main; NO remote copy.
    Note: Ask fix-decision-approve-missing-commit-2026-09-25 appears already
    settled — see MISSION_LOG.md:813 and
    docs/plans/bootstrap-managed-production-to-build-flight-deck.md:2043.
    Verify before deciding; tidy does not act on this by itself.
```

This claims **no new authority and changes no deletion behavior whatsoever**.
The verdict stays `unmerged`; `retireBranch` is never invoked for a branch
recognized this way; nothing about `--apply`'s existing effects changes. The
entire value is saving the next investigator the multi-step manual work this
thread required (`gh pr list`, hand-reading `MISSION_LOG.md`, tracing a
`request_id` through settlement records) by surfacing what `tidy` can already
find mechanically, as a note the operator or a later agent still has to read
and act on themselves.

Because nothing is deleted, the evidence-matching does not need to clear the
same bar a deletion decision would — a wrong note costs a moment's
verification, not lost work — but it should still avoid being actively
misleading. Any implementation should specifically avoid two precision traps
found during this proposal's own review process:

- **Do not match `request_id` as a substring.** `fix-decision-approve-missing-commit-2026-09-25`
  is a literal substring of `complete-fix-decision-approve-missing-commit-2026-09-25`;
  a substring match would attribute one Ask's settlement record to a
  different Ask that merely shares a suffix. Match the exact id in a
  structured field (the Ask's own `request_id`, or the `agent_ask_settlements`
  table's `request_id` column), never inside free text.
- **A Mission Log entry naming an Ask is not proof it was accepted.** A
  rejected or superseded settlement can still be mentioned in the Log. Where
  available, prefer the authoritative settlement record (an
  `agent_ask_settlements` row with `disposition: accepted`) over parsing Log
  prose, and where a target Action is named, check that Action's *current*
  status in its plan document rather than trusting a historical Log line
  alone, since an Action can be reopened after a Log entry describes it as
  done.

Precisely how to source and phrase the note is Arcadia's own implementation
choice; the proposal's scope ends at "annotate, never act."

## Explicitly out of scope

- **Any change to what `tidy` deletes, retires, or archives.** This version
  claims no new authority. If someone later wants to promote
  settlement-equivalence from an advisory note into an actual retirement
  path, that is a separate proposal, and per the discussion below it would
  need to reckon honestly with `START_HERE.md:1613`'s actual safety rule and
  with the fact that a branch with no remote copy has no copy anywhere else
  once its only local trace is removed.
- **Dirty or untracked worktree content.** `tidy` already never touches a
  dirty worktree; this proposal doesn't touch that boundary either.
- **`go`'s worktree-safety refusal.** An earlier draft of this proposal
  suggested `go` could have avoided one incident by consulting `evaluateMerge`
  before refusing to prepare a worktree. That suggestion was wrong and is
  withdrawn: that refusal (`findUncommittedManualCandidate` in
  `src/commands/go.ts:1078`) is triggered by uncommitted/dirty state in an
  unlaunched worktree, which `evaluateMerge` has no way to see — it reasons
  about committed content, not working-tree cleanliness. Nothing in this
  proposal bears on that incident.
- **Generated operator scripts deleting branches or worktrees directly**
  (`git branch -D`, `git worktree remove --force`) instead of routing through
  `tidy`'s own safe retirement path. A first draft of this proposal built a
  standalone helper meant to enforce this and found it had real bugs (see
  below); that helper is deleted rather than fixed. The underlying concern —
  nothing yet stops a *future* generated script from deleting a branch
  directly — is real but has no second instance yet to generalize from.
  Deferred, with a trigger: revisit when a second generated operator script
  needs to delete a branch or worktree, rather than designing the shared
  primitive against a sample of one.

## What this proposal got wrong

**First draft:** claimed `tidy` had no archive-before-delete mechanism and no
squash-merge detection, and proposed building both from scratch, including a
standalone `archive-before-delete.sh` helper described as "tested." An
independent Opus review found `tidy.ts`'s `retireBranch`/`evaluateMerge`
already implement exactly this (a compare-and-swap `archive/tidy/<sha>` tag,
plus ancestry/patch-equivalence/PR-merge-commit proof), that the standalone
helper had a real silent-data-loss bug (a branch-name collision silently
skipped archiving but still deleted) with no test suite behind the "tested"
claim, that the stated safety guarantee never covered dirty/untracked
worktree content, and that the proposed UX ("no longer need an operator's
individual sign-off") contradicted `CONSTITUTION.md`'s hard stop on deletion
without a Decision. It also mischaracterized both motivating incidents and
several git mechanics. CodeRabbit's review of that draft independently caught
two more gaps: a branch can carry more than one Ask file, and any deletion
path needs a compare-and-swap guard.

**Second draft:** removed the standalone helper and the overstated guarantee,
narrowing to one new proof (`settlement-equivalent`) that would hand off to
`tidy`'s *existing* `retireBranch` — reusing its real mechanism instead of a
second one, though CodeRabbit noted the draft's description glossed over the
fact that `retireBranch` has two paths: a plain `git branch -d` that can
succeed with no archive tag at all (`archivedAs: null`), and only a fallback
compare-and-swap path that actually creates `archive/tidy/<sha>` — a
distinction the draft should have stated rather than describing `retireBranch`
as if it always tags. A second independent review found the design still
claimed authority it didn't have: `retireBranch`'s actual justification is
`START_HERE.md:1613`'s
"proven present on the base branch" rule, not merely "there's an archive tag,"
and a settlement-equivalent branch fails that rule by construction. It also
found that for a branch with no remote copy to begin with, the archive tag
would become the *only* surviving copy of that content, on one machine only —
a materially different risk than archiving a branch whose content is already
also safe on the base branch. And it found the evidence-matching design had
the same shape of gap as the deleted helper: a `request_id` substring
collision, and treating a Log mention as proof of acceptance rather than
checking the authoritative settlement record. This version removes the
retirement step rather than trying to patch those into correctness, on the
reviewer's own observation that an advisory note captures most of the value
at none of the risk.

Three local git refs created ad hoc while investigating this proposal's
motivating branches (`refs/arcadia/archived/*`) have been folded into tidy's
own canonical `archive/tidy/<sha>` tag format as plain housekeeping; they are
not part of what this proposal asks for.
