# Way knowledge probe 1: answers

Method: read docs/agent-guidance/index.json and .agents/skills/arcadia-relay/SKILL.md first, then targeted rg and bounded reads of START_HERE.md and the docs it points to. Nothing under docs/design/relay/ other than the questions file was read. No arcadia command was run. Paths are relative to the worktree root.

## Q1
Answer: Arcadia is a local-first "project operating system" for one person running several projects with coding agents. Agents forget between sessions; Arcadia keeps what to do next, and why, written in each project's own repository. It works out one next Action, prepares an isolated workspace for a coding agent, records what happened, and brings you only the choices that are yours (approvals, questions). It can also notify you and show status on a dashboard.
Cited: README.md (intro, "Principles"); docs/operating-model.md ("How Arcadia Works", "The commitment...", "The loop"); OPERATOR_CONTEXT.md.

## Q2
Answer: Ask your coding agent: "What matters now, what is blocked, and what should happen next?" (this is addressed to Rowan, the coordinator). Rowan finds context and returns either a result or the exact decision needed. You can also open the Now screen on Mission Control, the dashboard, for the one next move. The checked-in guide gives some first steps as terminal commands (init, project add, docket); the operator context says you should not need a terminal, so ask the agent to run them. Setting up Arcadia from scratch is covered in INSTALL_WITH_A_CODING_AGENT.md, which I did not read.
Cited: START_HERE.md "Your Arcadia colleagues"; START_HERE.md paragraph about the **Now** screen; docs/operating-model.md "Getting started"; OPERATOR_CONTEXT.md ("Device preference"). Partial: no single plain "first-time" walkthrough was found.

## Q3
Answer: A Project is a lasting container for an endeavor (for example a client website), with a mission. A Plan is one initiative inside it, written as a document with a milestone and an ordered list of steps. An Action is the smallest unit of work, one step in a Plan, with a verb, a done-condition and an owner (agent, autonomous, needs your review, or blocked). Each Project points to its active Plan, and the Plan points to the one current Action to do next.
Cited: docs/arcadia-semantics.md "Concept Model", "Project", "Action", "Responsibility"; docs/managed-documents.md "The pointer chain", "Anatomy of a plan document".

## Q4
Answer: Tell your agent the idea and that it is a new software project. Arcadia files it as a Project with a first milestone and a planning Action, and prepares a read-only planning packet. You then get one planning Decision to approve before any agent plans; building needs a separate later approval. If it is only a thought, it can go on the Back Burner instead. Only one narrow path is proven end to end: an Astro "Field Notes" blog site with a staging deploy. Other website stacks are not claimed. Client text should stay out of the public repository.
Cited: START_HERE.md "Start a software Project from an idea", "Astro Field Notes staging demo", "Explicit planning-first preparation"; START_HERE.md "Design something large with Arcadia Design" (client text).

## Q5
Answer: Open Mission Control in your phone's browser at the Tailscale address in the guide. Send a request with the Capture box (text or files), through the workspace page's composer, or by messaging the Discord bot's default channel (the only one that accepts requests). Voice memos and documents can be shared to an iCloud "ArcadiaIngress" folder with the provided Shortcut. Every Send returns a receipt. Arcadia then shows a "Heard:" line you can correct by replying.
Cited: START_HERE.md (Mission Control paragraph near line 240; "Conversational workspace preview"; "Ingress Artifacts"; "Where Discord messages land"; "What Arcadia heard, and fixing it with one reply"); OPERATOR_CONTEXT.md "Device preference".

## Q6
Answer: Ask "what is waiting on me?" or open "Needs you" on Mission Control. The to-do view lists your blocking items first (open Decisions, Ask questions that need one answer, stalled production work), then counts the agent work in flight. A phone channel named "review" in Discord receives every Decision and approval waiting on you. The agent runs the to-do command for you.
Cited: START_HERE.md "What is waiting on you: `arcadia todo`", "Normal daily use", "Where Discord messages land"; .agents/skills/arcadia-relay/SKILL.md (todo as the source).

## Q7
Answer: A Decision is a point that needs your judgment: approving a plan or run, choosing between options, or clarifying a question. An approval Decision offers Approve, Reject, Defer. A clarification Decision asks for your answer in your own words. Answer in the dashboard's "Needs you", or in Discord by replying to the message or posting its number and letter (for example "0141 A"). Free-form text never grants execution authority. A chat "yes" to an agent is not a Decision answer.
Cited: START_HERE.md "Answering Decisions", "Where Discord messages land"; docs/arcadia-semantics.md "Decision"; .agents/skills/arcadia-relay/SKILL.md "Boundary".

