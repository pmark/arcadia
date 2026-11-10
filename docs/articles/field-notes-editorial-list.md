# Field Notes editorial list

## Field Notes shortlist

Editorial pass on November 9, 2026. Aim for one concrete problem, one piece of evidence, and one technique a developer can reuse. The shortlist is the operator's one-time November 9 release batch. [Release PR #2393](https://github.com/pmark/arcadia/pull/2393) records the fact-check and public delivery.

| Order | Existing draft | Why it belongs |
| --- | --- | --- |
| 1 | [Replaying an agent run without rerunning the agent](2026-10-21-making-every-run-teach-us-more.md) | Lead with the changed-repair regression. A scripted bad verdict can exercise the real worker's control flow without another live agent run. |
| 2 | [Where unattended coding runs spend their time](2026-10-12-why-autonomous-production-is-not-a-coding-speed-problem.md) | Use the measured November runs to show which waits and retries a faster model would leave behind. Keep the serial, test-only limits visible. |
| 3 | [Give agents a way to suggest work without starting it](2026-10-23-how-an-idea-becomes-governed-work.md) | Explain the preview receipt and separate activation with one example from the completed November Plan. |
| 4 | [Who writes the change, and who checks it?](2026-10-12-why-agent-roles-make-collaborative-work-easier.md) | Use the CSV export example to show how an independent code review and a product acceptance check answer different questions. |

## Earlier ship notes

These two historical ship notes were already live when the [Atom feed](https://pmark.github.io/arcadia/feed.xml) was checked before the November 9 batch.

- [What Arcadia checks before an agent starts](https://pmark.github.io/arcadia/posts/what-arcadia-checks-before-an-agent-starts/)
- [One press](https://pmark.github.io/arcadia/posts/one-press/)

## Hold or use as source material

| Draft | Editorial disposition |
| --- | --- |
| [The single-Action path runs itself](2026-10-10-the-single-action-path-runs-itself.md) | Keep the October nine-Action fixture as background for the November proof. A separate post would repeat the run story. |
| [The hardest part of Hello World was proving it arrived](2026-10-12-arcadia-studio-creative-work-integration-test.md) | Hold for correlated end-to-end proof or a newly verified infrastructure milestone. The queued fixture is a useful teaching example. |
| [Arcadia spatial background and conversational context](2026-10-14-arcadia-spatial-background.md) | Keep as design source. The shipped blog canyon has its own story and does not establish the proposed conversational behavior. |
| [Arcadia agent identities](2026-10-23-agent-identities-roles-and-behaviors.md) | Use the named profiles as reference material for the shorter roles piece. |
| [How Arcadia could guide design brainstorming](2026-10-28-how-arcadia-could-guide-design-brainstorming.md) | Hold for a real walkthrough. The paper rehearsals surfaced a useful question about whether an agent records a preference as a rule. |
| [Arcadia session glossary](2026-11-03-glossary-of-arcadia-session-jargon.md) | Keep as a reference or AMC guide. Link to individual terms when they help a post. |

## Drafts in separate pull requests

Two open candidates are outside the main-branch inventory. [PR #1932](https://github.com/pmark/arcadia/pull/1932) has another take on the unattended-production story, so pick one version before scheduling it. [PR #2028](https://github.com/pmark/arcadia/pull/2028) already drafts pieces on the design archive, Relay's labelled simulation, and Way lookup. Use those candidates if any of the three topics moves forward.

## New short pieces

| Pitch | Developer angle and evidence |
| --- | --- |
| **Twenty PRs under one deliberately small contract** | Explain why a test-only queue, one worker slot, and a frozen base made the experiment measurable. One test can show what a pin protects, such as keeping a persisted ID stable. Count five separately started batches and distinguish them from a single unattended stretch. [Run evidence](../managed-production-readiness.md#operator-view-the-rovers-route-from-here) · [Test-pin Plan](../plans/record-run-unattended-test-pins-20261107-part-2.md) |
| **The last PR merged. Why did the run report say it failed?** | Trace the difference between a Plan's last merge and its completion projection. Show how the worker detects the terminal transition when there is no next Action. Cite the merged fix and date any claim about live verification. [Incident #2273](https://github.com/pmark/arcadia/issues/2273) · [Fix #2365](https://github.com/pmark/arcadia/pull/2365) |
| **An API label is a poor billing alarm** | Explain how a display fallback can be mistaken for paid execution. Separate the UI label from authentication, inherited billing variables, and overage settings. The report's deterministic check is a proposed correction; verify its delivery before calling it shipped. [Spend-safety investigation](../reports/spend-safety-investigation-2026-11-09.md) |
| **How to replace a coordinator without losing the work** | Show what a successor needs beyond a chat summary: pinned state, open authority boundaries, and evidence that it actually received the prompt. Source changes landed; the first-custodian and live launch proofs remain gates. [Coordinator change #2338](https://github.com/pmark/arcadia/pull/2338) · [Launch proof design](../agent-guidance/coordinator-handoff-design.md#real-launch-proof-gate-6) |
| **A restored database can give an agent its retry budget back** | Use the bounded Run admission work to explain why restoring an earlier valid ledger can resurrect spent attempts. Show how a separately retained witness helps detect rollback and where that trust boundary ends. [Durable admission #1457](https://github.com/pmark/arcadia/pull/1457) |
| **A moving backdrop that lets the reader scroll** | Explain the practical tradeoffs from Canyon Pass: a still fallback, progressive enhancement, and mobile Safari scroll smoothing. Use this as an occasional web engineering note alongside the agent stories. [Canyon Pass #2385](https://github.com/pmark/arcadia/pull/2385) · [Mobile fix #2388](https://github.com/pmark/arcadia/pull/2388) |
