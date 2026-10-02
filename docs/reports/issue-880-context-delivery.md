# Issue #880: compact Way delivery

## Scope and authority

Milestone: Bootstrap managed production to run unattended from the GitHub board.
The checked-in pointer remains `prove-literal-split-browser-and-ledger`; this is
an operator-requested bug repair for #880, not completion of that Action or of
`build-agent-agnostic-learning-loop`. Responsibility: agent. Required Artifacts:
compact bootstrap/provider entry, indexed authoritative procedures, adoption and
refusal checks, regression evidence, and the pull request.

Decision 0050's learning direction is reused through the existing Project Notes
To Self. No lesson store, worker, retrieval CLI, provider-limit increase, queue
change, authority grant, or fabricated completion is added. Existing detailed
instructions are preserved in focused homes. Root/local obligations still bind.
The active Plan and Project pointer have not been edited.

## Bytes and mandatory coverage

Baseline: `f1149da5c4433790cabccd926ecb47c3a033e6d3` (the issue's measured baseline
has the same file sizes). UTF-8 bytes, not model token counts:

| Input | Baseline | Result | Reduction |
| --- | ---: | ---: | ---: |
| AGENTS.md | 71,630 | 7,549 | 89.5% |
| Shared bootstrap | 55,969 | 6,262 | 88.8% |
| CLAUDE.md wrapper | 6,076 | 378 | 93.8% |

Nine essential constraint groups remain in the bootstrap: Authority, Governance,
Preservation, Identity, Handoff, Operator steps, Review, Economy/truth and
Vocabulary. Mandatory learning lookup now appears at byte 1,392; the
identity resolver appears at byte 3,877. Both arrive well before the
supported budget; a late-identity regression fails.

