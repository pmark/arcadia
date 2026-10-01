# Restricted host browser audit preparation

The operator replied “I don't know, just get it done” to the choice between
preparing an inactive host-owned route and waiting for native named-profile
capability. This candidate takes the recommended preparation route. It does
not grant activation, change the installed `arcadia-unattended` profile, merge
PR #858, touch the accepted PPN candidate, or claim its release audit complete.

Current milestone: bootstrap managed production to run unattended. Work
classification: explicit Issue #847 capability repair, outside the unchanged
`limit-sessions-per-provider-account` pointer. Next action: review this inactive
preparation before a separate source/revision-scoped activation proposal.
Required artifacts: executor/worker, positive and negative host fixture proof,
timeout receipt, regression tests, and the canonical preparation Decision.

## Vital few

Reuse the landed static preview; copy and hash a bounded read-only static-site
snapshot; allow the sandboxed browser only its disposable origin and private
profile IPC; retain observable proof before calling the route available.
There is no new host service, queue path, permission installation, arbitrary
command protocol, or source selector in the CLI. The fixed proof script accepts
no arguments and uses synthetic files only.

The snapshot refuses hidden/credential-like names, symlinks, non-regular files,
oversized input, nested destinations and excessive directory depth/entry count.
File opening refuses symlink following and uses nonblocking mode plus bounded
reads and file-identity checks. Browser code can read the snapshot only through
HTTP; its allowed file-write scope is its own disposable profile directory.

The dedicated policy denies by default. TCP is permitted only to the selected
loopback port. Unix sockets are permitted only inside the disposable profile
directory, because Chrome requires a singleton socket; unrelated sockets are
probed and denied. Node/Playwright package directories and Chrome's application
bundle are resolved read-only runtime inputs, not the whole checkout or home.
The worker inherits a stripped environment and a fresh HOME/TMPDIR.

macOS bootstrap needs a root-directory open for dyld, named font/preferences/
desktop-registration services, Chrome-specific child rendezvous, and the
power-notification IOKit client. These are explicit policy entries, not a
wildcard service or network allowance. Credential-service lookup is not granted.
These platform dependencies require security review before activation; the
fixture proof establishes the tested direct file/socket restrictions, not the
absence of every possible OS-service side channel.

## Actual proof

Run from an ordinary macOS host terminal:

```sh
pnpm build
node --import tsx scripts/prove-host-browser-audit.ts
```

The installed named profile's negative result from PR #858 remains valid. This
proof measures the alternative dedicated host boundary, not a changed named
profile and not a reinstall of the existing broker.

The retained preparation run `artifacts/tmp/host-browser-audit/proof-4ReByk/`
returned `ready: true`, `timeoutProven: true`, and `sourceUnchanged: true`.
The packaged committed-code rerun `proof-vBEdUl/` also returned all three
values true. It validates `node dist/scripts/prove-host-browser-audit.js`,
including the built executor and copied worker.
After retaining the native-child observation, the final packaged run
`proof-Qus42z/` again passed rendering, all six file/socket denials, fixed-worker
timeout cleanup and source identity. Its separate detached-child result is
`denied: false`, preserving the live-activation blocker.

| Observation | Actual result |
| --- | --- |
| Mobile HTTP render, 390 × 844 | HTTP 200, JavaScript rendered marker, screenshot retained |
| Desktop HTTP render, 1440 × 900 | HTTP 200, JavaScript rendered marker, screenshot retained |
| External TCP, documentation-only destination | EPERM |
| Private-network TCP | EPERM |
| Other loopback port | EPERM |
| Unrelated live Unix socket | EPERM |
| Synthetic `.env` outside allowed roots | EPERM |
| External browser navigation | ERR_ACCESS_DENIED |
| Static fixture source | Unchanged |
| Deliberate stall after real Chrome launch | SIGKILL at `browser.fault.stall`; no live group members |
| Native detached child creation | Allowed; not an OS-enforced group-containment boundary |

The worker keeps Chrome in its supervised process group instead of Playwright's
default detached group. The normal budget is 120 seconds, followed by at most
two seconds for pipe shutdown and a bounded process-state observation (at most
20 one-second commands and twenty 50 ms pauses). The deliberate fault uses a
fixed five-second budget. Unavailable group observation or a surviving process
fails readiness. Receipt writes are atomic and include source, executor, worker
and profile hashes, stage, exit/signal, bounded output, child PIDs and actual
group membership. A secondary signal can return EPERM while killed children
are briefly launchd-owned zombies; that error remains recorded and is not
silently equated with successful cleanup.

The additional detached-child probe succeeded even when a prototype denied
`SYS_setsid`/`SYS_setpgid`; that ineffective restriction was removed. The fixed
host-owned worker keeps its actual browser launch in the supervised group and
its real stall proof stops that group. This does not establish containment of
arbitrary or compromised native code that deliberately creates another group.
That negative finding is retained separately from the six passing file/socket
denials. A live route must contain/observe such descendants before activation;
the current fixture `ready` value is not dispatch readiness or that proof.

Earlier failed prototype/proof receipts remain retained. They exposed the
dyld root-open requirement, Chrome's profile/socket and IOKit requirements,
the Playwright module import shape, and the zombie signal race. Neither a
timeout nor ENOENT/connection-refused was accepted as denial proof.

## Remaining boundary

There is no live broker/dispatch integration and no Lighthouse scoring here.
The pre-dispatch refusal remains active. Native descendant containment is an
additional activation blocker. Activation must pin the reviewed code
and policy, exact Project/source revision, allowed routes/viewports, expiry,
and receipt destination, and refuse drift. A separately reviewed host-request
path must preserve this restriction instead of exposing arbitrary URLs,
commands, roots, browser flags, credentials, or network policy to a caller.
Only then can a scoped run measure PPN's comparable four-route Lighthouse
matrix. Its accepted candidate remains
`579878edd09f8274a2f5b9a9e8ac53e4dbc54769`.

Arcadia created open Decision 0078 through the original Ask settlement in this
candidate. Automatic approval review refused recording its recommended answer:
the operator's delegation was not explicit authorization of that exact Decision
answer. Decision 0078 therefore remains open; no answer or activation is claimed.
The old Decision-opening action from PR #858 is not an activation action and
must not be rerun to create a duplicate. Its canonical settlement receipt now
refers to this candidate's open Decision. Production remains outside this
preparation's authority.

The prepared one-shot `/runs` action is
`approve-browser-audit-preparation-0078-2026-10-01`. It pins the open Decision,
original proposal, candidate/code bytes, exact offered answer and expiry;
requires synchronized clean Git and green CI; records only the preparation
answer in PR #863; and can retry only its own retained publication receipt.
It does not merge or activate anything. Eight offline operator-action tests
intercept every Git/GitHub/CLI subprocess; five snapshot/preview tests also pass.
The action itself has not been executed.
