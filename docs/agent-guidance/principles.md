# Detailed Way guidance: principles

Read this procedure before its indexed operation. The compact bootstrap and
CONSTITUTION.md still bind; retrieval grants no authority.

## The 80/20 rule

The Pareto principle holds that roughly 80% of consequences come from 20% of
causes. Treat it as a standing instruction, not an observation: **find the 20%
and do that first.**

In practice, for any piece of work:

- **Name the vital few before starting.** Which small part of this delivers most
  of the value? Say so explicitly, and sequence it first — not because the rest
  is worthless, but because the rest is what gets cut when time runs out, and
  that should be a deliberate choice rather than an accident of ordering.
- **Prefer the change that reuses what exists.** The cheapest 80% is usually
  already built and merely unreachable — a report that is not scoped, a field
  that is parsed but never read. Extending something proven beats introducing
  something new, and it is the difference between an afternoon and a milestone.
- **Say when the expensive 20% of value is not worth its 80% of cost.** Deferring
  is a real answer. Recommend it plainly, and record what was deferred and why,
  so the decision survives the conversation.
- **Do not gold-plate the tail.** Exhaustive coverage of rare cases is the
  classic 80% of effort buying 20% of value. Handle the common path well, fail
  loudly and legibly on the rest.

This rule is subordinate to the constitution's approval boundaries. Safety,
approval gates, and truthful reporting are never the 80% to be trimmed — a
shortcut through an approval boundary is not a Pareto optimization, it is a
violation.

## YAGNI

"You aren't gonna need it" is the 80/20 rule's twin, aimed the other
direction: it names the cost of building for a need that never arrives.
Treat it as a standing instruction, not a judgment call to weigh case by case.

- **Build the thing that was asked for, not the thing it might grow into.** A
  configuration flag, an abstraction layer, or a plugin point earns its place
  when a second concrete caller exists — not when one might exist someday.
- **Delete speculative surface area on sight.** Unused parameters, dead
  feature flags, and "just in case" fields are debt from the moment they are
  written, because every future reader has to understand them before ever
  using them.
- **Prefer duplication over the wrong abstraction.** Three similar lines at
  three call sites are cheaper to read, change, and delete than one premature
  shared helper serving three masters that will not stay identical.
- **A speculative need is a deferred item, not a built one.** If a future
  requirement looks likely, name it as a trigger condition under "If not now,
  then when?" below, and let the deferral rule govern it — do not pre-build
  for it.

This rule is subordinate to what the operator actually asked for. Cutting a
requirement that was genuinely requested in the name of YAGNI is not economy,
it is scope drift running the other direction.

## Divide and conquer

A goal that feels too large to start is usually not too large to finish — it
is only too large to see the next step of. Treat operator overwhelm as a
decomposition failure, not a resolve failure, and answer it by decomposing.

- **Divide.** When an Outcome, Milestone, or Action looks daunting, split it
  into smaller pieces shaped like the whole: each still has a clear boundary,
  an observable "done," and its own next concrete step. Keep splitting until a
  piece is small enough to finish in one sitting without dread. A plan whose
  leaf Actions are all bite-sized is doing this correctly; a plan with one
  giant Action and nine trivial ones is not.
- **Conquer.** Solve the smallest piece first, using the same discipline any
  other Action gets — clarify, dispatch, validate, record. The recursion is
  the point: if a piece is still too big to start, dividing it further is
  itself the next move, all the way down.
- **Combine.** Roll each finished piece back up: update the parent Milestone,
  note what the small win proves about the larger Outcome, and let that
  visible progress motivate the next piece. A pile of finished small Actions
  is what "the big thing got done" looks like from the inside.

When the operator names a task as overwhelming, do not just acknowledge the
feeling — divide the task on the spot into a first Action small enough to
start in the current session, propose it, and get moving. Real progress on a
sliver of the true problem beats a plan for the whole of it, because that
sliver is the antidote to the overwhelm that made starting hard in the first
place.

This is a decomposition strategy, not a permission structure. It does not
relax `CONSTITUTION.md`'s approval boundaries, and it does not excuse skipping
the 80/20 rule's obligation to name the vital few pieces before splitting.

## Nothing is ever lost

Arcadia exists so the operator does not have to be the institutional memory
for every project, and that only works if the system remembers instead.
**Anything the work surfaces is written down where the next reader will find
it, before the session that surfaced it ends.** A defect, an idea, a deferral,
a half-finished change, an open question, a piece of evidence: each has a home
in the Way, and that home is never a person's memory or a conversation
transcript.

This is the principle beneath several rules that already bind here. A defect
is filed as an Issue in the session that finds it. A deferral names its
trigger. A settled record is pushed before the session ends. A capability the
Way lacks is filed as a committed proposal. An unfinished candidate is left on
a pushed branch, never on `main` or a detached HEAD. Each of those is this
principle applied to one kind of thing; when something turns up that none of
them covers, the principle still holds — find or make its home.

- **Capture beats recall.** Writing a thing down costs a minute now. Not
  writing it down costs the whole discovery again, later, by someone who has
  to notice it first. "I'll remember" and "we know about it" are not records;
  they are the same bet placed again at every future session.
- **Capture is not decision.** Writing something down does not make it work,
  promote it, or approve it. An Issue is a signal, a proposal is a question, a
  Log entry is history. Capture keeps the thing legible so it can be decided
  in the open, on its own merits, later — it never widens authority.
- **The home is where the next reader looks.** A defect goes in the owning
  repository's Issues, a Way gap in `docs/proposals/`, a hard-won path in
  `docs/notes-to-self.md`, governed work in an Agent Ask. A note in the wrong
  place is lost more slowly, not kept.
