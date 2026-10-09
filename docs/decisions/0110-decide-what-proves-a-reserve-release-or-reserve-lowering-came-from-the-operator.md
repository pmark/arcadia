---
arcadia: v1
type: decision
id: "0110"
slug: decide-what-proves-a-reserve-release-or-reserve-lowering-came-from-the-operator
project: arcadia
status: open
question: Decide what proves a reserve release or reserve lowering came from the operator and not from an agent.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A Discord message from the operator. Arcadia issues a one-time challenge code (expiring within 15 minutes) for a named scope. The operator posts it in the operator channel. The verifier fetches that message live from the Discord API and accepts it only when the author id equals the operator's Discord user id, pinned in checked-in config. It re-fetches each time the release is used
options:
  - label: A Discord message from the operator. Arcadia issues a one-time challenge code (expiring within 15 minutes) for a named scope. The operator posts it in the operator channel. The verifier fetches that message live from the Discord API and accepts it only when the author id equals the operator's Discord user id, pinned in checked-in config. It re-fetches each time the release is used
    consequence: Reuses the existing bot and the phone flow, with no new credential. An agent holding the bot token can read messages but cannot post as the operator, and a forged database row fails the live re-check. Release is unavailable while Discord is unreachable, and the scheme trusts the security of the operator's Discord account.
    recommended: true
  - label: A passkey (WebAuthn) on the operator's phone, signing the challenge, verified against a public key pinned in checked-in config
    consequence: The strongest option, with no third party, and the verifier holds only public data. It needs the dashboard served over HTTPS on the tailnet, a certificate setup only the operator can do, plus new ceremony code.
    recommended: false
  - label: A key readable only by a separate macOS user that runs the verifier service
    consequence: No third party. It needs a new OS account and a sudo install, both operator steps, and adds host operations. It protects only while no agent ever runs as that user.
    recommended: false
  - label: "No operator proof yet: reserve release is protected by convention only, and labelled that way"
    consequence: Cheap now. Any agent can release reserve by running the script or writing a receipt, so the reserve is not protected from agents.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0110: Decide what proves a reserve release or reserve lowering came from the operator and not from an agent.

## Options

- **A Discord message from the operator. Arcadia issues a one-time challenge code (expiring within 15 minutes) for a named scope. The operator posts it in the operator channel. The verifier fetches that message live from the Discord API and accepts it only when the author id equals the operator's Discord user id, pinned in checked-in config. It re-fetches each time the release is used** (recommended): Reuses the existing bot and the phone flow, with no new credential. An agent holding the bot token can read messages but cannot post as the operator, and a forged database row fails the live re-check. Release is unavailable while Discord is unreachable, and the scheme trusts the security of the operator's Discord account.
- **A passkey (WebAuthn) on the operator's phone, signing the challenge, verified against a public key pinned in checked-in config**: The strongest option, with no third party, and the verifier holds only public data. It needs the dashboard served over HTTPS on the tailnet, a certificate setup only the operator can do, plus new ceremony code.
- **A key readable only by a separate macOS user that runs the verifier service**: No third party. It needs a new OS account and a sudo install, both operator steps, and adds host operations. It protects only while no agent ever runs as that user.
- **No operator proof yet: reserve release is protected by convention only, and labelled that way**: Cheap now. Any agent can release reserve by running the script or writing a receipt, so the reserve is not protected from agents.

## Rationale

Verified on main 060f7fd5f: the dashboard has no auth or identity layer and its operator-script route only rejects cross-origin browser requests (apps/dashboard/lib/originGuard.ts). Operator-script receipts and run records are workspace files any agent shell can write. Scripts can be run directly. ARCADIA_OPERATOR_SCRIPT_ID is an environment variable. The protected preservation and go-broker transports carry only nonces, with no operator identity. The Discord bot authorizes by guild and channel only. So no operator-only proof exists. A sound proof must be one no process on this host can manufacture, and that can be re-verified each time the reserve is used. It does not defend against an agent changing Arcadia's installed code; review and the operator-merge gate cover that. Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-operator-presence-proof-2026-10-09.
