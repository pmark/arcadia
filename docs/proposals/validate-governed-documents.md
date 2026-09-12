---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia catch an invalid governed document before it blocks dispatch — through a read-only `docs validate`, one shared dispatch-readiness check, and generators for the schema'd documents agents author by hand?
---

# Validate governed documents before they block dispatch

## What happened

On 2026-09-11, mid-way through the operator-run `prove-zero-prompt-production-loop`
rehearsal, `arcadia-go-broker-codex` refused to dispatch:

```
The repository does not resolve exactly one dispatchable Arcadia action.
docs/plans/first-usable-build.md  status        `status` must be one of: draft, active, complete, superseded — got "reference".
docs/plans/first-usable-build.md  token_budget  `token_budget` is required.
docs/plans/first-usable-build.md  token_impact  `token_impact` is required.
docs/plans/first-usable-build.md  updated       `updated` must be an ISO date (YYYY-MM-DD), got undefined.
```

One defect, four reported errors. The word `reference` had been written into
`status:` instead of `type:`, so a narrative planning artifact was parsed as a
plan document and then failed every plan-specific check. `reference` is a valid
`type` and is not in `STRUCTURED_DOC_TYPES`, so once the transposition was
undone the document needed none of those fields.

Three facts about the timing are the argument for this proposal:

- **The document had been invalid since 2026-09-10** — roughly three days.
- **Nothing surfaced it in that window.** It became visible only when it blocked
  work.
- **It became visible at the most expensive possible moment**: inside a timed
  rehearsal whose acceptance requires zero hidden interventions, where an
  unplanned repair threatens the validity of the proof itself. The repair was
  safe only because it landed before the counted activation. Ten minutes later
  it would have cost the run.

## What is missing

**1. There is no way to ask.** `arcadia docs` exposes exactly one subcommand,
`sync`. There is no read-only validation entry point, so there is nothing to put
in CI, in a pre-commit hook, or in a preflight check. The only way to discover an
invalid governed document today is to be refused by something that needed it.

**2. Two code paths disagree about dispatchability.** Earlier in the same
session, against the same repository at the same revision, with the document
already broken:

- `arcadia next --project zero-prompt-rehearsal` resolved **clean**, reporting
  `write-rehearsal-marker` as the current Action with no blockers.
- `arcadia-go-broker-codex` refused, with the four blockers above.

An operator who checks readiness with `next` — which is the documented way to
see what is next — is told the work is ready, and then finds it is not. This is
the same family as open proposal **R177** ("make complete-intent settlement and
`arcadia advance` read one consistent Action status, and report the
authoritative record when they disagree").

**3. Schema'd documents are hand-authored by agents.** Arcadia generates its own
governance records — Agent Ask settlement writes managed documents, and that path
has not produced an invalid one. But documents an *agent* authors to satisfy an
Action's acceptance criteria are written by hand, frontmatter included. Every
Arcadia-seeded "Plan the first usable build for X" Action requires exactly such a
document. This one was written on 2026-09-08 and was wrong from birth.

## The three capabilities, in priority order

### 1. `arcadia docs validate` — the one that pays

A read-only noun: scans every governed document in a repository (or across the
portfolio), reports each schema violation with file, field, message and remedy,
and exits non-zero when any exist. Writes nothing.

This is first because **it catches an invalid document regardless of how it was
born** — generated, hand-written, hand-repaired under Decision 0044, merged from
a branch, or predating any generator. It is also the smallest build: the
validation logic already exists and already produces exactly the structured
blocker list shown above. What is missing is an entry point that runs it on
demand rather than as a side effect of being refused.

Where it earns its place: a pre-commit hook and a CI step. Three days of silence
becomes one failing check at the moment the mistake is made.

### 2. One shared dispatch-readiness check

`next` and the broker should answer the dispatchability question from the same
code path, so they cannot disagree. Whichever is authoritative, both should
report it — and when a document blocks dispatch, `next` should say so rather
than resolving clean.

This is second because it is a correctness defect rather than a new capability,
and because it is the difference between "the tool told me late" and "the tool
told me the opposite."

### 3. Generators for the schema'd documents agents author

Templates or a generator that emit correct frontmatter for the document types
agents write by hand — planning artifacts first, since Arcadia seeds an Action
requiring one in every new Project. A generator cannot transpose two fields.

This is third **not** because it is unimportant but because it is the narrowest:
it guarantees validity at creation and says nothing about the rest of a
document's life.

## The constraint this must respect

**Generation must not become the only permitted path.** Decision 0044 settled
that document hygiene is not governance state, after an adopting project reached
49 schema errors with no available way to correct them: every intent could create
records, none could repair a document. Today's fix was a hand edit under exactly
that rule, and it was the right move.

So the goal is *cheap detection plus easy repair*, not *locked-down creation*. A
validator that names the file, field and remedy serves both: it is also the tool
that tells whoever repairs a document by hand whether they got it right.

## What we would build locally

Nothing, per Decision 0025. The stopgap is what happened today — discover it when
it blocks work, repair it by hand, and lose the time.

## What would make this answerable

Judgments for the operator, not the agent:

1. Is `docs validate` portfolio-scoped by default, or single-repository like
   `docket`?
2. Should it be wired into `arcadia work monitor`'s preflight, so working-copy
   safety and document validity are one check?
3. Does #2 fold into R177's consistency work rather than standing alone?
4. Should filing cost one command — an `arcadia propose` that writes
   `docs/proposals/<slug>.md`, commits it on a **dedicated branch**, and pushes?

## On the cost of filing (question 4)

This proposal is the third document filed today, and each one cost a branch, a
commit, a pull request and a review. That ceremony is not what
[`AGENTS.md`](../../AGENTS.md) asks for — it says to write the file and "commit
it like any other document," and says nothing about a pull request. The overhead
is self-imposed, and it is a real disincentive: a capability gap noticed in
passing is worth filing only if filing is cheap.

Committing straight to the default branch is the obvious way to make it cheap,
and it is the wrong one. **Many repositories disallow direct commits to `main`**
— branch protection, required reviews, required checks — so a filing path that
depends on writing to `main` works in this repository and fails in exactly the
adopting projects the proposal mechanism exists to serve. It is also unsafe in
the ordinary case: a settlement or a rehearsal in flight makes an unexpected
commit on `main` an ambiguity in someone's evidence, which is why this document
was filed on a branch today rather than committed directly.

So the cheap path should still be a branch — just one the operator never has to
think about. `arcadia propose <question>` would write the document, create a
dedicated branch, commit, push, and print the URL to open a pull request, in one
command. Whether it opens the pull request itself is a separate judgment: doing
so needs credentials and network, which the current file-based mechanism
deliberately does not, so it should degrade to "branch pushed, here is the link"
when those are absent.

Worth answering alongside this proposal because the same argument applies to
every future filing, including the ones this validator will produce.

## Why not GitHub issues

Considered and rejected as the primary mechanism, for the record.

An issue tracker is a second inbox that `arcadia portfolio` cannot see. Arcadia's
Outcome is explicitly "without the operator holding the whole portfolio in their
head," and the portfolio already carries 20 Decisions and 11 Way-change requests
awaiting an answer; splitting that across two surfaces makes the problem it
exists to solve worse. Issues also need network and credentials, which the
committed-file mechanism deliberately does not — that is what lets a cloud
container with no Arcadia installed still file one. And an issue has no
ratification path: a proposal is answered by ratifying a Decision, and an issue
cannot become one.

Where issues would genuinely help is threaded discussion on an open proposal and
filing from a phone. Neither is the pain that prompted question 4, and neither
requires moving the mechanism.
