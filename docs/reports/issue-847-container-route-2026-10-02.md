# Issue 847: inactive container audit route

Continuation starts at PR #873, `001ee17263b27d5c8c8698c20a6e6d2dc2eb4f03`.
Decision 0078 and the operator's continuation authorize preparation. The
installed named-profile negative evidence remains valid. No installed profile,
dispatch readiness, activation, PPN browser measurement or production changed.

## Image and boundary

The hanging public pull was waiting in `docker-credential-desktop get`.
An empty separate Docker configuration acquired the image anonymously through
the fixed Desktop endpoint. The Dockerfile pins the ARM64 Playwright base;
the npm lock pins Lighthouse 13.4.0 and Playwright Core 1.61.1 with install
scripts disabled. `scripts/browser-audit-image/identity.json` pins the resulting
local image ID; runtime uses it with `--pull never`.

Chromium is 149.0.7827.0, different from PPN's historical Chrome 154 comparison.
A later report must name that non-comparability. Throttling is fixed at
simulated 40 ms RTT, 10,240 Kbps, 4× CPU and DPR 1.

The request accepts only a UUID nonce, with no public arguments or command,
image, URL, mounts, source selector, port, browser flags or receipt destination.
The existing host consumer requires a protected one-shot Grant and its exact
approved canonical Decision. It verifies the packaged executor before consuming
the Grant and invoking the fixed packaged host child. Docker authority remains
entirely on the host. Replay recovers a protected response; interruption requires
receipt inspection and fresh explicit authority, never a silently reset Grant.

Authority binds the Project document at an immutable Git revision, an approved
static-export hash, image and executor hashes, at most four routes, two bounded
viewports, and an absolute expiry within 24 hours. The snapshot hash is the
approved artifact-to-revision binding; this launcher executes no build scripts.

The container has isolated loopback only, no published ports, host home or
Docker socket, and two read-only input mounts. UID 1000, all capabilities
dropped, no new privileges, read-only root, and PID/memory/CPU/scratch limits
bound it. Chromium's inner sandbox is disabled; Docker is the containment
boundary. No Docker/kernel exploit resistance is claimed.

Execution stops at 240 seconds or earlier expiry, with bounded host-command
and cleanup waits. Success requires forced removal and an empty container-list
observation. Timeout captures process groups before removing the entire
container, rather than signalling only the worker group.

## Real synthetic evidence

`artifacts/evidence/issue-847-container-2026-10-02/` retains summary and raw
normal, stalled and broker receipts. Static HTTP and actual Lighthouse reports
pass at 390×844 and 1440×900. External, private and host-gateway TCP return
ENETUNREACH; external browser navigation is denied. A root-owned synthetic
credential returns EACCES; the Docker socket is absent. A deliberate
`setsid sleep 300` has a distinct process group. Timeout after Chromium launch
removes it and every browser process through container removal. Source hashes
stay unchanged. The packaged nonce-only host consumer produces actual reports;
each of Project/revision/image/executor/snapshot/route/viewport/expiry drift
refuses. Synthetic Decision files exist only in temporary proof fixtures and
grant no operator or production authority.

## Operator QA and remaining gate

There is no installed runnable route or externally reachable preview. From the
candidate, build then run `mise exec -- node dist/scripts/prove-container-browser-audit.js`.
HTTP is container-local only; the command prints `ready: true` only when the
normal, timeout, packaged broker and authority-denial proofs pass.

1. Open the summary; every drift denial, timeout, detached-group and source
   identity observation must be true.
2. Open normal and broker receipts; verify actual Lighthouse JSON, version,
   Chromium user agent, authorized routes/viewports and HTTP 200 results.
3. Open the stalled receipt; verify `browser.stall`, distinct process groups,
   timeout and removal. That receipt itself must remain `ready: false`.

The operator procedure is also the end-user procedure. No public or production
URL is involved.

The proposed Grant targets the retained PPN **baseline** static export at
`579878edd09f8274a2f5b9a9e8ac53e4dbc54769`, not the later accepted mobile layout.
Preparation copied and hashed that existing export only; no PPN HTTP preview,
browser navigation or Lighthouse acquisition ran. This scope cannot complete
its release-quality Action. The Arcadia Decision proposal reconciles #847's
named-profile-only wording with the separately approved host substitute.
The Issue remains open, dispatch remains refused, and activation waits for
operator approval of the exact scope after reviewed code installation.


## Canonical handoff

Arcadia settled Agent Ask `activate-scoped-container-audit-847-2026-10-02-v3`
into open, unanswered Decision 0079. It proposes the bounded host alternative
for #847 and the exact preserved-baseline one-shot Grant; it does not answer or
activate either. v1/v2 were previews only and are superseded. The reviewed-scope
expiry is 2026-10-02 18:45 UTC. The prepared approval action checks reviewed code,
protected packaged runtime and the loaded host consumer before authority writes.
It is published to the main `/runs` library but has not been executed.

Worker results are retained independently of response delivery. A response write
retries for five seconds; the same consumed Grant's durable result can be
recovered without re-execution. Failure-receipt errors still attempt a response.
If neither delivery nor durable retention succeeds, the in-flight guard remains
closed for host recovery rather than permitting a new launch.

The protected preservation launcher refused this inherited candidate with
`No active Arcadia Session or manual handoff registers this preservation worktree.`
The PR branch preserves the commits remotely. No registry entry was fabricated
and no unrelated Project pointer was changed.


Merge readiness is conditional on CodeRabbit approval and every required CI job
passing for the **current PR #873 head**, not a revision cited in a historical
Log. The live PR description identifies that head. The published
`merge-container-audit-pr873` action pins it, checks literal exact-head approval,
all seven CI jobs and a clean merge state, and uses `--match-head-commit`.
Merging this preparation does not answer Decision 0079. The separate
`approve-scoped-container-audit-847-2026-10-02` action requires reviewed installed
source/runtime and the current-head gates before approving its one-shot scope.
