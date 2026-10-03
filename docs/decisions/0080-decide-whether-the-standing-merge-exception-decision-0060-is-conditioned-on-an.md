---
arcadia: v1
type: decision
id: "0080"
slug: decide-whether-the-standing-merge-exception-decision-0060-is-conditioned-on-an
project: arcadia
status: approved
question: Decide whether the standing merge exception (Decision 0060) is conditioned on an independent agent review plus green required checks instead of CodeRabbit approval.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Independent review gate replaces CodeRabbit approval
options:
  - label: Independent review gate replaces CodeRabbit approval
    consequence: "Any agent may merge a PR once an independent read-only review of its exact current head has no unresolved blocking finding, every required check on that head is green and the merge state is clean. CodeRabbit becomes advisory: its comments are considered, never waited on. Every PR gets a review at creation, at most three rounds unless significant findings keep appearing. PRs that open or carry an important Decision or change agent authority still wait for the operator. The wording in CONSTITUTION.md, AGENTS.md and the PR procedure changes when this PR is merged."
    recommended: true
  - label: Keep CodeRabbit approval required
    consequence: The CodeRabbit approval condition stays binding. Merges wait for CodeRabbit's review of each head, which is currently limited to about one review per 45 minutes, so multi-PR work stalls. This PR's wording is not adopted and should be closed.
    recommended: false
  - label: Require both
    consequence: "A merge needs the independent review gate and, whenever CodeRabbit is available, its approval. Safest and slowest: the rate limit still stalls merges, but an independent review is always present. This PR would be amended to say so before merging."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-03
answer: Independent review gate replaces CodeRabbit approval
decided: 2026-10-03
---

# Decision 0080: Decide whether the standing merge exception (Decision 0060) is conditioned on an independent agent review plus green required checks instead of CodeRabbit approval.

## Options

- **Independent review gate replaces CodeRabbit approval** (recommended): Any agent may merge a PR once an independent read-only review of its exact current head has no unresolved blocking finding, every required check on that head is green and the merge state is clean. CodeRabbit becomes advisory: its comments are considered, never waited on. Every PR gets a review at creation, at most three rounds unless significant findings keep appearing. PRs that open or carry an important Decision or change agent authority still wait for the operator. The wording in CONSTITUTION.md, AGENTS.md and the PR procedure changes when this PR is merged.
- **Keep CodeRabbit approval required**: The CodeRabbit approval condition stays binding. Merges wait for CodeRabbit's review of each head, which is currently limited to about one review per 45 minutes, so multi-PR work stalls. This PR's wording is not adopted and should be closed.
- **Require both**: A merge needs the independent review gate and, whenever CodeRabbit is available, its approval. Safest and slowest: the rate limit still stalls merges, but an independent review is always present. This PR would be amended to say so before merging.

## Rationale

On 2026-10-02/03 the operator said to stop waiting on CodeRabbit when agents perform their own code reviews, to merge on green, and to cap review rounds at three unless significant issues recur. CodeRabbit's free-review limit (about one review per 45 minutes) was stalling every PR. Across six merged PRs the independent reviews found real defects, including a blocking double-handout flaw in the Go draft-recovery change. Merge is an approval boundary, so this wording needs an explicit Decision before it binds every agent.

Proposed by Agent Ask decide-independent-review-gate-replaces-coderabbit-approval-2026-10-03.
