---
arcadia: v1
type: plan
slug: relay-use-drives-planned-work-that-production-performs
project: arcadia
status: draft
milestone: Relay use drives planned work that production performs
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-09
actions:
  - id: list-relay-gap-signals-for-triage
    title: List every Relay and production gap signal for one Project in one read-only triage view, unrouted signals first.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: List every Relay and production gap signal for one Project in one read-only triage view, unrouted signals first.
    expected_artifact: Evidence satisfying Agent Ask list-relay-gap-signals-for-triage
    clarification: clarified
    confidence: high
    source: Agent Ask relay-loop-triage-criteria-review-20261108
    why: "Every triage pass is hand-stitched from several commands today, which costs tokens and lets signals slip through, so the Relay-driven loop cannot run cheaply."
    acceptance_criteria:
      - "`arcadia relay signals --project <slug>` prints one line per signal and `--json` prints the same records, each with source kind (`lesson` or `red_alert`), source id, text, first seen, last seen and occurrence count."
      - "Its only sources are that Project's lessons whose text starts with `Relay improvised:` or `Relay can't yet:`, where one occurrence is one `lesson_evidence` row and its `created_at` gives first and last seen, and that Project's `production_red_alerts` rows that are open or were cleared within the last 7 days, the cleared ones marked `cleared`; it opens the workspace database read-only, calls no model and writes nothing, which a test proves on a fixture workspace database by comparing its contents before and after the command."
      - "A signal whose reference `signal:<kind>:<id>` appears in any Plan Action's `references` in that Project, or in the text of an open Decision document in that Project, is listed as routed, with that `plan/<slug>#<action-id>` or Decision id, after every unrouted signal; unrouted signals are ordered by occurrence count descending, then by last seen descending. Action show-landed-and-recurred-relay-signals may add states ahead of unrouted signals."
      - "An Agent Ask child carrying `references: [\"signal:lesson:<id>\"]` previews and settles against a fixture repository with that string unchanged in the Plan Action's `references`, proved by a test; if settlement refuses or rewrites it, the Session reports that instead of changing settlement."
      - Tests use a fixed clock and cover no signals, only routed signals, a signal routed by a Decision, an alert cleared inside and outside the 7 days and the ordering rule, and need no network, timer, child process or live service.
    depends_on: []
    decisions: []
    references: ["docs/relay-driven-operations.md"]
  - id: show-landed-and-recurred-relay-signals
    title: Show which routed Relay signals have landed and which recurred after their fix, so Relay can tell the operator what to try again.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Show which routed Relay signals have landed and which recurred after their fix, so Relay can tell the operator what to try again.
    expected_artifact: Evidence satisfying Agent Ask show-landed-and-recurred-relay-signals
    clarification: clarified
    confidence: high
    source: Agent Ask relay-loop-triage-criteria-review-20261108
    why: "Without it the loop cannot close: nobody sees that a fix landed, and a gap that returns after its fix looks already handled."
    acceptance_criteria:
      - In `arcadia relay signals`, a routed signal whose citing Actions are all done is listed as `landed`, with those Actions' refs and the latest completion time, where one Action's completion time is the `created_at` of the accepted `agent_ask_settlements` row whose `receipt_json` records intent `complete` and whose `operation_json` targets that Action (the table has no intent or target column, so both are read from that JSON); while any citing Action is open the signal stays `routed`.
      - A lesson signal with a `lesson_evidence` row created after that completion time is listed as `recurred`, ahead of every unrouted signal, with the Action refs and that row's time. Red-alert signals use only `unrouted` and `routed`, and leave the list 7 days after they clear.
      - "`--json` carries a state of `unrouted`, `routed`, `landed` or `recurred` on every record, and tests cover each state, including a signal cited by two Actions with one still open, on a fixture workspace database with fixed timestamps and need no network, timer, child process or live service."
    depends_on: [list-relay-gap-signals-for-triage]
    decisions: []
    references: ["docs/relay-driven-operations.md"]
questions: []
decisions: []
---

# Relay use drives planned work that production performs

Created as an inactive draft from accepted Agent Ask relay-driven-loop-plan-20261107-v2; creation changed no pointer. Current activation is recorded in frontmatter.
