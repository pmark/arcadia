---
id: lead-described-live-behaviour-before-verifying-it
cost: 15
fix: this PR (live queue and red-alert readers added and run on the real repo)
status: practice
---
The Lead told the operator the selector would flag the live invalid queue before reading the build: the CLI read only injected JSON. Caught by the Lead reading the Driver's gaps. Rule: describe a command's live behaviour only after running it on the real repo and quoting its output.
