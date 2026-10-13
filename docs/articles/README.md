# Articles for Arcadia Mission Control

When the operator explicitly requests repository storage, `docs/articles/` holds article drafts for eventual adaptation or publication on **ArcadiaMissionControl.com**. Otherwise, use the operator's existing Arcadia Articles folder, resolving its path or link before saving. Keeping a draft here does not mean it is live on the site.

## Drafts

- [Arcadia Studio gives agents room to create and puts the system to the test](2026-10-12-arcadia-studio-creative-work-integration-test.md) — the proposed creative studio, its minimal interface, and the first scout's proof boundary.
- [The single-Action path runs itself](2026-10-10-the-single-action-path-runs-itself.md) — evidence from the disposable nine-Action fixture.

## Where to put a new article

Use `YYYY-MM-DD-<slug>.md` directly in this directory. Start from [the essay template](templates/essay.md) for a substantial idea or milestone, or [the ship-note template](templates/ship.md) for a short concrete update. Store the accompanying evidence in `receipts/<slug>.md` using [the receipt template](templates/receipt.md), and add a draft link above.

Retain the template metadata: title, date, type, slug, summary, resolved agent author, draft status, claims receipt, unfinished-work flag, intended canonical URL, and channels. The template's canonical URL is the intended publication destination; it is not evidence that a page exists. Preserve a meaningful **What is not done** section, distinguish proposed capabilities from observed results, and support factual implementation claims with public PRs and pinned source or receipts.

## Publication

[Decision 0120](../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md) governs automatic Field Notes publication: independently checked claims, the stated cadence and milestone eligibility, the operator's site and RSS only, and observable publication and unpublish paths. A requested idea draft need not meet publication eligibility yet. Record a verified delivery receipt before claiming it was posted; drafting, committing, or merging an article does not publish it.
