# Arcadia Field Notes (GitHub Pages)

Field Notes is the plain project-update feed: what shipped, what broke, what is
next. It is built from the dated posts in `docs/articles/` and published to
https://pmark.github.io/arcadia/. The split: **Field Notes = project updates on
GitHub Pages; AMC ([arcadiamissioncontrol.com](https://arcadiamissioncontrol.com))
= polished customer-facing guides.** The audiences overlap; the purposes differ.

## How posts are published

- Any `docs/articles/YYYY-MM-DD-slug.md` becomes a post at `/posts/slug/`, newest
  first, with an Atom feed at `/feed.xml`. `README.md`, `templates/` and
  `receipts/` are not posts. Articles are never edited by the build.
- `node site/stage.mjs <dir>` copies this directory and the posts into `<dir>`,
  adds a title from the first H1 when front matter lacks one, drops that H1 (the
  layout renders it), and rewrites relative links (sibling posts to post pages,
  other files to the repository on `main`). Jekyll (`jekyll-feed`) then renders it.
- `.github/workflows/blog.yml` builds on pull requests (check only) and deploys
  on pushes to `main` that touch `docs/articles/`, `site/` or the workflow.
- The pages are static HTML and CSS: no JavaScript, responsive, light/dark.

## One-time operator setup (not done by the build)

Settings > Pages > Source = "GitHub Actions". Until then the deploy job is
skipped and the build still passes. Public publication needs the operator's
explicit approval (Constitution), and Decision 0120 names the Mission Control
site as the Field Notes destination, so this destination needs a Decision
amendment first. Front-matter `status: draft` posts show a "draft" badge.

## Local build

```
node site/stage.mjs "$TMPDIR/fn-src"
jekyll build -s "$TMPDIR/fn-src" -d "$TMPDIR/fn-site"   # jekyll 3.10 + jekyll-feed
```