## Q8
Answer: Nothing is decided for you. An unanswered Decision stays visible, and the Actions that need it will not be dispatched (the work waits, it is not skipped). Silence never closes an open question. Some pauses also refuse to resume until you answer, so that judgment is not bypassed. The material does not state any automatic expiry or timeout for an ordinary Decision. Defer is refused unless it names the condition that will bring the item back.
Cited: CONSTITUTION.md "Truth" (open questions never closed by silence); docs/managed-documents.md "What is enforced, and where"; START_HERE.md "Normal daily use", "Production scheduling and the GitHub board" (schedule resume refuses while the Decision is unanswered). No explicit statement on timeouts found.

## Q9
Answer: Without asking you, agents can read, plan, work in their own isolated worktree, run checks, open a GitHub Issue, push a branch and open a pull request for requested work, record ideas and lessons, and send proposals or questions to Arcadia (an Agent Ask; it grants nothing). Reversible, previewable work may go further. They cannot deploy, publish, delete, spend, use credentials, access production or send messages without an explicit Decision.
Cited: CONSTITUTION.md "Authority"; AGENTS.md "Routine GitHub delivery", "Ask freely; execution stays governed"; START_HERE.md "Ask an agent for something now".

## Q10
Answer: Merging is normally a hard stop. There is one standing exception: an agent may merge a pull request when an independent review of its current head has no unresolved blocking finding, every required check on that head is green, and the merge is clean. Any new push resets that. Pull requests that raise or answer an important Decision, or change what agents are authorized to do, wait for you.
Cited: CONSTITUTION.md "Authority" (Decisions 0060, 0080); docs/agent-guidance/pull-requests.md "Merge on green".

## Q11
Answer: No. Spending money and using credentials each need an explicit Decision from you, and a more capable model changes nothing. Even production being switched on delegates only mechanics (validation, acceptance, pointer moves), never spending, credentials, deploying, publishing, or messaging. The guide notes there is no budget forecasting yet; it records observed usage and limits.
Cited: CONSTITUTION.md "Authority"; START_HERE.md "Managed production: the standing authorization" (end), "Answering Decisions" (execution profiles paragraph); OPERATOR_CONTEXT.md "Approval boundaries".

## Q12
Answer: Plans pin a model tier (light, standard or heavy) per Action; the tier maps to a concrete model for whichever agent runs it. The default is standard; heavy is reserved for real redesigns. By operator direction, every session starts on the smallest (light) model and can call in a bigger one, with the plan's tier as the escalation target. Arcadia picks the least costly configuration that meets the Action's needs and refuses rather than choosing a weaker one. You can override per request.
Cited: docs/model-selection.md "Coding-agent Action handoff", "Sessions start on the light tier and call in help"; START_HERE.md "Answering Decisions" (execution-profile paragraph); docs/agent-guidance/arcadia-repository.md "Model Selection".

## Q13
Answer: Codex, Claude Code and OpenCode. Codex is the default. Claude Code works for planning and building. OpenCode works for building only (no planning profile) and is ranked last, so it is used when the others are not available.
Cited: START_HERE.md "Answering Decisions" (coding-agent paragraph); docs/model-selection.md (tier table); CLAUDE.md / AGENTS.md references to the three agents.