The budget is 8 KiB for generated bootstrap, 12 KiB for root instructions,
24 KiB for the project chain and a conservative 32 KiB combined envelope,
reserving 8 KiB for global additions. [Official Codex guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
describes a default 32 KiB instruction limit and override/ancestor discovery.
The combined bound is Arcadia's conservative policy, not a claim that every
provider shares Codex's cap. Global, nested and wrapper bytes are counted.
[Claude's official memory documentation](https://code.claude.com/docs/en/memory)
explains that imports load context and additional memory layouts can add input.
The supported thin-wrapper audit refuses uncounted layouts/imports explicitly.
[OpenCode rules](https://opencode.ai/docs/rules/) specify its global AGENTS.md
and Claude fallback; the audit counts the selected source. Custom profiles,
settings, extra imports and additional directories need effective-load evidence.

See `issue-880-instruction-delivery.json` for actual file paths, byte counts,
SHA256 receipts and the scope of this measurement. It excludes instruction
contents and private transcripts. Token counts were not measured; byte reduction
is the context-cost evidence, without assuming a fixed bytes/token ratio.

## Delivery and retrieval

The searchable `docs/agent-guidance/index.json` names every shared procedure's
trigger, authoritative path, required read timing and fingerprint. Local Arcadia
procedures have their explicit triggers/path in the root's repository obligations.
Startup/handoff and operator-only button procedures are separate, so normal
startup does not load the operator action manual.

Setup checks canonical resources and budgets before writing, preserves Markdown
and root additions outside managed regions, refuses foreign JSON indexes and
escaping paths (including dangling symlinks), and installs every referenced
shared resource. Propagation refuses all planned writes if its reference-library
installation is blocked, so it cannot publish a partial bootstrap/library pair. It refuses feature or
detached target checkouts and revalidates destination ownership/the entire plan
after checkout before any write. Propagation uses
the same adopter and keeps initial bootstrap/resource installation in the
**governing** tier together. Way status detects missing/stale resources and
budget problems. JSON dispatch and managed launches refuse unsafe delivery.
Existing briefs carry relevant exact reference paths and file receipts, rather
than automatically importing the procedural library.

The deterministic fixture resolves `sample/fix#repair` through the real dispatch
reader, invokes a real targeted search (`rg`, or `grep` when `rg` is absent)
on a verified settle lesson before reading the Ask procedure, reads the identity reference, renders the real managed brief, and
proves that deleting the identity reference refuses both dispatch and launch.
These are executed file/command checks, not an agent acknowledgement. Fixtures
cover Arcadia/adopters, default root/global/nested combinations, Codex overrides,
Claude wrapper/import refusal, OpenCode globals, missing/stale/escaping resources,
UTF-8 overflow, preservation/idempotency, and mandatory late-rule visibility.

## Validation

- Focused delivery/adoption/dispatch suites: 99 tests passed; the final new
  guidance suite contains 16 regression scenarios.
- The security review also identified destination drift across checkout.
  Regressions cover a feature-only repaired library and foreign ownership
  introduced after checkout; neither can be overwritten or published. Three
  relevant suites passed 52 tests and the final build passed.
- CodeRabbit round one: four verified findings repaired; human dispatch
  refusals and whole-word trigger matching have regression coverage. Four
  focused suites passed 57 tests and the refreshed guidance audit passed.
- Final containment/preservation checks: 68 tests passed across six adoption,
  propagation and delivery suites; the build passed.
- Linux portability repair: the then-15-scenario suite passed with both ordinary
  PATH and a restricted PATH containing Git/grep but no ripgrep; lint passed.
- `mise exec -- pnpm build`: passed (lint, TypeScript, core and Discord builds).
- `mise exec -- pnpm check:agent-guidance`: passed; file receipts are attached.
- Full suite with an isolated TMPDIR: 247 test files passed, 3 skipped;
  2,701 tests passed, 21 skipped. Final guidance suite and lint reruns passed
  after the last override-preflight adjustment.

## Review gate

CodeRabbit round one identified four actionable findings; they were repaired
and its second loop reported no unresolved threads. The second review was
**rate limited**, with **no approval on that head**. This is not merge approval.
The security-summary destination-drift concern was also repaired and validated.
CI and review must be checked on the final published head; do not infer approval
from a green rate-limit status.

## Fresh-provider acceptance still outstanding

Version-only checks found Codex CLI 0.157.1 and Claude Code 2.1.267 installed.
No new native coding-agent process or paid provider request was launched for a
behavioral rehearsal. The current session began with the prior instruction
context, so its reads cannot honestly prove compact automatic startup. The file
and fixture receipts prove deterministic delivery/refusal, not native effective
prompt contents or model adherence. #880 must remain open until the following
fresh-session traces have been recorded; the implementation PR uses `Refs #880`.

A bounded read-only native-provider rehearsal must retain actual loaded-source
metadata and tool calls, not just a summary. Use a disposable adopter with
`sample/fix#repair` and a known `settle --proposal` Notes To Self remedy. Start at
root and at a relevant nested directory with supported global guidance. Verify:

1. Native loaded-source evidence contains the compact root and selected global /
   nested instructions and no automatic procedural manual import.
2. The agent resolves the exact Project/Plan/Action, performs targeted lesson
   lookup before the known failing `settle --file` experiment, and retrieves the
   Ask procedure before proposing any consequential operation.
3. Before preparing a commit, it reads the identity procedure and invokes the
   correct resolver; no commit, settlement, queue mutation or production occurs.
4. The trace identifies loaded and retrieved paths, byte receipts, order and
   results. A known-friction recurrence is zero wrong-flag experiments in that
   rehearsal; it is not inferred from this session's test success.
5. Repeat through a prepared/manual brief and managed brief, and through the
   Codex default and Claude thin-wrapper entry points. Record provider version,
   effective profile, missing mandatory guidance, and any failure honestly.

Operator and end-user QA are the same for this developer tooling. There is no
changed web demo target or HTTP URL. The immediately runnable local proof is
`mise exec -- pnpm check:agent-guidance` plus
`mise exec -- pnpm exec vitest run tests/agent-guidance.test.ts` in the candidate.
The operator authorized bounded read-only Codex/Claude rehearsals using their
configured defaults. Four disposable root/manual and nested/managed adopters
were then prepared with the real adoption and brief generators. Neither native
agent started: automatic approval review rejected the launch because transmitting
automatically loaded global instructions was not specifically authorized, and
Claude's proposed `cat`/`rg` permissions could reach files outside the fixtures.
No retry or workaround was attempted. The remaining operator question is whether
to authorize that instruction/file transmission to the configured model services
or hold native QA. The prepared fixtures and prompts remain under
`/private/tmp/issue880-native/`; they are temporary preparation, not behavioral
acceptance evidence. No real Project or workspace was changed.

## Friction and prevention

| Operation | Observed evidence | Recovery / prevention |
| --- | --- | --- |
| Bridge new worktree dependencies | Sandbox EPERM creating candidate app dependency directories | Used the existing bridge through scoped host execution; no manual dependency links. |
| Pinned runtime validation | mise could not write its worktree trust registration from the sandbox | Ran the pinned validation through scoped host execution; no profile/permission widening. |
| Initial typecheck | setup command projection omitted the new guidance field | Added the typed projection and reran typecheck/build. |
| Early focused checks | Existing text-location assertions still expected the whole manual in AGENTS.md; one fixture lacked Project goal/date | Preserved assertions in the indexed canonical homes and corrected fixture fields. |
| Linux CI retrieval fixture | Runner lacks `rg` (`ENOENT`) | Use real `grep` only for missing `rg`; keep search failures and lesson assertions binding. |
| Initial lint | Replaced adoption fixtures left unused imports | Removed imports; lint/build passed. |
| Full-suite tidy test | Fixed shared `publisher` clone path already existed | Reproduced and linked existing [#859](https://github.com/pmark/arcadia/issues/859); preserve the unknown old directory and use an isolated TMPDIR for proof. |
| One full-suite run overlapped final source edits | The early test worker retained prior module code while new tests had already landed | Freeze code before final run; use fresh workers and retain the prior failed output. |

No new hot-cache workaround was added for transient implementation errors. The
recurring large-instruction failure becomes source extraction, refusal guards
and regression tests. The unrelated test isolation defect retains its existing
Issue and is not repaired in this scope.
