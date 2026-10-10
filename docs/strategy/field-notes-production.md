# Field Notes production

This is the instruction file for a standard agent session, using existing Git,
GitHub and Arcadia commands. Read the [publishing strategy](update-promotion-strategy.md)
and [Decision 0120](../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md)
first. This file neither schedules a session nor grants authority.

## Current reachability

The production destination is `pmark/mission-control-site` at
`https://arcadiamissioncontrol.com`. Its main-branch Deploy workflow publishes
production on merge. As inspected on 2026-10-10, its main tree has guides but
no Field Notes content collection, `/notes/` routes or RSS implementation.
Arcadia's existing `blog` commands capture ideas and create draft scaffolds
and operator review items; they do not fact-check, publish, or implement the
Decision 0120 exception. Do not clear those review items automatically or use
`prepare-schedule` as a recurring scheduler. Track the missing capability in
[issue #1211](https://github.com/pmark/arcadia/issues/1211) and its
[implementation proposal](../proposals/field-notes-production-capability.md).

A session can produce and independently review a content package today. Live
publication and automatic cadence remain unimplemented; stop before them
until the site capability and a governed scheduling path exist. Do not install
cron, launchd, a queue or a second agent runner as a workaround.

## Inputs and preflight

Responsibility: the assigned author agent prepares the Artifact; a separate
reviewer judges it. No governed Action is created by this instruction file.
Required inputs are the checked-in strategy and Decision, exact source/base
revision, last verified publication receipt, an explicit timezone, and an
isolated candidate. Follow both repositories' instructions before changing
their files. Run `arcadia work monitor --no-pull-requests` before editing.

For a ship note, take the last completed Monday-to-Monday calendar week in
the supplied timezone; record its UTC boundaries as the cadence window.
Separately record an evidence collection interval `[last confirmed cutoff,
completed week end)` in UTC. It may span several weeks after downtime. The
explicit first-run baseline replaces the cutoff only on the first collection.
Publish no more than one ship note per calendar week. For an essay, require a
proven Milestone and no essay already published in the current calendar month.
Cadence is a ceiling, never a quota. Do not invent a timezone or a first-run
cutoff: a missing baseline becomes a captured question, not an all-history scan.

Before spending model tokens, inspect existing article/receipt files and any
publication receipt for this type/window. Reuse an existing package; do not
create a second slug on retry. After downtime, collect unreported shipped work
since the last confirmed cutoff into the next eligible note; do not publish a
burst of backdated posts. Unpublished packages remain pending and do not move
the cutoff. Any already published source must be excluded or explicitly cited
as background. An empty eligible set means skip with a receipt and zero
additional model calls.

## Collect one evidence package

Use existing commands; replace the angle-bracket arguments with resolved values:

```sh
gh pr list --repo pmark/arcadia --state merged --search 'merged:>=<COLLECTION-CUTOFF-UTC-DATE>' --limit 100 --json number,title,url,mergedAt,mergeCommit,body
gh pr view <NUMBER> --repo pmark/arcadia --json number,url,state,mergedAt,mergeCommit,body
git show <MERGE-SHA> --stat
git show <SOURCE-SHA>:<RECEIPT-PATH>
```

The list query is discovery only: start at the evidence collection cutoff
and filter exact `mergedAt` timestamps to the recorded half-open collection
interval, not the shorter cadence window. The UTC date query is coarse;
include that date and apply the exact timestamp filter afterwards. If the result reaches 100,
split the date query into bounded ranges or use existing GitHub pagination;
never assume the first page is complete. Pin the source revision separately
from the article revision. Verify each merged PR, its actual change and its
acceptance evidence; PR descriptions alone are claims, not proof. A merged
change is not necessarily deployed or usable. State fixture versus real
Project versus live use explicitly. Local history alone cannot prove a PR is
merged, and database status alone cannot prove a Milestone.

Store the public-safe package in `docs/articles/receipts/<slug>.md` using the
[receipt template](../articles/templates/receipt.md). Keep private logs in their
existing authorized custody; include only redacted, shareable evidence in Git.
If the proof cannot be shared or independently inspected, remove the public
claim. Link each factual sentence, summary claim and number to pinned public
proof. Keep raw data, normalized analysis, charts and editorial prose distinct
when an analytics story warrants them; no live API or credential is needed for
the ordinary ship-note path.

## Draft once

Copy the [ship-note template](../articles/templates/ship.md) or
[essay template](../articles/templates/essay.md) into
`docs/articles/YYYY-MM-DD-<slug>.md`. Do not publish templates or placeholders.
The same merged Markdown is the source for the site and full-text RSS. The site
must never become a competing editorial source.

Ship notes are 100–250 words of body text including the required limitation
section. Describe one to three user-visible changes, why they matter and what
is still missing. The opening states where the proof ran. Essays explain one
Milestone through problem, evidence, consequences and limitations; reuse
previous ship-note proof rather than researching it again. No speculative
superlatives, unmeasured comparisons, social variants or decorative images.

Use the least costly configured sufficient model. Budget one draft and one
independent fact-check per package, with at most one scoped author repair and
one delta check. Escalation requires a named unmet requirement and explicit
finite budget. Failed fact-check means hold the post and capture the finding,
not repeated generation until it passes. Quiet periods stop before drafting.

## Check mechanics, then independently judge

Before reviewer tokens, check all front matter against the strategy: title,
ISO date, type, slug, summary, agent author, draft status, receipt path,
`not_done: true`, canonical URL, and exactly `channels: [site, rss]`.
Check that the actual `## What is not done` section contains a specific
limitation and that all placeholders are gone. Check word count, links and
receipt coverage, then run `git diff --check`.

Freeze the article and receipt at an exact candidate revision. Give a separate
read-only reviewer the following brief, without the author's confidence or
verdict:

> Read the Field Notes strategy, Decision 0120, this exact article revision and
> its receipt. Check every factual sentence and summary against the cited
> evidence. Distinguish fixture, merged code, deployed code and real use; verify
> every number and the authority scope. Flag unsupported claims, omitted
> limitations, private data, channel expansion and cadence violations. Report
> PASS or HOLD, with blocking findings by sentence and evidence. You may read
> through git show or extract the revision into a fresh temporary directory.
> Never edit, checkout, stash, reset, commit, run a broker, publish, message
> anyone or touch another live checkout. Record the reviewed article revision
> and source revision; do not accept the author's self-review as proof.

Retain the report with the package. Resolve blocking findings within the budget
or hold. Any article or receipt change invalidates its review and requires a
scoped delta check; a PASS applies only to the exact reviewed bytes. Opening a
PR also requires independent PR review and the repository's required checks.

## Publication handoff and recovery

Until the capability is implemented, keep `status: draft` or `reviewed` and
hand off the content PR. `approved` must mean the publication adapter verified
Decision 0120, the matching independent PASS and all mechanical gates; it is
not permission to skip them. `published` belongs in the durable publication
receipt, while the source remains `approved` so a rebuild can include it.

The implementation must copy only approved source and public receipts from a
merged, pinned Arcadia revision into an isolated site candidate. A site PR
must touch only Field Notes content/receipts for automatic publication: route,
workflow, configuration or other site changes require separate reviewed work.
Before merging content, read the site's own authority and required checks;
Decision 0120 must be reconciled with its instructions, never treated as a
blanket deployment grant. The site build must reject unreviewed content and
mismatched receipt/review bindings. Its existing Deploy workflow is the
publication path; do not introduce a direct credentialed deploy fallback.

A publication receipt must bind type/window, slug, source article revision,
reviewed content hash, reviewer report, site commit, deploy result and canonical
URL. One pending delivery per type/window prevents overlapping sessions or
retries from duplicating posts. A rerun first checks the existing site PR,
merge/deploy result and live page/RSS before attempting any mutation. Failed
or unknown delivery stays pending and never advances the cutoff. A successful
receipt advances it only after the live page and full-text feed match the
approved content. Notification is a separate retry-safe delivery: its failure
must not republish the post. Decision 0120 requires a link ping and an operator
unpublish path; preserve both before calling automation complete.

Unpublishing removes the live entry and RSS item through reviewed site history,
preserving the source, receipts and tombstone. Retrying must respect that
withdrawal rather than reimport the approved source. Never send social posts,
subscriber email, create accounts or spend money through this workflow.

## Acceptance for the implementation follow-up

- A quiet week skips without drafting; new merged work produces one short
  note; a proven Milestone is essay-eligible within the monthly ceiling.
- Exact window boundaries, first-run baseline, pagination and downtime catch-up
  are inspectable, with no lost or duplicate work.
- Missing proof, a blocking review, changed reviewed bytes, private evidence or
  expanded channels refuses publication.
- Two concurrent attempts and a lost response produce one post, one feed item
  and one retry-safe notification; failed delivery keeps its pending package.
- Live page and full-text RSS match the approved source; an unpublish survives
  subsequent retries. Default tests are offline fixtures.
