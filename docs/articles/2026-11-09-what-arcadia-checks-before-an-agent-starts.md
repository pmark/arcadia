---
title: "What Arcadia checks before an agent starts"
date: "2026-11-09"
type: ship
slug: "what-arcadia-checks-before-an-agent-starts"
summary: "A GitHub guide prompted Arcadia to compare two runs and add a check that catches confusing instructions before an agent starts."
author: "Arcadia (drafted by Clara / Claudia Mason)"
status: approved
claims_receipt: "docs/articles/receipts/what-arcadia-checks-before-an-agent-starts.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/what-arcadia-checks-before-an-agent-starts/"
channels: [site, rss]
---

# What Arcadia checks before an agent starts

In [*Beyond code generation: A developer’s guide to agentic engineering*](https://github.blog/ai-and-ml/github-copilot/beyond-code-generation-a-developers-guide-to-agentic-engineering/), GitHub describes agentic engineering as planning, building, verifying, and observing. We used that framing to ask where two of Arcadia's own test-only runs lost time. [METR's developer productivity research](https://metr.org/blog/2026-02-24-uplift-update/) offers a reason to ask locally. Who’s in a study and which tasks they submit can change what the numbers tell you.

In the [clean run](https://github.com/pmark/arcadia/blob/1dcc6295be6037056d548f551b33fec81ad4ea50/docs/managed-production-readiness.md#L18-L66), review and QA took longer than building. A [longer run](https://github.com/pmark/arcadia/blob/1dcc6295be6037056d548f551b33fec81ad4ea50/docs/reports/relay-record-run-night-2026-11-07.md#L28-L81) exposed a different problem. An instruction named a test file as an example. Arcadia treated it as a required file and [kept retrying](https://github.com/pmark/arcadia/issues/2272).

[The resulting change](https://github.com/pmark/arcadia/pull/2287) moves that check earlier. Before Arcadia prepares a card to start a run, it flags an ambiguous filename for clarification and stops if it finds certain invisible characters. It uses the existing test-file parser and makes no AI calls. [Offline tests](https://github.com/pmark/arcadia/pull/2287#issuecomment-6724398417) and [GitHub CI](https://github.com/pmark/arcadia/actions/runs/42503213179) passed.

For Field Notes, we’ll keep testing outside advice against our own delivery evidence.

## What is not done

We still can’t tell whether the check reduces retries. In four test-only batches after the merge, Arcadia delivered 15 Actions across 18 build sessions. One Action took four sessions after a later QA step mistook quoted test inputs for files ([#2324](https://github.com/pmark/arcadia/issues/2324), fixed in [#2325](https://github.com/pmark/arcadia/pull/2325)). Replaying the four cards’ pinned criteria produced no warnings or refusals. The saved records omit the check’s live output, so we couldn’t verify a catch. See the [follow-up source notes](https://github.com/pmark/arcadia/blob/main/docs/articles/receipts/what-arcadia-checks-before-an-agent-starts.md#follow-up-run-evidence).
