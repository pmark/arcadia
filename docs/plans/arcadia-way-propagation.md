---
arcadia: v1
type: plan
slug: arcadia-way-propagation
project: arcadia
status: complete
milestone: No Arcadia project is silently stale on the Way, and no project's governance changes without review
token_impact: medium
token_budget: "Drift detection and file generation are deterministic — no model call belongs in either. Reserve model use for one implementation session per Action and a single review pass; a propagation run that calls a model per repository is the failure mode this budget exists to prevent."
recommended_model: claude-sonnet-5
updated: 2026-08-16
actions:
  - id: give-arcadia-its-own-context-files
    title: Give Arcadia the .arcadia context files it tells every project to read
    status: done
    responsibility: codex
    effort: quick
    next_action: Run `arcadia project setup-context` against this repository, or hedge the shared region's wording the way its `docs/managed-documents.md` line already is.
    expected_artifact: Either `.arcadia/AGENT_CONTEXT_POLICY.md`, `.arcadia/repo-context.md`, and `.arcadia/context-policy.json` in this repository, or a shared region that does not instruct agents to read files a repository may not have
    clarification: clarified
    confidence: high
    source: Found immediately by making Arcadia adopter zero, PR #66.
    acceptance_criteria:
      - Every file the shared AGENTS.md region tells an agent to read before broad exploration exists in this repository, or the region no longer unconditionally tells them to.
      - The adopter-zero test in tests/arcadia-way-propagation.test.ts still passes.
    depends_on: []
    references:
      - AGENTS.md
      - docs/agents-context.md
      - src/projects/contextSetup.ts
    result: >-
      All three `.arcadia/` files are committed. Running the prescribed
      `next_action` also proved the command could not run at all from the built
      CLI, and that it destroyed this repository's `CLAUDE.md`; both are fixed
      here, with the destructive one pinned by two regression tests.
  - id: stop-duplicating-a-canonical-protocol-on-adopter-zero
    title: Stop appending a second copy of the continuation protocol to the repository that authored it
    status: done
    responsibility: codex
    effort: quick
    next_action: Treat an existing `docs/agent-continuation-protocol.md` whose body already equals the canonical source as the managed region itself, rather than as a project-authored section to preserve below it.
    expected_artifact: A `setup-context` run against Arcadia that leaves `docs/agent-continuation-protocol.md` byte-identical instead of doubling it, covered by a test
    clarification: clarified
    confidence: high
    source: Observed twice while completing `give-arcadia-its-own-context-files`, 2026-08-16.
    acceptance_criteria:
      - Running `arcadia project setup-context` against Arcadia twice leaves `docs/agent-continuation-protocol.md` unchanged after the first run.
      - A repository whose protocol genuinely differs from the canonical text still has its own section preserved under the TRIAGE marker.
    depends_on: []
    references:
      - src/projects/contextSetup.ts
      - docs/agent-continuation-protocol.md
    result: >-
      `adoptContinuationProtocol` now treats an unmarked existing file whose
      body already equals the canonical text as the managed region itself
      rather than a project-authored section to double below it. That alone
      fixed the first run, but proving it against Arcadia's own worktree
      surfaced a second, worse defect the acceptance criteria's "twice" was
      written to catch: the canonical source is read from Arcadia's own
      repository root, which is also the adopted target whenever setup runs
      against Arcadia itself, so after the first run the "canonical" copy
      already carried the markers this function was about to add again --
      every subsequent run nested another pair around the previous run's
      output. Fixed by unwrapping one layer of markers from the canonical
      body before rewrapping it, so `body` is always the pure text regardless
      of self-reference. Verified for real: three consecutive
      `setup-context` runs against this worktree now produce a byte-identical
      `docs/agent-continuation-protocol.md` (single confirmed via md5), with
      exactly one marker pair and no TRIAGE section. A repository whose
      protocol genuinely differs still gets it preserved under TRIAGE
      (existing test, unchanged). 3 new tests in
      `tests/arcadia-way-propagation.test.ts`; full suite otherwise
      unaffected. This closes the milestone: `arcadia way` (report-way-drift)
      makes staleness visible rather than silent, and this fix removes the
      one defect it found. `open-way-sync-pull-requests` remains open,
      genuinely blocked on the unanswered `propagation-authority` question,
      and does not gate the milestone as written.
  - id: report-way-drift
    title: Report which projects are stale on the Way, without writing anything
    status: done
    responsibility: codex
    effort: session
    next_action: Add a read-only command that compares each adopting repository's managed regions against the canonical text and reports per project what differs.
    expected_artifact: A noun command reporting, per adopting project, whether CONSTITUTION.md, the shared AGENTS.md region, and docs/agent-continuation-protocol.md match the canonical text, and what its adoption.json upgrade_policy is
    clarification: clarified
    confidence: high
    source: Today the only way to learn whether a project is current is to run the writer and read the diff, which makes the read available only by attempting a write.
    acceptance_criteria:
      - The command writes nothing to any repository, consistent with the naming rule it reports on.
      - It names each stale project, which managed region differs, and the project's declared upgrade_policy.
      - A project whose repository path is unset or unreachable is reported as unknown rather than assumed current.
    depends_on: []
    references:
      - src/projects/contextSetup.ts
      - docs/agents-context.md
      - .arcadia/arcadia-way/adoption.json
    result: >-
      `arcadia way` reads every registered project's `repo_path` and reports,
      per project, whether `CONSTITUTION.md`, the `AGENTS.md` managed region,
      and `docs/agent-continuation-protocol.md` match Arcadia's own canonical
      copies, plus the repository's declared `.arcadia/arcadia-way/adoption.json`
      `upgrade_policy`. Drift detection reuses the same pure generator
      functions `setup-context` writes with (`updateAgentsMarkdown`,
      `adoptContinuationProtocol`) rather than a second implementation of
      "adopted": a file is current exactly when regenerating it from the
      canonical source reproduces its own bytes, so the read and write sides
      of "adopted" cannot drift apart from each other. A project with no
      `repo_path`, or one that no longer resolves to a directory, is reported
      `unknown` rather than folded into either current or stale. Run against
      Arcadia itself (adopter zero, repo_path pointed at its own checkout),
      it correctly reported `CONSTITUTION.md` and the `AGENTS.md` region as
      matching and `docs/agent-continuation-protocol.md` as differing --
      exactly the still-open `stop-duplicating-a-canonical-protocol-on-adopter-zero`
      defect, not a false positive. 6 new tests in `tests/way-status.test.ts`
      cover unset/unreachable paths, byte-identical adoption, named drift,
      missing files, and that the command writes nothing to the repository it
      inspects; the full suite is otherwise unaffected (826 passing, 4
      pre-existing failures in `tests/narrative-digest-schedule.test.ts`
      confirmed failing identically on `main`).
