# Loopback port broker prototype (Issue #2521, option A of #2519)

Status: prototype, not wired into pre-acceptance. Production stays on the
`completion_loopback_denied` hold from #2520.

Goal: a named test that starts its own loopback server passes pre-acceptance,
while candidate code still cannot reach host services on localhost (dashboard,
Intelligence API, LiteLLM).

## What Seatbelt can express (checked with `sandbox-exec` on macOS 26)

| Attempt | Result |
| --- | --- |
| `(allow network-bind (local ip "localhost:*"))` + inbound + `(remote ip "localhost:*")` | Own server works, but every host loopback service is reachable. Rejected: this is the hole #2519 closed. |
| Port range `localhost:58000-58010` | Profile syntax error (`invalid port in network address`). Only one number or `*`. |
| One concrete port per filter, several filters per rule | Works. This is the mechanism used. |
| Allow bind only (no inbound/outbound) | `listen` still fails EPERM: bind, inbound and outbound are all needed. |
| "Ports a process in this sandbox bound" | Not expressible. Seatbelt decides at `bind(2)`, before the kernel assigns an ephemeral port, and profiles cannot change after launch. |

So `listen(0)` can never be allowed "for the port that results".

## Mechanism

`src/sessions/loopbackPortBroker.ts`:

1. The broker (host side, per run) reserves a pool of concrete free loopback
   ports (`allocateLoopbackPortPool`).
2. `loopbackProfileClauses(pool)` is the only text added to the confinement
   profile: bind, inbound and outbound on `localhost:<pool port>`. No wildcard.
3. A `NODE_OPTIONS=--require` shim maps `listen(0)` (and host-less listens) onto
   the pool on 127.0.0.1, retrying the next pool port on `EADDRINUSE` so
   concurrent test workers share the pool.

The isolation guarantee is the kernel's (Seatbelt). The shim is convenience, not
a boundary: bypassing it only yields EPERM.

## Proven by `tests/loopback-port-broker.test.ts`

Run unsandboxed on a macOS host (Seatbelt cannot nest; the suite skips where it
cannot apply a profile).

- Control: the existing deny-default profile alone gives `listen EPERM`.
- A confined child binds a pool port and connects to it.
- Two servers in one child get distinct pool ports.
- The same child connecting to a decoy server on a random host port gets EPERM,
  and the decoy sees zero connections; the decoy is reachable outside.
- An explicit bind outside the pool gets EPERM.
- The added profile text is only the three network rules on pool ports.

## Known limits

- Pool race: a host service that starts later on a pool port becomes reachable
  from the sandbox. Mitigation: a small pool of random ephemeral ports checked
  free at allocation; the exposure window is the run. A real rollout should hold
  the ports (a host-side placeholder is not possible, the sandbox must bind
  them) or re-verify before and after the run.
- Node-only shim. Non-Node processes that bind port 0 still get EPERM.
- `localhost` name resolution under `deny default` is not covered; use 127.0.0.1.
- Seatbelt accepts only `*` or `localhost` as the host (`127.0.0.1:PORT` and
  `ip4` forms are profile errors), so no tighter filter exists. Verified on the
  host: with the appended rules a confined process CAN bind `0.0.0.0:<pool port>`
  and `[::]:<pool port>` (a LAN-reachable listener) and `::1:<pool port>`, and
  can connect out to a pool port on `::1`. Only 127.0.0.2 and non-pool ports are
  denied. Consequence for the pool race: a host service that comes up on a pool
  port on any address, `[::1]` included, is reachable; the exposure is pool ports
  on all local addresses, not IPv4 loopback only. The shim forces 127.0.0.1 for
  its own listens but is not a boundary.
- The pool is opaque: only pools issued by `allocateLoopbackPortPool` are
  accepted, so a host service port cannot be written into the profile.
- Tests that fix a literal port (for example 3020) are denied unless that port
  is in the pool, which is deliberately never done for host service ports.
- Pool size bounds the number of simultaneous listeners (default 16).
