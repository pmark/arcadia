---
arcadia: v1
type: plan
slug: every-open-github-issue-in-pmark-arcadia-is-classified-once-into-a-five-route
project: arcadia
status: draft
milestone: Every open GitHub Issue in pmark/arcadia is classified once into a five-route vocabulary, reconciled both ways with governed Actions, the vital few (about 20 percent) are verified, and the top batches plus a Decision-ready change list are delivered as one local report, with no GitHub mutation.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-11
actions:
  - id: snapshot-open-issues-and-build-packets
    title: Save one snapshot of every open pmark/arcadia Issue and split it into packets of 20 [agent, light tier, S, no operator gate].
    status: open
    responsibility: agent
    effort: session
    next_action: Save one snapshot of every open pmark/arcadia Issue and split it into packets of 20 [agent, light tier, S, no operator gate].
    expected_artifact: Evidence satisfying Agent Ask snapshot-open-issues-and-build-packets
    clarification: clarified
    confidence: high
    source: Agent Ask amend-issue-triage-plan-pin-output-path-2026-10-11
    why: "Everything later reads this saved snapshot, so the backlog is fetched once and never reloaded into model context."
    acceptance_criteria:
      - A snapshot of all open Issues (pull requests excluded) with number, title, labels, URL, updated_at, comment count and full body is saved as /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/snapshot.json, with the retrieval time, query and observed default-branch SHA recorded in /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/receipt.json.
      - The snapshot count is reconciled to the live open-Issue count, any drift or failed page is named, and no coverage claim is made for an incomplete inventory.
      - The skill helper issue_packets.py has emitted an index and packets of 20 into /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/packets/ from the snapshot, and its validate mode accepts the inventory.
    depends_on: []
    decisions: []
    references: ["docs/agent-guidance/principles.md"]
  - id: classify-calibration-packet
    title: Classify the first packet of 20 Issues and fix the routing vocabulary before scaling [agent, light tier, S, no operator gate].
    status: open
    responsibility: agent
    effort: session
    next_action: Classify the first packet of 20 Issues and fix the routing vocabulary before scaling [agent, light tier, S, no operator gate].
    expected_artifact: Evidence satisfying Agent Ask classify-calibration-packet
    clarification: clarified
    confidence: high
    source: Agent Ask amend-issue-triage-plan-pin-output-path-2026-10-11
    why: "A small first slice exposes any vocabulary or evidence-format problem at a cost of one packet instead of five."
    acceptance_criteria:
      - Every Issue in packet 1 has one row in /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/triage.json using exactly one of the routes verify, fix, batch, close-candidate or needs-operator, with validity left unknown unless direct evidence is cited.
      - The route vocabulary and area names are reused from existing repository labels where they exist, and no new label taxonomy is introduced.
      - Each row separates observation from inference in its reason and names a next step and a revival trigger.
    depends_on: [snapshot-open-issues-and-build-packets]
    decisions: []
    references: []
  - id: classify-packets-two-and-three
    title: Classify packets 2 and 3 with the calibrated vocabulary [agent, light tier, S, no operator gate].
    status: open
    responsibility: agent
    effort: session
    next_action: Classify packets 2 and 3 with the calibrated vocabulary [agent, light tier, S, no operator gate].
    expected_artifact: Evidence satisfying Agent Ask classify-packets-two-and-three
    clarification: clarified
    confidence: high
    source: Agent Ask amend-issue-triage-plan-pin-output-path-2026-10-11
    why: "Two packets per session keeps each Action finishable while the work stays mechanical and cheap."
    acceptance_criteria:
      - Every Issue in packets 2 and 3 has a row appended to /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/triage.json before the session ends, each with a route, area, validity, reason, next step and revival trigger.
      - Possible duplicate groups and shared causes are recorded from the compact index and stay proposed until evidence is retrieved.
      - No Issue has validity other than unknown without a cited evidence entry.
    depends_on: [classify-calibration-packet]
    decisions: []
    references: []
  - id: classify-packets-four-and-five
    title: Classify the remaining packets so that every snapshot Issue has exactly one row [agent, light tier, S, no operator gate].
    status: open
    responsibility: agent
    effort: session
    next_action: Classify the remaining packets so that every snapshot Issue has exactly one row [agent, light tier, S, no operator gate].
    expected_artifact: Evidence satisfying Agent Ask classify-packets-four-and-five
    clarification: clarified
    confidence: high
    source: Agent Ask amend-issue-triage-plan-pin-output-path-2026-10-11
    why: "This completes the one-row-per-Issue invariant that the validator and every later step depend on."
    acceptance_criteria:
      - Every remaining snapshot Issue has a row in /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/triage.json, and the helper validate mode reports full inventory coverage with no missing or repeated numbers.
      - Duplicate and shared-cause groups across all five packets are consolidated into one list with the member numbers of each.
    depends_on: [classify-packets-two-and-three]
    decisions: []
    references: []
  - id: reconcile-issues-with-governed-actions
    title: Reconcile open Issues with governed Actions in both directions and write reconciliation.json [agent, standard tier, M, no operator gate].
    status: open
    responsibility: agent
    effort: session
    next_action: Reconcile open Issues with governed Actions in both directions and write reconciliation.json [agent, standard tier, M, no operator gate].
    expected_artifact: Evidence satisfying Agent Ask reconcile-issues-with-governed-actions
    clarification: clarified
    confidence: high
    source: Agent Ask amend-issue-triage-plan-pin-output-path-2026-10-11
    why: "Checked-in Plans govern work, so an Issue already covered by a done Action is cleanup and an unmapped bug Action needs its Issue link."
    acceptance_criteria:
      - /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/reconciliation.json lists, for every open Issue, its explicit Action references or the value unmapped, with link provenance marked explicit or proposed.
      - Every Action in every Plan that explicitly references an Issue is inspected, including done and non-active Plans, and each linked closed Issue is recorded separately.
      - Each mismatch from the skill table (Action done with Issue open, Issue closed with Action unfinished, and so on) is listed with its evidence and next step, and any unreadable record is named as a gap instead of a coverage claim.
    depends_on: [classify-packets-four-and-five]
    decisions: []
    references: ["docs/managed-documents.md"]
  - id: verify-the-vital-few-issues
    title: Verify about 20 percent of the Issues, clustered by subsystem, against the recorded base SHA [agent, standard tier, M, no operator gate].
    status: open
    responsibility: agent
    effort: session
    next_action: Verify about 20 percent of the Issues, clustered by subsystem, against the recorded base SHA [agent, standard tier, M, no operator gate].
    expected_artifact: Evidence satisfying Agent Ask verify-the-vital-few-issues
    clarification: clarified
    confidence: high
    source: Agent Ask amend-issue-triage-plan-pin-output-path-2026-10-11
    why: "Verification is the expensive part, so it is spent only on governed-work blockers, likely-resolved or duplicate Issues and clusters one investigation can settle."
    acceptance_criteria:
      - At most 20 Issues are chosen for verification, with the selection reason recorded in /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/triage.json, and every other Issue keeps validity unknown with its revival trigger.
      - "Each verified Issue has a validity of present, resolved, duplicate, superseded or unknown, and every judgment other than unknown cites path:line, a test or command result, or a linked change at the observed base SHA."
      - No Issue is marked resolved from a merged pull request alone, and no code, workspace or live Session was modified during verification.
    depends_on: [reconcile-issues-with-governed-actions]
    decisions: []
    references: []
  - id: deliver-triage-report-and-proposed-changes
    title: Rank the top batches and deliver report.md, triage.json, reconciliation.json and changes.json [agent, standard tier, S, no operator gate].
    status: open
    responsibility: agent
    effort: session
    next_action: Rank the top batches and deliver report.md, triage.json, reconciliation.json and changes.json [agent, standard tier, S, no operator gate].
    expected_artifact: Evidence satisfying Agent Ask deliver-triage-report-and-proposed-changes
    clarification: clarified
    confidence: high
    source: Agent Ask amend-issue-triage-plan-pin-output-path-2026-10-11
    why: "One local report with exact, precondition-stamped proposals is the whole product; applying any of it is a separate authorized step."
    acceptance_criteria:
      - /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/report.md states the actual total, the observed base SHA, verified versus unknown counts, the top three or fewer batches each with one shared mechanism, member numbers, dependency order and common validation, and the close candidates with reasons.
      - /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/reports/issue-triage-2026-10-11/changes.json lists exact proposed label additions and closures, each with the Issue updated_at, the base SHA and the Action or Decision values used as proof preconditions, and nothing in it has been applied to GitHub.
      - The helper validate mode passes on triage.json, and the unverified remainder is stated with a named revival trigger instead of being declared invalid.
    depends_on: [verify-the-vital-few-issues]
    decisions: []
    references: []
  - id: submit-promotion-ask-and-github-change-decision
    title: "Submit one Agent Ask promoting the top batches to Actions and one Decision for applying the labels and closures [agent, standard tier, S, operator gate: Decision answer]."
    status: open
    responsibility: agent
    effort: session
    next_action: "Submit one Agent Ask promoting the top batches to Actions and one Decision for applying the labels and closures [agent, standard tier, S, operator gate: Decision answer]."
    expected_artifact: Evidence satisfying Agent Ask submit-promotion-ask-and-github-change-decision
    clarification: clarified
    confidence: high
    source: Agent Ask plan-open-issue-triage-divide-yagni-pareto-2026-10-11
    why: "Triage is analysis and never permission, so the work to repair and the GitHub mutations each wait for the operator."
    acceptance_criteria:
      - One Agent Ask proposes the top batches as inactive-Plan Actions with acceptance criteria drawn from the report, and its preview receipt is recorded.
      - One Decision Ask offers apply all, apply labels only, or apply nothing, each option stating its consequence, and names the closure and comment scopes separately.
      - No label, comment or closure has been applied to any GitHub Issue, and the pointer and queue are unchanged.
    depends_on: [deliver-triage-report-and-proposed-changes]
    decisions: []
    references: []
questions: []
decisions: []
---

# Every open GitHub Issue in pmark/arcadia is classified once into a five-route vocabulary, reconciled both ways with governed Actions, the vital few (about 20 percent) are verified, and the top batches plus a Decision-ready change list are delivered as one local report, with no GitHub mutation.

Created as an inactive draft from accepted Agent Ask plan-open-issue-triage-divide-yagni-pareto-2026-10-11; creation changed no pointer. Current activation is recorded in frontmatter.
