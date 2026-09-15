---
arcadia: v1
type: proposal
project: arcadia
question: Mark has stated a personal, live need to cut Arcadia's real operating cost, and wants standing, budget-aware, continuously-updated model selection as a core operating feature — not a one-off addition. Should Arcadia adopt that as a Way-level economy policy, and does an OpenRouter-accessible coding-agent backend (OpenCode CLI or Kilo CLI) belong inside it?
---

# Cost-minimizing model selection, and OpenRouter as a possible backend

## Operator directive (2026-09-15)

Mark corrected the premise of this proposal's original research: he
personally needs the cost of running Arcadia reduced, and wants that
expressed as a standing operating principle — *Arcadia always finds the most
economical model appropriate to the job, within a budget, from an
up-to-date selection of available models* — rather than a fixed pin revisited
only on a new vendor GA release. That is a bigger ask than "add one more CLI
backend," and this document now treats it as two nested questions: the
standing policy first, and OpenRouter's place inside it second.

## Why this project needs it

`docs/model-selection.md` pins exactly two coding-agent providers on two
fixed models and says to revisit "when either vendor ships a new generation
GA — not on a calendar." It explicitly rules out per-task model switching:
"No tier 3/4 exists at this layer... that capability, if ever wanted, is a
deferred item with its own trigger (a real workload where Action-level
granularity is provably too coarse)." Mark's directive is exactly that
trigger, stated directly rather than inferred — this proposal's earlier draft
had rated the cost justification as speculative and unconfirmed by treating
subscription-included capacity as settling the question; that was an
assumption I should have asked about rather than concluded on his behalf.
Restated against the Constitution's Economy section ("spend in ascending
order: deterministic scripts, then local models, then frontier models, then
the operator"), a live cost-minimization need is squarely in scope — the
Economy section already commits Arcadia to spending as little as the task
allows, and a hard two-model pin is a policy that only partially honors that.

**Capacity fallback** remains the secondary, not-yet-live justification: this
repository's own `prove-multi-provider-production-recovery` Action
([`docs/plans/bootstrap-managed-production-to-build-flight-deck.md`](../plans/bootstrap-managed-production-to-build-flight-deck.md))
defers even the two-provider (Codex/Claude) soak proof "until single-provider
single-repository production has run cleanly in real use." A third provider's
fallback value is still ahead of that trigger; nothing here changes that part
of the earlier analysis.

## What we found (current docs/repos, fetched 2026-09-15)

**Both tools have a real non-interactive mode**, comparable in shape to what
Arcadia already relies on:

