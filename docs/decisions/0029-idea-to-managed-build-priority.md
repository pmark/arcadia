---
arcadia: v1
type: decision
id: "0029"
slug: idea-to-managed-build-priority
project: arcadia
status: approved
question: Should Arcadia prioritize a direct path from a stated software-project idea through governed planning and coding-agent delivery?
answer: Build the direct idea-to-managed-build path now, beginning with project preparation and then closing the accepted-plan-to-build handoff.
recommendation: Reuse the existing intake, managed-document dispatch, planning Artifact, provider-selection, Run, and QA contracts; add only the missing orchestration between them.
confidence: high
decided: 2026-08-20
updated: 2026-08-20
---

# Idea to managed build priority

The operator wants to describe a project idea once and have Arcadia classify
it, plan it, make it dispatchable at the appropriate gates, and manage its
construction with a coding agent.

This Decision changes sequencing, not Arcadia's authority boundaries. Planning
remains read-only and explicitly approved. Coding-agent repository writes need
an exact governed Action and explicit invocation. Merge, deployment, release,
credentials, spending, production access, publishing, deletion, and outbound
communication remain separately gated.

The demo-first delivery plan remains active work but is no longer the current
pointer. It resumes when this vertical slice either reaches managed Candidate
production or exposes a proof/QA dependency already specified there.
