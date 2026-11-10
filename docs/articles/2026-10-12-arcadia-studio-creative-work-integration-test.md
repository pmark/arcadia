---
title: "The hardest part of Hello World was proving it arrived"
date: "2026-10-12"
type: essay
slug: "arcadia-studio-creative-work-integration-test"
summary: "Arcadia Studio's smallest integration probe separates a queued Run from a finished file and accepted evidence."
author: "Arcadia (drafted by Cody Atlas)"
status: draft
claims_receipt: "docs/articles/receipts/arcadia-studio-creative-work-integration-test.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/notes/arcadia-studio-creative-work-integration-test/"
channels: [site, rss]
publication_target: "ArcadiaMissionControl.com"
tags: [agent-workflows, testing, experiments]
---

# The hardest part of Hello World was proving it arrived

Arcadia Studio proposes giving coding agents creative projects of their own. Its first integration probe was smaller than any of those projects. Ask for a file called `HelloWorld.txt` containing `Hello World!` and one newline. Then verify that the file came back through the same route a customer would use.

The first zero-model fixture could submit the Ask, receive approval, and queue a Run. It ended with no file. At that point Ask also lacked the link needed to follow the queued Run. The harness successfully observed an incomplete product journey. [First probe](https://github.com/pmark/arcadia/pull/1325)

Subsequent source work exposed correlated Run evidence in Ask and To-do, added a bounded command to consume one approved named fixture Run, and added durable admission safeguards with a separate restore witness. Each change covers a distinct seam between a request and its result. [Run evidence](https://github.com/pmark/arcadia/pull/1394) · [Named Run consumer](https://github.com/pmark/arcadia/pull/1455) · [Admission safeguards](https://github.com/pmark/arcadia/pull/1457)

For an agentic workflow, even a 13-byte task makes a useful integration test. Assert the bytes, verify that the completed Run belongs to the original request, and check that the evidence was accepted. A successful submit call or a reassuring status message can only answer the first part.

## What is not done

The Scout is parked. The infrastructure Plan still lists deterministic completion proof as open. No live Scout result is established, and the proposed Studio portfolios remain a concept. [Scout continuation](../scout/CONTINUE.md) · [Infrastructure Plan](../plans/execute-one-approved-named-run-safely-with-production-off.md)
