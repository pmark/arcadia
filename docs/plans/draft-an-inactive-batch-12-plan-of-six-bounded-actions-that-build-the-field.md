---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-12-plan-of-six-bounded-actions-that-build-the-field
project: arcadia
status: draft
milestone: Draft an inactive batch 12 Plan of six bounded Actions that build the Field Notes writer identity system for Decisions 0234 and 0235 (writer registry and shared token mapping, build-time writer validation, post layout furniture, index chip and feed attribution, Clara's style, Flynn's style held reserved) without pulling any cadence, reviewer, ping, retire or imitation behaviour into this batch
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-15
actions:
  - id: add-writer-registry-and-shared-token-mapping
    title: Add the writer registry (arcadia house writer active, clara and flynn reserved), the house stylesheet, the child-scoped `[data-writer]` token mapping and the `data-writer` hooks in the layouts, with no visible change to any existing post or the index.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Add the writer registry (arcadia house writer active, clara and flynn reserved), the house stylesheet, the child-scoped `[data-writer]` token mapping and the `data-writer` hooks in the layouts, with no visible change to any existing post or the index.
    expected_artifact: Evidence satisfying Agent Ask add-writer-registry-and-shared-token-mapping
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-12-20261114b
    why: "No authority-path edit (site/* and tests/* only). Writer identity needs one validated source and a safe CSS contract before any writer style or check can be built on it."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: rg 'data-writer|--w-|writer' site finds nothing; default.html loads only style.css and topics.css; the :root token block in site/assets/style.css defines --bg --fg --muted --link --brand --explore --focus --rule --glass --label --code --display --copy --mono; blog.yml has no dependency-install step, so the registry is read by Jekyll and by stage.mjs without any package; and state whether Iris's mapping on the same element as the slot definitions is a custom-property cycle (the expected answer is yes) so the mapping selector is a child combinator."
      - "A failing-first test in a new tests/site-writer-registry.test.ts (Linux-safe, reads files only, uses no Jekyll) shows: site/_data/writers.json parses and holds exactly the slugs arcadia (status active), clara and flynn (status reserved); each entry has name, role, tagline, voice, status, an emoji map (marker to word), suggestion_label, and a css path only when that file exists under site/assets/writers/; every css path named exists; arcadia.css assigns each --w-fg, --w-muted, --w-accent, --w-edge, --w-tint, --w-rule, --w-code, --w-display, --w-copy to its matching site token with no colour or font literal; style.css contains the mapping block with every selector a child combinator of [data-writer] (never a bare `[data-writer]` or `[data-writer=\"x\"]` on the carrier); and default.html, post.html and index.html each carry data-writer defaulting to arcadia through `{{ page.writer | default: 'arcadia' }}` or `{{ post.writer | default: 'arcadia' }}`. It fails before the files exist."
      - "Hooks: post.html puts data-writer on `<article class=\"post-body\">`; index.html puts it on each `<li>`; default.html links each registry entry's css through a loop over site.data.writers and bumps the `?v=` token on style.css; the mapping block is appended to style.css (nothing existing is restyled) so every unwritered post and the index resolve to today's values."
      - "Registries and tests this change touches, all enumerated: no test, script or config lists site/ files (verified); eslint does not cover site/; scripts/large-files-allowlist.json needs no entry (every new file is far under 1 MiB, additions total a few KB against the 54.99 of 62 MiB tracked cap, no binary asset); _config.yml needs no change for _data or assets/writers; START_HERE.md needs no edit (no operator command or step changes); topics.html and tags pages stay untouched and carry no writer byline; blog.yml needs no change (path filter already includes site/**)."
      - A local Jekyll build is not available on this host; the Session says so, records the Blog workflow PR build (Linux) as the only Jekyll render and, if a Jekyll toolchain is available to the builder, checks the existing posts and index differ from before only by the added attribute and stylesheet link; otherwise states that visual equivalence is argued from the token-identical arcadia.css, not rendered.
      - pnpm vitest run tests/site-writer-registry.test.ts --testTimeout 150000 and node scripts/check-large-files.mjs pass, and only site/_data/writers.json (new), site/assets/writers/arcadia.css (new), site/assets/style.css, site/_layouts/default.html, site/_layouts/post.html, site/index.html and tests/site-writer-registry.test.ts (new) change; the Session records that no authority-path file changed (stop and report if one must).
    depends_on: []
    decisions: []
    references: ["site/_layouts/default.html", "site/_layouts/post.html", "site/index.html", "site/assets/style.css", "site/_config.yml", ".github/workflows/blog.yml", "docs/decisions/0234-amend-decision-0120-may-the-field-notes-writers-flynn-the-chronicler-and-clara.md"]
  - id: validate-writers-in-the-site-build
    title: "Add `site/writer-check.mjs` and extend `site/stage.mjs` so a `writer:` post is validated fail-closed (allowlist, reserved rejection, author name, one-sentence operator suggestion, evidence limits, own-emoji only) and every writer stylesheet is checked for closed-palette tokens and WCAG contrast in both schemes."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Add `site/writer-check.mjs` and extend `site/stage.mjs` so a `writer:` post is validated fail-closed (allowlist, reserved rejection, author name, one-sentence operator suggestion, evidence limits, own-emoji only) and every writer stylesheet is checked for closed-palette tokens and WCAG contrast in both schemes."
    expected_artifact: Evidence satisfying Agent Ask validate-writers-in-the-site-build
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-12-20261114b
    why: "No authority-path edit (site/* and tests/* only). A stricter build can refuse more posts but cannot publish more, and it is the only enforcement point the identity system has."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: stage.mjs reads no writer, operator_suggestion or author value (rg 'writer|operator_suggestion' site/stage.mjs finds nothing), keeps the whole front matter, and imports only node: built-ins; publicationRefusal and the tags check run before any new check; _config.yml exclude lists only README.md and stage.mjs."
      - "Failing-first tests in a new tests/site-writer-stage.test.ts copy site/ into a temp directory with fixture docs/articles and receipts beside it (stage.mjs resolves its repo root from its own location, so the test never touches the real articles) and run `process.execPath <tmp>/site/stage.mjs <out>`; they show: a post without `writer` stages exactly as before; `writer: clara` is rejected while clara is reserved, unknown slugs fail, and `writer: flynn` fails while reserved, each with an error in the existing 'add one tags line' style; the author string must contain the writer's display name case-insensitively; `operator_suggestion` is required on a writer post and must be one sentence of at most 240 characters on one line; a writer body with more than three inline links or a fenced code block over 5 lines fails; only the writer's own registry emoji may appear in the body; every Decision 0120 gate (status, type, channels, not_done, receipt PASS) still skips a writer post first and a gated-out writer post never reaches the writer checks. They fail before the checks exist."
      - "A second group in the same file runs `node site/writer-check.mjs --json <site dir>` against fixture site directories and shows: a hex, rgb(), hsl() or named colour, an @font-face or @import, a font family outside --display --copy --mono, and a var() outside the allowlist each fail in a writer file; a system-colour keyword is allowed only inside `@media (forced-colors: active)`; the site token values are read from style.css :root (light-dark pairs), with WCAG contrast computed per slot pair (ink 7, muted 4.5, accent text 4.5 and on the tint 4.5, edge and rule 3 non-text) in light and dark against --bg and the worst-case glass surface (glass over black for light, over white for dark), failing below threshold; a fixture that lowers a token below a threshold fails; overlapping emoji across writers (every emoji anywhere in a registry entry) and a duplicate (--w-accent, --w-edge) pair among writers with a stylesheet fail; the module is runnable as a script and exports its checks, imports only node: built-ins, and stage.mjs calls it for every registry entry whose css file exists."
      - "This Action implements none of the Decision 0235 behaviours reserved for batch 13: no cadence counting or digest type, no `- Reviewer:` independence check, no daily roll-up ping, no retire-skip behaviour (a reserved writer simply fails the build as the pre-launch slot guard, and Decision 0235's skip-instead-of-fail for a retired writer is batch 13) no RSS 2.0 output and no voice-imitation check; the Session reports any temptation to add them as a finding for batch 13."
      - "Registries and tests this change touches, all enumerated: site/_config.yml gains `writer-check.mjs` in `exclude` so it is not published as a static file (and a staged-output assertion in the test shows /writer-check.mjs is excluded by name in _config.yml); no existing test enumerates site/ or stage.mjs (verified); the only first-party test pattern for a plain .mjs is tests/largeFileGuard.test.ts with a `@ts-expect-error` import, so this Action uses child-process runs instead and adds no new lint exemption; eslint and tsconfig do not cover site/ or the new module; no large-files allowlist entry; no START_HERE.md edit; blog.yml needs no change because it already runs `node site/stage.mjs` on every PR touching site/** on Linux."
      - pnpm vitest run tests/site-writer-stage.test.ts tests/site-writer-registry.test.ts --testTimeout 150000 passes, and only site/writer-check.mjs (new), site/stage.mjs, site/_config.yml and tests/site-writer-stage.test.ts (new) change; the Session records that no authority-path file changed.
    depends_on: [add-writer-registry-and-shared-token-mapping]
    decisions: []
    references: ["site/stage.mjs", "site/_data/writers.json", "site/assets/style.css", "site/_config.yml", ".github/workflows/blog.yml", "docs/decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md"]
  - id: render-writer-byline-receipt-and-suggestion
    title: Render the writer byline, the Receipt link, the closing operator suggestion and the drafted-by line in post.html (made hash-safe for author first), with their appended style rules, for writer posts only.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Render the writer byline, the Receipt link, the closing operator suggestion and the drafted-by line in post.html (made hash-safe for author first), with their appended style rules, for writer posts only.
    expected_artifact: Evidence satisfying Agent Ask render-writer-byline-receipt-and-suggestion
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-12-20261114b
    why: "No authority-path edit (site/* and tests/* only). This is the layout furniture half of the identity system, and it comes first because it makes post.html safe for a hash `author` before stage.mjs writes one in the next Action."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: post.html line 8 prints `{{ page.author | escape }}`, so a hash author would render as a raw hash and the layout must print `page.author.name` when the author is a hash and the string otherwise; claims_receipt reaches page front matter unchanged because stage.mjs keeps the whole front matter; the registry from the first Action carries each writer's emoji map and suggestion_label; and state that the Receipt link must use the registry's own receipt marker (found by the word Receipt in the writer's emoji map: Clara's 🧾) or plain text, never another writer's emoji, because Flynn's v4 spec names the layout's 🧾 as furniture although 🧾 is in Clara's set."
      - "Failing-first additions to tests/site-writer-registry.test.ts (static reads, Linux-safe, no Jekyll) show post.html: prints the author hash-safely (a `.name` branch plus the string branch); renders a byline from the registry (name and role as real text, glyph aria-hidden); builds the Receipt link from `page.claims_receipt` to the blob URL on main in the repository the footer already names, with the marker looked up from the writer's emoji map and no marker when the map has no Receipt word; renders the closing block from `page.operator_suggestion` labelled by the registry's suggestion_label with its marker found by that word; prints a drafted_by small-print line only when `page.drafted_by` is set; and renders none of the byline, Receipt, suggestion or drafted_by furniture when `page.writer` is absent, so every existing post renders as today. They fail before the edit."
      - style.css gets appended rules only (leading edge, answer tint, label, receipt, suggestion and byline furniture, forced-colors and prefers-contrast overrides), written only with child-scoped selectors and the --w-* slots, no colour or font literals; the `?v=` token on style.css in default.html is bumped; the byline is real text and glyphs are aria-hidden, so identity is never carried by colour alone. Index rows, stage.mjs and the README are not touched here.
      - "Registries and tests this change touches, all enumerated: only tests/site-writer-registry.test.ts moves (no new test file); tests/site-writer-stage.test.ts is untouched because stage.mjs does not change in this Action; no other test, script or config enumerates site files (verified); no large-files allowlist entry; START_HERE.md needs no edit (no operator command or step changes); _config.yml needs no change; the Blog workflow PR build on Linux is the only Jekyll render and asserts nothing about content, which the Session states, along with whether a local render was possible (none on this host)."
      - pnpm vitest run tests/site-writer-registry.test.ts tests/site-writer-stage.test.ts --testTimeout 150000 passes, and only site/_layouts/post.html, site/_layouts/default.html (cache token only), site/assets/style.css and tests/site-writer-registry.test.ts change; the Session records that no authority-path file changed.
    depends_on: [add-writer-registry-and-shared-token-mapping, validate-writers-in-the-site-build]
    decisions: []
    references: ["site/_layouts/post.html", "site/_layouts/default.html", "site/assets/style.css", "site/_data/writers.json", "tests/site-writer-registry.test.ts"]
  - id: add-index-writer-chip-and-atom-author-hash
    title: "Show a text writer chip in each index row, have stage.mjs write the Atom-native `author` hash with the source string kept as `drafted_by`, and document `writer:` in the site README."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Show a text writer chip in each index row, have stage.mjs write the Atom-native `author` hash with the source string kept as `drafted_by`, and document `writer:` in the site README."
    expected_artifact: Evidence satisfying Agent Ask add-index-writer-chip-and-atom-author-hash
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-12-20261114b
    why: "No authority-path edit (site/* and tests/* only). Identity must read in words in the index and travel to the combined feed; post.html already prints a hash author safely from the previous Action, so stage can now write one."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: stage.mjs leaves front matter untouched apart from tags and title and has no author handling; post.html already contains the hash-safe author expression from the previous Action (rg '.name' site/_layouts/post.html), so a hash author cannot print raw; index.html shows kicker, title, summary and topics per row with data-writer from the first Action and no writer chip."
      - "Failing-first additions to tests/site-writer-stage.test.ts show: a staged writer post front matter carries `author` as a hash with `name` (the registry display name) and a `uri` fragment, and `drafted_by` holds the original source string; a post without `writer` keeps its string author unchanged and gets no drafted_by; the hash is produced only after every earlier check (Decision 0120 gates, writer checks) passes. Failing-first additions to tests/site-writer-registry.test.ts show index.html renders a text writer chip in the kicker from the registry for writer posts, leaves the row order, date and summary slots unchanged, and renders no chip for a post without writer."
      - "style.css gets appended rules only for the chip (child-scoped, --w-* slots, no literals, forced-colors safe, glyph aria-hidden, name always real text) and the `?v=` token is bumped again. Feed attribution is Atom-native and uses no new feed: the combined /feed.xml stays the only feed (Decision 0235 counts Atom as the RSS feed). Whether jekyll-feed on the pinned jekyll-build-pages image emits the hash author as `<author><name>` is inferred, not verified; if the builder can render locally the Session records the feed item, otherwise it states that author attribution in feed readers is unproven. Titles and summaries are never prefixed with the writer name."
      - "site/README.md documents `writer:`, the registry, the token contract and the check in the 'How posts are published' section, and states plainly that cadence enforcement and the digest type, the reviewer-independence gate, the daily roll-up ping, retire-skip behaviour and the voice-imitation check are not built and belong to batch 13 under Decisions 0234 and 0235; it restates no Decision 0120 or 0165 wording as changed."
      - "Registries and tests this change touches, all enumerated: tests/site-writer-stage.test.ts and tests/site-writer-registry.test.ts (both from earlier Actions) are the only tests that move; the first-party fixture pattern is unchanged (child-process stage run in a temp copy of site/); no other test enumerates site files (verified); _config.yml needs no change (writer-check.mjs is already excluded by the second Action); no large-files allowlist entry; START_HERE.md needs no edit (its Field Notes lines 256 to 261 describe production, not the site layout); topics.html is not touched."
      - pnpm vitest run tests/site-writer-stage.test.ts tests/site-writer-registry.test.ts --testTimeout 150000 passes, and only site/stage.mjs, site/index.html, site/assets/style.css, site/_layouts/default.html (cache token only), site/README.md, tests/site-writer-stage.test.ts and tests/site-writer-registry.test.ts change; the Session records that no authority-path file changed.
    depends_on: [render-writer-byline-receipt-and-suggestion]
    decisions: []
    references: ["site/stage.mjs", "site/index.html", "site/assets/style.css", "site/README.md", "site/_data/writers.json", "tests/site-writer-stage.test.ts"]
  - id: add-claras-writer-style
    title: "Add `site/assets/writers/clara.css` and activate Clara in the registry with her closed emoji set, so a `writer: clara` post that already passes Decision 0120 renders in her identity and the contrast check proves it in both schemes."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Add `site/assets/writers/clara.css` and activate Clara in the registry with her closed emoji set, so a `writer: clara` post that already passes Decision 0120 renders in her identity and the contrast check proves it in both schemes."
    expected_artifact: Evidence satisfying Agent Ask add-claras-writer-style
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-12-20261114b
    why: "No authority-path edit (site/* and tests/* only). Clara is the first active writer; the check from the earlier Action must pass on her real stylesheet before anything publishes in it."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: clara is still `reserved` with no css path, so stage rejects `writer: clara`; Clara's table in the identity design assigns --fg, --muted, --link (accent text), --explore (edge), a 9 percent --explore mix into --bg (tint), --rule, --code and the three site families, measure 62ch; and the site token values in style.css :root still give the contrast numbers the design quotes."
      - "Failing-first tests in a new tests/site-writer-styles.test.ts show: clara.css contains only rules under [data-writer=\"clara\"], assigns each --w-* slot from the table with site tokens only and no literal; the registry entry is active with name, role Technical writer, tagline, voice, suggestion_label Try this, kicker `🔎 Clara · Ship note`/`Essay` style text and the closed six-emoji map 🔎 Checked, 📐 Proposed, ❓ Not proved, ✅ Done, 🧾 Receipt, 👉 Try this; `node site/writer-check.mjs --json` on the real site passes in light and dark and reports ink on bg 17.87 and 16.62, link on bg 8.81 and 12.26, edge 3.94 and 8.99 and rule 3.03 and 3.05 within 0.05 of the design's table; a fixture `writer: clara` post with all required fields stages and carries the hash author; the same fixture with a Flynn emoji in its body or without `operator_suggestion` fails. It fails before clara.css exists."
      - "The stylesheet stays small (target under 2 KB, no binary asset, no new font family and no change to the Google Fonts request), the leading edge uses the child-scoped mapping from the first Action, and the Session notes the two non-text pairs close to 3:1 are decorative dividers as the design says."
      - "No Clara post is authored or committed, no `status: approved` sample is added, and Clara's cadence stays as in Decision 0120; the Session states that Clara's sample post in the design notes remains a draft for a separate docs-only change that needs its own independent PASS receipt."
      - "Registries and tests this change touches, all enumerated: tests/site-writer-registry.test.ts changes only where the registry fixture asserts clara reserved (update to active and css present); tests/site-writer-stage.test.ts cases that use clara as the reserved-writer rejection switch to flynn (still reserved); no large-files allowlist entry; no START_HERE.md edit; no config change."
      - pnpm vitest run tests/site-writer-styles.test.ts tests/site-writer-stage.test.ts tests/site-writer-registry.test.ts --testTimeout 150000 passes, and only site/assets/writers/clara.css (new), site/_data/writers.json, tests/site-writer-styles.test.ts (new), tests/site-writer-stage.test.ts and tests/site-writer-registry.test.ts change; the Session records that no authority-path file changed.
    depends_on: [add-index-writer-chip-and-atom-author-hash]
    decisions: []
    references: ["site/_data/writers.json", "site/assets/writers/arcadia.css", "site/writer-check.mjs", "site/assets/style.css"]
  - id: add-flynns-writer-style-held-reserved
    title: "Add `site/assets/writers/flynn.css` from Flynn's v4 spec and complete Flynn's registry entry, proven by the same contrast and uniqueness checks, while the entry stays `reserved` so `writer: flynn` still fails the build."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Add `site/assets/writers/flynn.css` from Flynn's v4 spec and complete Flynn's registry entry, proven by the same contrast and uniqueness checks, while the entry stays `reserved` so `writer: flynn` still fails the build."
    expected_artifact: Evidence satisfying Agent Ask add-flynns-writer-style-held-reserved
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-12-20261114b
    why: "No authority-path edit (site/* and tests/* only). Flynn's four-a-day cadence is capped by Decision 0235's per-site ceiling and digest type, which batch 13 enforces, so the style is delivered and proven but not activated until that enforcement lands."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: the flynn registry entry is a bare reserved slot with no css; the v4 spec and draft flynn.css live outside the repository (a builder without that host path writes the stylesheet from the spec's slot table, which this criterion quotes: --w-fg --fg, --w-muted --muted, --w-accent --label, --w-edge --brand, --w-tint a 8 percent --brand mix into --bg, --w-rule --rule, --w-code --code, display and copy families, mono for labels, measure 62ch); and the draft's selectors `.row`, `.closing`, `.haiku` and `.section-label` match no layout class, so state which are rewritten to existing hooks (`li[data-writer=\"flynn\"]`, the suggestion block from the post layout Action) and which are dropped; keep a haiku or label rule only if the markdown output provably carries the class (inferred: kramdown inline attribute lists), otherwise drop it and list it as not done."
      - "Failing-first tests in tests/site-writer-styles.test.ts show: flynn.css has only rules under [data-writer=\"flynn\"], no literal except system-colour keywords inside the forced-colors block, no @font-face or @import; the registry entry holds name Flynn, role Chronicler, tagline, voice, glyph ∞, kicker `♾️ Flynn · Chronicle`, suggestion_label For operators, status reserved and the closed six-emoji map 🌀 Muse, 🍃 Haiku, 🎲 Joke, 🧵 Metaphor, 🔭 Could be, 🧭 For operators; every emoji anywhere in the Flynn entry (including ♾️ and ∞) is disjoint from Clara's; Flynn's (--w-accent, --w-edge) pair (--label, --brand) is distinct from Clara's (--link, --explore); `writer-check.mjs --json` passes both schemes with Flynn's contrast at or above the spec's measured values within 0.05 (accent on card 7.8 and 10.3, edge non-text 6.6 and 8.2); a fixture `writer: flynn` post is still rejected as reserved. It fails before the stylesheet exists."
      - "Sign-off: the spec's body sign-off `Flynn ♾️` is not allowed in a body because the body check allows only the writer's six emoji, so the byline renders the glyph and the sign-off is dropped from the Flynn template notes; the Session states this as the resolution and does not widen the emoji rule."
      - "Deferred and named in the PR description, not built here: flipping Flynn to `active`, the digest post type and the four-a-day cadence cap, a Flynn musings label as a machine type, the non-author fact-check independence gate, the daily roll-up publish ping, retire-skip behaviour and the voice-imitation check (RSS 2.0 is not planned because Decision 0235 counts Atom as RSS); each has its answer in Decisions 0234 and 0235 and belongs to batch 13, which must read them from those Decisions rather than hard-code them."
      - "Registries and tests this change touches, all enumerated: tests/site-writer-styles.test.ts is extended; tests/site-writer-stage.test.ts keeps flynn as the reserved rejection case; tests/site-writer-registry.test.ts asserts every registry css path exists; no large-files allowlist entry (stylesheet under 2 KB); no START_HERE.md edit; no config change."
      - pnpm vitest run tests/site-writer-styles.test.ts tests/site-writer-stage.test.ts tests/site-writer-registry.test.ts --testTimeout 150000 passes, and only site/assets/writers/flynn.css (new), site/_data/writers.json, tests/site-writer-styles.test.ts, tests/site-writer-stage.test.ts and tests/site-writer-registry.test.ts change; the Session records that no authority-path file changed.
    depends_on: [add-claras-writer-style]
    decisions: []
    references: ["site/_data/writers.json", "site/writer-check.mjs", "site/assets/writers/clara.css"]
questions: []
decisions: []
---

# Draft an inactive batch 12 Plan of six bounded Actions that build the Field Notes writer identity system for Decisions 0234 and 0235 (writer registry and shared token mapping, build-time writer validation, post layout furniture, index chip and feed attribution, Clara's style, Flynn's style held reserved) without pulling any cadence, reviewer, ping, retire or imitation behaviour into this batch

Created as an inactive draft from accepted Agent Ask ellis-batch-12-20261114b; creation changed no pointer. Current activation is recorded in frontmatter.
