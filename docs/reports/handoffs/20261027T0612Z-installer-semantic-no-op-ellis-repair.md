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

Source head: `f03093ec28916f6055525cbbb06937a74bb117be`. Complete draft/preview succeeded with request `complete-installer-semantic-no-op-20261027-ellis`, proposal `agentask_734d69b3fffc63678d`, fingerprint `734d69b3fffc63678db4011f12f4764f41384aa2cced0af8a996b9f0e84feb9d`, exact ordered three criteria `met` and that source revision. The draft is preserved in `.arcadia/asks/agent-ask-complete-installer-semantic-no-op-20261027-ellis.yaml`.

**Settlement blocked, no governed completion applied.** Automatic approval review rejected even the settlement-preview command before execution, stating: "The prior preview explicitly requires operator acceptance, while this command accepts and settles the completion proposal, mutating governed records beyond the user's authorization to ask through normal channels." No retry, workaround or indirect execution was attempted. Rowan retains the exact approval boundary: obtain operator approval for this completion settlement, then use the supported candidate route and fresh fingerprint after verifying current evidence/revision. The local governed pointer remains unchanged. This is not an Action-completed claim. Root owns independent R2 and current-head CI; no independent review launched by writer and no CI watcher started. No merge, adoption/install, provider/auth probe, runtime recovery or next Action activation by writer. Custody is released only in final hand-back; until then this remains the sole source writer.

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

## R2 repair and evidence correction

Independent R2 found five blocking defects in e88d4f931: unrelated array/quoted-bracket table headers incorrectly invalidated exact proof; the distinct arcadia-unattended-custom profile was treated as owned; an inline profile under [permissions] survived repair and produced duplicate invalid TOML; multiline project trust rewrote only its opener; and this report originally used an invalid handoff filename. The prior broad checks ran before this report existed, so they did not validate the pushed final head. These are verified gaps, not previously handled cases.

Meaningful disposable R2 regressions were added before the source correction and all six cases failed. Full raw failing-first and later passing output is preserved, including final blank lines. Inline/dotted profiles under the permissions parent and multiline project trust are now refused before any configuration write. Unrelated array tables, quoted bracket names and similarly prefixed profiles are skipped by managed scalar proof and remain byte-identical across repeated installs.

The old completion draft and proposal agentask_734d69b3fffc63678d bind f03093ec and are STALE after R2 source changes. They remain intact as historical evidence; no settlement retry or replacement receipt was attempted. The report was renamed to the canonical timestamp/session form and active references updated below. Governed completion remains unapplied; parent retains the exact operator-approval boundary.

R2 authoritative report: https://github.com/pmark/arcadia/pull/1810#issuecomment-6435240552 (reviewed e88d4f931; all five findings verified). Repair scope is fourteen source lines plus disposable tests and corrected evidence naming. The six new regression cases first failed (6failed/66skipped), then passed (6passed/66skipped). Full repaired installer suite: `node node_modules/vitest/vitest.mjs run tests/go-broker-agent-setup.test.ts`, exit0, 72/72pass. Full typecheck: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`, exit0. `node --import tsx scripts/check-session-ledger.ts`, exit0 after canonical report creation/rename; it will be checked again on the final committed head. `git diff --check`, exit0. `node node_modules/eslint/bin/eslint.js src test tests scripts apps/dashboard apps/discord-bot` completed exit0 (full lint). Primary remains clean at2b6aee46cf5dcb21e2d92ea2cc4221c98bf346a1.

Raw R2 failing-first/passing/full-suite/ledger receipts are adjacent `docs/reports/installer-semantic-no-op-r2-*.txt`; raw bytes including trailing blank lines were copied without stripping. Historical blocked completion Ask bytes were intentionally not edited, so its obsolete report reference names the pre-rename historical artifact; the current durable evidence is this timestamped report. No stale Ask was resubmitted or settled. Prevention captured as canonical lesson `lesson_fa8559dca6388380059e`.

Criterion1 now additionally proves byte-identical repeated no-op with unrelated array tables, quoted bracket names and a distinct similarly prefixed permissions profile. Criterion2 additionally proves inline managed profiles and multiline trust fail before writes rather than yielding invalid TOML. Criterion3 includes whole-suite72pass, preserved user files on refusals and corrected final handoff validation. This remains source evidence subject to independent R3/current-head CI, not a claim of governed completion or unattended production acceptance.

## R3 remaining blocker and repair

Authoritative review: https://github.com/pmark/arcadia/pull/1810#issuecomment-6435331649 at9e9e9fba7. `1810-R3-01` confirmed the R2 inline-profile refusal still missed quoted root assignments. Double/single-quoted root permissions, quoted dotted roots, and Unicode-escaped quoted permission keys could produce invalid duplicate TOML while reporting ready. This was a remaining acceptance gap, not a previously fixed case.

