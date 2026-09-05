# Flight Deck: reviewable settlement handoff

2026-09-05. Supporting evidence, not a canonical Log or operator approval.

## Completed in this documentation pass

- Source audit and bounded live checks, operations contract, twenty-Action
  delivery sequence, exact Agent Ask and twenty-scenario acceptance matrix.
- Four existing Action ids preserved; sixteen additions. All ids and references
  checked, dependency graph acyclic, first Action independently executable.
- Live `agent-ask preview` succeeded with twenty effects, no conflicts/refusals
  and `projectWritesPerformed: 0`.
- Full settlement preview with `--top` refused: four existing approved Actions
  have no queue positions. Amendment without placement also refuses because
  new active-plan Actions require an explicit position. These refusals are
  recorded, not bypassed.
- Queue repair preview succeeded at revision 17 with 51 keys: existing four
  Flight Deck Actions first, all other 47 keys retaining their relative order.
  Receipt `qorder_9e4c8486e5ce4f0da4`, `applied: false`, revision 17 unchanged.
  Predicted next: `arcadia/project-plan-lanes-and-pipeline-columns`.

The schema-approved proposal request is
`flight-deck-operations-complete-2026-09-05`, proposal
`agentask_1fbe386a7149e28979`, fingerprint
`1fbe386a7149e289792d6e29592ca226fbdfbc784c2fa639b280f4df54bf107f`.
The fingerprint binds the Ask bytes; edits require a new request id and preview.
It is not a settlement apply fingerprint.

## One operator question

Approve the twenty-Action Flight Deck amendment and the prerequisite queue order
(first projection, focus, detail, dispatch; preserve other Projects' relative
order), so the expanded dependency-safe bundle can become governed execution work?

Acceptance of the feature plan is not acceptance of its future implementation,
permission to launch a real provider, or authority to merge/deploy/release.
Publishing this documentation branch/PR and any canonical settlement commit
requires the repository's explicit publication authority too.

## Exact execution sequence after approval

1. Preserve and publish the documentation branch as a PR with its documentation
   QA plan; merge only with explicit merge authority. Supporting references must
   be present in the canonical source before dispatch relies on them.
2. Read a fresh `advance queue --json`. If revision, key set or relative order
   changed, regenerate the queue preview preserving the then-current other work;
   ask again only if the proposed consequence differs from the approved one.
3. Apply the approved complete arrange through `advance queue arrange`, not a
   hand-edited queue. Verify a durable receipt and valid order. The original
   preview request id is `flight-deck-initial-order-2026-09-05`.
4. Generate the full plan settlement preview using proposal request above,
   `--disposition accepted --responsibility agent --top`, a fresh settlement
   request id and current queue revision. Inspect the exact effects and refusal
   list. Then apply only its exact settlement fingerprint within approval.
5. Settlement targets the configured Project repository, currently
   `/Users/pmark/Dev/MR/Arcadia/arcadia`, not the invoking documentation worktree.
   Inspect its branch/cleanliness and concurrent-session ownership before apply.
   It was main at audit time. Do not silently commit/push a shared branch or
   redirect the registry to a worktree to evade that fact. If publication needs
   a different branch/worktree, prepare the approved safe route first.
6. Verify the active plan has exactly twenty intended Actions, first pointer
   unchanged, dependencies preserved, agent Responsibility, and an explicit
   dependency-safe queue segment. Check the existing model pin and real launch
   prerequisites; a recommended model is not a prepared build packet.
7. Publish any settlement commit under approved Working-Copy Safety, then open
   a fresh `arcadia go` session for the current projection Action. Recommended
   initial handoff is the configured Claude Sonnet 5, medium effort; the sizing
   guide names the later high-effort boundaries.

Do not apply the amendment-only refusal, use the proposal hash as an apply hash,
or describe this supporting bundle as the already expanded canonical Plan.

## Recovery material

The current work is isolated in
`/Users/pmark/Dev/MR/Arcadia/flight-deck-operations-spec`, branch
`codex/flight-deck-operations-spec`. The audit changes no product source,
PROJECT.md, active-plan state or queue. The documentation-only PR should say
there is no new runnable target and use the audit, Ask schema validation and
acceptance matrix as its proof. Existing UI probing is not feature acceptance.

Private runtime queue payloads and raw receipt files were left outside Git in
`/tmp/flight-deck-*.json`; they are conveniences, not durable authority. Regenerate
from the live CLI if absent or stale. This handoff intentionally contains only
the scope/count/consequence needed to review the prerequisite, not the rest of
the operator's portfolio content.

## Review-discoverability correction

The current intended Ask is now `flight-deck-operations-reviewable-2026-09-05`
in the same YAML file. It retains twenty Actions and explicitly adds pending
Agent Ask inventory, direct review links and contextual settlement, after the
operator found that the old UI cannot expose this proposal. The earlier request
and fingerprint above remain historical preview evidence, not an approval of
this revision; do not apply the earlier request. Neither request has been settled.
Use a fresh preview and settlement fingerprint for the revised request, keeping
the same queue-repair prerequisite and publication boundaries.

For the present proposal the operator may approve in the agent conversation and
the agent performs the bounded mechanics. This temporary handoff is the precise
workflow Flight Deck must eliminate as a requirement for normal operation.
