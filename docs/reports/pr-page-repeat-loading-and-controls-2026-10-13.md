# PR page repeat loading and TLDR controls

Operator-directed request: “The PR page still is very slow to load every time. The TLDR and read aloud features are missing”. Existing intake Issues #1339 and #1340; no governed Action applies. Active Plan and queue unchanged.

## Behavior and evidence

Return visits/reloads restore the last displayed inventory from session storage after hydration, mark it stale, and check the server. A 24-hour maximum age bounds reuse. Initial visits still need the repository scan. Explicit Refresh still forces scanning; display memory grants no merge authority.

Visible cards read existing matching TLDRs automatically using GET; inference remains explicit. Generate TLDR and Play TLDR are visible immediately, with playback disabled until a completed matching summary exists. Offscreen cards do not eagerly load sources. The source deadline is 65 seconds instead of 20, covering the observed 22.62-second lookup.

Localhost lab measurements before change: inventory request 34,290 ms; warm request 372 ms with the same checked-at timestamp. Chrome trace: LCP 736 ms, TTFB 380 ms, CLS 0.00. These are local lab observations, not phone or production-ready candidate proof.

Live PR #1337 summary was blocked (LITELLM_UNAVAILABLE). A fresh explicit local-only TLDR test for #1362 also blocked: job ijob_2a0e0a9c262b4dda89. Local Intelligence and LiteLLM health were reachable. Safe backend log diagnosis identified oMLX prefill memory guard refusal: estimated peak 9.86 GB (current 9.25 GB plus 627.84 MB KV/SDPA) exceeded dynamic ceiling 8.89 GB. LiteLLM then raised a TypeError while handling that error and returned HTTP 500. No memory-limit change, credential use, paid fallback, service restart, or exhausted-job reset was performed. Successful generation/MP3 proof remains blocked on local backend capacity; revive #1340 when that backend accepts the prompt.

## Validation

Implementer: six focused files, 29 tests passed; touched-file ESLint, core TypeScript, dashboard build, and git diff --check passed. Lead replays focused checks before PR review. First candidate build lacked package exports; core TypeScript generated the prerequisite and the dashboard build then passed. One redundant test assertion lint failure was repaired. Live candidate/phone playback is not claimed.

## Retrieved guidance

CONSTITUTION.md; PROJECT.md and exact todo-actions-render-cards Action; .arcadia/AGENT_CONTEXT_POLICY.md, repo-context.md, context-policy.json; docs/agent-guidance/index.json; continuation, operator-directed-work, learning, principles, native-app-sessions, session-roles-and-briefs, git-identity, pull-requests, operator-actions and rehearsal-freeze-window procedures; relevant Arcadia repository Orientation/Semantics/PR QA/Working-Copy sections; docs/AGENT_ORIENTATION.md Intelligence section; targeted notes-to-self cache/dashboard/timeout entries; arcadia-guardrail, arcadia-role and web-perf skills. Work monitor was rerun before edits. No other candidate was modified.

## Independent review R1 and repair

R1 on 99322225c976af5747edf5e6f1f0e8c1db89abf4 found one blocking P2: array-container checks admitted null cards and invalid dates from session storage, causing page crashes before network recovery. Lead reproduced the null-card failure. The implementer added field validation against the existing Dashboard type contract. Twenty-one adversarial cases failed before repair and pass afterward. Final focused replay: six files / 50 tests; delta ESLint, dashboard build and diff integrity passed. A real 13-card API fixture remains readable as stale display data. R2 exact-head review and CI follow. Primary reflog remained unchanged during R1.

Loaded instruction sizes (UTF-8 bytes; current candidate): CONSTITUTION.md: 3320, PROJECT.md: 31542, docs/agent-guidance/index.json: 7623, docs/agent-guidance/pull-requests.md: 17585, docs/agent-guidance/native-app-sessions.md: 8101, docs/agent-guidance/session-roles-and-briefs.md: 5343, docs/agent-guidance/git-identity.md: 5248, docs/agent-guidance/operator-directed-work.md: 4494, .agents/skills/arcadia-role/SKILL.md: 7277, .agents/skills/arcadia-guardrail/SKILL.md: 5565.
