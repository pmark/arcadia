# Friction observed while coordinating production recovery

This is an observation and 80/20 recommendation, not an activated Action or approval change.

## Where the agent spent time on logistics

- The v6 proof required a criterion assessment, then a `split` Ask, draft preview, settlement preview, settlement apply, queue repair, pointer preview, pointer apply and pushes. The narrow repair needed a second Ask sequence. The agent supplied no special reasoning to the fingerprint and commit steps once the intended effects were known.
- An unpositioned v6 fixture Action made the whole queue invalid and blocked `make-next`, even though its displayed order was last. The operator's intended current repair was already the top queued Arcadia Action; a deterministic repair of the missing position was needed before the pointer command could proceed.
- The first supported service restart refused because its helper's default workspace still named the legacy path. The CLI had already resolved `martianrover`; the host should pass that configured workspace to the installer without making the agent diagnose or guess a path.
- Candidate completion, base integration and Off/restart were separate facts in separate receipts. Without a stage-aware report, the Action could look complete after its candidate settled even while the base still held the old pointer.
- An isolated coding worktree lacked its dashboard and Discord package links. The first full test run then failed those imports and a shared temporary fixture path, while the focused recovery tests passed. Worktree setup should bridge declared dependencies and give each test run an isolated temporary root before CI is interpreted as product evidence.

## Smallest useful product change

Arcadia should own one host-side continuation transaction for **accepted, already previewed work**: recheck the exact proposal, queue revision, repository head and authority; apply the canonical settlement; place only new or unpositioned Actions according to an explicit reviewed placement; advance the pointer only when that same reviewed choice authorizes it; commit, publish and return one durable receipt. Any changed input refuses with a named next move. This reduces multiple mechanical agent turns without weakening the existing operator gate.

For completion, a deterministic evidence assessor can project each declared criterion as met, missing or disputed from immutable Session, validation, settlement, integration and Off receipts. It may auto-settle only a complete objective Action under existing delegated authority and current exact revision. A partial `split`, new Action, fresh Grant, merge and any reasonable judgment remain explicit operator choices. The host can prepare their exact preview and `/runs` button; no agent should relay fingerprints or copy receipts between commands.

This recommendation does not justify a new governance store, a parallel retry engine, broader concurrency, or activating the inactive hardening Plan. The present repair keeps recovery in the existing receipt path.
