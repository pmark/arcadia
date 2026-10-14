---
id: scout-review-limit-provenance-gap
cost: unknown
fix: operator review-boundary Decision; proposed agentask_9213b86bcdc3ac5439
status: open
---
PR1394 exact source head207080cd80c0b62a65b721c80c284b8238bdb87e passed299 source tests and all7 CI jobs (38514726921). Independent Code-reviewer and QA R5 still block Ingress fallback when filename-based attachment discovery loses the original capture reference. Researcher confirmed renamed/detached input creates a new capture ID, not stale-capture authority. Whether that is legitimate new intake or required provenance continuity remains unresolved. No rename/detach regression was run.

The five-round limit in docs/agent-guidance/pull-requests.md ends the cycle; no sixth review or merge occurred. Proposal agentask_9213b86bcdc3ac5439 requests a bounded operator Decision. It is not approval. Existing edited-input refusal and real replay regressions in tests/ingress.test.ts pass, but do not cover rename/detach. Revival: operator records a review-boundary Decision and supplies the clarified acceptance scope. Production stays Off; consumer/budget and actual Scout remain gated.
