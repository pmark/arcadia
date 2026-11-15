---
arcadia: v1
type: decision
id: "0234"
slug: amend-decision-0120-may-the-field-notes-writers-flynn-the-chronicler-and-clara
project: arcadia
status: approved
question: "Amend Decision 0120: may the Field Notes writers Flynn (the Chronicler) and Clara publish automatically to one combined Field Notes feed on GitHub Pages, each post in its writer's own Iris-designed style, with Flynn posting up to four digests a day?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A: Field Notes on GitHub Pages becomes the destination for automatic multi-writer publishing"
options:
  - label: "A: Field Notes on GitHub Pages becomes the destination for automatic multi-writer publishing"
    consequence: "Flynn (the Chronicler) publishes digests up to four times a day, with musings clearly labelled as musings, and Clara publishes her Field Notes, automatically and without a per-post operator tap, to one combined Field Notes feed on the GitHub Pages blog (https://pmark.github.io/arcadia/, built from docs/articles) with its RSS/Atom feed. Each writer's posts have their own unique visual and voice style, designed by Iris, while the feed combines all posts. Decision 0120's conditions stay: every post needs an independent fact-check with no blocking issue, every factual claim links to a PR or receipt, a \"What is not done\" section, an operator ping with a link on each publish, and the operator can unpublish. External platforms, accounts and spend stay the operator's. Risk: up to four posts a day by Flynn can be noisy, and an automated digest could publish a wrong claim between operator looks; the independent fact-check, receipts and unpublish bound this. Clara's cadence stays as in Decision 0120 unless the operator says otherwise."
    recommended: true
  - label: "B: Same destination and styles, but each post waits for one operator tap"
    consequence: Flynn's digests and Clara's notes are drafted, independently fact-checked and styled the same way, and the combined feed and per-writer styles are built, but each post waits for the operator's one-tap approval on /todo before it publishes. Safest, but with up to four Flynn digests a day this adds up to four taps a day, and nothing publishes while the operator is away.
    recommended: false
  - label: "C: Keep Decision 0120 as is"
    consequence: "No digest type, no per-writer style system and no combined multi-writer feed; ship notes (at most weekly) and essays (at most monthly) continue under Decisions 0120 and 0165, and Clara's posts keep needing one-time operator approvals. Revival trigger: the operator asks again for Flynn's digests or per-writer styles."
    recommended: false
confidence: high
plan: prove-the-rowan-supervisor-attention-loop
updated: 2026-11-14
answer: "A: Field Notes on GitHub Pages becomes the destination for automatic multi-writer publishing"
decided: 2026-11-14
---

# Decision 0234: Amend Decision 0120: may the Field Notes writers Flynn (the Chronicler) and Clara publish automatically to one combined Field Notes feed on GitHub Pages, each post in its writer's own Iris-designed style, with Flynn posting up to four digests a day?

## Options

- **A: Field Notes on GitHub Pages becomes the destination for automatic multi-writer publishing** (recommended): Flynn (the Chronicler) publishes digests up to four times a day, with musings clearly labelled as musings, and Clara publishes her Field Notes, automatically and without a per-post operator tap, to one combined Field Notes feed on the GitHub Pages blog (https://pmark.github.io/arcadia/, built from docs/articles) with its RSS/Atom feed. Each writer's posts have their own unique visual and voice style, designed by Iris, while the feed combines all posts. Decision 0120's conditions stay: every post needs an independent fact-check with no blocking issue, every factual claim links to a PR or receipt, a "What is not done" section, an operator ping with a link on each publish, and the operator can unpublish. External platforms, accounts and spend stay the operator's. Risk: up to four posts a day by Flynn can be noisy, and an automated digest could publish a wrong claim between operator looks; the independent fact-check, receipts and unpublish bound this. Clara's cadence stays as in Decision 0120 unless the operator says otherwise.
- **B: Same destination and styles, but each post waits for one operator tap**: Flynn's digests and Clara's notes are drafted, independently fact-checked and styled the same way, and the combined feed and per-writer styles are built, but each post waits for the operator's one-tap approval on /todo before it publishes. Safest, but with up to four Flynn digests a day this adds up to four taps a day, and nothing publishes while the operator is away.
- **C: Keep Decision 0120 as is**: No digest type, no per-writer style system and no combined multi-writer feed; ship notes (at most weekly) and essays (at most monthly) continue under Decisions 0120 and 0165, and Clara's posts keep needing one-time operator approvals. Revival trigger: the operator asks again for Flynn's digests or per-writer styles.

## Rationale

Operator words, relayed by Signal 11 from its transcript 6c227f6b-bd31-45d1-9ff0-edc572715a8a on 2026-11-14 and to be verified by Signal 11 under Decision 0229 before this is answered: "have Flynn post a blog that is a digest up to four times a day", and "it would be posted to Field Notes, but very clearly in his style. Field Notes should have a feed that combines all of the posts, but each post should have a completely unique style that each writer, in this case Flynn, and the other one is Clara, has Iris design." Publishing is an approval boundary under the Constitution, so this needs a recorded Decision. Today: Decision 0120 (2026-10-10) lets agents publish ship notes (at most weekly) and essays (at most monthly) automatically to the operator's own site, and Decision 0165 (2026-11-01) added the GitHub Pages blog at https://pmark.github.io/arcadia/ (built from docs/articles by the Blog workflow, feed at /feed.xml) as a destination, gated by status approved, type ship or essay, channels [site, rss], a "What is not done" section and a claims receipt whose independent review ends in Verdict PASS. Clara's posts so far each needed the operator's one-time approval (Decisions 0208 and 0216), and no digest post type, per-writer style or four-a-day cadence is covered. This Decision grants publication scope only: no accounts, spend, credentials, posting to Hacker News, X, dev.to, Reddit, Lobsters or email subscribers (those stay the operator's), no production START and no merge authority change. The Ask is a proposal: Ellis drafts the implementation batch (combined feed, per-writer style system designed by Iris, publish path) only after the operator answers.

Proposed by Agent Ask amend-decision-0120-flynn-clara-field-notes-feed-20261114.

## Answer record (Decision 0229)

Answered **A** on 2026-11-14 (Pacific). Verified per Decision 0229 by Rowan 16 (Claude Code session local_7824b4cc-b3f7-4711-86d4-75f6d6fb593b), read-only from Signal 11's session transcript: the operator's own user-role message, verbatim `0234 A`, in session local_61703936-0009-4be3-88b7-c44879f6f8ad (transcript 6c227f6b-bd31-45d1-9ff0-edc572715a8a), line 6077, uuid af7abeea-f4fd-437f-b801-0a48d6d1a9d1, timestamp 2026-11-15T02:43:30.044Z (2026-11-14 6:43:30 PM Pacific), sent as the reply to Signal 11's presentation of this A/B/C menu after PR #2691 merged (5b46c9de7). The six detail points Iris and Rowan raised with it (per-site post limit, non-author fact-checker, Atom counts as RSS, publish-ping choice, retired-writer behaviour, no real-person style) were not answered in that message and are not assumed by this answer.
