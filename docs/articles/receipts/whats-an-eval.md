# Field Notes evidence: whats-an-eval

- Type: operator-requested beginner explainer draft; not a claim of Field Notes publication eligibility.
- Article: [2026-11-09-whats-an-eval.md](../2026-11-09-whats-an-eval.md)
- Source repository and pinned revision: `pmark/arcadia@88045ef9712fa0341bdc5be2df45eee2334e8eaa`.
- Evidence observed: November 9, 2026, America/Los_Angeles.
- Decision: [0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md); [0165](../../decisions/0165-may-decision-0120-s-automatic-field-notes-publication-use-the-arcadia-field.md) adds the GitHub Pages blog as a destination while retaining Decision 0120's conditions.
- Source status: `status: draft`. The `evals` tag is carried in the article front matter; `site/stage.mjs` copies front matter to staged posts, while the current `site/_layouts/post.html` displays date, author and a draft badge and does not display tags.

## Claims

| ID | Exact factual sentence, summary or number | Pinned public evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | An eval is a repeatable way to check whether a system does something you care about. | [Arcadia's QA plan consistency replay guide](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/qa-plan-consistency-replay.md) | The guide documents a repeatable offline comparison for one specific QA-plan consistency check. The definition and generalization in the article are explanatory framing, not a claim that Arcadia already has a general eval system. |
| C2 | The webhook example is a hypothetical lesson-search case. | [Current lesson search implementation](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/src/learning/lessons.ts#L204-L230) | The pinned source shows the current lesson search entry point; it does not establish this hypothetical as a captured or observed failure. |
| C3 | Arcadia has scoped lesson search. | [Current lesson search implementation](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/src/learning/lessons.ts#L204-L230) | The code accepts a query and optional scope. This does not demonstrate ranking quality or retrieval success. |
| C4 | Arcadia has an offline replay for checking whether a QA plan matches a pull request. | [QA plan consistency replay guide](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/qa-plan-consistency-replay.md) and [implementation](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/scripts/qa-plan-consistency.ts) | These sources document an existing replay and implementation. Their existence is not a result from either proposed eval pilot. |
| C5 | Neither proposed pilot has run, and there are no results. The proposed first pilot is offline QA-plan consistency, with ranked lesson retrieval later when priority allows. | Planning intent supplied for this draft; no public result or completed pilot is asserted. | Prospective plan only. The note does not claim the pilots are implemented, scheduled, or complete. |

## Mechanical checks

- Front matter includes title, date, `essay` type, slug, summary, author, draft status, receipt path, `not_done: true`, intended GitHub Pages canonical, and exactly `channels: [site, rss]`.
- The draft carries `evals` in its front matter. The current post layout does not render tags.
- The article has a substantive `## What is not done` section and no publication or result claim.
- Public evidence links are pinned to the candidate base revision. The webhook scenario is identified as hypothetical.

## Independent review

- Reviewer: pending; no independent fact-check has been performed.
- Reviewed article and receipt revision: pending.
- Source revision: `88045ef9712fa0341bdc5be2df45eee2334e8eaa`.
- Verdict: HOLD pending independent fact-check.
- Findings and resolution: none recorded; author self-review is not independent evidence.

## Delivery handoff

- Draft only; no publication, deployment, page verification, RSS verification, notification or unpublish action has occurred.
- Intended canonical URL: https://pmark.github.io/arcadia/posts/whats-an-eval/ . It is metadata, not proof of a live page.
