# Bounded code simplification

Adapted selectively from [Addy Osmani's code-simplification skill](https://github.com/addyosmani/agent-skills/blob/fea75b16472ba87e8c11f13a9e000c3ffdb2d1f5/skills/code-simplification/SKILL.md),
retrieved 2026-10-14. This is a specialization of existing roles, not a new role,
automatic pass or scope expansion.

## Principles worth applying

- Improve comprehension, not line count. Follow neighboring conventions.
- Understand callers, edge cases, history and the reason for a guard before
  changing it. Keep comments that explain intent.
- Preserve outputs, errors, side effects and their ordering. Readability is
  not permission to weaken checks.
- Start with assigned, recently changed code. Look for tangled control flow,
  misleading names, duplication and wrappers without a demonstrated purpose.
- Retain useful conceptual helpers, platform constraints and measured performance.
  Leave already clear code alone.
- Make small, independently reviewable edits. Keep unrelated refactoring out
  of a repair; compare before/after and run relevant tests, lint and build.
  Changing expected behavior to make tests pass is not simplification.

## Arcadia routing and boundaries

Planner proposes a smaller implementation without dropping acceptance. Plan
critic tests that proposal; code reviewer flags concrete complexity read-only.
One authorized implementer changes the assigned candidate. A supervisor routes
observed complexity to these existing responsibilities within remaining allowance;
no extra agent or automatic launch is required. Use indexed PR/custody procedures.
Hacker recovery establishes a working repair route first; cosmetic cleanup must
not delay a stop-the-line fix. Broader cleanup needs its own authorized scope.

Establish the baseline before editing. Where coverage misses a relevant boundary,
add a focused characterization test first. Retain security regressions and review
the final head. If an edit fails a check, isolate or undo only that edit without
resetting retained work. Hand back the concrete readability benefit, unchanged
behavior evidence, checks and any deferred cleanup with a revival trigger.

## Semantic traps: examples are not automatic rewrites

Removing an `async` wrapper can change a synchronous throw into a caller-visible
throw instead of a rejected promise, and alter promise identity. Replacing an
object accumulator with `Map` changes the returned type and key semantics.
Prove the caller contract before either rewrite; a shorter example alone is no
proof. Fixing unsafe output handling deliberately changes behavior and remains
a bug repair, with failing regressions, rather than a behavior-preserving refactor.
