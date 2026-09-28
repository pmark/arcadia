---
arcadia: v1
type: decision
id: "0074"
slug: adopt-the-module-integration-contract
project: arcadia
status: approved
question: Should every Arcadia website module follow the module integration contract in docs/proposals/module-integration-contract.md — a neutral library, a CLI printing versioned schema-defined JSON, a Capability Contract v1 module that alone holds governance, and an MCP facade generated from the same JSON on a trigger — with Uplink and Downlink as the first worked example?
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Adopt the four-layer contract, with MCP on its trigger.
confidence: high
updated: 2026-09-28
answer: Adopt the four-layer contract, with MCP on its trigger
decided: 2026-09-28
options:
  - label: Adopt the four-layer contract, with MCP on its trigger
    consequence: Engine extraction draws its boundaries to this shape and every later website module starts from it; governance lives only in layer 3; MCP is built read-only, plus drafting candidates, once Uplink's copy-audit mode ships AND a coding-agent session needs it mid-build, and never exposes approval-gated operations.
    recommended: true
  - label: Adopt layers 1-3 only, with no MCP policy
    consequence: Less to agree on today; coding agents shell to the CLI indefinitely, nothing binds a future facade's authority, and schemas are not held to generatable. Revisit when a coding-agent session needs a module mid-build.
  - label: No general contract; decide per module
    consequence: Uplink and Downlink follow #744 as written and each later module picks its own shape, so the first module's accidents become the de facto rule and the public-repository dependency question is answered per module. Revisit when a second module proposal is filed.
---

# Decision 0074: Adopt the module integration contract

## Context

Decision 0073 settled that Arcadia builds Uplink (`copywriting`) and Downlink
(`seo-audit`). It did not settle how a website module plugs into Arcadia.
`docs/proposals/module-integration-contract.md` (#754) asked for one contract
that every future website module follows: Downlink, imagery, deploy,
analytics and forms.

## Resolution

Adopt the four-layer contract, with MCP on its trigger.

The operator gave this answer on 2026-09-28 in Claude Code session
https://claude.ai/code/session_01PV3f9xHNWQ48L7yaZYvi6t ("Adopt the
four-layer contract with the MCP trigger"). It was recorded on #755 at the
time. **The operator ratifies it by merging the pull request that adds this
document.** Until that merge, this file exists only on an unmerged branch and
decides nothing.

## What this commits to

- **Four layers, all of them layers rather than alternatives:**
  1. a neutral library that never imports Arcadia;
  2. a CLI printing versioned, schema-defined JSON, which is the stable
     contract;
  3. a Capability Contract v1 module, which is the only layer with
     governance;
  4. an MCP facade generated from the same schemas, with no logic of its own.
- **The authority rule.** The module does the work and Arcadia holds the
  authority. This holds in every layer, MCP included.
- **Choosing a layer.** Decide by where authority sits, whether a model is
  needed, who is calling, and failure isolation. Delivered sites never depend
  on a module at request time.
- **MCP policy.** MCP is designed now and built only when Uplink's copy-audit
  mode ships AND a coding-agent session needs it mid-build.
  - The first version is read-only, plus drafting candidates.
  - Publish and approve are never exposed.

Nothing is built by this Decision. Decision 0073 still blocks building the
modules in Arcadia until PPN's copy-audit mode has run clean against Mission
Control for one release. The public-repository/private-engine condition in
the proposal is resolved at engine extraction, not here.

## Options considered

The three options above are the same as in the proposal's "Decision
requested" section. The first is recommended and chosen.

## Provenance

- Proposal: `docs/proposals/module-integration-contract.md` (#754).
- Decision Ask, archived unsettled because this document supersedes it:
  `.arcadia/asks/archive/agent-ask-decide-module-integration-contract-2026-09-28.yaml`
  (#755).
- Builds on: Decision 0073 and
  `docs/proposals/site-copy-and-seo-capability-modules.md` (#744).
