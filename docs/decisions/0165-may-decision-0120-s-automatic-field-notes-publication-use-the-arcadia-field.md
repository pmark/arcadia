---
arcadia: v1
type: decision
id: "0165"
slug: may-decision-0120-s-automatic-field-notes-publication-use-the-arcadia-field
project: arcadia
status: open
question: "May Decision 0120's automatic Field Notes publication use the Arcadia Field Notes blog on GitHub Pages (https://pmark.github.io/arcadia/, built from docs/articles by .github/workflows/blog.yml) as a destination, in addition to the Mission Control site?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Yes: Field Notes may publish on the GitHub Pages blog (recommended)"
options:
  - label: "Yes: Field Notes may publish on the GitHub Pages blog (recommended)"
    consequence: "Adds one destination to Decision 0120: the public Arcadia Field Notes blog on GitHub Pages at https://pmark.github.io/arcadia/ (the repository is public) and its feed at /feed.xml. It is built from docs/articles in pmark/arcadia and deployed only by the Blog workflow from main, so every publish or unpublish is a merged PR under the repository's normal merge rules. This applies only once the site with its publication gate is merged: the build stages only posts with status approved, type ship or essay, channels [site, rss], not_done true and a claims receipt whose Independent review section ends in Verdict PASS. Every existing draft stays unpublished, and any already-approved post with a PASS receipt would publish on the first deploy. The gate is mechanical. Decision 0120's other conditions remain process conditions for the publishing agent, not code: an independent fact-check with no blocking issue, a PR or receipt for every claim, a What is not done section, ship notes at most weekly and essays at most monthly at a real milestone, and a link ping to the operator by the publishing agent after each verified publish. Unpublish: status withdrawn plus a merge removes the page and feed item on the next deploy. The source stays in public Git history, and the operator can also disable Pages at once. Enabling GitHub Pages in repository settings stays the operator's one-time step. No social posts, subscriber email, accounts or spending."
    recommended: true
  - label: "No: Mission Control site only"
    consequence: Field Notes stay limited to arcadiamissioncontrol.com, which has no Field Notes route or feed yet, so no Field Note publishes automatically until that capability exists. The GitHub Pages blog is not used for Field Notes.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-01
---

# Decision 0165: May Decision 0120's automatic Field Notes publication use the Arcadia Field Notes blog on GitHub Pages (https://pmark.github.io/arcadia/, built from docs/articles by .github/workflows/blog.yml) as a destination, in addition to the Mission Control site?

## Options

- **Yes: Field Notes may publish on the GitHub Pages blog (recommended)** (recommended): Adds one destination to Decision 0120: the public Arcadia Field Notes blog on GitHub Pages at https://pmark.github.io/arcadia/ (the repository is public) and its feed at /feed.xml. It is built from docs/articles in pmark/arcadia and deployed only by the Blog workflow from main, so every publish or unpublish is a merged PR under the repository's normal merge rules. This applies only once the site with its publication gate is merged: the build stages only posts with status approved, type ship or essay, channels [site, rss], not_done true and a claims receipt whose Independent review section ends in Verdict PASS. Every existing draft stays unpublished, and any already-approved post with a PASS receipt would publish on the first deploy. The gate is mechanical. Decision 0120's other conditions remain process conditions for the publishing agent, not code: an independent fact-check with no blocking issue, a PR or receipt for every claim, a What is not done section, ship notes at most weekly and essays at most monthly at a real milestone, and a link ping to the operator by the publishing agent after each verified publish. Unpublish: status withdrawn plus a merge removes the page and feed item on the next deploy. The source stays in public Git history, and the operator can also disable Pages at once. Enabling GitHub Pages in repository settings stays the operator's one-time step. No social posts, subscriber email, accounts or spending.
- **No: Mission Control site only**: Field Notes stay limited to arcadiamissioncontrol.com, which has no Field Notes route or feed yet, so no Field Note publishes automatically until that capability exists. The GitHub Pages blog is not used for Field Notes.

## Rationale

Decision 0120 names the operator's Mission Control site, but the new Field Notes blog (PR #1930) is on GitHub Pages, and that PR said this destination needs a Decision amendment. The operator instructed in Rowan's chat on 2026-11-01: "ask Clara to write an article. At this point I expect that previous instruction to yield a published article on the new Field Notes Blog". This Ask reads that instruction as choosing the new GitHub Pages blog as the place Field Notes publish. The reading is the agent's: the quote names the blog and expects publication, but it does not mention the feed, standing use or any 0120 condition. So the recorded answer keeps every 0120 condition and adds only the destination. Publishing is an approval boundary, so it is recorded as a Decision. It supersedes the unsettled preview decision-field-notes-github-pages-destination-20261101, which a critic pre-review found overstated the site gate.

Proposed by Agent Ask decision-field-notes-github-pages-destination-20261101-v2.
