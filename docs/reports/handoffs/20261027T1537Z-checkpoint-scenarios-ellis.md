# Final Git checkpoint scenario proof — Ellis handoff

Project Arcadia; active Plan `agents-notice-governed-changes-on-main-at-their-existing-checkpoints-and-re`; Action `prove-git-change-checkpoint-scenarios`. Milestone: agents notice governed changes on main at existing checkpoints and re-read changed records before acting, using Git alone. Intake https://github.com/pmark/arcadia/issues/1815. Parent Rowan sole coordinator, Ellis sole implementer/depth1, actual gpt-6.1-sol/medium; registry5.6-terra is not runtime. No delegation.

Candidate `/Users/pmark/.codex/worktrees/git-change-checkpoint-scenarios/arcadia`, branch `codex/git-change-checkpoint-scenarios`, clean base72e180880ca61e1684297bbe20bb6a922e9a053c. Parent verified PR1813 merged at that main revision and dependency guidance done; current Action open/agent/clarified. Read complete generated brief and supplied work-monitor receipt (unrelated candidates preserved). Branch creation, documented bridge and bounded scoped learning search succeeded; no install or primary source edit.

## New criterion-level evidence

All evidence below is newly produced by `tests/git-change-checkpoint-scenarios.test.ts`; earlier PR1813 review probes are not substituted. The test reads the actual trusted committed procedure with `git show HEAD:docs/agent-guidance/native-mail-checkpoints.md`, records source revision72e180880ca61e1684297bbe20bb6a922e9a053c and content hash, and executes its unchanged shell block. Every fixture Git operation is bounded to a disposable root, global/system Git config is disabled, inherited GIT_* inputs scrubbed, hooks/signing disabled for fixture commits, and GIT_ALLOW_PROTOCOL=file prohibits network transports.

1. **Restart/Decision observation:** observer clone is stopped while writer commits a Decision answer. A new short-lived checkpoint process receives the handed-off base SHA. It sees exactly one Decision commit event in the governed-record projection, while its working copy still contains the old pending answer, then runs `git show <pinned-main>:docs/decisions/0001.md` and verifies exact answered contents. Honest physical-output count: the same SHA appears once in governed output and once in metadata output, twice in the unmodified combined output; no projection or merge-parent comparison is hidden.
2. **Cursor advance/empty check:** only after the pinned re-read, the disposable handoff cursor is advanced to observed main. A second fresh process runs the same block; both log projections and combined stdout are exactly empty. Distinct process IDs and the final handed-off SHA are retained.
3. **Settlement before helper push:** helper branch has its own unpushed candidate commit. Writer lands a fixture settlement changing Project/Plan; before-push check finds that commit and re-reads fresh Project from pinned main. Candidate HEAD, local controls and clean status remain unchanged; `git ls-remote --heads origin refs/heads/helper` returns empty. Source procedure explicitly requires revalidation instead of pushing. This is deterministic Git/policy evidence, not proof that a model comprehended or enforced that requirement.
4. **Forged subject/body:** a commit subject imitates an Agent Ask settlement and shell `touch`; its body names an Action and shell writes to Project/queue/claim. Both appear as raw metadata only. Canary is absent; observer and writer Project/Plan/queue/claim fixture bytes remain equal to their original snapshots; observer HEAD/status stay unchanged. Queue/claim files are explicit fixture canaries, not emulated or inspected live Arcadia database rows.
5. **Exact isolated receipts:** three committed JSONL records contain actual source command results and all fixture argv, cwd, exit status, PID, stdout/stderr, revisions and assertions. They include21/25/18 fixture commands for the three scenarios, all exit0, and raw combined plus separate log projections. No Arcadia workspace command, provider, service or network transport runs inside these scenarios. Delivery's separately mandated real-repository checkpoint is identified separately below.

## Validation and artifacts

- Explicit structured-evidence run of `node node_modules/vitest/vitest.mjs run tests/git-change-checkpoint-scenarios.test.ts --silent=false` with tempfile-only `ARCADIA_CHECKPOINT_SCENARIO_EVIDENCE`: exit0,3/3pass; three actual JSONL records/59783UTF-8 bytes verified before copying. Console output was suppressed even with --silent=false, so the console-only transcript is not claimed as command evidence. Initial optional JSONL destination checked only its real temporary parent; R1 demonstrated that this was insufficient to protect a redirected leaf (corrected below). Normal test runs need no output path.
- `node node_modules/vitest/vitest.mjs run tests/git-change-checkpoint-scenarios.test.ts tests/git-change-checkpoint-regressions.test.ts tests/agent-guidance.test.ts tests/standard-harness-guidance.test.ts`: exit0,32/32pass across4files.
- Full lint `node node_modules/eslint/bin/eslint.js src test tests scripts apps/dashboard apps/discord-bot`: exit0.
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: exit0.
- `node --import tsx scripts/check-agent-guidance.ts`: exit0 (procedure/index/bootstrap unchanged).
- Session-ledger validation is run after this timestamped artifact exists and again on final committed head. Source diff check exit0; raw receipts retain terminal blank lines, so a clean working tree is not a claim that branch receipt bytes produce no whitespace warnings.

Artifacts: `docs/reports/git-change-checkpoint-scenarios-evidence.jsonl` (actual structured raw records), `git-change-checkpoint-scenarios-run.json` (run command/env/count summary), `git-change-checkpoint-scenarios-proof.txt`, `git-change-checkpoint-scenarios-focused.txt`, `git-change-checkpoint-scenarios-guidance.json`. Initial console-only pass transcript retained separately, with its evidentiary limitation disclosed above.

## Cursor, authority and completion boundary