Six disposable failing-first cases demonstrated that bypass before source repair (6failed/1passed/72skipped); the seventh case preserved unrelated escaped/quoted user keys and comments. The bounded fix classifies one TOML key segment, including literal/basic quoted keys and validated u/U Unicode escapes, before the existing root/parent/table guards. It parses no values and adds no dependency. This refuses equivalent managed aliases before configuration writes while preserving unrelated literal dotted names. The same classification covers escaped permissions-parent and owned-table names. Targeted R3 run7/7pass; full affected installer run79/79pass; full typecheck exit0. Full repository lint (`node node_modules/eslint/bin/eslint.js src test tests scripts apps/dashboard apps/discord-bot`) completed exit0. Session-ledger validation after this report update is exit0; final committed head will be rechecked before push.

A temporary source-edit script incorrectly reduced TypeScript backslash escapes and caused a startup syntax failure (exit1) before fixture execution; corrected immediately using a literal helper source file. No committed invalid source, fixture write, or gate weakening resulted. Failing-first and passing fixture transcripts are retained verbatim, including final blank lines.

**Whitespace evidence correction:** `git diff --check` on a clean working tree is exit0 and proves no uncommitted whitespace problems. The full branch check against2b6aee46cf5dcb21e2d92ea2cc4221c98bf346a1 is exit2 and reports CRLF/trailing-whitespace plus final-blank-line warnings in preserved raw test receipts. Those receipt bytes remain unchanged; this report does not claim a warning-free branch diff. Raw branch-check output is preserved alongside R3 receipts.

Old completion734d69 remains stale and host-blocked; no retry, replacement governance input or settlement. Three ordinary review rounds are consumed; R4 is available only because R3 found a significant blocker, with maximumfive total unchanged. Parent owns independent R4/current-head CI and conditional user-authorized merge. Writer stops/releases after the same-PR push; no runtime, credentials, setup, START, primary or worktree lifecycle changes.

## Final R4 structural boundary repair

Authoritative R4 report: https://github.com/pmark/arcadia/pull/1810#issuecomment-6435477460 at1ca752fe1, findings1810-R4-01/02. Both are verified: dotted/table root namespaces and array permissions parents could conflict with generated scalar/profile namespaces; escaped/dotted/nested trust aliases could conflict with generated trust scalars. The earlier per-spelling guards did not establish whole-document validity.

The assigned parent explicitly permitted one standard runtime parser dependency for this recurring structural gap. `smol-toml` is pinned at1.9.1 in package.json/pnpm-lock.yaml. Official API source read: https://github.com/squirrelchat/smol-toml (parse options, integers, key safety). Source invokes only `parse(content, { integersAsBigInt: "asNeeded" })`; no stringify, parsed-data mutation, serializer, general framework or diagnostic text is used. The parse result is discarded. Parser failures become a fixed validation error without config contents.

`prepareCodexConfig` performs the existing bounded permission/trust transformation, then validates the entire prepared document. Installer preflight calls this before any format writes/backups; updateCodexConfigs repeats the same preparation immediately before its write. Public inspection separately parses raw input and reports `codexConfigValid=false` for invalid documents, using empty input for the old semantic checks so invalid TOML cannot be reported ready. Invalid raw managed data remains repairable when the existing deterministic transformation produces valid output; the previous malformed/duplicate-managed repair assertions were retained.

Meaningful public failing-first evidence:12failed/1controlpassed/79skipped. Cases cover all six root namespace/array-parent inputs, all five trust aliases, invalid public inspection, and a control preserving an unrelated signed64-bit integer/date/literal dotted trust key. Every refusal asserts original Codex and Claude bytes plus unchanged Codex backup listing. After repair13/13targetedpass and full92/92pass, including all79priorcases. Full typecheck exit0; full repository lint (`node node_modules/eslint/bin/eslint.js src test tests scripts apps/dashboard apps/discord-bot`) exit0. Session-ledger check after the final R4 evidence files exists is exit0, with final committed head rechecked before push. Canonical prevention lesson: lesson_3bc69ee68e67da7eaf14. Full-branch whitespace check remains exit2 due to preserved raw CRLF/EOF receipt bytes, with its raw output retained; source/test/package/lock delta whitespace check is exit0. Raw transcripts copied unchanged, retaining final blank lines.

Dependency operation evidence: `pnpm add smol-toml --workspace-root --save-exact --lockfile-only --ignore-scripts` exit0. Despite lockfile-only it reported Packages+1 and added the candidate smol-toml link into the bridged `.pnpm` store, whose target is the primary checkout's ignored node_modules cache. This unexpected shared dependency-cache addition was immediately disclosed to Rowan, who acknowledged it and directed preservation/no cleanup or further primary install. No install scripts ran, no primary tracked file changed, no service adopted new code. Pnpm's unrelated Next/styled-jsx optional-peer lockfile drift was removed by a normal candidate edit; the final lock diff contains only the9parser-resolution lines.

Criterion1 retains exact-byte repeated no-op, including unrelated valid numeric/date syntax; criterion2 now has full-document structural proof before writes and no-backup refusals; criterion3 preserves all prior user-value/comment/multiline tests and adds literal dotted-key/large-integer/date preservation. This is source evidence, subject to absolute final R5 and current-head CI, not governed completion. Four review rounds are consumed; R5 is final, with no reset or automatic extra round if a source blocker remains. Stale completion734d69 and host refusal remain untouched; no new governance input, settlement, review, watcher, merge, runtime, auth, START or primary source operation by writer.
