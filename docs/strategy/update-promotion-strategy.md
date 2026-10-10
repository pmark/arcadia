# How Arcadia updates are published and promoted

Status: proposal for operator review (2026-10-10). Nothing here posts anywhere.
It governs the Mission Control site (ArcadiaMissionControl.com, own repo) and
drafts kept in this repo. Standing rule: honesty outranks conversion.

## Recommendations

1. **One site section, two post types.** Section name **Field Notes**, at
   `/notes/`. Post `type: ship` (short, dated, 100-250 words, what merged and
   what did not) and `type: essay` (milestone write-ups like the first article).
   One feed, filterable by type. Reason: one person cannot feed two sections;
   a single chronological log reads as an honest mission log, and "Blog" invites
   marketing tone. If ship notes outgrow it, split later into `/changelog/`.
2. **Source of truth is this repo.** Drafts live in `docs/articles/YYYY-MM-DD-slug.md`;
   the site repo pulls or copies merged files. The site never holds text that
   the repo lacks. URL: `/notes/<slug>/`. Feed: `/notes/rss.xml` (full text),
   auto-discovery link in the head.
3. **Cadence.** Ship note after a meaningful merged batch, at most weekly,
   skipped when nothing true is worth saying. Essay only at a real milestone
   (roughly monthly or less). Never publish to hit a schedule.
4. **Promote almost nothing at first.** Own the feed and the site; put the first
   essay on a small number of channels (below). No Show HN until others can
   install Arcadia.
5. **No auto-posting.** Agents draft the post and per-channel variants. Mark
   approves or skips each channel from one `/todo` item reached by a Discord
   deep link. Any automated posting needs a governed Decision.
6. **First article:** publish on the site and RSS now; submit once to Hacker
   News as a regular link (not Show HN) only if Mark approves; hold Show HN,
   Reddit launch posts and similar pushes until installable.

## Front-matter contract (agents draft against this)

```yaml
---
title: "Sentence-case, no hype, no all caps"
date: 2026-10-10            # publish date, ISO
type: ship | essay
slug: single-action-path-runs-itself   # optional, else from filename
summary: "One or two plain sentences; used for feed and social cards."
author: "Arcadia (drafted by <agent name>)"
status: draft | reviewed | approved | published
claims_receipt: docs/articles/receipts/<slug>.md   # claim -> PR/receipt table
not_done: true              # post must contain a "What is not done" section
canonical: https://arcadiamissioncontrol.com/notes/<slug>/   # filled at publish
channels: [site, rss]       # channels approved by Mark; others need a /todo yes
---
```

The site build should fail when `not_done` is missing, `claims_receipt` is
absent, or `status` is not `approved`.

## Honest-claims checklist (every post)

- Every factual sentence maps to a PR, commit, run log or Decision link; the
  receipts file lists them. Unlinked numbers get cut.
- Say where it ran (fixture vs. real project) in the first paragraph.
- A "What is not done" section is required and non-trivial.
- No superlatives, no "revolutionary", no comparisons we have not measured.
- State who held authority (which Decision, which expiry).
- Agent-written text is labelled as agent-drafted.

**Review gate:** (1) independent agent fact-check of each claim against its
receipt, as done for the first article, with findings resolved; (2) Mark
approves from `/todo`; (3) status flips to `approved`, then publish.

## Channels, ranked for a not-yet-installable project

