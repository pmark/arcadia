# How Arcadia updates are published and promoted

Status: operator decisions recorded 2026-10-10 (see the last section). Nothing
here posts anywhere. It governs the Mission Control site (ArcadiaMissionControl.com,
own repo) and drafts kept in this repo. Standing rule: honesty outranks conversion.

## Recommendations

1. **One site section, two post types.** Section name **Field Notes** (decided),
   at `/notes/`. Post `type: ship` (short, dated, 100-250 words, what merged and
   what did not) and `type: essay` (milestone write-ups like the first article).
   One feed, filterable by type. If ship notes outgrow it, split later into
   `/changelog/`.
2. **Source of truth is this repo.** Drafts live in `docs/articles/YYYY-MM-DD-slug.md`;
   the site repo pulls or copies merged files. The site never holds text that
   the repo lacks. URL: `/notes/<slug>/`. Feed: `/notes/rss.xml` (full text),
   auto-discovery link in the head.
3. **Default cadence (per post type, agent-managed once authorized).**
   Ship notes: weekly, only when there is shipped work, never padded; a quiet
   week means no post. Essays: only at a real milestone, at most monthly.
   Never publish to hit a schedule.
4. **Publishing authority.** Until the governed Decision "agents publish Field
   Notes to the operator's own site automatically, under the honesty gate" is
   answered and implemented, every post needs the operator's per-post `/todo`
   approval. After it, agents may publish Field Notes on the Mission Control
   site only, on the cadence above. The agent fact-check gate stays mandatory
   in both modes, and the Decision covers no other site or platform.
5. **No social posting yet.** HN, X, dev.to, Reddit and Lobsters are all held.
   The only outward channels now are the site, its RSS feed and an email list.
6. **First article:** publish on the site and RSS (after fact-check and
   per-post approval); no external submission.

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

Channel analysis below is retained for when social is authorized; all rows except the site, RSS and email are currently held.

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

1. Agent drafts the post, its receipts file and, for the email list, an email
   draft. No per-channel social variants are produced while social is held.
2. Independent agent fact-checks; findings fixed. Mandatory in every mode.
3. Until the Decision lands: one `/todo` item per post with a Discord deep
   link showing the exact text and the consequence of approving or skipping.
4. After the Decision: agents publish on cadence to the Mission Control site;
   the operator is notified, and can unpublish. Failed fact-check means no
   post and an alert, not a retry loop.
5. Email: the operator signs up for the tool himself (account creation is his
   step). Agents only draft emails, as drafts and never auto-send.
6. Metrics, weekly, privacy-respecting: privacy-friendly aggregate page views
   and referrers (no per-person tracking), RSS and email subscriber counts,
   GitHub stars and issues from strangers. Record one line per post.

## First post

Publish `The single-Action path runs itself` on the site and RSS after the
fact-check and the operator's approval, keeping its "fixture only" framing.
No external submission. When social is later authorized, the earlier channel
analysis above still applies, and Show HN waits for an installable project.

## Operator decisions (2026-10-10)

1. **Section name:** Field Notes at `/notes/`.
2. **Social:** no Hacker News submission, and no social-media posting at all
   yet (HN, X, dev.to, Reddit, Lobsters all held).
3. **Email list:** yes, start one. The signup is the operator's own step;
   agents draft emails only.
4. **Automatic publishing:** the operator wants the entire blog (Field Notes
   on the Mission Control site only) managed automatically on a regular
   cadence per post type. Pending a governed Decision, being raised now.
   Until it is answered and implemented, publishing stays per-post operator
   approval. The default cadence is in Recommendation 3.
5. **X:** yes eventually, but no presence today. The only handle is @pmark.
   No posting until the operator says so.
