# Evidence: make-done-action-settlement-unambiguous

Action: `bootstrap-managed-production-to-build-flight-deck/make-done-action-settlement-unambiguous`.
Implementer: Sonnet 5, single-session candidate worktree. No live Arcadia command, database,
broker, `gh`, push, commit, settlement, production activation, or subagent was invoked.

## Instructions and context loaded

| Path | Bytes | Why |
| --- | --- | --- |
| `AGENTS.md` | 8,376 | mandatory retrieval, authority/governance/preservation/identity/review rules |
| `CLAUDE.md` | 378 | project entry pointer |
| `CONSTITUTION.md` | 3,320 | authority/truth/economy boundaries |
| `PROJECT.md` | 31,414 | current pointer and narrative history |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 | durable AI guidelines |
| `.arcadia/repo-context.md` | 703 | safe commands, source/test roots |
| `.arcadia/context-policy.json` | 870 | allowed roots, denied paths, safe commands |
| `docs/agent-guidance/index.json` | 5,717 | task/failure-triggered procedure index |
| `docs/plans/bootstrap-managed-production-to-build-flight-deck.md` (Action block only, lines ~4222-4239) | n/a | this Action's exact acceptance criteria |
| `docs/autonomous-production-rehearsal-runbook.md` §9–10 (lines 690-726) | n/a of 65,491 | findings ledger row and recommendation 1 that this Action implements |
| `docs/reports/rehearsal-reviewer-smoke/README.md` | 2,882 | what the run-8 smoke harness does/doesn't prove, and its known FAIL |
| `docs/notes-to-self.md` | targeted `rg` only (see below) | settlement/completion friction |

`rg -n -i "settle\|next_action\|reviewer-smoke" docs/notes-to-self.md` surfaced settle/apply
mechanics, queue-placement rules, and `pnpm fast-rehearsal` usage guidance; nothing specific to a
done Action's `next_action` field (this Action's defect was not previously logged there).

**Retrieval gap, disclosed truthfully.** `docs/agent-guidance/index.json` was read at session
start, but none of its three matching indexed procedures —
`docs/agent-guidance/learning.md` (1,636 bytes), `docs/working-copy-safety.md` (15,818 bytes), and
`docs/agent-guidance/agent-asks.md` (17,030 bytes) — were actually read before the original
`markActionDone`/`setTopLevelFields` edits in this session, only the index entry naming them. They
were read only now, for this correction, at the supervising release manager's explicit instruction. Reading them did
not surface anything that changes this change's approach (the parser-optionality rule that drives
this correction lives in `src/docs/parse.ts`, found directly), but the retrieval step itself was
skipped earlier and is recorded here as a process gap, not claimed as having happened before it did.

## Source change

`src/ask/settlement.ts`, `markActionDone(content, actionId, requestId)`:
- Now also rewrites the completed Action's `next_action` field to
  `Completed via Agent Ask <requestId>; no further action.`, naming the exact settlement's own
  Agent Ask `request_id` (the Ask's own id, e.g. `complete-first`, consistent with how `source:`
  and the Mission Log entry already name it — not the separate `--request-id` settlement-receipt id).
- Both call sites pass `proposal.normalized.requestId`: the `complete` intent (line ~858) and the
  `split` intent's narrowed-Action completion (line ~1208), so both paths use the same writer.
- Status/pointer logic, active-vs-non-active Plan handling, pending-Action instructions, and
  refusal paths are untouched — `markActionDone` only ever touches the one Action block it is
  called for.

### Regression found and fixed during implementation

The first version of the rewrite only replaced the `next_action:` header line
(`block.replace(/^ {4}next_action:.*$/m, ...)`), matching the pattern `amendAction` already uses
elsewhere in this file. `src/docs/parse.ts` accepts `next_action` as any non-empty string, so a
YAML literal/folded block scalar (`next_action: |` / `>`) is valid input. Reproduced with a
throwaway script and the `yaml` package already in `node_modules`: a header-only replace left the
old block scalar's continuation lines in place, and because they are more-indented than the new
plain-scalar line, YAML's line-folding silently merged the stale text onto the end of the new
value instead of throwing — e.g. `next_action: Completed via Agent Ask x; no further action.` was
immediately followed by ` Finish the first part. Then finish the second part.` once parsed. Not a
parse failure, so nothing would have caught it short of inspecting output text or a parser-level
assertion.