## Q14
Answer: Production is a permission you grant, and it defaults to Off. You do not type anything: Arcadia prepares a one-press START card for a named Plan and ordered Actions, and you press it from the Actions page (or use the Production page's "Turn production On"). One press installs the pinned reviewed code, activates the Plan, and starts. Before pressing, check what the preview authorizes. Currently production is Off pending a separate START approval, and the first unattended run is recorded as unproved.
Cited: START_HERE.md "Managed production: the standing authorization", Production page paragraph (Turn production On…); docs/agent-guidance/operator-actions.md "Per-run START cards"; docs/managed-production-readiness.md; AGENTS.md "Standing unattended-production directive"; docs/autonomous-production-operator-guide.md.

## Q15
Answer: Switch production Off (the Production page's "Turn production Off…", or ask your agent). Off stops new work being admitted at once and fences work not yet launched. It does not kill anything already running: that keeps going and is reconciled, and nothing is deleted. The guide says "Pause all" and per-session Pause are not available yet. So there is no one-press hard stop of running sessions in the material.
Cited: START_HERE.md "Managed production: the standing authorization" ("Switch it Off at any time"); START_HERE.md Production page paragraph ("Pause all is shown disabled").

## Q16
Answer: An Ask is what you send: a request or idea, via chat, the Capture box, Discord or Ingress. Arcadia routes it into an Action, a question to you, or the Back Burner. An Agent Ask is what a coding agent sends: a proposal, question, concern or request to change Project records. A preview stores a receipt and changes nothing; changing governed documents goes through a later settle step. Neither one approves or executes anything by itself.
Cited: START_HERE.md "Where an Ask goes: `ask.routing.v2`", "Agent Ask v1"; docs/agent-guidance/agent-asks.md "Ask freely without interrupting current work", "Asking Arcadia to change Project state"; AGENTS.md "Ask freely; execution stays governed".

## Q17
Answer: Ask your agent to trace it. Arcadia keeps an immutable receipt for every Send, and an "ask-trail" lookup shows how the request was classified and every Action, Decision, Back Burner item and Run it produced. An unplaced request is never silently shelved: it becomes a question in your to-do. If the "Heard:" line was wrong, reply to correct it. A partial receipt must never be taken as proof that nothing happened.
Cited: START_HERE.md "Back Burner" section ("To find out what any Ask became..."), "What is waiting on you", "What Arcadia heard, and fixing it with one reply", "Ingress Artifacts" (receipts).

## Q18
Answer: Open the Plan's Journey view, which compares the last 1, 7 or 30 days with the previous period. For a to-do-style list (done, current, next five, blocked with reasons), ask your agent for the Plan's progress. The workspace page also shows each Plan and Action with a plain-language title, why it exists and what "done" means. "Done" means the recorded status, not re-proven acceptance. Journey notes that zeros mean no qualifying record, not that nothing happened.
Cited: START_HERE.md "Daily evidence in Journey", "Conversational workspace preview", "Project continuation" (arcadia plans --plan paragraph).

## Q19
Answer: Usually nothing from you: the agent that pushed the pull request owns a red check and is expected to read the failing log, fix the cause, push and re-watch, with one rerun allowed for a suspected flake. It must never weaken or skip tests. If it hits a real blocker (needs credentials, spend, an outside service down, or three failed repairs), it comments on the PR and notifies you on Discord with the step that would unblock it.
Cited: docs/agent-guidance/pull-requests.md "CI failures are fixed immediately".

## Q20
Answer: A shelf for ideas worth keeping that are not yet work. Ideas can be tagged to a Project or left unscoped, and may carry a revival condition (a date, an Action reaching a status, or a small named check). A fired condition only makes the item visible. Nothing is dispatched or promoted automatically. Only you can promote one into an Action.
Cited: docs/back-burner-guide.md (opening and "The two choices to make"); START_HERE.md Back Burner paragraph (`ask --back-burner`, `back-burner list --fired yes`, `promote`).

## Q21
Answer: Ask your coding agent to "check or restart all Arcadia services". It runs the managed restart script. It refuses while managed production is Active, so production must be turned Off first. The dashboard, worker, Intelligence service and Discord adapter start by themselves after you sign in. Under heavy machine load the restart can fail and needs a retry. The agent reports any outage.
Cited: START_HERE.md "Automatic local services"; docs/agent-guidance/pull-requests.md "Merge on green" (restart under load); docs/agent-guidance/rehearsal-freeze-window.md (indexed trigger, not read in full).

## Q22
Answer: Tell the agent to add the repository as a Project. Registration is a one-line step. For a new software Project, the preparation path first needs the folder to be its own Git repository with one baseline commit, and refuses nested or non-Git folders. It then creates the Project, first Milestone and planning Action, plus one planning Decision for you to approve. For an existing repository, the agent installs the Way bootstrap into it. Details of registering an existing repository were not found beyond the one-line command.
Cited: docs/operating-model.md "Getting started" (`project add`); START_HERE.md "Explicit planning-first preparation", "Compact agent instructions" (`project setup-context`); docs/managed-documents.md "Where the chain comes from in a new repository". Partial.

## Q23
Answer: Deploying always needs your explicit Decision. The only built end-to-end path is the Astro "Field Notes" site: you approve its Decision and Arcadia builds and deploys one Cloudflare Workers staging copy and reports the live staging link. That approval does not cover pushing to GitHub, merging, production deployment, a custom domain, or publication. Cloudflare sign-in and the site-generator skill must already be in place; otherwise it fails with a clear error. A Project's stable demo release is a separate step that also needs a Decision.
Cited: START_HERE.md "Astro Field Notes staging demo", "Stable demo deployment"; CONSTITUTION.md "Authority"; docs/operator-demo-and-release-contract.md.

## Q24
Answer: Yes, in the built parts. Arcadia's Intelligence service generates and edits images locally through ComfyUI (FLUX), and there is also a Codex image path, plus speech and narration. Results are stored as Artifacts. The image backend must be started before use. How an operator asks for it in plain language, and how a generated image is attached to a Project, is not explained. The orientation notes say nothing links a generated image to a Project Artifact today.
Cited: START_HERE.md "Automatic local services"; docs/intelligence/COMFYUI_IMAGE_EXECUTOR.md "Requests"; docs/AGENT_ORIENTATION.md "Two different Artifact concepts". Partial.

## Q25
Answer: The material gives no dollar figure. It gives the method: use cheap steps first (scripts, then local models, then frontier models, then you). Sessions start on the smallest model. Each plan states its token impact (None to Extra Large) and how model use is bounded. Paid spending itself needs your Decision. A usage screen shows recorded usage and provider limits.
Cited: CONSTITUTION.md "Economy"; docs/arcadia-semantics.md "Token Impact"; docs/model-selection.md; START_HERE.md "Answering Decisions" (Intelligence screen). Cost per project not answerable.

## Q26
Answer: Work lives in Git on a branch in its own worktree, and the Project's records live in its repository; Arcadia's database is a projection. It is safe only once committed and pushed. The monitor labels work UNSAVED, LOCAL ONLY, PUSHED, IN PR or LANDED; the first two can still be lost. Agents must push committed work and open or update a PR before stopping. Finished managed sessions are preserved automatically on exit. Cleanup quarantines worktrees and branches recoverably.
Cited: docs/working-copy-safety.md "The safety states"; START_HERE.md "Protect active coding work", "Preserve on exit...", "What stays recoverable"; AGENTS.md "Preservation"; docs/managed-documents.md "The one rule that explains the rest".

## Q27
Answer: Discord yes: its adapter handles capture and status, and delivers notifications, the morning briefing, and Decision prompts. Replies there can answer Decisions and correct what Arcadia heard (only for your allowed user). Slack is not mentioned anywhere I searched, so I cannot say whether it works.
Cited: START_HERE.md "Where Discord messages land", "Quick pings from an agent", "Automatic local services", "What Arcadia heard..."; OPERATOR_CONTEXT.md. Partial for Slack.

## Q28
Answer: Not answered by the material. What I found: messages that arrive through Discord or Ingress are treated as signals, not as your instruction, until Arcadia can verify the sender. Sending any message on your behalf needs a Decision. Delivering to a client is a separate recorded step needing your authorization. The material describes no channel for a client to message Arcadia directly.
Cited: START_HERE.md "Ask an agent for something now"; docs/operator-demo-and-release-contract.md (client delivery); CONSTITUTION.md "Authority". Not answered.

## Q29
Answer: Ask for "design help", "critique this design" or "keep a design brief". Arcadia Design confirms the outcome with you, keeps sources, compares them, checks them against the real code, brings you only the choices that are yours, and has independent critics try to break the result. It then hands you Agent Ask previews to approve; nothing gets built or approved by the design itself. "Get a second opinion" gets a separate independent adviser.
Cited: START_HERE.md "Design something large with Arcadia Design", "Get advice without assembling the team"; .agents/skills/arcadia-design/SKILL.md; docs/agent-guidance/consultation.md.

## Q30
Answer: Tell the agent to capture it. It records your exact words as a lesson in that Project's scope with no model call. Capture is evidence, not authority. Before similar work, agents search retained lessons and the Project's notes, and recurring problems are meant to become a code fix, test or guard. A single capture does not change rules or approve anything.
Cited: docs/agent-guidance/learning.md; START_HERE.md "Compact agent instructions"; AGENTS.md "Mandatory retrieval"; .agents/skills/arcadia-relay/SKILL.md "What the simulation teaches".
