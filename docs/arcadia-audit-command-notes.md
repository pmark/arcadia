# `arcadia audit` design notes

Status: exploratory notes, not an approved implementation Action.

## Job

`arcadia audit` should help an operator or coding agent answer the question that
often follows an enthusiastic AI-assisted build: **what is real, what is left,
and what needs human judgment before this can become a defined release?**

It is a noun command and therefore reads state only. It must not repair files,
rewrite plans, resolve Decisions, start a Run, install dependencies, use
credentials, publish, deploy, or otherwise mutate the audited Project.

## 80/20 report

The smallest useful report should establish:

1. The stated Outcome, current Milestone, current Action, and intended release
   or demonstration target, including where any of those are missing or
   contradictory.
2. What demonstrably works now, bound to stable evidence such as tests, builds,
   runnable URLs, Artifacts, Candidate revisions, and validation receipts.
3. The shortest evidence-backed path from the current state to the target,
   decomposed into bite-sized Actions with observable completion.
4. Decisions, questions, external blockers, credentials, and approvals that
   require the operator, deduplicated and connected to the exact Action they
   block.
5. Work Arcadia or a coding agent can perform without the operator, kept out of
   the operator attention board.

## Attention-board projection

Each operator-only finding should be projectable into the same brief used by
`Needs you`:

- kind: clarification, choice, approval, signoff, credential, or external
  blocker;
- urgency and temporal trigger;
- relevance to the current Outcome, Milestone, release, or demonstration path;
- significance expressed as the Actions and gates the answer unlocks;
- estimated operator attention in minutes;
- immediate and downstream Token Impact;
- recommendation, evidence, uncertainty, and outcome-specific choices;
- the immediate consequence of each choice, including what remains blocked and
  whether any Run or external effect would start.

Ranking must be explainable. An unexplained composite score must not become a
second authority beside checked-in managed documents.

## Deterministic-first evidence

The default audit should prefer repository facts: managed documents, Git state,
pull-request metadata already available to Arcadia, package scripts, test and
build configuration, release metadata, existing validation receipts, Run and
Artifact records, and declared Stable/Candidate proof. Missing or stale evidence
stays visible instead of being filled with model inference.

A future model-assisted interpretation may be useful when the intended Outcome
or release target cannot be determined deterministically. That should be an
explicit, bounded mode whose inferences are labelled and never silently written
back. The trigger for considering it is a real audited Project whose release
gap remains materially ambiguous after deterministic inspection.

## Candidate command shape

The likely first interface is deliberately small:

```sh
arcadia audit --repo /path/to/project
arcadia audit --repo /path/to/project --json
```

The human output should lead with the release gap and the single highest-value
next Action, then the operator attention brief, autonomous work, evidence gaps,
and an audit receipt naming sources inspected and paths deliberately skipped.
JSON should expose the same facts for the Dashboard without creating a parallel
ranking implementation.

## Deferred until triggered

- automatic repairs or plan generation — consider only after operators trust
  the read-only report on at least two materially different repositories;
- customizable scoring — consider only when the visible deterministic ranking
  produces a documented wrong ordering in normal use;
- deep dependency, security, or performance audits — keep separate until one is
  required by a named release target;
- scheduled portfolio audits — consider only after the single-Project command
  proves useful enough that stale evidence becomes a repeated problem.
