---
arcadia: v1
type: decision
id: "0031"
slug: obsidian-architecture-maps
project: arcadia
status: approved
question: How should Arcadia create and update interactive linked software-architecture maps for every managed Project without requiring paid model use?
answer: Use a versioned architecture manifest checked into each Project repository and a preview-first deterministic Arcadia projector into `Projects/<project-slug>/` in the configured Obsidian vault; permit only an explicit, separately labelled local-AI enrichment with no cloud fallback.
recommendation: Insert the implementation into demo-first-delivery now, preserve repository documentation and code as authority, keep generated maps outside Arcadia's existing Records and Ideas namespaces, install the mind-map viewer once per vault, and restore the displaced idea-to-managed-build pointer after dogfood proof.
confidence: high
decided: 2026-08-20
updated: 2026-08-20
---

# Obsidian architecture maps

The operator wants software concerns to be navigable as interactive, linked
mind maps in Arcadia's existing Obsidian memory vault. The capability must work
for every Arcadia-managed software Project and must participate in the same
managed-document, dispatch, validation, QA, and continuation process as other
Arcadia work.

The repository manifest is authoritative for the projection because Arcadia
cannot truthfully infer arbitrary Project semantics from filenames alone. The
normal sync path is entirely deterministic and makes zero model calls. An
explicit local-only enrichment may interpret a bounded set of declared source
files, but it is labelled as AI output, cannot alter the manifest or base maps,
and cannot fall back to a cloud provider.

Generated Project maps live under `Projects/<project-slug>/`, outside
`Arcadia/Records/` and `Arcadia/Ideas/`. Mindmap NextGen is installed once in a
vault and is never downloaded or upgraded by routine synchronization. Obsidian
transclusions provide a readable embedded index; pinned plugin panes provide
the reliable interactive side-by-side view.

This Decision also resolves sequencing. The work is inserted into
`demo-first-delivery` ahead of `make-test-action-state-aware`. The currently
dispatchable `idea-to-managed-build/promote-accepted-plan` Action is paused
without changing its status and is restored as the sole pointer after the
architecture-map dogfood Action is accepted.
