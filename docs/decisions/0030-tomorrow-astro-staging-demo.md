---
arcadia: v1
type: decision
id: "0030"
slug: tomorrow-astro-staging-demo
project: arcadia
status: approved
question: What is the smallest honest idea-to-built-Project slice Arcadia should prove for the 2026-08-21 demonstration?
answer: Prove the exact MartianRover Field Notes Astro-blog path from natural-language proposal through one Project-scoped approval, one coding-agent scaffold Run, and one Cloudflare Pages staging deployment whose URL returns through Discord.
recommendation: Reuse Arcadia's template registry, Project detail page, Review Decisions, managed worker, coding-agent adapters, Artifact notifications, and Project metadata. Defer generic multi-stack orchestration until this golden path succeeds with a real repository and staging URL.
confidence: high
decided: 2026-08-20
updated: 2026-08-20
---

# Tomorrow Astro staging demo

The operator will create an empty GitHub repository and enter its URL on the
proposed Project. The proposal itself is reversible local state and does not
invoke an agent, access credentials, initialize Git, or deploy anything.

Approval is one exact authority grant for this Project and this staging
attempt. It authorizes Arcadia to initialize the configured local repository,
attach the supplied GitHub origin, allow the selected coding agent the network
access required to use the declared Create Astro Site generator skill and
install dependencies, validate the generated scaffold, create or reuse the
named Cloudflare Pages project, deploy the `staging` preview branch, and let
Arcadia's configured Discord adapter report the result. Stored Cloudflare and
GitHub authentication may be used only for those effects.

Approval does not authorize a production deployment, a custom domain, a Git
push, merge, pull request, publication, content posting, spending, deletion,
or changes outside the proposed Project repository. Failure at any stage must
leave evidence and a focused repair action without claiming a live URL.

The Next.js and Node.js templates remain valid future classifications, and both
Codex and Claude Code remain valid build adapters. They become part of this
automated proposal/deployment contract only when a second stack is selected for
a concrete demo or Project; that is the trigger for generalizing the golden
path.