- OpenCode: `opencode run [message..]` — non-interactive, streams to stdout,
  built for scripting/CI. ([opencode.ai/docs/cli](https://opencode.ai/docs/cli/))
- Kilo: `kilo run --auto "<message>"` — autonomous mode auto-approves per
  config, exits 0/124/1, and injects "you cannot ask the user, decide
  autonomously" into the agent's context when it would otherwise stop to ask.
  ([kilo.ai/docs/code-with-ai/platforms/cli](https://kilo.ai/docs/code-with-ai/platforms/cli))

Neither needs to be wrapped to become scriptable; both already ship the
headless entry point Codex's `--ask-for-approval never` and Claude's headless
mode give Arcadia today.

**Model pinning is uneven, and validation is weaker than Claude's today:**

- OpenCode: `--model provider/model` on the command line, plus `opencode
  models [provider]` to list what's actually configured and reachable
  (`--verbose` adds cost/metadata). This is a *better* capability-check
  primitive than Arcadia's own `isPlausibleClaudeModel`, which is admittedly
  "a coarse sanity check, not a real" one
  ([`src/sessions/worktreePreparation.ts:64`](../../src/sessions/worktreePreparation.ts)).
- Kilo: no CLI flag to pin a model per invocation. The model is set in
  `~/.config/kilo/kilo.json[c]` (`{"model": "provider/model"}`) or switched
  interactively with `/models` — there is no per-run override and no CLI
  command to enumerate or validate available OpenRouter model ids; the docs
  point at the OpenRouter website instead
  ([kilo.ai/docs/ai-providers/openrouter](https://kilo.ai/docs/ai-providers/openrouter)).
  A config-file-only pin is a materially worse fit for Arcadia's
  per-Action, per-launch model selection than either Codex's or Claude's
  `--model` flag — it would need a config file rewritten per worktree launch
  rather than an argument on the spawn command, which is a real complication
  the current adapter interface (`ProviderAdapterBinding.modelArgs: string[]`)
  does not obviously accommodate.

**Sandbox/trust is a third, incompatible mechanism, not a variant of the
existing two:**

`goBrokerAgentSetup.ts` already hardcodes deeply provider-specific setup for
just two vendors — Codex gets a native TOML permission profile
(`arcadia-unattended.config.toml`, `approval_policy`, worktree-root allowlist);
Claude gets a JSON settings file (`sandbox.enabled`, `permissions.allow`,
`disableBypassPermissionsMode`). Neither generalizes to the other today, and
both required their own installer logic, their own status checks, and their
own regression tests. OpenCode adds a *third* shape again: a `config.json`
with per-tool `allow`/`deny`/`ask` rules that default to `allow` for almost
everything except `doom_loop` and `external_directory`
([open-code.ai/docs/permissions](https://open-code.ai/en/docs/permissions)) —
an allow-by-default posture that would need explicit denies added for
Arcadia's unattended profile, mirroring but not reusing either existing
branch. Kilo's `permission` block (`{"*": "ask", "bash": "allow", ...}`) plus
its `--auto` flag is a fourth shape again. Each is real and scriptable, but
none of the three trust mechanisms Arcadia would then support share a
representation — `goBrokerAgentSetup.ts` would gain a third fully separate
branch, not a parameterized variant of what exists.

**The (cli, model) two-axis assumption survives, but the model axis gets much
wider and more heterogeneous:**

Both OpenCode and Kilo already key model selection as `provider/model`
strings, the same shape Codex and Claude use today (`claude-opus-5`,
`claude-sonnet-5` are single-vendor strings; OpenRouter's are
`vendor/model`). So this is not a third axis structurally — `docs/AGENT_ORIENTATION.md`
and `providerAdapters.ts`'s `ProviderAdapterBinding` (one `provider`, one
`model`, one `modelArgs`) do not need a new field to represent "OpenRouter,
routed to `deepseek/deepseek-v3`." What changes is cardinality and
heterogeneity: OpenRouter fronts dozens of unrelated model families with
different context windows, different tool-calling reliability, and no shared
reasoning-effort semantics. `docs/model-selection.md`'s two-row table works
because Claude and Codex are each one well-documented model family with a
known effort dial. A third provider whose whole value proposition is "many
different families" would need its own per-family capability/effort mapping
inside that document (or a deliberately narrow allowlist of exactly one or two
named OpenRouter models) rather than one more table row — otherwise
`recommended_model` on a Plan Action becomes a string nobody has validated
against real capability data, which is the exact failure
`isPlausibleClaudeModel` and the model-selection revisit trigger both exist to
prevent.

## What we would build locally if we skipped Arcadia's process

A fourth provider-setup code path duplicating `goBrokerAgentSetup.ts`'s
Codex/Claude-specific installer logic for OpenCode's or Kilo's own config
format, plus ad hoc model-string validation for whichever CLI does not offer
`opencode models`-style enumeration — exactly the local reimplementation
Decision 0025 exists to prevent, and exactly why this is a proposal rather
than an Agent Ask.

## Recommendation

Split the two questions rather than answer them together, because they carry
different weight and different evidence:

**1. Standing cost-minimizing model selection: yes, pursue this — as a
Decision, not an Agent Ask.** The need is now live and stated directly by the
operator, which is the exact trigger `docs/model-selection.md` names for
revisiting its pinned-model design. But this is a change to the Constitution's
Economy section's operating contract and to a document that currently commits
Arcadia to *not* doing per-task model switching — it deserves an explicit
ratified Decision that says what "budget" means (a per-Action ceiling? a
portfolio-wide monthly figure?), how "most up-to-date selection" gets
refreshed without becoming a live, unvalidated model-string generator, and
whether Arcadia gains real intra-session/inter-Action switching or keeps
per-Action pinning but re-computes the pin from fresher, cost-ranked data each
time a Plan Action is dispatched. That last, narrower shape — recompute the
cheapest-sufficient pin at dispatch time instead of hand-picking it once in a
static table — is very likely the 20% that carries most of the value here,
and fits the existing `providerAdapters.ts` cost-ranked selection
(`candidates.sort(... left.costRank - right.costRank ...)`) almost as-is for
whatever providers are already configured, before any new provider is added
at all.

**2. OpenRouter (OpenCode CLI or Kilo CLI) as a backend inside that policy:
not yet, and not needed to get most of the value in (1).** The architecture
findings above still hold regardless of how live the cost need is: Kilo has
no per-run model flag and no model-enumeration command at all, which is a
poor fit for a design that wants to re-pin cheaper models frequently; OpenCode
is a better fit (`--model provider/model` plus `opencode models` for real
capability enumeration) but still requires a third, from-scratch sandbox/trust
mechanism in `goBrokerAgentSetup.ts` alongside Codex's and Claude's. Given
that (1) can deliver real, immediate savings by re-ranking cost among
*already-configured* providers and models, sequence OpenRouter as a follow-on
once the standing policy exists and its first real use shows the existing two
providers can't reach the operator's target cost — not as the first move.
If that follow-on happens, prefer OpenCode over Kilo on the evidence above.