questions:
  - id: propagation-authority
    question: "Which tiers of Way change may propagate automatically, and does Arcadia's CI get push access to every project repository to do it?"
    gap_type: missing-decision
    decision: way-propagation-tiers-and-push-authority
decisions: ["0024"]
superseded_by_note: The Action this question unblocked, open-way-sync-pull-requests, moved to the way-delivery plan on 2026-08-17 because this plan had already reached its milestone. The question stays here as the record of what was asked; Decision 0024 holds the answer.
---

# Arcadia Way propagation

## What this plan displaced

Dispatch moved here from `demo-first-delivery` on operator direction,
2026-08-16. Exactly one Action may be current across the project, so that plan's
`current_action` was removed rather than left to be reported as a competing
objective. It stays `status: active` with every Action intact, so resuming it is
a pointer change and nothing else: set `active_plan: demo-first-delivery` in
`PROJECT.md` and restore `current_action: build-demo-hero-vertical-slice` to its
frontmatter. That Action is `open`, exactly as it was left.

## Why this plan exists

Arcadia writes the Way into every project, and nothing pulls it back. A project
is current because someone ran `arcadia project setup-context` at it, and stale
because nobody did. PPN's `.arcadia/arcadia-way/adoption.json` declares
`upgrade_policy: "explicit-only"`, which is honest about the mechanism rather
than a workaround for it.

That was survivable while the Way was small and the portfolio was one or two
projects. It stops being survivable when a Way change alters what agents are
*permitted* to do. The `open`-is-executable clarification is the worked example:
before it, an agent read the rule strictly and stopped; after it, the same agent
proceeds. Two coding agents stopped on that ambiguity in different repositories
before it was found.

## What is settled

Generating updated files in a working tree is safe, reversible, and idempotent,
and the `ARCADIA_CONTEXT_*` markers already protect a project's own sections.
Applying them — commit, push, merge into a project's `main` — crosses an
approval boundary the Constitution names explicitly.

