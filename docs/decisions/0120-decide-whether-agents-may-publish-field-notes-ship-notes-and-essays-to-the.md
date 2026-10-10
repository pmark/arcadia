---
arcadia: v1
type: decision
id: "0120"
slug: decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the
project: arcadia
status: approved
question: Decide whether agents may publish Field Notes (ship notes and essays) to the operator's own Mission Control site automatically on a regular cadence, without a per-post operator approval.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Agents publish Field Notes automatically on the operator's site
options:
  - label: Agents publish Field Notes automatically on the operator's site
    consequence: "Agents draft, independently fact-check and publish Field Notes to the operator's own Mission Control site (and its RSS feed) on a regular cadence: ship notes when real work shipped (at most weekly, never padded), essays at genuine milestones (at most monthly). A post publishes only if the fact-check finds no blocking issue, every claim links to a PR or receipt, and it has a \"What is not done\" section; each publish pings the operator with a link, and the operator can unpublish. It never posts to Hacker News, X, dev.to, Reddit, Lobsters or email subscribers, and never creates accounts or spends money; those stay the operator's. Agents still cannot change this scope without a new Decision."
    recommended: true
  - label: Agents draft, operator approves each post
    consequence: Agents draft and fact-check posts on the same cadence, and each one waits for the operator's one-tap approval on /todo before it is published. Fewer surprises, but nothing publishes while the operator is away.
    recommended: false
  - label: Not now
    consequence: "Nothing is published automatically; posts are written only when asked. Revival trigger: the operator asks for the next Field Note."
    recommended: false
confidence: high
plan: governed-agent-roles-one-real-action-and-one-interactive-session-each-run-as-a
updated: 2026-10-10
answer: Agents publish Field Notes automatically on the operator's site
decided: 2026-10-10
---

# Decision 0120: Decide whether agents may publish Field Notes (ship notes and essays) to the operator's own Mission Control site automatically on a regular cadence, without a per-post operator approval.

## Options

- **Agents publish Field Notes automatically on the operator's site** (recommended): Agents draft, independently fact-check and publish Field Notes to the operator's own Mission Control site (and its RSS feed) on a regular cadence: ship notes when real work shipped (at most weekly, never padded), essays at genuine milestones (at most monthly). A post publishes only if the fact-check finds no blocking issue, every claim links to a PR or receipt, and it has a "What is not done" section; each publish pings the operator with a link, and the operator can unpublish. It never posts to Hacker News, X, dev.to, Reddit, Lobsters or email subscribers, and never creates accounts or spends money; those stay the operator's. Agents still cannot change this scope without a new Decision.
- **Agents draft, operator approves each post**: Agents draft and fact-check posts on the same cadence, and each one waits for the operator's one-tap approval on /todo before it is published. Fewer surprises, but nothing publishes while the operator is away.
- **Not now**: Nothing is published automatically; posts are written only when asked. Revival trigger: the operator asks for the next Field Note.

## Rationale

The operator said in chat on 2026-10-10 that he wants the entire blog managed automatically with a regular cadence for each article type. Publishing is an approval boundary under the Constitution, so it needs a recorded Decision. The strategy (docs/strategy/update-promotion-strategy.md) keeps every external platform manual and requires an independent agent fact-check on every post.

Proposed by Agent Ask raise-automatic-field-notes-publishing-20261010.
