# Articles for Arcadia Mission Control

When the operator explicitly requests repository storage, `docs/articles/` holds article drafts for eventual adaptation or publication on **ArcadiaMissionControl.com**. Otherwise, use the operator's existing Arcadia Articles folder, resolving its path or link before saving. Keeping a draft here does not mean it is live on the site.

## Drafts

- [How an idea becomes governed work](2026-10-23-how-an-idea-becomes-governed-work.md) — a short explainer of proposals, Agent Asks, Plans and Actions, and how settlement connects them.

- [Making every run teach us more](2026-10-21-making-every-run-teach-us-more.md) — a proposed feedback loop for autonomous production, using focused checks and disposable failure rehearsals.

- [Arcadia spatial background and conversational context](2026-10-14-arcadia-spatial-background.md) — design proposal for an entity-based conversational workspace; includes concept imagery.

- [Arcadia Studio gives agents room to create and puts the system to the test](2026-10-12-arcadia-studio-creative-work-integration-test.md) — the proposed creative studio, its minimal interface, and the first scout's proof boundary.
- [Why autonomous production is not a coding-speed problem](2026-10-12-why-autonomous-production-is-not-a-coding-speed-problem.md) — what the day's ~20 PRs showed was slow, and where Claude Code ultracode would and would not help.
- [The single-Action path runs itself](2026-10-10-the-single-action-path-runs-itself.md) — evidence from the disposable nine-Action fixture.

## Where to put a new article

Use `YYYY-MM-DD-<slug>.md` directly in this directory. Start from [the essay template](templates/essay.md) for a substantial idea or milestone, or [the ship-note template](templates/ship.md) for a short concrete update. Store the accompanying evidence in `receipts/<slug>.md` using [the receipt template](templates/receipt.md), and add a draft link above.

Retain the template metadata: title, date, type, slug, summary, resolved agent author, draft status, claims receipt, unfinished-work flag, intended canonical URL, and channels. The template's canonical URL is the intended publication destination; it is not evidence that a page exists. Preserve a meaningful **What is not done** section, distinguish proposed capabilities from observed results, and support factual implementation claims with public PRs and pinned source or receipts.

## Publication

[Decision 0120](../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md) governs automatic Field Notes publication: a fact-check with no blocking issue and a PR or receipt link for every claim, the stated cadence and milestone eligibility, the operator's site and RSS only, and observable publication and unpublish paths. A requested idea draft need not meet publication eligibility yet. Record a verified delivery receipt before claiming it was posted; drafting, committing, or merging an article does not publish it.