Fixed by consuming the full old field — header plus any more-indented continuation lines — the
same way this file already consumes `depends_on`/`references` block-list continuations:
```
/^ {4}next_action:.*(?:\r?\n(?! {4}\S).*)*/m
```
Verified against five cases with the `yaml` package (literal `|`, folded `>`, literal `|-` with an
embedded blank line, plain single-line, and CRLF line endings): all five now produce one clean
single-line field with no orphaned text, confirmed by parsing the result. Added a regression test
(below) covering the literal-block-scalar case through the real settlement path, not just the
regex in isolation.

### Second regression found and fixed: `String.replace` metacharacter expansion

Flagged before PR creation: `src/ask/agentAsk.ts` normalizes `request_id` with `requiredText`
only (any non-empty trimmed string is legal, no character restriction), so a request id
containing `String.replace` special patterns (`$&`, `` $` ``, `$'`, `$1`, …) is legal input.
`markActionDone`'s two `.replace(regex, aPlainString)` calls — the `next_action` rewrite and the
function's own closing `content.replace(pattern, block)` — both pass a *string* as the
replacement argument, which `String.replace` scans for those patterns and expands against its own
match, rather than treating it as literal text.

Reproduced with a disposable unit test (`request_id: complete-first-$&-end`) and a standalone
repro script. Fixing just the two call sites inside `markActionDone` (both converted to replacer
*callbacks*, which `String.replace` never reinterprets) was not sufficient: debug tracing showed
`markActionDone`'s own output was already correct, but the very next step in the same call
chain — `setTopLevelFields`, invoked immediately after `markActionDone` for every `complete`/`split`
Plan write — re-captures the **entire frontmatter block** (which, for a Plan document, embeds the
whole `actions:` list, including the just-rewritten `next_action` line) into `lines`, then does
`content.replace(match[0], ` ``` ---\n${lines.join("\n")}\n--- ``` `)`. That final call's second
argument is a plain string built from `lines.join("\n")`, which now carries the literal `$&`
untouched — and `String.replace` expanded it there, against `match[0]`'s own match (the original
full frontmatter block), corrupting the document with a duplicated, invalid-YAML copy of the
file's own header.

Fixed `setTopLevelFields`'s one closing `.replace()` call the same way (a replacer callback).
This is the one shared low-level frontmatter-rewrite helper unavoidably in `markActionDone`'s own
call chain for both `complete` and `split` (every other call site passes only deterministic
values — plan slugs, Action ids, dates — so no other caller was exposed to this). No other writer
function (`amendAction`, `newDraftPlan`, `setActionDependsOn`, `recordSplitInto`,
`replaceTopLevelField`) was touched; each has the same latent `String.replace`-with-a-string
pattern in isolation, but none of them sit in this Action's acceptance path, so fixing them is
out of this change's scope.

All three fixes (`markActionDone`'s two call sites, plus `setTopLevelFields`) verified end-to-end
with a new regression test asserting the parsed done Action's `nextAction` equals the exact
completed form with the literal `$&` intact, and that the pending Action's own instruction is
untouched.

### Third correction: a done Action with no `next_action` must not be refused

Flagged before PR creation: the `next_action`-presence check added alongside the rewrite
(`if (!/^ {4}next_action:/m.test(block)) throw ...`) introduced a refusal the old completion
writer never had. `src/docs/parse.ts` only requires `next_action` when `clarification: clarified`
is declared, or forbids it when `clarification: question_open`; otherwise — including a legacy or
non-active-Plan Action that declares neither `clarification` nor `next_action` — both are
optional, and `complete`'s own checks (declared acceptance criteria; `responsibility` is `agent`
or `autonomous`) never required either. Confirmed `complete` already accepts exactly this shape
today (a non-active-Plan Action is not the Project's `current_action`, so the parser's
current-Action clarification requirement does not apply to it either).