A separate real repository delivery checkpoint used the committed block with cursor72e180880ca61e1684297bbe20bb6a922e9a053c; fetched/pinned main remained that same SHA, ancestry/first-parent checks passed, log range empty, exit0. Current coordinator handoff cursor: **72e180880ca61e1684297bbe20bb6a922e9a053c**. Receipt `git-change-checkpoint-scenarios-delivery.txt` is delivery hygiene, not part of the local-only scenario proof. Primary verified clean at72e before preservation.

No runtime/procedure/CLI/framework/dependency/governed record changed. Production Off and strict unattended acceptance remain separate. UI edge remains proposal-only; native coordination is manual relay. Parent owns independent current-head review, single CI watch, supported completion and merge decision. Writer will prepare only a temporary completion input after the final source commit, without committing an input that moves its bound head; no draft/preview/settle command or pointer/status/queue edit by writer. One Action only; no next work selected or held work touched. Sole writer releases custody explicitly after PR handoff.

## Instruction retrieval

Full `/tmp/rowan-final-scenario-role-brief.json` (7627bytes) and `/tmp/rowan-final-scenario-work-monitor.txt` read. Exact current Action/Project, Constitution, context policies and Notes retrieved; shared procedure executed from committed source. Indexed role/guardrail/working-copy/identity/PR/Ask rules remain loaded in this continuous writer context; retrieved paths/sections include checkpoint cursor/log/authority rules and Notes bridge/focused-fixture remedies. Paths/bytes:

- `AGENTS.md`: 12236bytes
- `CONSTITUTION.md`: 3320bytes
- `PROJECT.md`: 31501bytes
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539bytes
- `.arcadia/repo-context.md`: 703bytes
- `.arcadia/context-policy.json`: 870bytes
- `docs/agent-guidance/index.json`: 12038bytes
- `.agents/skills/arcadia-role/SKILL.md`: 11841bytes
- `.agents/skills/arcadia-guardrail/SKILL.md`: 5565bytes
- `docs/agent-guidance/native-mail-checkpoints.md`: 8529bytes
- `docs/agent-guidance/git-identity.md`: 5248bytes
- `docs/agent-guidance/pull-requests.md`: 21758bytes
- `docs/agent-guidance/agent-asks.md`: 23384bytes
- `docs/notes-to-self.md`: 44338bytes
- `docs/plans/agents-notice-governed-changes-on-main-at-their-existing-checkpoints-and-re.md`: 3996bytes


## PR1817 R1 repair — 1817-R1-01

R1 NO-GO identified that `appendFileSync(path)` followed an existing leaf symlink after only the parent had been validated. Confirmed with new disposable tests: corrected failing-first command `node node_modules/vitest/vitest.mjs run tests/git-change-checkpoint-scenarios.test.ts -t 'scenario evidence destination boundary'` exited1, three failures/one pass/three skipped. The symlink and pre-existing hardlink each changed an external **disposable** sentinel; a hardlink added after the first owned append also received the second append. No live external file was used. Initial regression run also had a directory-cleanup mistake; that receipt is retained separately and the control was corrected before the meaningful baseline.

Repair: canonical temporary parent remains required, and first creation now uses `O_CREAT|O_EXCL` with mode0600. Reopens use `O_NOFOLLOW|O_NONBLOCK`; the opened descriptor must be a regular file, single-link, and have the same device/inode as this process exclusively created. Writes use that validated descriptor and close in `finally`. Pre-existing regular files, symlinks, hardlinks and directories are refused; no-follow-unavailable platforms fail closed. A hardlink added between appends is refused before additional bytes. This is an owned-receipt safety boundary, not a claim of isolation against a concurrently hostile filesystem actor racing link/parent changes after checks. No serializer, runtime or production code changed.

Fresh complete scenario proof executes the same committed procedure from source HEAD8af6cb966486d44cb57fd8fc9e474763e8103cc5 (procedure bytes unchanged). `node /tmp/run-scenario-evidence-r2.mjs` runs the actual Vitest argv retained in `checkpoint-scenarios-r2-run.json`, exit0, seven tests; three full scenario JSONL records/59783UTF-8 bytes,21/25/18 actual fixture commands, all exit0. Boundary tests redirect only their own optional output paths and restore the environment; original three criterion proofs still produce exactly three structured records. All five criterion assertions above remain independently reproduced in this fresh receipt. Console suppression remains disclosed; JSONL is the raw command evidence. Initial sandbox cache-write EPERM is preserved as `checkpoint-scenarios-r2-host-denied.txt`; ordinary host permission rerun passed, no dependency install.

Repair checks: affected four-file Vitest command listed above exit0,36/36pass; full lint exit0; full tsc exit0; guidance delivery exit0; final artifact session-ledger check exit0. Exact commands are unchanged from the validation list above; raw lint/tsc outputs are empty on success and preserved, guidance/ledger outputs retained. Raw failing-first, passing, structured JSONL/run and delivery receipts are `docs/reports/checkpoint-scenarios-r2-*`; prior evidence remains untouched. The separate mandatory real-repository checkpoint again exited0 with main72e180880ca61e1684297bbe20bb6a922e9a053c and empty range; cursor remains72e after verified unchanged records. Pre-edit work monitor exited0; Notes search found no existing symlink-evidence remedy. Indexed identity and PR procedures re-read (5248/21758bytes); other continuous-context loaded paths/bytes remain above.

Parent owns independent R2 of the repaired head, CI, fresh exact-head completion input and merge. Prior temporary completion input bound8af6 is stale after this repair; no settlement/status edit or replacement governance input by writer. Raw terminal EOF blanks remain preserved; working-tree cleanliness is not branch whitespace cleanliness. Writer releases source custody after commit/push, awaiting parent review only.
