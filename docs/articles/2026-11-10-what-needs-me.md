---
title: "Nothing is waiting on you—unless the read is incomplete"
date: "2026-11-10"
type: essay
slug: "what-needs-me"
summary: "A synthetic partial-read test put an all-clear beside a warning. Here is why useful agents need to say complete, partial, or unknown—and show their evidence."
author: "Arcadia (drafted by Clara / Cody Swift)"
status: draft
claims_receipt: "docs/articles/receipts/what-needs-me.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/what-needs-me/"
channels: [site, rss]
tags: [agent-workflows, evals]
---

# Nothing is waiting on you—unless the read is incomplete

“Nothing is waiting on you.” It sounds reassuring—until the same screen says a source could not be read.

That contradiction showed up in a small offline experiment. Given a synthetic empty list with one failed source, Arcadia’s checked-in To-do view displayed both the source warning and the all-clear. A separate, hand-written mock showed “Current status unknown” and “Retry the read.” The mock was clearer in this case. It is not a shipped Arcadia feature. Across all eight cases, the current first view met the basic disposition check in five, but the stricter check with visible source and freshness evidence in none.

The useful distinction is simple: **complete**, **partial**, or **unknown**. An empty result is reassuring only when the read that produced it is complete. If a source is missing, the agent should say what it could not check, keep the answer open, and offer a safe next step. A confident summary cannot make missing data complete.

## Show the trail behind the answer

We compared the current dashboard component with a read-only mock using the same eight frozen, fabricated cases. The cases included ordinary pending items and settled work, but also a partial empty read, a failed refresh with an older blocking item still on screen, and a request scoped to one project while the data included another.

On the initial view, the current component reached the expected basic disposition and safe next step in five of eight cases. It met the stricter check—which also required visible source and freshness evidence—in zero. Opening item details raised that stricter score to three of eight. The mock met both checks in all eight cases. These are small, designed examples, not a benchmark or a measure of real-world performance; the receipt describes the grading rule and each result.

That points to two practical habits for agent builders. Carry completeness and freshness alongside the answer. Make the evidence easy to inspect where a person decides. In this comparison, details sometimes contained useful evidence, but a person had to open them. The failed-refresh case still showed an old approval control. We did not click it or test server-side enforcement, so this experiment says nothing about what an action endpoint would allow.

Google Cloud’s [2026 agent trends report](https://cloud.google.com/resources/content/ai-agent-trends-2026) offers a helpful hypothetical: a delivery agent notices a failed delivery, checks operational information, proposes a new slot, and explains the situation to the customer, with a human handoff for a more complex case. The important pattern is the trail between signal and response: what was checked, what remains uncertain, and what the person can do next. The report describes a scenario, not proof that every agent can do this reliably.

Arcadia’s [Relay first-slice proposal](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/docs/proposals/relay.md#L104-L133) sketches grounded replies with freshness; the [operations proposal](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/docs/relay-driven-operations.md#L156-L193) sketches signal triage linked to evidence and verified fixes. Both are proposals. An answer should name its scope and check the current verified Decision that applies to that scope. For a delegated task, it should point to the verified Artifact—or honestly say it is still waiting.

The stakes are practical. During Arcadia’s November 9 run, 20 worker merges landed across five serial, test-only batches. The day record read the last batch as failed because its completion signal was missing. Separately, it records that approval had to be retyped at a coordinator handoff. [PR #2365](https://github.com/pmark/arcadia/pull/2365) later merged a scope-complete fix. This essay did not verify that fix installed or live. The [run record](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/docs/managed-production-readiness.md#L5-L15) captures why evidence must distinguish “the work landed” from “the completion was verified.”

So when an agent says “nothing needs you,” ask: **What did it check, how fresh was that read, and what could it not see?** If one source goes silent, “unknown; retrying” is often the most useful answer.

## What is not done

This was an offline, first-render comparison using fabricated fixtures and a hand-authored mock. It had no participants, live system, browser session, model call, routing test, or approval-endpoint test. The mock is not deployed functionality, and its eight-for-eight result is not a product benchmark. PR #2365 merged a source fix, but this work did not verify installed or live behavior. The proposals above have not been implemented as part of this experiment.
