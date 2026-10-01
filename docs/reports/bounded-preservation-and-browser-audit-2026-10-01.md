# Protected preservation and browser-audit repair evidence

The operator requested an isolated repair of #848 first, then #847. This is
stop-the-line repair work for the unattended managed-production milestone,
not completion of `limit-sessions-per-provider-account`. Its scope was previewed
through Agent Ask `repair-preservation-browser-boundaries-2026-10-01`.
No Project/Plan pointer, PPN candidate file, claim, production policy or installed
permission profile was manually changed by this repair.

The initial worktree HEAD `fb8ee4b10` already included local-main integration
and canonical settlement history that remote main did not yet contain. The first version of PR #858
therefore included inherited changes to `PROJECT.md`, Decision 0057 and
the bootstrap Plan: the pointer targets `limit-sessions-per-provider-account`,
and Decision 0057 keeps the two-Action proof dispatchable. This repair did not
write or reverse those records. Their provenance is the initial local history,
including `6beb51ef6`, `eb4309523` and `e5ccdd2cf`; those records were called out for review. Main subsequently gained the same
records through PR #856; this reconciled PR leaves them unchanged. The pointer transition was
written by `arcadia advance queue make-next --apply`, receipt
`qpointer_8d0d526f7631442f94`, in operator-authored commit `e5ccdd2cf`. It
did not claim the unfinished proof was complete.

## #848: bounded claimed execution

The retained real-host PPN receipt contains three passing Node 22.23.1 Seatbelt
checks. The original post-validation stall is not diagnosed by that receipt.
Reinstalling unchanged preservation sources does not demonstrate a repair.

The consumer previously called synchronous preservation on the worker thread.
The repaired consumer runs the same host-owned writer and real validator in a
supervised child, transfers claim ownership to its PID, and releases only its
own token after terminal handling. Other ticks and heartbeat refreshes remain
serviceable. After PID transfer, a parent crash leaves a live child protected by its claim. The
caller still supplies only a nonce in its registered worktree, never commands,
paths, evidence, flags or authority.

The PR #863 follow-up raises the merged 20-minute attempt ceiling to 22 minutes and 150-second stage ceiling; Git/capture
subprocesses have 30-second native limits. Each declared check keeps its existing
120-second limit. The supervisor kills the attempt's process group on timeout,
waits for exit, retains its last-stage journal, bounded stderr and terminal
result, and returns the stage plus any validation evidence reference. The child
also keeps an append-only event journal. Validation writes partial receipts
before checks and preserves completed check results. Partial receipts do not
authorize preservation. Ordinary refusals preserve their original failure stage
rather than mislabelling it as later cleanup.

Capture now uses nonblocking no-follow descriptors: replacing a tracked regular
file with a FIFO is rejected without waiting for a writer. Git ignores untracked
FIFOs; this is a capture hardening test, not a claim that PPN contained one.
Snapshots, command binding, immutable check definitions, source containment,
reservation/lease guards and commit-trailer recovery remain enforced.

Demonstrated on real macOS fixtures:

- Managed and manual sandbox requests through the **actual installed** named
  profile reach the existing worker, fail bad checks, preserve one local commit,
  replay without another commit, and leave the Action open. The new proof writes
  timestamped receipts rather than replacing earlier proof artifacts.
- A real host Git shim stalls only after a genuine passing Seatbelt receipt.
  The supervisor terminates that process group, returns
  `validation.recheck-snapshot`, retains the passing receipt and leaves the
  fixture candidate files and HEAD intact.
- Real validator refusal, post-validation mutation refusal, source-write denial,
  changed-check denial, binding/refusal budgets and commit replay pass.

The private named-profile proof receipt from this session is retained under
`artifacts/tmp/protected-preservation/fixture-2026-10-01T15-34-37-129Z-15521.json`.
The original PPN diagnostics and recovery bundle remain intact outside this
repository. Their local paths and identifiers are deliberately not copied into
this public report. Installing the reviewed additional diagnostics and making a fresh protected
capture are still required before claiming PPN preservation succeeded.

## #847: measured missing capability, still open

`node scripts/probe-local-browser-audit.mjs` runs a synthetic fixture through
`codex sandbox -P arcadia-unattended --include-managed-config`, with no model,
no permission overrides, an isolated Chrome profile and no real credentials.
The intended server binds only an ephemeral port on 127.0.0.1. The external
probe uses an RFC 5737 documentation-only destination; only EPERM/EACCES count
as denial, never a timeout. The credential probe reads a synthetic `.env`
sentinel, never a real credential. Process execution is bounded to 30 seconds.

Actual installed-profile result on 2026-10-01:

| Requirement | Observed |
| --- | --- |
| Loopback HTTP | EPERM at listen; no server |
| Headless browser | Chrome abort, SIGABRT, including remote-debugging-pipe |
| External socket denial | EPERM |
| Synthetic credential-file denial | EPERM |
| Comparable browser/Lighthouse matrix | Unperformed |

The private receipt is retained under
`artifacts/tmp/local-browser-audit/probe-NuYYMB/receipt.json`. The probe exits 2;
this is failure evidence, not a supported audit route. Preparing an Action or
Session for declared browser measurements now refuses with
`local_browser_audit_unavailable` before new candidate/Session creation.
Existing criteria are conservatively recognized; an explicit
`capability/local-browser-audit` reference removes prose ambiguity. Other
providers' capability is not inferred from Codex's denial.