| Rank | Channel | Use for | Rules to respect | Source |
|---|---|---|---|---|
| 1 | Own site + RSS | every post | none; canonical home | [Astro RSS guide](https://docs.astro.build/en/guides/rss/) |
| 2 | Email list (Buttondown, RSS-to-email, draft mode) | essays; opt-in only | create as drafts for approval, not auto-send | [Buttondown RSS-to-email](https://docs.buttondown.com/rss-to-email) |
| 3 | Hacker News, regular submission | milestone essays only, once each, original URL | blog posts are not Show HN; no asking for votes; do not editorialize titles; self-posting only occasionally | [Show HN rules](https://news.ycombinator.com/showhn.html), [guidelines](https://news.ycombinator.com/newsguidelines.html) |
| 4 | dev.to cross-post | essays, 1-3 days after the site post; optional | set `canonical_url` to the site | [dev.to editor guide](https://dev.to/p/editor_guide) |
| 5 | X/Twitter (or Bluesky/Mastodon) | one short thread per essay; one line per ship note | plain text, link in last post, no engagement bait | judgment, no formal rule |
| 6 | Reddit (r/LocalLLaMA, r/programming, others) | skip for now; consider after install works | each sub's sidebar governs; 9:1 is a norm, some subs ban self-posts; I could not verify either sub's current text | [overview](https://www.teract.ai/resources/reddit-subreddit-marketing-2026) |
| 7 | Lobsters | only if a regular member suggests it | invite-only; self-promotion under about a quarter of activity; "show" tag unavailable to new users (first 70 days) | [Lobsters about](https://lobste.rs/about) |

Notes on norms:

- **Show HN** is for something others can try; work "that isn't ready for users
  yet" should wait ([rules](https://news.ycombinator.com/showhn.html)).
  Moderators are also openly worried about generated one-offs flooding Show HN
  ([discussion](https://hn.svelte.dev/item/47213630)), and Arcadia is an
  agent-heavy project, so an honest post about that, once installable, is the
  only credible framing.
- **dev.to canonical:** dev.to supports `canonical_url` front matter. Caveat:
  Google reportedly no longer recommends rel=canonical for syndication and
  suggests syndication partners noindex
  ([SEJ summary](https://www.searchenginejournal.com/ranking-factors/canonicalization/),
  secondary source). Treat the canonical tag as courtesy, publish on the site
  first, link back in the first line, and delay the cross-post so the original
  is indexed first.
- **Changelog vs. blog:** developer-tool guidance favours short, dated,
  user-impact entries with breaking changes flagged and long material linked
  out ([Mintlify](https://www.mintlify.com/blog/five-changelog-principles-from-best-developer-brands),
  [Intercom](https://www.intercom.com/blog/?p=28233)). Ship-type notes follow
  that shape; essays link to them.

## When not to post

- Not before the claim receipts and fact-check pass.
- Not to HN more than once per milestone (judgment, though HN asks that
  self-posting be occasional), never re-submitting a flop (judgment), never
  from a new, empty account without ordinary participation first (judgment).
- Not Show HN until `arcadia` installs in minutes without signup.
- Not the same text on five channels the same hour. Stagger: site, then
  email, then HN/X next morning (US weekday morning), dev.to a day later
  (all timing here is judgment, not sourced).
- Never ask for upvotes, stars or shares in any variant.

## Operating model (minimal operator time)

1. Agent drafts post, receipts file and per-channel variants (HN title, X
   thread of 3-5 posts, dev.to front matter, email blurb).
2. Independent agent fact-checks; findings fixed.
3. One `/todo` item per post with a Discord deep link: "Approve site+RSS" and
   per-channel Approve / Skip choices showing the exact text and consequence.
4. Site publish follows the operator's `/todo` approval (it is Mark's own
   property); agent-published ship notes with no per-post approval would need
   a future governed Decision;
   external platforms are posted by Mark by hand or, later, by a narrow
   governed Decision with an expiry, like Decision 0100.
5. Metrics, weekly, privacy-respecting: privacy-friendly aggregate page views
   and referrers (no per-person tracking), RSS and email subscriber counts,
   GitHub stars and issues from strangers, and replies worth answering. Judge
   by qualified conversations, not totals. Record one line per post.

## First post

Publish `The single-Action path runs itself` on the site and RSS now, after the
fact-check, keeping its "fixture only" framing. Optional: one regular HN
submission and one X thread, both only with Mark's yes. Hold: Show HN, Reddit,
Lobsters and any "try it" call to action until installable. Hold the dev.to
cross-post unless Mark wants it; it adds little before there is something to
install.

## Open questions for Mark

1. **Section name: Field Notes or Mission Log?** Field Notes is plainer;
   Mission Log fits the brand but can read as theatre. Either is a one-line
   rename; the URL changes with it.
2. **Submit the first essay to HN now?** Yes buys early feedback from the
   target audience but spends a regular-submission shot before install
   exists; no keeps it for the install milestone.
3. **Start an email list now?** Yes captures curious readers while install is
   still a goal; costs one tool signup (an account step you must do yourself)
   and a privacy notice.
4. **Allow a later Decision for agent-published ship notes on your own site
   only?** Saves approvals; external platforms stay manual either way.
5. **Any X presence?** Needs an account and a few minutes weekly; skipping
   costs reach but nothing else.
