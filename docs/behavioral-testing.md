# Behavioral testing with operator personas

Arcadia should help people turn intent into results, from first-time app creators to seasoned engineers. Behavioral testing asks whether a person with a particular goal, knowledge and attention can succeed through Arcadia’s normal interface, and whether Arcadia explains what happened when they cannot.

This document records the operator’s intended testing approach, clarified on 2026-10-14. It is a design and evidence framework, not an implemented persona runner, an activated Plan or execution authority. The [Scout initiative](scout/CONTINUE.md) is its first bounded integration probe. Existing Decisions and governed records continue to control each run.

## Personas represent people

A persona is a simulated human operator, not a new canonical agent role. Give it a concrete goal and a consistent background; let it converse naturally, ask questions, misunderstand or stop as that person would. Its submitted approvals are simulated fixture inputs through the authorized route, never real operator authority over production, spending or the repository.

Define only the traits relevant to the journey:

| Trait | Useful variation |
| --- | --- |
| Technical knowledge | Cannot write code; understands software architecture |
| Arcadia familiarity | First visit; experienced operator |
| Attention | Brief check-ins; sustained involvement |
| Communication | Informal or incomplete request; precise acceptance criteria |
| Working style | Needs guided choices; investigates and directs details |

Model capability and effort are separate, recorded execution settings. A capable model may portray a novice; a smaller model may expose limited reasoning or inconsistent instructions. Neither is automatically representative of a human skill level. Keep persona facts stable when comparing models, and vary one setting at a time when diagnosing a difference. Simulated journeys provide hypotheses about usability; actual human testing is needed to validate them.

## Specify behavior and judge observable results

Use short Given / When / Then scenarios, without requiring a new BDD library. For example:

- **Given** a first-time app creator who cannot write code and checks in briefly,
- **When** they ask for a simple app and answer Arcadia’s guided questions,
- **Then** they receive a usable result or an understandable blocker and next step, without needing unexplained technical procedures.

For an engineer, use the same goal with precise constraints and require Arcadia to preserve those constraints and provide inspectable evidence. Later scenarios may cover ambiguity, interruptions, contradictory answers and recovery; this is proposed coverage, not a claim that those cases already run. Success means meeting the scenario’s observable criteria. A safe, explained refusal can pass a refusal scenario, but cannot count as delivery when delivery was required.

The persona uses only the declared operator surfaces and the knowledge it is given. It must not inspect hidden implementation state, invoke internal workers, edit the requested output itself or rescue the journey through a coding-agent back channel. Approved test setup and approval transport belong outside the persona and are recorded. Measure the interface actually exercised: a CLI journey does not prove a dashboard or mobile journey.

Keep the test customer, delivery agents and evaluator distinct. Canonical Lead, Implementer, Researcher, Code-reviewer and QA retain their existing meanings. An operator-facing advisor can help the real operator prepare scope and Decisions; a separately assigned Lead coordinates bounded delivery. Neither becomes the test customer or acquires the human operator’s approval authority. Supervisor is an assigned duty. Independent evaluation checks output and protected-state evidence rather than trusting the persona’s satisfaction or the implementer’s self-report. Record every rescue intervention; it is evidence of a product gap, not unassisted success.

## The Scout initiative belongs here

Scout is the first minimal operator journey: ask for the exact `HelloWorld.txt` through Ask / Ask show / To-do and observe whether Arcadia delivers it. Its infrastructure repairs, consumer work and budget safeguards support this behavioral probe; they are prerequisites, not themselves proof of operator success. The Scout continuation guide owns current work, PRs, bounds and evidence. This document owns the broader persona-testing concept.

The existing deterministic rehearsal uses fixture inputs and reports source-path behavior without a live persona. The approved live Luna Scout uses a canonical Researcher/customer persona under Decision 0128. A Researcher’s test specialization does not grant execution or approval authority. That special-case model, attempt limit and expiry remain binding until amended through governance. Choosing Opus for an operator-facing advisor or Sonnet for future source preparation does not silently replace the approved customer or runtime repair configuration.

Scout’s delivery oracle requires the exact 13-byte file (`Hello World!` plus LF), the original Ask correlated with a completed Run, a ready/published product Artifact at that path, and independent result/isolation evidence within approved bounds. A passing source test, green CI, queued Run, metadata Artifact or standalone file is insufficient. A local Hello World result does not establish Studio pilot readiness or remote delivery.

## Start small and retain evidence

For each bounded journey, retain one compact scenario and one result using existing checked-in documentation and authorized evidence storage. Include:

- goal, persona traits, allowed interfaces, Given / When / Then criteria;
- source revision, fixture, actual model/effort and approved scope, time/attempt/spend limits;
- interaction transcript, operator questions and interventions, raw output and independent verdict;
- source-validation result, actual journey outcome, defects and the next safe move, reported separately.

No persona matrix, scheduler, service, new role taxonomy or general runner is required to document or finish the current Scout. Reuse standard harnesses and existing commands. Add another scenario when a concrete user journey or observed defect warrants it, through the existing governed work path; consider shared automation only after repeated journeys demonstrate the need. Log defects in their owning repository and preserve unresolved findings with a revival trigger. This approach grants no launch, Production, dispatch, spending or Decision-renewal authority.
