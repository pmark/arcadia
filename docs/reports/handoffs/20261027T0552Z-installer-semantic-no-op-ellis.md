# Incomplete installer repair — preserved for coordinator transfer

Action: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider#preserve-codex-config-on-semantic-no-op. Issue https://github.com/pmark/arcadia/issues/1800. Decision0144A selects this FIRST assisted source Action; it does not authorize an unattended launch.

Candidate: /Users/pmark/.codex/worktrees/installer-semantic-no-op/arcadia; branch codex/installer-semantic-no-op; base2b6aee46cf5dcb21e2d92ea2cc4221c98bf346a1. Sole writer Ellis/native gpt-6.1-sol/medium (registry default5.6-terra is NOT actual). Root ordered preservation of the current WIP to transfer coordinator session; no new source work may start before custody is explicitly reassigned. Final head/PR and custody release are reported in the handoff message.

## Actual implementation state

**INCOMPLETE: production source is unchanged.** Only tests and this evidence were added. No Action completion Ask was submitted or settled; no acceptance criterion is proven met. Do not merge this WIP.

Verified source cause: updateCodexConfigs calls setCodexPermissionProfile every install; that function removes/re-appends managed permission tables and normalizes formatting. removeTomlTable also drops a comment immediately preceding an unrelated next table. Existing checks use regexes, and no TOML parser dependency is present. A possible bounded repair is conservative comparison of actual managed keys/scalars against desired semantics before rewriting, retaining all required denies/network boundaries, with preservation of unrelated comments during necessary changes. This is a PROPOSAL, not implemented/validated design. Unknown/quoted/multiline syntax and duplicate/extra permissions must not be mistaken for safe semantics. No new parser/dependency/general framework has been added.

## Raw proof

Command: `node node_modules/vitest/vitest.mjs run tests/go-broker-agent-setup.test.ts -t 'semantic no-op|repairs incorrect'`

Exit1; 7 failed /45 skipped, one test file; duration1.96s. All failures occurred with source unmodified, against disposable home/config files and fake executables. Raw receipt: docs/reports/installer-semantic-no-op-failing-first.txt; bytes15544; SHA25613ba071de99346aecdeda23ad46f9fa7dc4dedd2ae5eb9d988c779deb17d1511. The first test rearranges tables/quotes/comments/newlines and expects exact bytes/no changed files/no backup across repeated installation. Six parameterized cases change network/extends/deny/missing deny/type/extra entry and require actual repair plus preservation of an unrelated user table/comment. These tests are intentionally red until the source fix exists.

Earlier candidate CLI work-monitor attempt exit1: tsx dependency absent (also mise trust-link sandbox warning). Existing repository dependency bridge exit0 created candidate-owned dependency trees and retargeted dashboard workspace import to candidate; no primary dependency install. Primary-source read-only `work monitor --no-pull-requests` exit0, unrelated candidates preserved. Branch creation exit0. No full tests/tsc/build have run for this WIP; lint/ledger/diff verification is reported separately. No independent review has occurred. CI of this known-red WIP is not acceptance evidence. Successor owns discovery/watch after explicit transfer; do not rerun unchanged red tests just to rediscover the known failures.

## Resume exactly here

1. New Rowan accepts coordinator custody; assigns sole writer to this SAME candidate/branch, verifies exact preserved head and clean status, reads full role brief /tmp/rowan-installer-role-brief-20261027.json or its canonical Action criteria. Do not reset/stash/clean/recreate work.
2. Implement smallest correct source repair with no permission relaxation; preserve tests and raw failure receipt. Add focused guards only for actual new risks. Re-run affected tests after source changes, then required lint/tsc/checks.
3. Canonical complete settlement must target THIS candidate with exact ordered criteria/evidence and no primary side effect; if unsupported, retain precise evidence Ask/gap. Resolve semantic identity fresh on each commit/comment. Push SAME PR; request Root's independent current-head review, observe normal <=3 rounds and current required CI. Root dispatches existing independent reviewer.
4. No merge of this authority-adjacent installer PR, no primary mutation/main push/install/service/provider/credential/renewal/START/reset/old-held operations. No author exception applies. Stop after this Action, not the next checkpoint Action. Preserve PR1662/1783/1787 and consumed allowances.

Journey: http://arcadia-1.alpine-rattlesnake.ts.net:3020/journey/arcadia/plan/current . This WIP is source preparation only; managed production stays Off and strict unattended acceptance remains unproved.

## Guidance retrieved

Full generated role brief; role/guardrail skills; AGENTS/Constitution/Project/current Action; context policies; guidance index; working-copy and identity procedures; relevant installer source/test and targeted Notes; PR/Ask procedures from immediately preceding passes remain loaded. All writes confined to assigned candidate.
