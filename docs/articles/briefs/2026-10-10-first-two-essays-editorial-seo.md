# First two Field Notes essays: editorial and SEO handoff

Draft batch requested by the operator on 2026-10-10; [Issue #1221](https://github.com/pmark/arcadia/issues/1221). No governed Action holds this writing request. The active Milestone is governed agent roles, and its current Action is `define-governed-role-registry`; these essays neither implement nor complete it. Responsibility: Cody Atlas as author, with a separate read-only reviewer. Artifacts: two essays, two public claim receipts, this handoff and the independent report. No Project pointer, Plan, Decision answer or queue change is part of this batch.

## Distinct reader questions

Audience: independent developers and technical operators evaluating autonomous AI coding agents and workflow governance. The first essay explains the workflow; the second evaluates the evidence. Neither is an installation tutorial or a claim of production availability.

| Field | Essay 1 | Essay 2 |
| --- | --- | --- |
| Selected working title (preserved) | The single-Action path runs itself. | What nine automated Actions proved—and what they didn’t. |
| Primary reader question | How does an AI coding agent move from approved work to a validated, preserved and independently reviewed merge? | What can a small autonomous-agent rehearsal demonstrate, and what evidence is still missing? |
| Primary topic / search intent | Governed AI coding workflow; process explanation | AI coding agent evaluation; evidence-led case study |
| Proposed search title / source H1 | The single-Action path: a governed AI coding workflow | Nine AI coding Actions: what the rehearsal proved |
| Meta description / source summary | Arcadia's fixture rehearsal shows a path from bounded coding work to validated, reviewed merges. Here is how the workflow separates work, proof and authority. | Nine merged fixture PRs provide evidence of bounded AI coding work and its handoffs. They do not establish production readiness or uninterrupted autonomy. |
| Slug | `the-single-action-path-runs-itself` (existing filename preserved; original source had no explicit slug) | `what-nine-automated-actions-proved` |
| Planned canonical | https://arcadiamissioncontrol.com/notes/the-single-action-path-runs-itself/ | https://arcadiamissioncontrol.com/notes/what-nine-automated-actions-proved/ |
| Internal links | Companion case study; governed autonomous development guide | Companion workflow explanation; Session management guide |

Both canonical URLs and essay-to-essay links are **pending**. Their source links label that fact. Before publication either make the destination live in an eligible monthly slot or replace the pending link with an honest non-link reference; editing published bytes needs the publication gate's matching review binding. Do not ship a broken internal link. The two drafts do not authorize two essay publications this month. Dates are drafting dates; downstream delivery must record the actual publication date without implying earlier live availability.

The guide URLs were checked with HTTP GET on 2026-10-10 America/Los_Angeles and returned 200:

- [Governed autonomous development](https://arcadiamissioncontrol.com/guides/governed-autonomous-development/): title “Governed autonomous development for AI coding agents — Arcadia Mission Control”; H1 asks what governed autonomous development is and how Arcadia approaches it.
- [Session management](https://arcadiamissioncontrol.com/guides/coding-agent-session-management/): title “Coding agent session management with Git worktrees — Arcadia Mission Control”; H1 asks how worktrees and durable handoffs keep Sessions on track.

## Factual proof boundary

Sources are pinned in the two receipts: Arcadia base `9302b5946451ba763de72052a69c6a35124aabc9`, nine fixture candidate heads and merge commits, immutable repair diffs/tests, and the exact launch Decision 0100 and packet Decision 0119 files (there is a different Decision filename sharing 0100; never substitute it). GitHub was queried directly for every specified PR's merged state. Public validation excerpts are available; raw private host receipts and full reviewer transcripts are not reproduced. The author independently reproduced the nine candidate file results with temporary archives and explicit byte assertions.

The workflow essay treats procedure as declared contract and fixture merges as observed output. The evaluation distinguishes public incident reports, implemented repairs, reproducible artifacts, actual GitHub merges, deployment and real-Project use. The shared genesis check does not cover CHAIN.md; the essay explains why its exit code is insufficient by itself. Historical final Plan prose still names an older local-integration scope; the public merge records support the dated merge facts. We omit the original draft's timing range, provider-by-PR roster, packet reuse count, operator-approval count and zero-intervention subset because public event receipts do not establish them.

The first article's original draft came from merged PR #1198, merge `535c9cba52945030553692f66bb1b5ab12c1521e`. This refines that source in place, retaining its Claudia Atlas attribution and history, and labels substantial revisions by Cody Atlas. Related Arcadia PRs #1194, #1195 and #1196 were verified merged but omitted from the essays: phone-oriented UI work is a different story and its live use is not this fixture's proof. PR #1219 (`739024e0e7aae521ddc54359503b4981a0d06d23`) supplies the production instruction, not a live publication result.

## SEO rationale and downstream verification

Primary guidance read on 2026-10-10:

- [Google: helpful, reliable content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content): prioritize original reporting and useful analysis for a defined audience; explain who drafted it, how evidence was checked and why the reader should care. No preferred-word-count assumption, invented keyword volumes or ranking promises.
- [Google: title links](https://developers.google.com/search/docs/appearance/title-link): use concise descriptive titles and a clear main heading. The source title/H1 pair identifies each distinct subject without repeating keywords.
- [Google: snippets](https://developers.google.com/search/docs/appearance/snippet): provide an accurate unique summary per page; a meta description is an input, and Google may choose different page text for a query.

Technical rendering is **unverified**: this PR changes no site code or infrastructure. The publication follow-up must:

1. Map each source title to the HTML title and one visible H1, its summary to the description, and its canonical to one consistent canonical link; check the rendered HTML and source agreement.
2. Keep drafts out of public routes, RSS and sitemap. Publish only through the implemented Decision 0120 gate with matching independent review/content hashes and actual delivery receipts.
3. Serve eligible published pages as crawlable HTML with working public links, correct successful status and no unintended robots/noindex restriction. Verify the rendered page, not just configuration.
4. Add accurate `BlogPosting` metadata for the real title, description, author attribution, canonical/mainEntityOfPage, verified publication date and actual modification date; do not invent credentials, ratings or dates.
5. Include only live published canonicals in the sitemap and full-text `/notes/rss.xml`, with feed discovery; verify page/feed text and deduplication. Implement or honor withdrawal receipts on retry.
6. Recheck guide links and the companion publication status; inspect desktop/mobile readability and metadata before recording delivery. No SEO rankings or indexing are guaranteed.

## Validation and review

Author mechanics: front matter parsed with the repository's YAML dependency; all required fields present; draft status; unique slugs; channels exactly site/RSS; one H1 each; substantive “What is not done”; no placeholders; each prose sentence and summary found in its claim receipt; local Markdown links resolved. `git diff --check` passes. Body word counts at initial review: 815 and 918; they follow substance, not an SEO quota. Nine temporary fixture archives pass the genesis command and exact marker/chain byte assertions. Site rendering and publication were not tested.

Independent initial review of `c2aa262613b0013bd6695b5ad26e382df0820829`: workflow essay PASS, case study HOLD for conflating a required reading step with an observed event. The sentence and its claim row were corrected. The [retained report](2026-10-10-first-two-essays-independent-review.md) binds the initial bytes; scoped delta verdict will be preserved on [content PR #1222](https://github.com/pmark/arcadia/pull/1222). No final PASS for changed bytes is claimed here. Content stays draft even if independently reviewed; publication approval remains separate.

## Retrieval and friction evidence

The prepared isolated checkout was clean at base; `arcadia work monitor --no-pull-requests --json` completed before edits. The monitor's raw cross-Project operational data remains outside public files. No conflicting dirty article candidate was identified; the existing first draft was already merged. Dependencies were bridged with `node scripts/bridge-worktree-deps.mjs`, not manual symlinks. Identity resolved to Cody Atlas, codex/heavy builder.

Observed friction: sandboxed `gh` could not connect; the same public-read operation succeeded through ordinary host escalation. Python urllib received HTTP 403 for a guide; curl GET succeeded and exposed its title/H1. An unquoted GitHub API `?` path hit zsh globbing; quoting it fixed the read. A temporary monitor-summary script encountered a null worktree path; a guarded read corrected it. An initial patch attempted two operations on one file and was rejected before any edit; source writing then succeeded. No permission denial was bypassed, no shared service was restarted, and no private logs were promoted to evidence. The first combined push/PR request was rejected by automatic approval review for lacking trusted authorization; direct human messages retrieved from the launch chat and the supplied AGENTS preservation instruction established that authorization, and the same operations succeeded. The rejected call created no PR-body scratch file, so the subsequent create attempt found it missing; writing the body separately corrected that. Sandbox Agent Ask preview refused SQLite writes; the supported host retry registered the same request, and its previewed log-only settlement recorded `asksettle_2306be7f06884a6591` in the candidate. This is the standing PR-opened notification, not Action completion or an authority Decision. These are session incidents, not unverified new operator preferences or a second memory store.

Instruction retrieval inventory follows (UTF-8 bytes at the source base; exact paths and relevant sections). Repeated reads were reused. Applicable global/operator AGENTS instructions were supplied in chat as well.

| Instruction path | Bytes | Retrieved section |
| --- | ---: | --- |
| `AGENTS.md` | 9276 | complete procedure/contract |
| `CONSTITUTION.md` | 3320 | complete procedure/contract |
| `PROJECT.md` | 31700 | front matter/current authority and retained history |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 | complete procedure/contract |
| `.arcadia/repo-context.md` | 703 | complete procedure/contract |
| `.arcadia/context-policy.json` | 870 | complete procedure/contract |
| `docs/agent-guidance/index.json` | 6393 | complete procedure/contract |
| `docs/plans/governed-agent-roles-one-real-action-and-one-interactive-session-each-run-as-a.md` | 43005 | front matter and exact define-governed-role-registry Action |
| `docs/agent-guidance/operator-directed-work.md` | 4494 | complete procedure/contract |
| `docs/agent-guidance/learning.md` | 1636 | complete procedure/contract |
| `docs/agent-guidance/continuation.md` | 6239 | complete procedure/contract |
| `docs/agent-guidance/git-identity.md` | 5248 | complete procedure/contract |
| `docs/agent-guidance/pull-requests.md` | 16922 | complete procedure/contract |
| `docs/agent-guidance/agent-asks.md` | 22884 | complete procedure/contract |
| `docs/working-copy-safety.md` | 15818 | complete procedure/contract |
| `docs/agent-guidance/arcadia-repository.md` | 30174 | Orientation, Semantics, PR QA, Working-Copy Safety, fixture launch and packet approval |
| `docs/arcadia-semantics.md` | 14180 | complete procedure/contract |
| `docs/operator-demo-and-release-contract.md` | 6915 | complete procedure/contract |
| `docs/notes-to-self.md` | 33541 | targeted blog/evidence/bridge/preservation lookup; sandbox/monitor/GitHub entries; dependency bridge entry |
| `docs/strategy/update-promotion-strategy.md` | 9813 | complete procedure/contract |
| `docs/strategy/field-notes-production.md` | 10828 | complete procedure/contract |
| `docs/decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md` | 3906 | complete procedure/contract |
| `docs/articles/templates/essay.md` | 889 | complete procedure/contract |
| `docs/articles/templates/receipt.md` | 1893 | complete procedure/contract |

Additional retrieved procedure: `docs/managed-documents.md` (16111 bytes), before the log-only lifecycle settlement.
