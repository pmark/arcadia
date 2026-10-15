# Operating Arcadia’s autonomous production path

Arcadia’s managed production worker can admit an approved Action, launch its coding Session, preserve the candidate and advance work under a bounded policy. The operator owns the production switch and any approval the current policy leaves outside the grant. The intended direction is less relay between Actions, while keeping approval boundaries visible. A fixture run, a successful preview, or the word “Active” alone does not prove the current host is ready or that a real Project has completed autonomously.

## Orient before deciding

Start with the checked-in control records: read `PROJECT.md`’s `active_plan` and `current_action`, then the named Plan and relevant Decisions. These establish what work is authorized and where it stands; an Issue, dashboard or queue is a signal or projection. For current runtime facts, inspect `arcadia production status` and the broker status, plus the latest run receipt and evidence. Status reports current state; it does not grant authority or diagnose every gap.

Then read [`managed-production-readiness.md`](managed-production-readiness.md), its refresh date and the run evidence it cites. It is a dated assessment, not a live monitor. The rehearsal runbook and older readiness sections preserve historical results; compare their host, source revision, provider, Project, scope and date before reusing any conclusion. For example, nine Actions completed in a disposable fixture is useful integration evidence, but it does not prove an Action completed on Arcadia’s own repository.

## Make a scoped go/no-go decision

1. Check the active Plan’s next Action and dependencies. Confirm it is ready and within the intended Project, Plan and ordered Action scope.
2. Check `production status` for the active state, revision, live admissions, alerts and saved configuration. A saved configuration is not active permission. If the service state or evidence is unclear, stop and resolve that uncertainty before launch.
3. Review a fresh production preview for the exact provider, scope, concurrency and preservation choice. Read the fingerprint and every listed transition. A preview is a no-write description of what activation would allow; it does not activate production.
4. Review the current Decisions and readiness gaps against that preview. A grant covers only its displayed scope and delegated mechanics. Remote preservation, when explicitly included, permits candidate branch push and a draft PR; it does not by itself ready or merge that PR. Integration or review grants are separate. Production activation remains the operator’s decision.
5. If activation is appropriate, use the supported CLI/card flow shown by the current operator guide and pin it to the preview revision and fingerprint. Watch status and run evidence against the expected stages. Stop production when the run should admit no more work, then verify Off and reconcile any work already admitted.

The exact options and required transitions evolve, so use the current [managed-production CLI guide in `START_HERE.md`](../START_HERE.md#managed-production-the-standing-authorization) and the CLI’s current preview output. Do not copy a command or fingerprint from an old runbook. Production activation is itself an explicit operator decision: a native session, a prepared candidate or a ready preview cannot activate it.

## Read evidence at the right level

Separate **fixture proof**, **candidate proof**, **installed-host proof**, and **live Project proof**. A hermetic test can show the worker handles a simulated launch failure. A reviewed candidate proves what that revision does. Installation and service status show what code is running. Only a current run receipt and its stage evidence show what happened under a particular live grant. Keep those claims separate when reporting progress.

For a pull request, require an independent review of the exact head, all required checks green on that head, and a clean merge state before any merge permitted by Decisions 0060 and 0080. A push normally resets that proof. A PR touching agent authority or carrying an important Decision waits for the operator. None of these review gates authorizes production, credential use, spend, publication or deployment.

## Sources to keep open

- [Managed production readiness](managed-production-readiness.md) — dated assessment and evidence limits.
- [Autonomous production rehearsal runbook](autonomous-production-rehearsal-runbook.md) — historical fixture procedure and run evidence; not authority.
- [Active production Plan](plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md) — current Actions and acceptance criteria.
- [Production strategy](strategy/autonomous-production-strategy.md) — direction and explicitly unbuilt goals.
- [Managed production in `START_HERE.md`](../START_HERE.md#managed-production-the-standing-authorization) — current CLI orientation and status commands.
- [Pull-request gates](agent-guidance/pull-requests.md) — exact-head review, CI and merge conditions.
- [Decisions 0060 and 0080](decisions/0060-settle-whether-constitution-md-s-rule-do-not-merge-without-an-explicit-decision.md) — bounded merge gate; read with the current Constitution and PR procedure.
