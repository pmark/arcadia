# Mira: canonical contract and production handoff

2026-10-23. Operator-directed work, intake [#1709](https://github.com/pmark/arcadia/issues/1709).
No governed Action is claimed or completed. This report is evidence and a
handoff, not a Plan, scheduling authority or approval to resume production.

## Canonical change

The seven registered roles remain unchanged. Specializations narrow a role's
domain or method; reusable procedures are Behaviors. Compatible methods compose
inside the existing brief and allowance. Human names are optional handles;
functional contracts and actual execution identities remain sufficient for
agent-to-agent collaboration. Mira is Release Investigator, implemented in
`.agents/skills/arcadia-release-investigator/SKILL.md`, with a relative Claude
discovery alias to that same source. The existing role skill, indexed brief
procedure, semantic contract and operator guide link the behavior.

This supplies a source contract and filesystem discovery, not automatic
dispatch, an installed runtime refresh or evidence of live production use.
The prior proposal `agentask_5bd20a5cfb56392cab` remains an intake receipt;
this report does not settle it or change its status.

## Production implementation recommendations

1. **Prove the bootstrap as one acceptance path before delivery.** Unique
   Project/Plan discovery, canonical sync, an actual ready WorkItem, aligned
   histories and a preservation-accepted published base must agree. Separate
   parser, shell and descriptor checks did not prove that composition. The
   current coordinator already received and incorporated this lesson; retain
   its reviewed evidence rather than commissioning an unchanged rehearsal.
2. **Match diagnostic context to the runtime being judged.** A shell-context
   Claude 403 did not prove worker failure. Check credential source equivalence
   and whether telemetry came from a fresh network request or cached observation.
   Reuse the delivered source-aware usage helper; do not reopen that implementation
   based only on this historical lesson or attribute success to desktop login.
3. **Separate exhaustion mechanisms.** Reviewer attempts are per requirement
   revision and role (`src/sessions/roleLineage.ts:58,534`); repair rounds are
   per Action and epoch (`src/sessions/reviewRepair.ts:140`); an operator hold is
   Action-keyed and survives pointer movement (`src/production/tick.ts:1650,2540`).
   Generic reset deliberately does not resolve the review-repair hold or restore
   lineage attempts (`src/production/tick.ts:3134`). The supported finding is an
   incomplete explicit recovery lifecycle, not proof that Action identity itself
   is wrong or that same-Action recovery was deliberately prohibited.
4. **Prepare a bounded same-Action resolve-and-resume transition as its own
   governed change.** Proposal `agentask_bc1de896bd2d8e4019` pins the hold,
   candidate head, requirement revision, authority, expiry and any finite
   additional allowance. Retain all prior attempts; consume approval once;
   clearing a hold replenishes no other budget. The decisive scenario exhausts
   A, completes independent B, then permits exactly one approved recovery of A,
   with fresh exact-head evidence and refusal of stale or replayed authority.
   This PR implements no such transition. Preserve the existing replacement
   setup, held #1662 and all receipts; this diagnosis is no reason to reset or
   reverse current authorized work. Revive this capability proposal when the
   operator selects it for implementation or another same-Action recovery is
   required; do not turn it into a new release prerequisite without evidence.
5. **Batch settled mechanics, keep effects explicit.** Distinct adoption,
   dependency and pointer operations can share one reviewed approval when that
   approval covers their exact effects. Separate operations do not necessarily
   require separate operator interruptions. Production START remains separately
   governed. The current coordinator retains custody and its existing stop/drain
   blocker; this handoff neither resumes a paused heartbeat nor launches work.

The investigation involved repeated questions to the existing production owner,
checked against source and history. Decision 0098 bounds repair and requires an
operator stop; it does not prescribe the database key. Commit
`86f7f2559c9c0cb3eb976d976a1d738d9a47b30a` explicitly preserves held work while
allowing independent progress. The anti-reset motivation for a stable key is a
reasonable inference, not a recovered statement of original author intent.
Retained lesson: `lesson_5f3a73358daa018146df`. Retrospective source chats:
`01a16620-8445-7a32-8bc2-c642ec4fb5ec` (owner) and
`01a16714-7047-79a2-996d-3be41a407b0e` (Mira).

## Validation and limits

- Shared skill filesystem discovery: Codex, Claude Code and OpenCode pass the
  existing `scripts/check-agent-skills.ts` checker; Claude resolves the relative
  alias to the maintained shared source. No personal install was overwritten.
- Existing guidance-delivery checker passes for all three providers, including
  instruction budgets. The roles-and-briefs fingerprint is refreshed.
- `tests/agent-guidance.test.ts` and `tests/agent-roles.test.ts`: 53 tests pass.
- Existing `role brief --role researcher --specialization 'release investigation'`
  renders a bounded brief; the label creates no new role or executor.
- `git diff --check` passes. No executable source, role-registry entry, policy,
  pointer, queue, budget or service configuration changed.
- Native discovery in fresh Codex, Claude Code and OpenCode sessions has not
  been exercised. Filesystem proof is reported separately; no provider sessions
  were launched merely to claim native proof. The current chat's skill catalog
  predates this candidate. Actual native discovery remains a post-adoption check.
- Skill Creator's optional Python validator could not start: PyYAML is absent
  from both the system and bundled Python. No packages were installed. The
  repository's YAML-based skill validator passes; the Python check is unproved.

## Instruction retrieval evidence

Loaded the repository context policy and index before exploration; Constitution,
Project and exact current Action to rule out overlap; Arcadia role, guardrail,
release-manager and Skill Creator instructions; matching working-copy, identity,
operator-directed-work, skill portability, standard harness, PR, learning,
principles and Arcadia repository QA/working-copy procedures. Targeted Notes
retrieval covered skills, identity, reviews, worktrees and workspace-write
recovery. Scoped Learn search returned no matching skill/role lessons.
The preservation monitor completed before edits; it reported 259 working copies
across four Projects. The production coordinator confirmed no overlapping writer
from its chat; its helpers were finished and heartbeat paused. Work stayed in a
fresh clean candidate, leaving the primary checkout unchanged. The existing
guidance checker records loaded default instruction paths, bytes and hashes.
