---
id: predicate-scoped-to-project-instead-of-object
cost: 25
fix: this PR (waiting is tied to the active Plan's own entries; unknown when it cannot be tied)
status: practice
---
'The active Plan waits on the operator' was computed from any attention entry in the Project, so an unrelated open Decision unlocked a second concurrent Plan. A predicate about an object must be computed from that object's own data; when it cannot be tied, the answer is unknown, and unknown must fail closed.