Fixed by making the rewrite conditional: when `next_action` is present, rewrite it exactly as
before (full-scalar consumption, literal-request-id callback); when absent, only `status` moves to
`done` and the field stays absent — there is no stale instruction to make unambiguous, and the
completion is still named by the canonical Mission Log entry and settlement receipt. No change to
`clarification`, `question_open` handling, the Ask schema, or any other writer function.

## Tests added/changed

- `tests/agent-ask-complete.test.ts`:
  - Strengthened the primary completion test to assert the done Action's exact rewritten
    `next_action`, that the still-open pending Action's own `next_action` is untouched, and that
    replay (idempotent re-settle) still shows the single clean rewritten form, not a second rewrite.
  - Strengthened the non-active-Plan completion test the same way, proving the rewrite applies
    identically regardless of `active_plan`.
  - Strengthened the "refuses completing an Action that is already done" test to assert nothing
    was rewritten before the refusal.
  - Added `"rewrites a block-scalar next_action cleanly, without leaving orphaned continuation
    lines behind"`: builds a disposable fixture repo whose `first` Action's `next_action` is a
    YAML literal block scalar, completes it through the real settlement command, and asserts the
    rewritten field is clean, the orphaned text is absent, the document still parses, and every
    other field/Action is untouched.
- `tests/agent-ask-split.test.ts`: strengthened the existing split test to assert the narrowed
  Action's `next_action` is rewritten to the same canonical completed form `markActionDone`
  produces for `complete`, not left as the narrowed title `amendAction` had just written.
- `tests/agent-ask-complete.test.ts`: added `"names the completion request id literally even when
  it contains String.replace metacharacters ($&)"`: completes an Action with
  `request_id: complete-first-$&-end`, asserts the parsed done Action's `nextAction` equals the
  exact completed form with the literal `$&` intact (`"Completed via Agent Ask
  complete-first-$&-end; no further action."`), that the pending sibling Action's own `next_action`
  is untouched, and that `git status` is clean.
- `tests/agent-ask-complete.test.ts`: added `"completes a legacy Action that declares neither
  clarification nor next_action, leaving both absent"`: strips `clarification`/`next_action` from
  the non-active side Plan's `side-one` Action (a real disposable fixture commit, re-parsed by the
  production parser, not a hand-asserted shape), completes it through the real settlement command,
  and asserts it still completes (`status: done`), both fields parse as `null` afterward, every
  other field on the same Action and the sibling Action are untouched, and `git status` is clean.

## Checks run

- `mise exec -- pnpm vitest run tests/agent-ask-complete.test.ts tests/agent-ask-split.test.ts` — 55 passed (after the final correction; re-run after each of the three fixes above).
- `mise exec -- pnpm vitest run tests/agent-ask-split-concurrency.test.ts tests/agent-ask-settlement.test.ts` — 70 passed (125 total across the four affected files).
- `mise exec -- pnpm vitest run` across the full `tests/agent-ask*.test.ts` family (9 files) — 183 passed on the `$&` fix, re-confirmed on the affected files after the final optional-`next_action` correction.
- `mise exec -- pnpm exec tsc -p . --noEmit` — clean.
- `mise exec -- pnpm lint` — clean.
- `mise exec -- pnpm fast-rehearsal` — two earlier implementer attempts were interrupted after duplicate jobs and a self-matching wait were detected. Their partial logs are not passing receipts. The release manager now supervises one final invocation after all source edits; its result is appended below.

## SMOKE_DRY=1 reviewer-smoke proof (run-8 Action 1 shape)

Per instruction, adapted a disposable **copy** of the existing
`docs/reports/rehearsal-reviewer-smoke/run8/` harness under `/private/tmp` (the checked-in
harness and the parent's own scratchpad under the other session's `/private/tmp/claude-501/...`
were read-only inputs, never mutated):

