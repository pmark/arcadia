# Arcadia Field Notes (GitHub Pages)

Field Notes is the plain project-update feed: what shipped, what broke, what is
next. It is built from the dated posts in `docs/articles/` and published to
https://pmark.github.io/arcadia/. The split: **Field Notes = project updates on
GitHub Pages; AMC ([arcadiamissioncontrol.com](https://arcadiamissioncontrol.com))
= polished customer-facing guides.** The audiences overlap; the purposes differ.

## How posts are published

- A `docs/articles/YYYY-MM-DD-slug.md` becomes a post at `/posts/slug/`, newest
  first, with an Atom feed at `/feed.xml`, **only if** it is an approved Field
  Note under Decision 0120: `status: approved`, `type: ship|essay`,
  `channels: [site, rss]`, `not_done: true`, and a `claims_receipt` under
  `docs/articles/receipts/` that records `- Verdict: PASS` from an independent
  fact-check. Every other article (drafts included) is skipped and listed in the
  build log. `README.md`, `templates/` and `receipts/` are not posts. Articles are
  never edited by the build.
- **Unpublish:** set the post's `status: withdrawn` (keep the file and receipt)
  and merge; the next deploy removes the page and its feed item.
- `node site/stage.mjs <dir>` copies this directory and the posts into `<dir>`,
  adds a title from the first H1 when front matter lacks one, drops that H1 (the
  layout renders it), and rewrites relative links (sibling posts to post pages,
  other files to the repository on `main`). Jekyll (`jekyll-feed`) then renders it.
- `.github/workflows/blog.yml` builds on pull requests (check only) and deploys
  on pushes to `main` that touch `docs/articles/`, `site/` or the workflow.
- Post links and the feed are rendered by Jekyll. The site adds Canyon
  Pass as a progressive enhancement over a still background. The
  background follows the simulated Martian day with a static star field. The
  system reduced-motion or forced-colors preference disables the moving background.
- The wordmark, typefaces, sol palette and star field follow the
  [Mission Control Site](https://github.com/pmark/mission-control-site).
  Field Notes keeps the sky running between the index and articles and restores
  the camera pose on a same-tab reload. The AMC-style icon toggle controls the
  interface theme independently of the sky clock.
  Three.js is loaded from a version-pinned CDN when motion is enabled.

## Topics and canonical URLs

Give each article one to three distinct lowercase topic slugs in its front
matter, for example `tags: [agent-workflows, testing]`. Reuse existing slugs
when they fit. The build rejects missing or malformed tags on otherwise
approved posts. The Topic Atlas at `/tags/` groups published posts by their
tags and sizes each label by the number of posts in that topic. The topic
counts and links update on the next build when an article is added, retagged,
or withdrawn.

Keep the intended `canonical` URL in the source metadata. The Pages layout
generates the HTML canonical link from the public page URL, including the
`/arcadia` base path.

## Resources

For a Field Note that draws on outside research or a practical guide, add or
reuse its source in `_data/resources.yml`. Link the original source, describe
how the note applies it, and include each related Field Note slug in `posts`.
Resources lists only sources with at least one published companion post, so
drafts and withdrawn notes stay out of the public index.

## One-time operator setup (not done by the build)

Settings > Pages > Source = "GitHub Actions". Until then the deploy job is
skipped and the build still passes. After enabling it, run the Blog workflow on
`main` once (Actions > Blog > Run workflow) to deploy what is already merged.
Publication here is governed by Decision 0120 and the destination Decision that
names this site; no social posts, email, accounts or spending follow from it.

## Local build

```
node site/stage.mjs "$TMPDIR/fn-src"
jekyll build -s "$TMPDIR/fn-src" -d "$TMPDIR/fn-site"   # jekyll 3.10 + jekyll-feed
```