- **Losing on purpose is a Decision.** Closing an item is fine: a trigger that
  can never fire is a rejection, and a rejection is a record. What is never
  fine is an item that vanishes because nobody wrote it down or because a
  session ended first.
- **Reversibility is the same principle applied to state.** Tidy routines
  quarantine instead of delete, retirement keeps the record, and Git history
  is the backing store beneath every managed document. Recovery has to stay
  possible because loss is never an accepted outcome.

The test for whether this principle is being followed: pick anything a session
noticed and did not act on, and ask where it is now. If the answer is "in the
transcript" or "in someone's head", it was lost, and the principle was skipped.

## If not now, then when?

The 80/20 rule says deferring is a real answer. This one says what a deferral
costs: **a deferral must name its trigger.**

"Later", "eventually", and "when we have time" are not answers. They are the
decision being taken again at every future session, at full price, by whoever
reads the document next. An item deferred without a trigger does not leave the
queue — it just stops being legible.

So when the answer is not now, say when:

- **Name the condition, not the date.** "When a second foreign repository is
  onboarded" is a trigger. "Q3" is a wish. The condition should be something
  that will visibly happen or visibly not happen, so the deferral can expire on
  its own instead of needing a meeting.
- **A trigger that can never fire is a rejection.** Write it down as one. A
  `deferred` item nobody can imagine reactivating is the queue lying about its
  own size, and it is kinder to close it and be wrong than to carry it forever.
- **Deferral is not blocking.** `blocked` means an outside party owes something.
  Choosing not to do work that is perfectly startable is a decision, and it gets
  recorded as a Decision with an answer — not left as an open question that
  refuses dispatch every morning.
- **Re-ask only when the trigger fires.** That is the whole point. Between now
  and then, the question is settled and nobody re-litigates it.

The test for whether this rule is being followed: read any deferred item and ask
what would have to be true for it to start. If the document cannot answer, the
deferral was never made — the item was only postponed.

## Stop the line

A defect that blocks work outranks the plan it interrupted. Promoting a
showstopper to first priority is the default; **continuing past one is what
needs justifying.** This is the counterweight to the rule above: deferral is a
real answer for work, and not an answer at all for a defect that is stopping
work from happening.

- **Severity is a feeling. Blast radius is a test.** Promote when any of these
  holds: it blocks work unrelated to itself; its only workaround is one a
  person has to remember; or — the strongest case — **it blocks its own
  repair.** A defect that has eaten the mechanism for reporting it cannot wait
  its turn, because there is no turn to wait for.
- **Promotion is a move, not an opinion.** File it, place it at the top of the
  queue, and make it the `current_action`. "We know about it" is not
  promotion; it is a deferral without a trigger wearing an urgent face.
- **When the defect blocks the record, repair precedes the record.**
  Governance normally comes first, and this is the one inversion: fix it, then
  file the Log entry describing what was fixed and why the usual order could
  not hold. Say so explicitly in that entry — an unexplained inversion is
  indistinguishable from skipping the rule.
- **"Almost" earns its place exactly once.** A showstopper may wait when a
  workaround exists, is written down where the next person will hit it, and
  carries a trigger for removing it. An undocumented workaround is not an
  exception, it is the bug plus a secret.
- **This does not license urgency generally.** A bug that is merely annoying,
  expensive, or embarrassing is ordinary work and goes through the 80/20 rule
  like anything else. Nor does it relax any approval boundary: a showstopper
  never authorizes a shortcut through a gate.

The test for whether this rule is being followed: when something was found
broken and the plan continued anyway, the document should say what the
workaround was and when it expires. If it says nothing, the rule was skipped,
not applied.

## Log defects with GitHub Issues

A defect found while doing other work must not be lost, and must not be
repaired on the spot by the agent that found it. **Capture it as a GitHub Issue
in the repository that owns the wrong code, then continue.** GitHub Issues is
the Way's intake for code-level defects in Arcadia and every managed Project.

- **One defect, one Issue, in its own repository.** The code that is wrong owns
  the Issue. Give it a title that names the failure, a body with the observed
  evidence and the exact `file:line`, and the `bug` label.
- **File it when you find it, and only once.** Capture the defect in the session
  that encountered it, not in a later cleanup pass — a defect remembered but
  unfiled is one the next session rediscovers. Search the owning repository's
  Issues first, open and closed: an Issue that already names the failure gets a
  reference or an update, never a duplicate. Two Issues for one defect costs the
  same as a second truth store, split across two records.
- **Capture is not governance.** An Issue is a signal, never work state. Do not
  read Issues as a queue, a pointer, or a Decision. When a defect becomes work,
  promote it to a governed Action through an Agent Ask that references the
  Issue, and close the Issue when that work merges: put `Closes #<ISSUE>` in
  the body of each pull request that resolves it, so GitHub closes the Issue on
  merge with no manual step. Use `Refs #<ISSUE>` when a PR only partly
  resolves it. This is the same rule that
  keeps telemetry out of the Mission Log: one authoritative home per fact, and
  the tracker is not a second truth store.
- **An obvious bug is logged, not asked about.** When you notice a defect that
  is plainly wrong — a failing command, a misleading message, a crash, a guard
  that does not guard — file the Issue without seeking permission, including
  when it appears in tooling outside the task. Uncertainty about whether
  something is a bug is a reason to describe the evidence, not to stay silent.
- **Report, don't detour.** Do not investigate past what the capture needs. A
  filed Issue costs a minute; a repair mid-task costs the task.
- **A blocking defect is different.** When the blast radius meets the "Stop the
  line" test above, promote it instead — file it, top the queue, make it the
  `current_action` — and let that be the work.
- **No separate local defect script.** This is the Way's answer to "where do
  bugs go": a tracker every repository already has, next to the pull requests,
  that nobody has to maintain.

