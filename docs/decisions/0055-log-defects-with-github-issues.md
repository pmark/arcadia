---
arcadia: v1
type: decision
id: "0055"
slug: log-defects-with-github-issues
project: arcadia
status: approved
question: Where do Arcadia and its managed Projects log code-level defects, and how do those Issues relate to governed work?
gap_type: missing-definition
recommendation: GitHub Issues are the intake for code-level defects across Arcadia and every managed Project; an actionable defect is promoted to a governed Action via Agent Ask and the Issue is closed when that work merges; Issues are never treated as work-state truth.
confidence: high
updated: 2026-09-16
answer: "GitHub Issues are the Way's intake for code-level defects in Arcadia and every managed Project. One defect, one Issue, in the repository that owns the wrong code, with observed evidence and exact file:line. An Issue is a signal, never work state: when a defect becomes work it is promoted to a governed Action through an Agent Ask that references the Issue, and the Issue is closed when that work merges. The agent that finds a defect captures it and continues; a defect that passes the Stop-the-line blast-radius test is promoted as governed work instead. No separate local defect script."
decided: 2026-09-16
---

# Decision 0055: Log Defects With Github Issues

## Context

Where do Arcadia and its managed Projects log code-level defects, and how do those Issues relate to governed work?

## Resolution

Open.
