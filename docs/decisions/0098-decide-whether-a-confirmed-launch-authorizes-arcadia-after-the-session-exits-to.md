---
arcadia: v1
type: decision
id: "0098"
slug: decide-whether-a-confirmed-launch-authorizes-arcadia-after-the-session-exits-to
project: arcadia
status: approved
question: Decide whether a confirmed Launch authorizes Arcadia, after the session exits, to run adversarial review and repair sessions on its draft PR and merge on green unless an automated gate calls for operator approval, and whether a confirmed chain Launch authorizes launching the next ready Action after each merge. Nothing is authorized by raising this Decision.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Yes: after a confirmed Launch, review as PR comments, repair conflicts and CI, merge on green unless a gate calls for me; chains launch the next Action after each merge"
options:
  - label: "Yes: after a confirmed Launch, review as PR comments, repair conflicts and CI, merge on green unless a gate calls for me; chains launch the next Action after each merge"
    consequence: After a session from your confirmed Launch opens its draft PR, Arcadia runs an independent adversarial review of the exact head and posts it as a PR comment. It launches repair sessions for blocking findings, conflicts and failing checks, for at most three rounds, each with its own receipted one-shot authorization. It marks the PR ready and merges it only when the Decision 0060/0080 conditions hold. The checked-in gate list stops it and pings you instead whenever the PR touches Decisions, the Constitution, agent guidance or policy, launch-authority code, credentials, workflows, deployment or dependencies, deletes or skips tests or lowers a check threshold, or the review flags authority, the rounds run out, or a check stays red. One answer covers both the post-exit review-repair-merge loop and automatic chain launches. A confirmed chain Launch (capped at 3 Actions by default, expiring after 24 hours) launches the next ready Action of that Plan from the new main after each merge, and stops at any gate, failure, unapproved Decision or Plan change.
    recommended: true
  - label: Stop at the draft PR
    consequence: "Launched sessions end at a draft PR, as Decision 0096 option 1 recorded. Review, repair and merging stay manual: you, or an agent under the existing Decision 0060/0080 exception, review and merge each PR. Merge-then-next chains then advance only when someone merges, so launched-pr-review-repair-merge and chain-as-loop-of-single-runs stay blocked, and both the offline and the live proofs are amended to end at the draft PR."
    recommended: false
  - label: Not now
    consequence: "Nothing changes. launched-pr-review-repair-merge, chain-as-loop-of-single-runs and the proofs that depend on them stay blocked. Headless launch, timeouts, the draft-PR path and the session board are still built while the Plan stays an inactive draft; the Plan cannot be activated while this Decision is open. Revival trigger: your next request to run a chain or a launch to merge."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: "Yes: after a confirmed Launch, review as PR comments, repair conflicts and CI, merge on green unless a gate calls for me; chains launch the next Action after each merge"
decided: 2026-10-09
---

# Decision 0098: Decide whether a confirmed Launch authorizes Arcadia, after the session exits, to run adversarial review and repair sessions on its draft PR and merge on green unless an automated gate calls for operator approval, and whether a confirmed chain Launch authorizes launching the next ready Action after each merge. Nothing is authorized by raising this Decision.

## Options

- **Yes: after a confirmed Launch, review as PR comments, repair conflicts and CI, merge on green unless a gate calls for me; chains launch the next Action after each merge** (recommended): After a session from your confirmed Launch opens its draft PR, Arcadia runs an independent adversarial review of the exact head and posts it as a PR comment. It launches repair sessions for blocking findings, conflicts and failing checks, for at most three rounds, each with its own receipted one-shot authorization. It marks the PR ready and merges it only when the Decision 0060/0080 conditions hold. The checked-in gate list stops it and pings you instead whenever the PR touches Decisions, the Constitution, agent guidance or policy, launch-authority code, credentials, workflows, deployment or dependencies, deletes or skips tests or lowers a check threshold, or the review flags authority, the rounds run out, or a check stays red. One answer covers both the post-exit review-repair-merge loop and automatic chain launches. A confirmed chain Launch (capped at 3 Actions by default, expiring after 24 hours) launches the next ready Action of that Plan from the new main after each merge, and stops at any gate, failure, unapproved Decision or Plan change.
- **Stop at the draft PR**: Launched sessions end at a draft PR, as Decision 0096 option 1 recorded. Review, repair and merging stay manual: you, or an agent under the existing Decision 0060/0080 exception, review and merge each PR. Merge-then-next chains then advance only when someone merges, so launched-pr-review-repair-merge and chain-as-loop-of-single-runs stay blocked, and both the offline and the live proofs are amended to end at the draft PR.
- **Not now**: Nothing changes. launched-pr-review-repair-merge, chain-as-loop-of-single-runs and the proofs that depend on them stay blocked. Headless launch, timeouts, the draft-PR path and the session board are still built while the Plan stays an inactive draft; the Plan cannot be activated while this Decision is open. Revival trigger: your next request to run a chain or a launch to merge.

## Rationale

On 2026-10-09 the operator answered Decision 0096 in the release-manager chat: "once per launch, for that one Action, Arcadia commits, pushes the branch opens a draft PR, performs adversarial review that is captured as PR comments, fix merge conflicts and CI issues, then merge on green unless an automated decision calls for operator approval." On 0097: "Each Action merges through the normal review gate before the next one launches, so a chain becomes a loop of single runs."

Decision 0096 could only record its option 1, which stops at the draft PR, and 0097's consequence placed automated review-and-merge in its own Plan. This Decision records the operator's fuller intent as a governed answer. Its approval gates the Actions launched-pr-review-repair-merge and chain-as-loop-of-single-runs in the reliable single-session Plan, which houses that capability.

Merging still requires the Decision 0060/0080 conditions on the exact head. PRs that open or carry an important Decision or change what agents are authorized to do are stopped for the operator by the checked-in gate list or by a review authority flag.

Proposed by Agent Ask raise-launch-review-merge-chain-decision-20261009-r2.
