# Detailed Way guidance: standard harness

Read this procedure before its indexed operation. The compact bootstrap and
CONSTITUTION.md still bind; retrieval grants no authority.

This records a design rule and the operator direction behind the Plan
`docs/plans/operator-to-do-list-with-ask-only-input.md` (an inactive draft).
It grants no new authority, activates nothing, and moves no pointer or queue.

## The rule

- **Run the harness unmodified.** A coding agent's standard harness (Claude
  Code, Codex, OpenCode) runs as shipped. Arcadia is its state (checked-in
  records and the workspace), its tools (existing `arcadia` commands) and its
  instruction files. Do not wrap, patch or replace the harness.
- **A new workflow is one instruction file plus existing commands.** Add one
  checked-in instruction file (a skill or an indexed procedure) that names the
  existing commands to run. Do not add orchestration code, a queue service or a
  second runner. If an operation has no command, record a proposal; do not
  build a local substitute.
- **Everything Arcadia needs from the operator is raised through a source
  `arcadia todo` reads** (a Decision, an Agent Ask, a review item, an
  operator-task ledger item, a production escalation). Chat text is not a
  signal. A pending question that no source holds does not exist.
- **Operator input enters through Ask or Ingress.** Direct chat with a coding
  agent is the one input channel this rule does not measure.
- **Judged outputs get a separate grader.** A generator never grades its own
  output. The grader is its own instruction file and call, never receives the
  generator's confidence, and its checked-in golden cases are the contract any
  deterministic replacement must pass.
- **Handoffs go to files.** A handoff is a checked-in file or an Agent Ask,
  never chat.

## Deferred, with revival triggers

Not now. Each item returns only when its trigger is met.

| Deferred | Revival trigger |
|---|---|
| GitHub Issue/Project write-back of to-dos | The operator answers a Decision naming the GitHub scope. |
| Flight Deck consuming the JSON | The Flight Deck board Plan is activated. |
| GitHub comment intake and a capture-only command | Coverage shows comments are material. |
| Direct-chat capture | After the proof's coverage review. |
| Orientation, feedback and capture envelopes | Coverage shows them material. |
| Grader calibration | Five operator corrections disagree with the grader. |
| Proactive push for new blocking items | Blocking items older than 24 hours. |
| Retiring other lists | After the Milestone is measured. |
| Generic query/exec tool | A second operation without a command. |
| Frontmatter schedule registration | A second scheduled instruction file. |
| Harness component-removal review | The first model change in the identity roster. |

Also not now: RBAC or tenant tables, a database swap, an HTTP API, an
orchestrator or queue service, an assignment UI, GitHub write-back, signed
GitHub comments, and new deterministic-tier agents.

## Session protocol (by convention today)

Agents are surrogates for future deterministic processes and decision systems.
Follow this as if enforced. Grammar, windows and classification live in
`docs/agent-guidance/agent-peer-watch.md`; this section does not restate them.

1. **Identity.** One Session per `<project>/<actionId>`. Declare the
   `<agent>/<tier>` from `arcadia identity resolve` in the session title, PR
   comments and commits.
2. **Lease.** Work only from the claim `arcadia go` or the host gave. Takeover
   only by an `arcadia-peer-takeover-request-v1` with basis `claim_released` or
   `principal_proven_terminal`. `release_requested` and silence release nothing.
3. **Reportable states:** `working`, `needs_input`, `handed_off`, `done`
   (a convention here; not parsed by the peer-watch contract).
   `healthy`, `idle` and `stalled` are watcher inferences, never declarations.
4. **Heartbeat.** Hand-write `Arcadia-Agent` and `Arcadia-Action` and, when
   known, `Arcadia-Claim` and `Arcadia-Heartbeat` trailers on every commit, at
   least every 10 minutes while working (windows: see `agent-peer-watch.md`).
   `src/agentWatch/contract.ts` parses them; no launcher adds them yet, so
   agents add them by hand.
5. **Inactivity ping.** Before any turn that leaves supervised or claimed work
   inactive without a PR, picker or completion, run
   `arcadia ping send "<agent/tier> <project>/<actionId> <needs_input|handed_off|blocked>: <reason>; resume: <command>" --kind attention --agent <agent/tier> --link <related Issue URL, else PR>`;
   when neither an Issue nor a PR exists, omit `--link`.
   This is the read-only Decision 0084 nudge: it informs only, asks for and
   approves nothing, and never substitutes for a picker, Decision or Agent Ask.
   If you need an answer, stop at the picker or Ask; the ping only reports that
   you stopped. Keep the message at or under 500 characters; dedup and hourly
   caps apply (`operator-actions.md`, "Pinging the operator").
   Once `arcadia todo` ships, a `needs_input` state is raised through a source
   it reads (an ActionClarification or an Agent Ask). Until then, also stop at
   a picker or Decision.
6. **Handoff** by file or Agent Ask naming agent/tier, claim generation and
   candidate revision. Never chat.
7. **Receipts.** Completion is a complete Agent Ask with per-criterion
   evidence and `candidate_revision`. A PR, green CI or a launched process
   proves nothing.
8. **Honesty.** Report only what you verified; mark LOCAL ONLY and blockers.
