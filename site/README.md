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
- The pages are static HTML and CSS: no JavaScript, responsive, light/dark.

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
