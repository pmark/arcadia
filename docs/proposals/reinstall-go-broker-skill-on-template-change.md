---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia detect when the installed arcadia-go skill (and its sibling brokers) has drifted from the checked-in template, instead of relying on someone remembering to run `go-broker install` after every template change merges?
---

# A merged skill-template change silently did nothing until reinstalled

## The evidence

PR pmark/arcadia#246 edited `src/agentSetup/arcadia-go.SKILL.md` to make
`arcadia advance` print the dispatch brief and rename the session. It merged
clean, CI passed, and the next real `arcadia go` session showed neither
behavior: no brief, no rename.

The change never took effect because `arcadia-go.SKILL.md` is a template, not
the artifact an agent reads. The installed skill lives at
`~/.codex/skills/arcadia-go/SKILL.md` (with `~/.claude/skills/arcadia-go`
symlinked to it), and that file is only rewritten by explicitly running
`pnpm arcadia go-broker install`. Nothing in the merge, in CI, or in the PR
process ran that command. The stale copy — installed August 5, before this
change existed — kept serving every session between merge and manual
discovery.

Diagnosing this cost a full round trip: the operator ran a real `arcadia go`
session, watched the expected behavior not happen, and reported it back
before anyone thought to check whether the installed copy matched the
checked-in template. `go-broker status` (which already exists and checks
several other drift conditions) did not catch this because it does not
compare the installed skill's content against the source template's content —
only presence and the managed-marker byte string.

## Why this project needs it

1. **Every future skill-template edit has the same silent-failure shape.**
   `arcadia-go.SKILL.md` is one of at least two managed skill templates
   (`arcadia-agent-ask` shares the mechanism). Any edit to either one behaves
   correctly in review and in the source tree, and does nothing in practice
   until someone remembers a manual step that nothing prompts them to take.
2. **The cost is invisible until it is expensive.** A stale skill does not
   error — it just keeps running the old instructions, which reads as "no
   change happened" rather than "the mechanism to apply the change was
   skipped." That is a worse failure mode than a loud one, because there is
   no natural moment where anyone is prompted to check.
3. **The existing drift check almost covers this and doesn't.** `go-broker
   status` already reports the installed skill's presence and revision
   pinning (per `docs/memory` on broker-revision drift, this has bitten this
   project before in the other direction — an installed broker silently
   lagging HEAD). Extending the same status check to content-diff the
   installed skill against the current template closes this specific gap
   with a mechanism the project has already decided to build.

## What we would build locally

A script that reads the installed `SKILL.md`, re-renders the checked-in
template with the same placeholder substitution `go-broker install` already
uses, and diffs the two — failing CI or a pre-commit hook when they disagree.
That is exactly the machinery `go-broker install`/`status` already contains
(`renderManagedSkill` in `src/agentSetup/goBrokerAgentSetup.ts`); building a
second, project-local copy of it to run at commit time is the reinvention
this proposal exists to avoid.

## What would make this answerable

1. Should `go-broker status` (already run by the arcadia-go skill itself,
   per its own workflow) compare the installed skill's content against the
   current source template and report drift, not just presence/markers?
2. Should merging a PR that touches a managed skill template (detectable by
   path, e.g. `src/agentSetup/*.SKILL.md`) require or automatically trigger
   `go-broker install` as part of that PR's own merge/completion evidence,
   the same way other generated-artifact drift is treated as a blocking
   check elsewhere in this repo?
3. Is host-side reinstall (this machine's `~/.codex`, `~/.claude`, `~/.local`)
   even the right permanent shape, or does this argue for the skill being
   read directly from the repository at session start instead of a
   host-global copy that can drift per machine?
