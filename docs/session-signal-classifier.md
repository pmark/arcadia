# Session signal catalog and classifier

`src/production/sessionSignals.ts` classifies one live managed Session into a
closed state set. It is the detection layer that red-alert and stalled-session
recovery Actions build on. It is **pure and deterministic**: no model calls, no
I/O, no clock. It only reads signals another layer already gathered
(`tmux.capturePane`, `observeSessionActivity`, the `agent_sessions` row, git,
the latest `execution_runs` status, the candidate preservation receipt, drafted
`complete` Asks, the PR, and the Action claim). It is not wired into the worker
tick and raises no alerts.

## Pane catalog

`PANE_SIGNAL_CATALOG` is a list of case-insensitive regexes over the last 40
non-blank pane lines (older scrollback is ignored so a recovered Session is not
condemned by a stale message). Each entry names a class, a provider, and an id.

| Class | Meaning | Examples matched |
| --- | --- | --- |
| `permission_prompt` | An interactive approval nobody is answering | Claude "Do you want to proceed?", Codex "Would you like to run the following command?" |
| `auth_failure` | Credentials or scope missing; waiting will not help | `Please run /login`, `401 authentication_error`, `insufficient_scope`, "Resource not accessible by personal access token" |
| `provider_limit` | Rate or usage limit; waiting is the remedy | "usage limit reached", Codex "hit your usage limit", `429 rate_limit_error` |
| `sandbox_denial` | The OS sandbox refused an operation | "Operation not permitted", `EPERM`, `EROFS` |
| `context_exhaustion` | The conversation no longer fits the model window | "Context limit reached", "Prompt is too long", Codex "ran out of room in the model's context window" |
| `command_loop` | The same tool/command line four or more times in a row | `detectRepeatedCommandLoop` (a count, not a single regex) |

## State set and actions

Each state maps to exactly one action (`SESSION_STATE_ACTION`). The set is
closed; adding a member is a contract change.

| State | Action | Decided by |
| --- | --- | --- |
| `completed_merged` | `release_claim` | PR merged |
| `completion_drafted` | `settle_drafted_completion` | drafted `complete` Ask covers every criterion |
| `permission_prompt` | `escalate_approval` | pane |
| `auth_failure` | `escalate_credentials` | pane |
| `provider_limit` | `wait_for_provider_reset` | pane |
| `sandbox_denial` | `escalate_sandbox` | pane |
| `context_exhaustion` | `resume_with_fresh_context` | pane |
| `command_loop` | `interrupt_and_restart` | pane |
| `exited_unpreserved` | `preserve_candidate` | process dead, dirty or ahead of base, not pushed or in a PR |
| `exited_preserved` | `await_pr_review` | process dead, candidate pushed or PR open |
| `exited_failed` | `reconcile_failed_exit` | process dead, no work, non-zero exit or failed Run |
| `exited_clean` | `reconcile_exit` | process dead, no work, clean |
| `stalled` | `recover_stalled_session` | alive and the stall detector flagged it |
| `working` | `none` | alive with recent activity |
| `unobservable` | `observe_again` | no pane capture and no activity observation |

## Precedence

First match wins:

1. PR merged. The work landed; nothing else matters.
2. Drafted completion. A deterministic settlement beats any live symptom.
3. Pane classes, in this order: `permission_prompt`, `auth_failure`,
   `provider_limit`, `sandbox_denial`, `context_exhaustion`, `command_loop`.
4. Process dead, split by preservation and exit status.
5. `stalled`.
6. `working` or `unobservable`.

The rule that matters: **an explained block always outranks a stall.** A Session
waiting on a prompt, a reset window, or a login is silent by design, so pane
classes are evaluated before the stall flag, and `stalled` is reachable only when
no catalog class explains the silence. Within panes, a prompt outranks the
denial that caused it, an auth failure outranks a limit (it needs the operator
now), and a loop is last because it is often a symptom of the others.

Pane blocks also win when the process has already died: the limit or login
failure explains the death. `exited_unpreserved` work is therefore not hidden
in that case; recovery Actions read git and preservation signals themselves.

## Output

```ts
interface SessionClassification {
  state: SessionState;
  action: SessionAction;
  reason: string;       // one line naming the deciding signal
  paneMatches: string[]; // catalog ids that matched, deciding or not
}
```

## Fixtures

`tests/session-signals.test.ts` replays `tests/fixtures/pane-transcripts/*.txt`,
at least one per class plus overlap cases (limit during a loop, sandbox denial
then approval, auth plus limit) and stall-indicator overlaps for every class.

**These fixtures are constructed, not captured.** No recorded live pane
transcripts existed in `artifacts/` or the workspace, so each file is built from
provider output strings as those tools print them. When the worker begins
persisting real pane captures, add them beside these files and extend the table.