1. Copied the parent's already-built `repo/` (base = run-8's rendered 9-Action fixture tree,
   commit 1 = `MARKER.md` implemented) into `/private/tmp/claude-501/run8-fix-proof/repo`, then
   `git reset --hard` to commit 1 (`78dc9a6`, before the hand-built settlement commit the original
   harness used — the README already documents that hand-built commit as not faithful).
2. Ran the **real, fixed** settlement path in-process (`runAgentAskPreviewCommand` /
   `runAgentAskSettleCommand`, the same exported commands the test suite uses) against a disposable
   throwaway Arcadia workspace, completing `three-action-rehearsal/write-start-marker` with
   `request_id: complete-write-start-marker-run8-2026-10-06` and its two real declared acceptance
   criteria. `applied: true`. The resulting Plan block:
   ```
   status: done
   next_action: Completed via Agent Ask complete-write-start-marker-run8-2026-10-06; no further action.
   ```
   — deterministic proof of the rendered run-8 Action 1 done shape, produced by the actual fixed
   code, not hand-asserted.
3. Rebuilt the PR evidence (`build-evidence.mts`, unmodified) from the corrected head, confirmed
   `candidate.patch` now shows the clean diff (`-` the old 500-character stale-instruction line,
   `+` the new one-line completed form) in place of the FAIL the README recorded.
4. Ran `smoke.mts` (unmodified) with `SMOKE_DRY=1`: exit 0, `reviewer.exitStatus: 1` /
   `reviewerUnavailable: "...dry run"` (the smoke's own paid-command interception — no model
   call), sandbox-boundary check `pass`, every content criterion `not-checked` by design in dry
   mode (the live verdict, including the "Managed documents" finding this Action targets, is a
   paid call deliberately held — per the Action's acceptance criterion — for this chat operator's
   spend authorization). Confirmed the generated `prompt.md` (the real reviewer's would-be input)
   carries the same corrected diff.

One retry note: the first `smoke.mts` attempt, run inside this tool's default Bash sandbox,
failed its own internal reviewer-sandbox-boundary preflight with `host-network-unreachable` —
this tool's sandbox blocks the outbound reachability probe that preflight step performs. Reran
with the sandbox disabled for that one read-only, disposable-fixture command only; it then matched
the parent's own earlier dry-run shape exactly. Not a defect in the fix; recorded here since it
cost a retry.

All of the above ran against disposable copies under `/private/tmp`; nothing in the live
workspace, the real `martianrover` workspace's mutable state, or any checked-in fixture was
written. No model/paid reviewer call was made.

## Open items / out of scope

- The existing `amendAction` writer also keeps old block-scalar continuation text when amending an existing Action. This is outside the completion writer acceptance path. Verified and recorded as [Issue #1031](https://github.com/pmark/arcadia/issues/1031); revival trigger: the next governed amendment-hardening Action or a real multiline amendment.
- The run-8 reviewer-smoke harness itself remains "reference code, not wired into the operator
  scripts" per its own README; turning this session's disposable proof into the maintained 3+3
  smoke is explicitly the parent's next Action, not this one's.
- Live/paid reviewer smoke (3 QA + 3 code-review calls, per runbook recommendation 2) is withheld
  pending this chat operator's spend authorization, as the acceptance criterion requires.

## Final release-manager fast rehearsal and preservation blocker

`mise exec -- pnpm fast-rehearsal --no-file-parallelism`: exit 0, 30 scenarios; 58 passed and 1 expected fail, zero unexpected errors, 11m37s (exceeds five-minute target). Summary: `run8-settlement-fast-rehearsal.json`. Initial release-manager commentary incorrectly used the older 27-scenario count; corrected against the final JSON. The summary writer initially asserted that outdated count and exited before writing; the shell nevertheless invoked preservation. Preservation then refused before commit on a normal, unchanged tracked skill symlink (not a loop); see #1032 and retained receipt. No retry, raw commit or deletion was attempted.

Evidence-copy correction at blocked audit: the initial stdout-only refusal artifact was empty because the launcher emitted its failure on stderr. The artifact now explicitly transcribes the original tool stderr, including the exact diagnostic and attempt reference; the host attempt journal independently confirms `binding.manual`. No launcher retry or preservation mutation occurred.
