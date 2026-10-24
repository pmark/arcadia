# Consultation: get advice, a second opinion or help

This is an instruction-following Behavior within existing Roles, not a new
role, scheduler, admission path or authorization. Rowan remains the accountable
coordinator. Read [role assignments](session-roles-and-briefs.md) and the selected
method before launching help; use the existing standard harness unmodified.

## Resolve the request

An operator or agent may say **get advice**, **get a second opinion**, or
**get help** without choosing an identity, provider or model. Resolve one stated
uncertainty and the output needed to answer it. If the context supplies both,
proceed; ask only when a missing fact would materially change the assignment.

- **Get advice:** choose the expertise needed for a recommendation.
- **Get a second opinion:** obtain a fresh judgment independent of the author
  whose proposal or work is being assessed. Supply the evidence and proposal,
  not the author's confidence or a desired verdict.
- **Get help:** default to advice. If execution assistance is actually requested,
  distinguish same-Action help from independently owned work before acting.

An agent requests consultation through its assigned Lead; a depth-one delegate
returns a help request rather than spawning another delegate. The top-level
Lead uses an already authorized launch route. This procedure grants no launch,
spend, ownership-transfer or execution permission. Do not seek approval again
for a consultation already authorized within that route and scope.

## Select the smallest useful consultation

Choose expertise first using the [canonical profiles](../arcadia-semantics.md#roles-specializations-and-optional-names):

| Uncertainty | Profile and registered Role |
| --- | --- |
| Cause of a failure | Mira / researcher |
| Solution design | Ellis / planner |
| Assumptions or plan adequacy | Nadia / plan-critic |
| Candidate defects | Sage / code-reviewer |
| Acceptance against observed behavior | Quinn / qa |
| Current operational health | Vida / researcher |
| User-facing editorial work | Clara / implementer, within assigned editorial Ownership |

One adviser is the default. Add another only for a named missing expertise,
material disagreement or required independence. Combine compatible methods in
one assignment; do not create a panel to represent every possible perspective.
Profiles do not supply shared memory, additional permissions or extra Roles.
Read-only consultation does not authorize an implementer to edit editorial or
product files. Sage and Quinn retain separate independent Session requirements;
a generic read-only PR verification context follows the existing
[PR procedure](pull-requests.md#independent-review-gate), not registered-role admission.

**Use the minimum viable spend needed to produce useful, sufficiently reliable
advice.** Minimize expected total inference across briefing, reading, reasoning,
retries and synthesis. Reuse current evidence, send only relevant context, bound
the output, and choose a sufficiently capable model and effort initially.
A stronger adviser with a short brief can cost less overall than repeated weak
attempts. There is no mandatory cheap-model trial, automatic escalation ladder,
maximum-model default or new budget-approval workflow.

Resolve configured model/effort through existing role briefs and
[model-selection guidance](../model-selection.md). Respect the launch's actual
binding and existing permissions and limits. Consultation does not change
whole-Session light-start policy or approve an unavailable model. Distinguish
configured defaults, requested settings and observed runtime; report unavailable
values honestly, never infer runtime from the profile or brief. If selection is
not supported by the authorized route, preserve the brief and name the boundary.

## Brief, launch and return

Use the existing brief's Task, Context, Acceptance, Ownership, Checks and Return;
add no schema. Keep the assignment short:

1. State the question, decision or uncertainty, with relevant evidence and its
   revision/freshness. Identify the responsible owner and independence needed.
2. State the profile, registered Role and selected method, proposed model/effort,
   allowed capabilities and one bounded pass. Existing tighter limits prevail.
3. Request a concise recommendation, supporting evidence, material uncertainty
   or dissent, and the next permitted step. State when the consultation stops.

Use supported native delegation only when available and authorized (Codex's
native agent tool or Claude Code's native Agent tool). For OpenCode or another
surface without a verified native path, use an existing authorized separate
Session or submit an Agent Ask proposal with the preserved brief. Read-only
advice claims no development Action and proves no governed enrollment. An
unsupported runtime must not be described as supervised or admitted; do not
invent a runner or a recursive delegation route.

Rowan integrates the answer, preserves material disagreement and cites the
actual sources and limits. Stop after the bounded pass when the question is
sufficiently answered. Another pass needs a specific unresolved question or new
evidence, not merely a desire for more opinions. Return unsupported conclusions
as uncertainty rather than manufacturing agreement.

Retain the question, adviser/Role, runtime evidence (or unavailable), recommendation,
limits and next step in the assignment's existing handoff, report or Agent Ask.
Record measured usage when available; otherwise use unknown. Do not create a
second consultation ledger or perform a novelty search merely to retain evidence.

## Advice and execution use the same ownership rules

Advice alone changes no Plan, queue, claim, acceptance result or production state.
Implementation help uses the existing assigned candidate and sole writer; the
Lead pauses edits when an implementer writes. Independently owned work requires
separate governed Action admission. Parallel advice never proves that two
Actions can execute concurrently. Governed follow-up uses Agent Ask; consultation
results never approve their own execution.

The Behavior is the same in direct desktop/mobile/CLI chats and unattended work;
available tools and authorization determine the launch route. `arcadia go` still
uses the existing host contract. This procedure implements no native supervision
adapter, concurrent scheduler, automatic production activation or cross-project
rollout. A procedure loaded from source is instruction evidence; native behavior
and host enforcement require separate proof.