The proposed boundary choice is committed as Agent Ask
`propose-bounded-host-browser-audit-847-2026-10-01`. Recommendation: prepare an
inactive host-owned static-site audit executor with one disposable loopback
origin, a separate restricted Seatbelt boundary, isolated browser profile,
denied external/private destinations and credentials, bounded execution and
source-bound receipts. Fixture proof and a separate scoped activation grant
must precede use on PPN. Alternative: retain the current denial until native
named-profile support demonstrates every positive and negative requirement.
Neither proposal acceptance nor PR merge activates browser authority.

The relevant [official permission documentation](https://learn.chatgpt.com/docs/permissions)
says domain rules require an active network proxy and distinguishes exact local
targets from broader local/private access. Those configuration fields alone do
not prove Chrome works on this host. No network key was enabled here.

## QA procedure

This is host CLI/worker behavior; no persistent HTTP demo or production endpoint
is provided. The operator procedure is also the end-user procedure.

1. Build the candidate, then run the real boundary proof from an ordinary host
   terminal: `pnpm build` followed by
   `node --import tsx scripts/prove-protected-preservation.ts`.
   Expected: both synthetic preservation scenarios pass through the installed
   named profile; a new timestamped receipt is printed. No real Project is
   activated, completed, published or integrated.
2. Run `ARCADIA_PRESERVATION_HOST_TEST=1 pnpm exec vitest run
   tests/preservation-request-host.test.ts tests/preservation-validation.test.ts
   --maxWorkers 1`.
   Expected: real Seatbelt evidence, bounded post-validation-stall refusal and
   unchanged fixture candidate; partial or failed proof never authorizes a commit.
3. Run `node scripts/probe-local-browser-audit.mjs` on the host.
   Expected on the currently installed profile: exit 2 and retained loopback,
   browser and denial evidence. Exit 0 is permitted only if all four requirements
   are actually met. A new supported route requires its separate Decision and proof.

No operator button is needed for deterministic proof. The boundary choice uses
an exact-proposal operator action; that action opens an unresolved Decision and
never grants browser or production authority. PPN needs a fresh final capture
once preservation transport is installed: its two evidence notes changed after
the previous snapshot. Its accepted mobile layout and verification Action remain
as the operator left them.

## Validation results

The host core/Discord build, dashboard production build, lint, type checking,
operator-script contract and actual named-profile preservation proof passed.
The focused supervisor/browser/launch group passed 46 tests (one opt-in host
case skipped there); the separate real Seatbelt/stalled-process group passed
19 tests. The complete host run passed 2642 tests and skipped 20, with one
pre-existing fixture-path collision in `tests/tidy-command.test.ts:389`.
That test passed in an isolated temporary root. The shared-path defect is
tracked as [#859](https://github.com/pmark/arcadia/issues/859); this report does
not describe the complete host run as green. CI and CodeRabbit are tracked
on [PR #858](https://github.com/pmark/arcadia/pull/858).

CodeRabbit round one identified a valid queue-walk regression in the new browser
preflight: an unavailable fallback stopped later ready work. The guard now skips
that fallback and retains the named refusal for the pointer itself; its real
Git/workspace integration regression passed. The inherited pointer finding was
declined with the original operator transition receipt. All seven GitHub CI
jobs passed on the initial repair head; the updated head will rerun review/CI.

CodeRabbit approved head `54dd0d1eb`, with all seven CI jobs green. The
Decision-opening button additionally has three offline publication-recovery
regressions: an applied receipt without preview-only documents can retry;
changed Decision state and unrelated local history refuse before push. Every
Git/CLI subprocess in those tests is intercepted; the live action was not run.

## Reconciliation with landed PR #856

While this PR was in its final review, main gained PR #856's async transport,
expiry recovery, admission pause and host-only static preview. The candidate
was merged with that base and keeps those contracts, using one supervised
writer with PID-owned claims, retained stage/evidence journals and group-exit
ordering. The PR #863 follow-up makes its total bound 22 minutes, preserving the maximum
ten 120-second validation checks plus two minutes for preservation; the caller
retains the 30-second response margin. Stage and native subprocess bounds remain
150 and 30 seconds. Token cleanup uses a fresh database connection after exit.

The existing host-preview command remains available for an explicit host-owned
static server. It does not demonstrate named-profile headless rendering or a
confined browser executor. The proposed Decision now concerns that remaining
executor; its implementation should reuse the landed preview where possible.
No route was installed or activated on PPN. The reconciled focused group passed
45 tests (two host cases skipped there), and the separate real host group passed
19. A prematurely run named-profile proof used the prior compiled runtime after
lint stopped its rebuild; that invocation failed and is not counted as proof.
The rebuilt named-profile proof passed both scenarios; its receipt is
`artifacts/tmp/protected-preservation/fixture-2026-10-01T16-49-33-996Z-21275.json`.
The separate reconciled worker/transport group passed 85 tests (two skipped).
Failed proof invocations
now retain their synthetic fixtures and a timestamped failure receipt.
