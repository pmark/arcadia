---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia give agents a known-good baseline for `pnpm test` in the sandboxed agent environment, so a full-suite run reports only what changed instead of forcing every agent to re-judge which failures are pre-existing sandbox artifacts?
---

# Every full-suite run re-litigates the same unknown

## The evidence

Investigating pmark/arcadia#242 (a preservation-validation sandbox fix), the
agent's report included a full-suite run from inside its task environment:

> Full suite: 1,437 passed, 73 failed, 12 skipped, with 53 unhandled errors.
> Many failures explicitly report EPERM for local HTTP/IPC, private workspace
> writes, or host application support paths... The full suite is not green; no
> claim is made that every failure is a proven baseline failure.

That last sentence is the problem. The agent could not say which of the 73
failures were caused by its change versus pre-existing sandbox artifacts (a
denied local socket, a denied write path, a denied host directory — none of
which a code change controls). So it ran the *focused* suite instead (129
passed, 6 host-only skipped) and left the full-suite number unexplained in the
PR, alongside an honest caveat.

This is not a one-off. Any sandboxed agent that runs `pnpm test` today gets the
same undifferentiated wall of failures and has to decide, from scratch, which
ones are its problem. The honest answer — "I don't know, here's the raw
number" — is what shipped in #242's report, and it is the best any agent can
currently do.

## Why this project needs it

Two costs recur every time this happens:

1. **Wasted diagnosis.** An agent (or a reviewer) has to manually triage 70+
   failures to find the handful, if any, that are real. #242 didn't do this —
   it deferred to the focused suite — which means the full suite currently
   provides *no* signal at all, despite running it costing real wall-clock
   time.
2. **Silent regressions are as invisible as they are common.** If a real
   regression is buried in the 73, nothing surfaces it, because nothing
   distinguishes "was already failing yesterday" from "started failing with
   this change." The full suite is run, but its result is not actionable
   either way.

## What we would build locally

A local script that snapshots `pnpm test` output and diffs consecutive runs,
which is the sandboxed-test-triage machinery this proposal exists to avoid
building per-project. If this capability belongs anywhere, it belongs in
Arcadia, once, for every adopting repository that runs tests inside an agent
sandbox — not reinvented per project as an ad hoc allowlist of "expected"
failure strings.

## What would make this answerable

1. Is a recorded baseline (a committed or Arcadia-held list of known
   sandbox-only failures, refreshed on a cadence or on demand) the right
   shape, or should this be solved by tightening the sandbox itself so EPERM
   failures stop happening in the first place?
2. If a baseline is the answer, who owns refreshing it when the sandbox
   configuration or the suite legitimately changes — an operator action, or
   something Arcadia re-derives automatically from a clean host run?
3. Should `pnpm test`'s own output distinguish these categories directly
   (e.g., tag EPERM-shaped failures inline), rather than requiring a second
   tool to diff against a baseline?
4. Does this belong next to the existing `ARCADIA_PRESERVATION_HOST_TEST=1`
   pattern (tests that skip in-sandbox and require an explicit unsandboxed
   run), or is it a distinct problem — the full suite doesn't skip these
   cases, it fails them noisily?
