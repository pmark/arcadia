---
id: pr1402-fresh-host-permission-and-fingerprint
cost: unknown
fix: ordinary host permission path and canonical guidanceFingerprint contract
status: resolved
---
# Fresh PR1402 carry-forward friction

- Branch creation and dependency bridge failed under the default sandbox: ref lock creation and candidate node_modules mkdir returned Operation not permitted. The exact commands succeeded through ordinary require_escalated host approval; no old checkout or branch changed.
- Initial refreshed Scout fingerprint used raw file SHA256; check:agent-guidance failed with Stale mandatory guidance. Verified src/projects/agentGuidance.ts guidanceFingerprint trims body text. Corrected the index fingerprint using that contract and the next check passed. Retain the canonical fingerprint function as the recipe.
- Initial monitor filter encountered a null worktreePath after printing relevant candidates; snapshot remained intact. Lead provided bounded process-CWD/app-session evidence of no observed live writer in the old dirty note candidates. This does not release their custody.
- A read-only ps probe was sandbox denied; not repeated or used as evidence. Validation tool sessions remained queryable through write_stdin.

- The first new friction file lacked required front matter; check:session-ledger refused it. Added the existing validator fields (id, cost, fix, status), without changing the validator.