So the automatic unit is a pull request per repository, not a commit. That much
does not need a Decision.

## What is not settled

Three things, all folded into `propagation-authority`:

- **Tiers.** Mechanical text (managed regions, `.arcadia` policy files) is a
  different risk from a constitutional amendment, which `adoption.json` records
  as ratified per project by the operator. Auto-applying an amendment would make
  that ratification field assert something false.
- **Command-surface changes.** A project may wrap the CLI — PPN's
  `scripts/arcadia.mjs` hardcodes repository paths — so renaming a command
  breaks a wrapper no marker protects.
- **Credentials.** Automatic propagation means Arcadia's CI holds push access to
  every project repository. That is a real blast radius and an authority
  boundary, not an implementation detail.

`adoptContinuationProtocol` already emits `TRIAGE THIS SECTION` when a preserved
local section restates the shared contract. Any propagation design must treat
that marker as a stop: a pull request carrying one is not eligible for automatic
merge under any tier.

## What adopting our own Way exposed

`give-arcadia-its-own-context-files` looked like a one-command Action. Running
that command against Arcadia found three defects, which is the argument for
adopter zero rather than a footnote to it.

- **The generator could not run from the built CLI at all.** `readAdoptedFile`
  resolved Arcadia's own repository root with a fixed `../..`, which is correct
  for `src/projects/` and wrong for `dist/src/projects/`, because `tsc` mirrors
  the source layout rather than flattening it. Every governance file the
  generator copies — the Constitution, the shared region, the protocol — read
  back as `null`, and setup failed claiming `docs/agents-context.md` was
  missing from the repository that authors it. It now walks up to the nearest
  `package.json`.
- **The generator destroyed this repository's `CLAUDE.md`.** `thinClaudeWrapper`
  treated the presence of `@AGENTS.md` as proof the whole file was generated, so
  a `CLAUDE.md` that imports `AGENTS.md` and then adds the project's own notes —
  the most natural shape for the file, and exactly Arcadia's — was silently
  replaced by the bare wrapper. This is the governance mutation the Constitution
  forbids, and the existing test missed it because its fixture had no import
  line to trip the early return. It now strips only what the generator itself
  writes and declines when anything survives.
- **The generator doubles a protocol it is itself the source of.** Arcadia's
  `docs/agent-continuation-protocol.md` predates the `ARCADIA_CONTEXT_*`
  markers, so first adoption reads the canonical text as a project-authored
  section and preserves it under the managed copy of itself. Non-destructive,
  and the marker says to triage it, so this is tracked as
  `stop-duplicating-a-canonical-protocol-on-adopter-zero` rather than fixed
  alongside a data-loss bug.

Two of the three would have reached every future adopter. The `CLAUDE.md` one
would have reached them silently.

## A known cost, deliberately not paid yet

`.arcadia/repo-context.md` and the `repo_path` it records are absolute and
machine-specific, so the committed file describes one checkout of one machine.
It is committed that way here because that is what every adopter already gets,
and changing the format is a propagation-wide decision rather than a detail of
this Action. **Trigger:** revisit when a second machine or a CI job needs to
read these files, which is the first moment the absolute path can actually be
wrong for a reader.

**This trigger fired on 2026-08-16.** A PPN session running in a cloud
container read machine-specific absolute paths that did not exist there. The
deferral expired on its own terms, exactly as written, without anyone having to
re-litigate it. The workspace-free `arcadia docket` addresses the orientation
command -- recorded as ad-hoc work in the Mission Log rather than an Action
here, because this plan had already closed when it landed; the
`repo-context.md` path format is still unaddressed and is now overdue rather
than deferred.

## The packaging half, deliberately not paid yet

`arcadia docket` no longer needs a workspace, which makes it correct on any
machine that has Arcadia. It does not make it *present* in a cloud container
that clones one project repository and nothing else — there is still no
`arcadia` on the box to run.

Three ways to close that: vendor the resolver into each adopter, which
guarantees the drift this plan exists to prevent; keep a shim pointing at a
checkout, which is what PPN does now and what fails in containers; or publish
Arcadia as a package each project declares as a dependency. Only the third is
real, and it is a propagation-wide decision about distribution rather than a
detail of this Action.

**Trigger:** the first time an agent session is dispatched to an adopting
repository in an environment that does not contain an Arcadia checkout, and is
expected to orient itself. That has already happened once by accident; the
trigger fires when it is expected to work.
