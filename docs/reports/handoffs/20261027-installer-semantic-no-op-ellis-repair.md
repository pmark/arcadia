# Installer semantic no-op repair — Ellis hand-back

Action: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider#preserve-codex-config-on-semantic-no-op. Issue #1800; PR https://github.com/pmark/arcadia/pull/1810. Parent Rowan retains governance/delivery judgment, independent R2 and CI observation. Actual writer gpt-6.1-sol/medium, implementer depth one; no delegation. Registry default is not actual runtime. Production remains Off.

## Candidate and recovery

Same branch `codex/installer-semantic-no-op`, starting head `2ff2bb25c635de41ae117558c6d5ea94d4b70c1f`, recovered path `/Users/pmark/.codex/worktrees/installer-semantic-no-op-resume/arcadia`. Original candidate disappeared after verified reads and before first source edit: process creation failed os error2 and primary-side `ls` confirmed absence. No edit ran in the original checkout. Root used supported app reconstruction from exact 2ff2, verified clean detached head, and explicitly transferred this path. Ordinary `git switch` needed host permission for Git index.lock, then succeeded. Cause of disappearance remains unknown. This was source-checkout recovery, not runtime recovery. No reset, stash, clean, history rewrite, primary product edit or duplicate writer.

## Implementation and criterion proof

1. Exact managed profile comparison covers the four owned tables, unique keys/tables, scalar types, worktree roots, all four credential denies, disabled network, approval and preserved interactive default. The early return preserves original bytes. Regression reorders tables, changes scalar quoting/spacing, adds table-path whitespace/comments and CRLF, and invokes twice with exact bytes, no changed files and no backups. Missing trust is added and incorrect trust repaired; existing correct trust stays byte-identical.
2. Regressions require repair for enabled network, dangerous extends, allow replacing deny, missing deny, wrong boolean type, extra key/table, duplicate keys and malformed scalar suffix. Exact managed descendant tables are replaced; extra grants do not survive. Duplicate project trust tables/entries and unsupported managed structures fail closed. Managed scalar proof is also the post-install verifier, avoiding the former prefix-regex false positives.
3. User tables, values, standalone/inline comments and unrelated multiline strings survive no-op and repair. Lexical masking prevents fake managed headers/root assignments inside multiline strings from being edited; repeated blank lines inside those values remain intact. The original failing-first receipt is untouched. All tests use disposable homes/configs and fake executables; no live config, credential, service or production access.

Supported comparison syntax: bare managed table paths (including whitespace around dots/brackets), single/double quoted scalar strings, quoted deny/root keys, comments and CRLF. Unsupported spellings of actual managed tables (quoted path components/array tables), quoted managed root/trust keys, duplicate/invalid defaults, or multiline managed permission values are refused before config writes; unrelated quoted tables, comments and multiline values are supported. This remains a bounded scanner/comparator, not a full TOML parser or new dependency.

## Raw validation

- `node node_modules/vitest/vitest.mjs run tests/go-broker-agent-setup.test.ts`: exit0, 66/66 pass (31.47s), after multiline preservation fix. Final table-whitespace delta: same command with `-t 'semantic no-op|unrelated multiline'`, exit0, 3pass/63skipped. Raw transcripts copied alongside this report.
- `node node_modules/eslint/bin/eslint.js src test tests scripts apps/dashboard apps/discord-bot`: exit0 (full lint); after final source changes, focused lint of source/test exit0.
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: exit0; final delta checked again.
- `node --import tsx scripts/check-agent-guidance.ts`, `check-operator-scripts.ts`, `check-session-ledger.ts`, `check-frozen-records.ts`, `check-plan-close-outs.ts`: exit0 each. Operator scripts checked65/failures0; shard partition `node scripts/ci-test-shard.mjs --check 8` exit0.
- `git diff --check`: exit0. Primary remained clean at `2b6aee46cf5dcb21e2d92ea2cc4221c98bf346a1` immediately before handoff preparation.

Initial changed narrow run exit1 (6pass/1fail): old post-install verifier rejected valid single quotes, then corrected by reusing exact comparison. Preserved original seven-failure evidence remains in `docs/reports/installer-semantic-no-op-failing-first.txt`. A temporary edit script initially had Python string quoting error before execution; corrected, no partial file write. Vite candidate-local .vite-temp mkdir was sandbox-denied; same test succeeded through ordinary host permission. Canonical learn first failed workspace readonly; same operation through ordinary permission succeeded: `lesson_7ccf9c386f6d34767d98`. No restriction or test was weakened.

## Settlement and delivery

Source commit and completion Ask are produced after this report. Final committed head, settlement receipt or exact refusal, and push are returned to Rowan. Root owns independent R2 and current-head CI; no independent review launched by writer and no CI watcher started. No merge, adoption/install, provider/auth probe, runtime recovery or next Action activation by writer. Custody is released only in final hand-back; until then this remains the sole source writer.

## Instruction evidence

Full generated brief `/tmp/rowan-installer-role-brief-20261027.json` read (8257 bytes). Mandatory source paths and bytes below; repository guidance retrieved Orientation, Semantics, Model Selection, PR QA and Working-Copy Safety; exact current Action lines352–367; Notes entries for workspace refusal, dependency bridge and focused Vitest; Ask completion/candidate settlement sections. Project was read in the original candidate along with Constitution/context/index; current pointer independently matched generated brief. No relevant missing reference.

- `AGENTS.md`: 12236 bytes
- `CONSTITUTION.md`: 3320 bytes
- `PROJECT.md`: 31689 bytes
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539 bytes
- `.arcadia/repo-context.md`: 703 bytes
- `.arcadia/context-policy.json`: 870 bytes
- `docs/agent-guidance/index.json`: 11757 bytes
- `.agents/skills/arcadia-role/SKILL.md`: 11841 bytes
- `.agents/skills/arcadia-guardrail/SKILL.md`: 5565 bytes
- `docs/agent-guidance/continuation.md`: 7462 bytes
- `docs/agent-guidance/learning.md`: 2458 bytes
- `docs/working-copy-safety.md`: 16202 bytes
- `docs/agent-guidance/git-identity.md`: 5248 bytes
- `docs/agent-guidance/pull-requests.md`: 21758 bytes
- `docs/agent-guidance/agent-asks.md`: 23384 bytes
- `docs/agent-guidance/arcadia-repository.md`: 30312 bytes
- `docs/notes-to-self.md`: 44338 bytes
- `docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md`: 30009 bytes
- `docs/reports/handoffs/20261027T0552Z-installer-semantic-no-op-ellis.md`: 5181 bytes
