# Back Burner Guide

The Back Burner is Arcadia's Incubating view for ideas that are worth keeping
without becoming an Action yet. It is a shelf, not a backlog and not a source
of work for an agent. A condition can make an item visible at the right moment,
but only the operator can promote it into an Action.

The most useful mental model is:

```text
capture the thought → optionally scope it → optionally name the revival condition
                                      ↓
                         condition fires → operator reviews → explicit promote
```

## The two choices to make

When an idea arrives, make two independent choices.

### Where does it belong?

- Choose `--project <project-id>` when the idea clearly belongs to one existing
  Project.
- Leave it unscoped when it could apply to several Projects, a future Project,
  or a part of life that does not have a Project yet.
- Create or choose a durable Project later when the idea develops a real
  outcome. Do not invent a Project merely to avoid an unscoped item.

An unscoped item can represent a possible app, game, website, song, household
change, family practice, or personal experiment. The Back Burner preserves the
thought while you wait for enough context to decide what it is really about.

### When should it come back?

- Use no condition (the default) for ideas that should remain available only
  when you deliberately browse the shelf.
- Use a date when the calendar is the fact that changes the decision.
- Use a dependency when a named Action reaching a status is the fact that
  changes the decision.
- Use a predicate only when a small, named deterministic check in Arcadia can
  observe the fact. Predicates are not free-form expressions.

Do not turn a vague “someday” into a made-up date. A manual item is a truthful
answer. Do not use tags as a substitute for a revival condition: tags describe
the shape of an idea; conditions describe when it should interrupt you.

## Capture patterns

All of these use the existing Ask path. `--back-burner` makes the shelving
decision explicit and avoids relying on the natural-language router to infer it.

### A project-specific product idea

You are working on Rebuster and think of a candidate-review improvement. It is
clearly Rebuster-related, but it is not ready to become an Action:

```sh
pnpm arcadia ask "Let reviewers compare candidates side by side" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --project proj_rebuster \
  --source-ref docs/ideas/rebuster-review-notes.md \
  --tag capability experiment
```

This is scoped, but manual. It will not appear in the fired view; it is meant
for deliberate shelf browsing until you decide whether it should become an
Action.

### A vague idea that could become many different things

You have the thought: “A calm, one-tap voice capture flow would be useful.” It
could become an Arcadia feature, a phone shortcut, a household practice, or a
different product entirely. Keep it portfolio-wide:

```sh
pnpm arcadia ask "A calm one-tap voice capture flow could be useful" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --source-ref notes/2026-08-03-ideas.md \
  --tag capability nice-to-have
```

Do not guess a Project. The source reference keeps the longer reasoning
available without making `original_input` carry an essay.

### A household or personal-life idea

If you already have a Home, Family, or Personal Project, scope the idea there:

```sh
pnpm arcadia ask "Try a Sunday reset for the household" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --project proj_home \
  --tag experiment chore
```

If no such Project exists, leave it unscoped. The absence of a Project is a
signal to preserve, not a reason to create administrative work during capture.

### A date-based idea

Use a date when the idea becomes relevant at a known point in time:

```sh
pnpm arcadia ask "Revisit a family trip-planning site" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --surface-date 2026-11-01 \
  --tag nice-to-have
```

On or after that local calendar date, the item is derived as fired. Nothing is
promoted or dispatched automatically.

### An idea waiting on an Action

Use a dependency when the idea should wait for a concrete existing Action:

```sh
pnpm arcadia ask "Revisit automated MIDI export presets" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --project proj_midi_opener \
  --surface-dependency work_abc123 \
  --dependency-status done \
  --tag capability
```

The item fires when `work_abc123` reaches `done`. Dependency evaluation reads
the current Action status, so it does not become stale because a flag was
forgotten.

### A predicate-based idea

Predicates are useful when the revival fact is repeated and measurable rather
than tied to one date or Action. The initial registry includes
`project-has-three-open-actions`:

```sh
pnpm arcadia ask "Reconsider a lightweight planning dashboard" \
  --workspace "$WORKSPACE" \
  --back-burner \
  --project proj_arcadia \
  --surface-predicate project-has-three-open-actions \
  --tag capability experiment
```

This fires when that Project has at least three open or in-progress Actions.
An unknown predicate name remains on the item as a visible warning. It is not
silently treated as a false condition, and it does not crash the shelf.

## Review the shelf without creating noise

When `arcadia next` reports fired items, inspect only the interruption set:

```sh
pnpm arcadia back-burner list \
  --workspace "$WORKSPACE" \
  --fired yes \
  --group-by fired
```

Useful filters are:

```sh
# Fired ideas for one Project.
pnpm arcadia back-burner list --workspace "$WORKSPACE" --fired yes --project arcadia

# Experiments across the shelf, grouped by Project.
pnpm arcadia back-burner list --workspace "$WORKSPACE" --tag experiment --group-by project

# See everything, grouped by facet tag.
pnpm arcadia back-burner list --workspace "$WORKSPACE" --status all --group-by tag
```

The controlled facet tags are `quick-win`, `experiment`, `nice-to-have`,
`chore`, and `capability`. Use one or two tags that will remain true over time;
do not encode urgency, ranking, or a temporary mood in them.

Inspect the full record, including its source reference and any warning, with:

```sh
pnpm arcadia back-burner show <back-burner-id> --workspace "$WORKSPACE"
```

## The promotion decision

When a fired idea is now a real desired change, promote it explicitly:

```sh
pnpm arcadia back-burner promote <back-burner-id> \
  --workspace "$WORKSPACE" \
  --next-action "Draft the smallest side-by-side review prototype"
```

Promotion is the moment to clarify the idea into an Action, choose its
responsibility, and attach it to the right Project if it was previously
unscoped (pass `--project <project-id>` at promotion when needed). A fired
condition is a prompt to review, not authorization to work.

If the idea is still not right, leave it on the shelf or archive it. There is
no obligation to promote every fired item.

## A lightweight weekly practice

1. Capture ideas immediately with the smallest truthful description.
2. Add a Project only when the destination is clear.
3. Add a condition only when you can name the observable fact that should revive
   the idea.
4. Add a source reference when the thought has supporting notes elsewhere.
5. During a weekly review, inspect fired items first, then browse manual items
   only if you have time.
6. Promote, leave, or archive each reviewed item explicitly.

The Back Burner is doing its job when ideas stop competing with current Actions,
but the few ideas whose moment has arrived are hard to miss.
