# Articles for Arcadia Mission Control

`docs/articles/` captures topics and detailed source material primarily for AI
agents to find, understand and reuse. Clara — Technical Writer owns the editorial
lifecycle: topic selection, audience/search intent, research and fact-checking,
writing/editing, discoverability, approved publication/distribution, verification
and timely maintenance. Rowan retains priorities and coordination. This explicit
Project direction supersedes the older personal Arcadia Articles folder default;
legacy drafts remain in place.

Polished, consumable human-facing guides, explainers and blog pieces belong in
[AMC](https://arcadiamissioncontrol.com), maintained in
[pmark/mission-control-site](https://github.com/pmark/mission-control-site).
Adapt source evidence for the reader instead of copying internal notes. Preserve
source paths/revisions and links to actual hosted canonical URLs and publication
receipts. A topic, intended URL or merged source is not a published page.

Resolve the target Project/repository and read its
[AGENTS](https://github.com/pmark/mission-control-site/blob/main/AGENTS.md),
[guide authoring](https://github.com/pmark/mission-control-site/blob/main/docs/guide-authoring.md),
[capability refresh](https://github.com/pmark/mission-control-site/blob/main/docs/capability-refresh.md)
and [deployment contract](https://github.com/pmark/mission-control-site/blob/main/DEPLOY.md)
before editing AMC. Main pushes deploy through its existing workflow; source
inspection establishes no permission to merge/deploy. Use
[Clara's method](../agent-guidance/session-roles-and-briefs.md#clara-technical-writing)
for evidence, discoverability and channel boundaries.

## Drafts

- [How an idea becomes governed work](2026-10-23-how-an-idea-becomes-governed-work.md): a short explainer of proposals, Agent Asks, Plans, Actions and Decisions, and how settlement connects them.

- [Making every run teach us more](2026-10-21-making-every-run-teach-us-more.md) — a proposed feedback loop for autonomous production, using focused checks and disposable failure rehearsals.

- [Arcadia spatial background and conversational context](2026-10-14-arcadia-spatial-background.md) — design proposal for an entity-based conversational workspace; includes concept imagery.

- [Arcadia Studio gives agents room to create and puts the system to the test](2026-10-12-arcadia-studio-creative-work-integration-test.md) — the proposed creative studio, its minimal interface, and the first scout's proof boundary.
- [Why autonomous production is not a coding-speed problem](2026-10-12-why-autonomous-production-is-not-a-coding-speed-problem.md) — what the day's ~20 PRs showed was slow, and where Claude Code ultracode would and would not help.
- [The single-Action path runs itself](2026-10-10-the-single-action-path-runs-itself.md) — evidence from the disposable nine-Action fixture.

## Capture a topic or source article

Use `YYYY-MM-DD-<slug>.md` directly in this directory. Start from [the essay template](templates/essay.md) for a substantial idea or milestone, or [the ship-note template](templates/ship.md) for a short concrete update. Store the accompanying evidence in `receipts/<slug>.md` using [the receipt template](templates/receipt.md), and add a draft link above.

Retain the template metadata: title, date, type, slug, summary, resolved agent author, draft status, claims receipt, unfinished-work flag, intended canonical URL, and channels. The template's canonical URL is the intended publication destination; it is not evidence that a page exists. Preserve a meaningful **What is not done** section, distinguish proposed capabilities from observed results, and support factual implementation claims with public PRs and pinned source or receipts.

## Publication

Clara may prepare requested social copy referencing her AMC material. Post only
under the applicable channel/account Decision with approved copy and a verified
hosted canonical URL. Do not present an unhosted draft as live. Keep draft,
merged, deployed, verified-page and social-post outcomes separate with timestamps
and existing receipts; reconcile prior delivery before retrying. No account,
spending, email or social permission follows from the editorial assignment.

The Field Notes templates and their exact-copy/review bindings apply to the existing
Decision 0120 Field Notes packages; general AMC guides adapt agent-oriented
sources under AMC's authoring contract. Legacy package metadata and receipts
remain intact.

[Decision 0120](../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md) governs automatic Field Notes publication: a fact-check with no blocking issue and a PR or receipt link for every claim, the stated cadence and milestone eligibility, the operator's site and RSS only, and observable publication and unpublish paths. A requested idea draft need not meet publication eligibility yet. Record a verified delivery receipt before claiming it was posted; drafting, committing, or merging an article does not publish it.
