---
arcadia: v1
type: decision
id: "0235"
slug: record-the-operator-s-answer-defaults-to-the-six-detail-points-of-decision-0234
project: arcadia
status: open
question: Record the operator's answer "Defaults" to the six detail points of Decision 0234 (amend Decision 0120 for Flynn and Clara Field Notes), so the later Field Notes implementation batch reads them instead of hard-coding them.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A: Defaults: the operator accepts all six recommended clarifications for Decision 0234"
options:
  - label: "A: Defaults: the operator accepts all six recommended clarifications for Decision 0234"
    consequence: "The six clarifications to Decision 0234 are, as presented to the operator: (1) one shared post limit for the site, with Flynn's digests as their own post type capped at four a day; (2) the fact-check is done by someone other than the author, with the reviewer recorded and checked by the build; (3) the existing Atom feed counts as the RSS feed; (4) one daily roll-up publish ping listing each post, which replaces Decision 0120's ping on each publish; (5) a retired writer's posts are skipped instead of the whole build failing; (6) no style may imitate a named real person. The later Field Notes implementation batch (cadence enforcement, the reviewer-independence check, the publish ping, retire behaviour, the voice check) reads these instead of hard-coding them; nothing is built by this record."
    recommended: true
  - label: "B: Change some of the six clarifications"
    consequence: The operator names the points to change (for example "4a" for a ping on every post); the implementation batch waits for that follow-up record. No answer is assumed meanwhile.
    recommended: false
confidence: high
plan: prove-the-rowan-supervisor-attention-loop
updated: 2026-11-15
---

# Decision 0235: Record the operator's answer "Defaults" to the six detail points of Decision 0234 (amend Decision 0120 for Flynn and Clara Field Notes), so the later Field Notes implementation batch reads them instead of hard-coding them.

## Options

- **A: Defaults: the operator accepts all six recommended clarifications for Decision 0234** (recommended): The six clarifications to Decision 0234 are, as presented to the operator: (1) one shared post limit for the site, with Flynn's digests as their own post type capped at four a day; (2) the fact-check is done by someone other than the author, with the reviewer recorded and checked by the build; (3) the existing Atom feed counts as the RSS feed; (4) one daily roll-up publish ping listing each post, which replaces Decision 0120's ping on each publish; (5) a retired writer's posts are skipped instead of the whole build failing; (6) no style may imitate a named real person. The later Field Notes implementation batch (cadence enforcement, the reviewer-independence check, the publish ping, retire behaviour, the voice check) reads these instead of hard-coding them; nothing is built by this record.
- **B: Change some of the six clarifications**: The operator names the points to change (for example "4a" for a ping on every post); the implementation batch waits for that follow-up record. No answer is assumed meanwhile.

## Rationale

Operator words, verified per Decision 0229 by Rowan 16 (Claude Code session local_7824b4cc-b3f7-4711-86d4-75f6d6fb593b), read-only from Signal 11's session transcript (session local_61703936-0009-4be3-88b7-c44879f6f8ad, transcript 6c227f6b-bd31-45d1-9ff0-edc572715a8a): the operator's own user-role message at file line 6162, uuid d307212c-d1ef-44ae-93ed-20a78a9ae244, timestamp 2026-11-15T02:51:04.243Z (2026-11-14 6:51:04 PM Pacific), whose first line is "Defaults" (the same message continues with an unrelated request to have Clara write a post, which this Decision does not cover), sent as the reply to Signal 11's presentation of the six detail points that follow Decision 0234 (answered A in PR 2692, not yet merged when this was written; see also Decisions 0120 and 0165). "Defaults" accepts Signal 11's recommendation on each of the six points exactly as listed in that presentation (transcript line 6072). This records the clarifications only: it grants no publication beyond what Decision 0234 option A states, no accounts, spend, credentials or external-platform posting, and no production START. Relation to Decision 0120's conditions: point 4 CHANGES one of them, the operator ping (Decision 0120 and Decision 0234 option A say each publish pings the operator with a link; the operator chose one daily roll-up ping listing each post instead); point 2 ADDS to the fact-check condition (the checker must not be the author, with the reviewer recorded and checked by the build); the remaining 0120 conditions (claims linked to PRs or receipts, a "What is not done" section, unpublish, no external platforms, accounts or spend) are unchanged.

Proposed by Agent Ask record-decision-0234-detail-answers-defaults-20261114b.
