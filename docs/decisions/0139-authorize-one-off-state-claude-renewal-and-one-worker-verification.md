---
arcadia: v1
type: decision
id: "0139"
slug: authorize-one-off-state-claude-renewal-and-one-worker-verification
project: arcadia
status: approved
question: Authorize one Off-state Claude renewal and one worker verification?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Authorize one Off-state Claude renewal and one worker verification
options:
  - label: Authorize one Off-state Claude renewal and one worker verification
    consequence: "Authorize ONE bounded Off-state ClaudeCLI renewal using reviewed compiledrelease13e9f3fcf82a849e09fe8356b3ab281510905e1c exported runClaudeCliHeadless with the fixed CLAUDE_CLI_SELF_REFRESH_ARGS: Haiku, one turn, reply onlyok, no tools/MCP/slashcommands/user settings/hooks/session persistence, stdinclosed, privateemptycwd, allowlistedfixedenvironment with no APIkey/injectedOAuth/baseURL/cloudcredentials. Only installed /opt/homebrew/Caskroom/claude-code/2.1.292/claude SHA256 97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f. The CLI may refresh/rotate/store its own sign-in and consumes a small amount of included usage, never an APIkey/paidfallback. Bound60seconds, timeout kills directchild only, descendant termination notproved; preserve failure and do not retry. ConcurrentinteractiveClaude refresh could interfere with that login; sharedCLIhandling is not proved interference-free. Pin Off79/epoch44/zero, noactiveRun/Session and fresh exactworker50950/instancebddb5c6b-3e8b-4bdf-bfb0-eb8f82ab1478/release13e9/handlere9ad3733b88e4997c896c66835b4e8ec292f65ce1ac7591cfe8095623a5143ba. Renewal entry expires2026-10-25T22:30UTC. Consume a durableone-shot marker before any effect. CLI failure stops withoutverification. OnCLIexit0, archive ONLY exacthashedterminal0138 nonce2d1436fa-7362-433b-a25a-1fe2affa4077 request then grant viaexclusivehardlink+fsync/removalofoldnames; preserve everyoldattempt/receipt/Decision and unknownstate. Exit0alone isnot credentialreadiness. Authorize creation, canonicalsettlement/answer and normalnonforcepublication of thisapproval and ONEnecessary subsequent exactdiagnosticDecision0140: compute a freshnonce/five-minuteexpiry onlyafterrenewal/preparation, bindsameworker/release/handler/Off79/44/zero, atmostone existingcredentialusage-helper/fetchinitiation tofixedinitialAnthropicusageendpoint with existingautomaticredirects (additionalHTTPrequests/destinationspossible), no tokenrefreshinthatdiagnostic, deadline30seconds, at least60seconds remaining. Exclusivelypublishcomplete0600grant+nonce-onlyrequest afterfreshcanonicalauthority/owner/policy/absencechecks, retain sanitizedactualworkerreceipt. No automaticretry/newnonceafterfailure, attemptreset, packetrepreparation, productionactivation, managedjoblaunch orSTART. This approval covers only thissingle renewal-and-verification sequence and its mechanicalcanonicalrecords; no furtheroperator touch is needed within those exactbounds."
    recommended: true
  - label: Keep credentials unchanged
    consequence: Do not runCLIrenewal, archive terminal metadata ormakeanotherusagecheck. Preserve the expired-credential blocker andproductionOff; no host step is requested.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-10-25
answer: Authorize one Off-state Claude renewal and one worker verification
decided: 2026-10-25
---

# Decision 0139: Authorize one Off-state Claude renewal and one worker verification?

## Options

- **Authorize one Off-state Claude renewal and one worker verification** (recommended): Authorize ONE bounded Off-state ClaudeCLI renewal using reviewed compiledrelease13e9f3fcf82a849e09fe8356b3ab281510905e1c exported runClaudeCliHeadless with the fixed CLAUDE_CLI_SELF_REFRESH_ARGS: Haiku, one turn, reply onlyok, no tools/MCP/slashcommands/user settings/hooks/session persistence, stdinclosed, privateemptycwd, allowlistedfixedenvironment with no APIkey/injectedOAuth/baseURL/cloudcredentials. Only installed /opt/homebrew/Caskroom/claude-code/2.1.292/claude SHA256 97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f. The CLI may refresh/rotate/store its own sign-in and consumes a small amount of included usage, never an APIkey/paidfallback. Bound60seconds, timeout kills directchild only, descendant termination notproved; preserve failure and do not retry. ConcurrentinteractiveClaude refresh could interfere with that login; sharedCLIhandling is not proved interference-free. Pin Off79/epoch44/zero, noactiveRun/Session and fresh exactworker50950/instancebddb5c6b-3e8b-4bdf-bfb0-eb8f82ab1478/release13e9/handlere9ad3733b88e4997c896c66835b4e8ec292f65ce1ac7591cfe8095623a5143ba. Renewal entry expires2026-10-25T22:30UTC. Consume a durableone-shot marker before any effect. CLI failure stops withoutverification. OnCLIexit0, archive ONLY exacthashedterminal0138 nonce2d1436fa-7362-433b-a25a-1fe2affa4077 request then grant viaexclusivehardlink+fsync/removalofoldnames; preserve everyoldattempt/receipt/Decision and unknownstate. Exit0alone isnot credentialreadiness. Authorize creation, canonicalsettlement/answer and normalnonforcepublication of thisapproval and ONEnecessary subsequent exactdiagnosticDecision0140: compute a freshnonce/five-minuteexpiry onlyafterrenewal/preparation, bindsameworker/release/handler/Off79/44/zero, atmostone existingcredentialusage-helper/fetchinitiation tofixedinitialAnthropicusageendpoint with existingautomaticredirects (additionalHTTPrequests/destinationspossible), no tokenrefreshinthatdiagnostic, deadline30seconds, at least60seconds remaining. Exclusivelypublishcomplete0600grant+nonce-onlyrequest afterfreshcanonicalauthority/owner/policy/absencechecks, retain sanitizedactualworkerreceipt. No automaticretry/newnonceafterfailure, attemptreset, packetrepreparation, productionactivation, managedjoblaunch orSTART. This approval covers only thissingle renewal-and-verification sequence and its mechanicalcanonicalrecords; no furtheroperator touch is needed within those exactbounds.
- **Keep credentials unchanged**: Do not runCLIrenewal, archive terminal metadata ormakeanotherusagecheck. Preserve the expired-credential blocker andproductionOff; no host step is requested.

## Rationale

The user explicitly approved replacementusagecheck0138. Its actual owningworker50950 selected an expired Keychain credential and produced credential_expired beforeHTTP; durableattemptconsumed. No retry or renewal was authorized. Decision0131 covers Active401, not this Off-state expired-credential case. This proposes one specific additional approval using an existing reviewed exported helper, not a source change or permanent authority expansion. Production staysOff and separateSTART remains required. Exact reviewed plan and controller hashes are referenced.

Proposed by Agent Ask authorize-one-offstate-renewal-and-worker-verification-20261025.
