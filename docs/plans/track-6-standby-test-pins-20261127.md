---
arcadia: v1
type: plan
slug: track-6-standby-test-pins-20261127
project: arcadia
status: active
milestone: Track 6 standby test pins 20261127
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-28
actions:
  - id: pin-orientation-urgency-score
    title: Pin how a Life-ledger entry's continuous urgency score is computed from its priority and due date, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-orientation-urgency-score-5a376a615cc2; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-orientation-urgency-score
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127
    why: "computeOrientationUrgencyScore (src/orientation/urgency.ts:23-36) scores each live Life-ledger entry for Mission Control, the activity report and fit (missionControl.ts:99, report.ts:300, fit.ts:96), and no test file names it, so its base scores and lead-window bonus are pinned only indirectly."
    acceptance_criteria:
      - "tests/pin-orientation-urgency-score.test.ts is a new test file that imports computeOrientationUrgencyScore from ../src/orientation/urgency.js (lines 8-13 and 23-36, with APPROACHING_LEAD_DAYS at staleness.ts:12-17) and, with now set to 2026-11-27T12:00:00.000Z, asserts it returns exactly 0.75, 0.55, 0.35 and 0.15 for critical, high, normal and low entries with dueAt null, 0.35 for a normal entry due 2026-12-07T12:00:00.000Z (ten days out, beyond its three-day lead) and 0.55 for a high entry due 2026-12-04T12:00:00.000Z (exactly its seven-day lead)."
      - "The same test file asserts, to 10 decimal places, that it returns 0.675 for a high entry due 2026-12-01T00:00:00.000Z, 0.875 for a critical entry due 2026-12-04T12:00:00.000Z and 0.275 for a low entry due 2026-11-28T00:00:00.000Z, and that it returns exactly 1 for a normal entry due at now itself and for a low entry due 2026-11-01T00:00:00.000Z (overdue)."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-orientation-urgency-score.test.ts, a new test file of at most 50 lines that imports only vitest and src/orientation/urgency.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/orientation/urgency.ts", "tests/pin-orientation-urgency-score.test.ts"]
  - id: pin-scout-clock-validity
    title: Pin which clock samples Scout admission accepts as proof of boot and monotonic clock continuity, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-scout-clock-validity-f5524ed97c58; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-scout-clock-validity
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127
    why: "validScoutClock (src/scout/admissionClock.ts:52-57) decides whether a Scout admission clock sample is trusted (runAdmission.ts:200, 218; admissionClock.ts:60), and no test file names it, so its kind, uncertainty and 250 ms span rules are pinned only via Scout admission flows."
    acceptance_criteria:
      - "tests/pin-scout-clock-validity.test.ts is a new test file that imports validScoutClock and the ScoutClockSample type from ../src/scout/admissionClock.js (lines 6-14 and 52-57) and asserts it is true for the scripted-fixture sample with bootId boot-a, wallMs 1000, monoStartMs 5, monoEndMs 5, uptimeMs 5 and uncertaintyMs 0, for that sample with wallMs, monoStartMs, monoEndMs and uptimeMs all 0, and for the host sample with bootId darwin:1:2, wallMs 1000, monoStartMs 100, monoEndMs 350 (a 250 ms span), uptimeMs 9000 and uncertaintyMs 1000."
      - The same test file asserts it is false for that host sample with monoEndMs 351 or with uncertaintyMs 0, for that fixture sample with monoEndMs 4 (before monoStartMs), with uncertaintyMs 1000, with bootId of three spaces, with kind "other", with wallMs -1, with uptimeMs NaN or with wallMs Infinity, and false for null.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-scout-clock-validity.test.ts, a new test file of at most 50 lines that imports only vitest and src/scout/admissionClock.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/scout/admissionClock.ts", "tests/pin-scout-clock-validity.test.ts"]
  - id: pin-intelligence-resource-group
    title: Pin which scheduler resource group each Intelligence route competes for, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-intelligence-resource-group-10e1d11c02e6; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-intelligence-resource-group
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127
    why: "resolveIntelligenceResourceGroup (src/intelligence/jobs/resourceGroup.ts:7-20) picks the concurrency pool each Intelligence job is admitted to (intelligence/jobs/worker.ts:594), and no test file names it, so its executor-first order and image-prefix split are pinned only via worker flows."
    acceptance_criteria:
      - tests/pin-intelligence-resource-group.test.ts is a new test file that imports resolveIntelligenceResourceGroup from ../src/intelligence/jobs/resourceGroup.js (lines 7-20) and, for routes given only executor, location and capability, asserts it returns "codex-cli" for executor codex-cli at location local, "claude-code-cli" for executor claude-code-cli at location cloud, "comfyui" for executor comfyui at location local, and "speech-local" and "speech-cloud" for executor speech at location local and at location cloud.
      - The same test file asserts that for executor litellm it returns "litellm-local" at location local even with capability image.generate, "litellm-cloud-image" at location cloud with capability image.edit, and "litellm-cloud-text" at location cloud with capability text.generate and with capability imagegen (no dot after image).
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-intelligence-resource-group.test.ts, a new test file of at most 50 lines that imports only vitest and src/intelligence/jobs/resourceGroup.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/intelligence/jobs/resourceGroup.ts", "tests/pin-intelligence-resource-group.test.ts"]
  - id: pin-direction-target-parsing
    title: Pin which Direction targets and Direction correlations are accepted, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-direction-target-parsing-550fdca9bf05; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-direction-target-parsing
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127
    why: "parseDirectionTarget and parseDirectionCorrelation (src/ask/directions.ts:34-50) check a captured Direction's target (directions.ts:60) and an Agent Ask's direction correlation (agentAsk.ts:190), and no test file names either, so their key, slug and fingerprint rules are pinned only via capture."
    acceptance_criteria:
      - "tests/pin-direction-target-parsing.test.ts is a new test file that imports parseDirectionTarget and parseDirectionCorrelation from ../src/ask/directions.js (lines 34-50) and asserts parseDirectionTarget returns { projectId: \"arcadia\" } for { projectId: \" arcadia \" } and returns that same object for { projectId: \"arcadia\", plan: \"track-6\", action: \"pin-x1\" }, throws \"Direction target must be an object.\" for null, for [] and for the string \"arcadia\", and throws \"Direction target requires an explicit Project and, for an Action, its Plan.\" for { projectId: \"a\", action: \"x\" }, { projectId: \"  \" }, { projectId: \"a\", plan: \"Bad_Plan\" } and { projectId: \"a\", extra: 1 }."
      - "The same test file asserts parseDirectionCorrelation returns an object equal to its input for { requestId: \"r1\", fingerprint: 64 lowercase a characters, messageId: \"m1\", consumptionReceiptId: \"c1\", acknowledgmentReceiptId: \"k1\" }, and throws \"Direction correlation must pin request, fingerprint, message and receiver receipt IDs.\" for that object with the fingerprint as 64 uppercase A characters, with an extra sixth key, with messageId \" \", and for null."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-direction-target-parsing.test.ts, a new test file of at most 50 lines that imports only vitest and src/ask/directions.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/ask/directions.ts", "tests/pin-direction-target-parsing.test.ts"]
  - id: pin-allowed-value-assertion
    title: Pin how a value is checked against a fixed list of allowed values, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-allowed-value-assertion-937974aa676d; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-allowed-value-assertion
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127
    why: "assertAllowedValue (src/domain/constants.ts:132-140) checks enum values such as Project status, work classification and executor type before a write (repositories.ts:163, registries.ts:128-136, setup.ts:56), and no test file names it, so its exact-match rule and wording are pinned indirectly."
    acceptance_criteria:
      - tests/pin-allowed-value-assertion.test.ts is a new test file that imports assertAllowedValue from ../src/domain/constants.js (lines 132-140) and asserts it does not throw for label Status with value "open" or value "done" and the allowed list ["open", "done"].
      - "The same test file asserts it throws an Error whose message is exactly \"Status must be one of: open, done\" for the values \"Open\", \" open\", \"\" and \"closed\" with that label and list, and an Error whose message is exactly \"Kind must be one of: \" for label Kind, value \"x\" and an empty allowed list."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-allowed-value-assertion.test.ts, a new test file of at most 50 lines that imports only vitest and src/domain/constants.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/domain/constants.ts", "tests/pin-allowed-value-assertion.test.ts"]
  - id: pin-enrollment-request-identity
    title: Pin how a protected enrollment request's identities and mode are read from an environment, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-enrollment-request-identity-5ffc8edd85f5; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-enrollment-request-identity
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127
    why: "resolveEnrollmentRequestIdentity and resolveEnrollmentRequestMode (src/sessions/enrollmentRequestProtocol.ts:17-45) name the replay identity and mode of an enrollment request (preservationTransport.ts:311-312), and no test file names either, so their variable order and bounds are pinned indirectly."
    acceptance_criteria:
      - "tests/pin-enrollment-request-identity.test.ts is a new test file that imports resolveEnrollmentRequestIdentity and resolveEnrollmentRequestMode from ../src/sessions/enrollmentRequestProtocol.js (lines 14-45) and, passing an explicit environment object every time, asserts resolveEnrollmentRequestIdentity returns { requestId: \"enroll:claude:abcd1234\", callerId: \"claude:abcd1234\" } for agent claude with CLAUDE_SESSION_ID abcd1234, { requestId: \"enroll:codex:thread-77\", callerId: \"codex:thread-77\" } for agent codex with only CODEX_THREAD_ID thread-77, { requestId: \"enroll:opencode:rt-000001\", callerId: \"opencode:rt-000001\" } for agent opencode with ARCADIA_ENROLLMENT_RUNTIME_ID rt-000001 and OPENCODE_SESSION_ID ignored1, and { requestId: \"request-0001\", callerId: \"caller-0001\" } for agent claude with ARCADIA_ENROLLMENT_REQUEST_ID request-0001 and ARCADIA_ENROLLMENT_CALLER_ID caller-0001."
      - The same test file asserts resolveEnrollmentRequestIdentity throws "Protected enrollment requires stable host-observable request and caller identities." for agent claude with an empty environment, for agent claude with only CODEX_SESSION_ID abcd1234, for agent codex with ARCADIA_ENROLLMENT_REQUEST_ID request-0001 and ARCADIA_ENROLLMENT_CALLER_ID short, and for agent codex with CODEX_SESSION_ID "has space"; and that resolveEnrollmentRequestMode returns "prepare" for an empty environment and for ARCADIA_ENROLLMENT_MODE of three spaces, "managed-launch" for " managed-launch ", "native-adopt" for native-adopt, and throws "Unknown enrollment mode." for launch.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-enrollment-request-identity.test.ts, a new test file of at most 50 lines that imports only vitest and src/sessions/enrollmentRequestProtocol.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/sessions/enrollmentRequestProtocol.ts", "tests/pin-enrollment-request-identity.test.ts"]
  - id: pin-back-burner-surface-checks
    title: Pin how a Back Burner item's manual, date and predicate surface conditions are judged without a database read, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how a Back Burner item's manual, date and predicate surface conditions are judged without a database read, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-back-burner-surface-checks
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127
    why: "evaluateBackBurnerSurface (src/backBurner/surfacing.ts:36-76, 85-101) decides when a parked Back Burner item surfaces again (repositories.ts:1993), and no test file names it, so its manual, date and unknown-predicate outcomes and warnings are pinned only via repository flows."
    acceptance_criteria:
      - "tests/pin-back-burner-surface-checks.test.ts is a new test file that imports evaluateBackBurnerSurface from ../src/backBurner/surfacing.js (lines 36-101), passes an empty object as the database (none of these cases reads it) and now 2026-11-27T12:00:00.000Z, and asserts it returns { condition: { kind: \"manual\" }, fired: false, warning: null } for surface_kind null and for surface_kind manual, { condition: { kind: \"date\", date: \"2026-11-20\" }, fired: true, warning: null } for surface_kind date with surface_date 2026-11-20, and the same shape with date \"2026-12-05\" and fired false for surface_date 2026-12-05."
      - "The same test file asserts it returns fired false, warning \"Invalid surface date: 2026-02-30\" and condition { kind: \"date\", date: \"2026-02-30\" } for surface_date 2026-02-30; fired false, warning \"Invalid surface date: \" and condition { kind: \"date\", date: \"\" } for surface_kind date with surface_date null; and fired false, warning \"Unknown surface predicate: no-such-check\" and condition { kind: \"predicate\", name: \"no-such-check\" } for surface_kind predicate with surface_predicate no-such-check."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-back-burner-surface-checks.test.ts, a new test file of at most 50 lines that imports only vitest and src/backBurner/surfacing.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/backBurner/surfacing.ts", "tests/pin-back-burner-surface-checks.test.ts"]
  - id: pin-intelligence-requirement-checks
    title: Pin which Intelligence request requirements are accepted before a job is queued, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which Intelligence request requirements are accepted before a job is queued, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-intelligence-requirement-checks
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127
    why: "validateRequirements (src/intelligence/validation/validateRequirements.ts:18-50) refuses unsupported requirements before an Intelligence job is queued (jobService.ts:58), and no test file names it, so its image-size, transparency and structured-output rules are pinned only indirectly."
    acceptance_criteria:
      - tests/pin-intelligence-requirement-checks.test.ts is a new test file that imports validateRequirements from ../src/intelligence/validation/validateRequirements.js (lines 8 and 18-50) and, for requests given only capability and requirements, asserts it returns undefined for capability text.generate with no requirements, text.generate with structuredOutput true, image.generate with imageSize 1024x1024, transparency false and structuredOutput false, and image.edit with imageSize 1024x1024.
      - "The same test file asserts it returns 'requirements.structuredOutput is not supported for capability \"image.edit\".' for image.edit with structuredOutput true, 'requirements.imageSize is only supported for image capabilities, not \"text.generate\".' for text.generate with imageSize 1024x1024, 'requirements.imageSize \"512x512\" is not supported. Supported sizes: 1024x1024.' for image.generate with imageSize 512x512, 'requirements.transparency is only supported for image capabilities, not \"text.generate\".' for text.generate with transparency false, and 'requirements.transparency: true is not supported yet. Only \"false\" is accepted.' for image.generate with transparency true."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-intelligence-requirement-checks.test.ts, a new test file of at most 50 lines that imports only vitest and src/intelligence/validation/validateRequirements.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/intelligence/validation/validateRequirements.ts", "tests/pin-intelligence-requirement-checks.test.ts"]
questions: []
decisions: []
current_action: pin-back-burner-surface-checks
recommended_model: heavy
recommended_reasoning_effort: high
---

# Track 6 standby test pins 20261127

Created as an inactive draft from accepted Agent Ask rowan-g11-plan-track-6-standby-test-pins-20261127; creation changed no pointer. Current activation is recorded in frontmatter.
