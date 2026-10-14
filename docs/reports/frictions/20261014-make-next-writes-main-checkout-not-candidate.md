---
id: make-next-writes-main-checkout-not-candidate
cost: 20
fix: proposed — resolve make-next's repoRoot from the caller's worktree as agent-ask settle does (projectCheckoutFor)
status: open
---
`arcadia advance queue make-next` previews with `repoRoot` = the registered main checkout (`entry.repositoryRoot`, src/commands/advance.ts), so applying it commits PROJECT.md on local main in the shared checkout. `agent-ask settle` already writes into the caller's candidate worktree. Result: a pointer move cannot travel in a candidate PR, and PR #1405 kept the pointer on delegation-policy-records instead of moving it to the production-path Actions.
