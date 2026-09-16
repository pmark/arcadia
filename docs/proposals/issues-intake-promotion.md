---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia surface open, un-promoted GitHub Issues and let one selection promote them into governed Actions through the existing Agent Ask path, so a logged defect cannot be forgotten without a second tracker or auto-approval?
---

# Promote logged Issues into governed work

## Why this Project needs it

GitHub Issues is the Way's defect intake, and the Way is explicit that an Issue
is a signal, never work state: nothing reads Issues as a queue or pointer, and
an Issue becomes work only when someone promotes it into a governed Action.
That boundary is correct, and it leaves exactly one failure mode — an Issue
nobody notices.

On 2026-09-16 two defects (#272, #273) were filed while completing
`refresh-preservation-heartbeat-off-tick`. The operator's fair question, "can I
rest assured #273 will be addressed?", had the honest answer "no". #273 became
guaranteed only when it was hand-promoted into the Action
`preserve-projects-with-dependencies`. Capture is automatic; promotion is
manual and invisible. Every Project has this gap.

## The 20% that carries the 80%

Visibility, reusing what already exists — not automation.

1. **One read-only projection of un-promoted defects.** For each active Project
   with a GitHub repo, list open Issues that no Action, Decision, or Plan
   references. Same shape as `arcadia work monitor` and `arcadia portfolio`: a
   noun that reads state.
2. **Promotion stays the existing Agent Ask.** The `menu` skill (or an
   equivalent picker) offers "promote defect #n", drafting an `action` Ask with
   `references: ["<issue-url>"]`. No new writer, no auto-approval, no second
   truth store.
3. **Closure stays GitHub's.** Because the Action references the Issue, the
   eventual PR carries `Closes #n`, so the merge that completes the work closes
   the Issue — the existing rule, for free.

The whole loop is notice → promote (choosing priority, as a human should) →
merge closes. It reuses `gh`, the checked-in managed documents, the Agent Ask
contract, and the `menu` skill; it invents no new state.

## What we would build locally

A `scripts/issues.sh` that scrapes `gh issue list`, keeps its own "handled"
marker file, and eventually grows its own Action-creation path. This proposal
exists to avoid that: the projection must be a first-class read-only noun,
promotion must remain the canonical Ask writer, and closure must remain
GitHub's own.

## Smallest implementation

- `arcadia issues` (read-only), or a section of `arcadia portfolio`: for each
  active Project with a `repo_path` and a GitHub remote, `gh issue list --state
  open`, minus any Issue whose URL or `#n` appears in an Action `references`, a
  Decision, or a plan. Group by Project with age and labels, marking
  `unpromoted`.
- Fail-soft, never false-safe: missing `gh`, missing auth, offline, or a
  non-GitHub remote reports the exact gap and marks the Project `unavailable` —
  never "no open issues".
- Promotion: add a "promote logged defect" option to the `menu` skill that
  drafts the `action` Ask referencing the Issue URL. Un-promoted Issues also
  surface alongside the existing "Waiting on you" list.

## What we deliberately do not build

- No automatic Issue → Action creation. "Capture is not governance" is the
  point; severity and priority are operator judgments, and auto-promotion would
  flood the queue and erase the back-burner.
- No mirroring of Issue bodies, state, or comments into Arcadia — that is a
  second truth store.
- No severity-scoring engine, no background poller, no new tracker.
- No replacement for Stop the Line: a blocking defect is still promoted
  immediately by hand; this only makes it discoverable.

## If not now, then when?

The reminder tail is deferred behind a named trigger: when any un-promoted
Issue is older than seven days, or the un-promoted set exceeds ten, add one
bounded reminder (a back-burner item or a single open Decision) naming them.
Until then the read-only projection is the whole answer. If neither condition
ever occurs this stays as-is — a trigger that never fires is a rejection, not a
deferral.

## First users

#272 and #273 in this repository, plus every Project whose repository has open
Issues today.
