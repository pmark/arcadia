# Way knowledge probe 1: judgment

Judge: separate read-only reviewer. No `arcadia` command run. Paths are relative to the worktree root. Format per line: correct / practical / cited / honest_limit, then cause and evidence for anything short of yes.

Q1: yes / yes / yes / n/a
Q2: partial / yes / yes / yes. Cause retrieval. The answer skipped INSTALL_WITH_A_CODING_AGENT.md, which is the setup walkthrough, and said no single first-time walkthrough was found. It did disclose that it hadn't read it. docs/operating-model.md "Getting started" lists terminal commands, which OPERATOR_CONTEXT.md says the operator should never need.
Q3: yes / yes / yes / n/a
Q4: partial / yes / yes / n/a. Cause retrieval. It omits the one phrase that triggers the proven path ("Create a MartianRover Field Notes blog site") and the setup that follows: an empty GitHub repo, the Project page, and choosing an agent (START_HERE.md "Astro Field Notes staging demo"). That path builds a blog, not a client's website, and the answer does not make this clear.
Q5: yes / yes / yes / n/a
Q6: yes / yes / yes / n/a
Q7: yes / yes / yes / n/a
Q8: yes / yes / yes / yes
Q9: yes / yes / yes / n/a
Q10: yes / yes / yes / n/a
Q11: yes / yes / partial / n/a. Cause answer. The claim "the guide notes there is no budget forecasting yet" is not stated anywhere. docs/arcadia-semantics.md "Token Impact" only says the rating is not a forecast or a dollar quote.
Q12: yes / yes / yes / n/a
Q13: yes / yes / yes / n/a
Q14: yes / yes / yes / n/a
Q15: partial / yes / yes / no. Cause retrieval. It says the material has no one-press stop. scripts/start-run.sh and docs/agent-guidance/operator-actions.md name a STOP button on the Actions page, and docs/managed-production-readiness.md says "STOP remains available". The Off semantics it did give are correct (START_HERE.md "Switch it Off at any time").
Q16: yes / yes / yes / n/a
Q17: yes / yes / yes / n/a
Q18: yes / yes / yes / n/a
Q19: yes / yes / yes / n/a
Q20: yes / yes / yes / n/a
Q21: yes / yes / partial / n/a. Cause answer. It cites docs/agent-guidance/rehearsal-freeze-window.md as "not read in full". It also leaves out the documented freeze-override route, though it correctly says restart refuses while production is Active.
Q22: partial / no / partial / no. Cause retrieval. INSTALL_WITH_A_CODING_AGENT.md Part 2 gives the full existing-repository path: check the repo is under Git (ask the operator if not), import the Project, link the repo, run setup-context, run docket. The answer says details were not found beyond a one-line command. The cited operating-model.md "Getting started" is a thin pointer.
Q23: partial / no / partial / n/a. Cause retrieval. It gives the approval step but not what must happen before it. START_HERE.md "Astro Field Notes staging demo" lists the setup: empty GitHub repo, Project link, URL, choose agent, save, then approve. It also cites the "Stable demo deployment" section as if it covered Project releases, but that section describes Arcadia's own dashboard on port 3030. docs/operator-demo-and-release-contract.md is the right source for Project releases.
Q24: partial / no / yes / yes. Cause guidance_gap. docs/intelligence/COMFYUI_IMAGE_EXECUTOR.md and docs/AGENT_ORIENTATION.md describe the engineering, but nothing tells an operator how to ask for an image in plain words or how it gets attached to a Project. The answer was honest about this.
Q25: yes / yes / yes / yes
Q26: partial / yes / yes / n/a. Cause answer. "Finished managed sessions are preserved automatically on exit" applies only to managed-production Sessions, and without remote preservation the result stays local only (START_HERE.md "Preserve on exit" and "Remote preservation is opt-in"). The wording suggests a crash is safe in general.
Q27: yes / yes / yes / yes
Q28: yes / yes / yes / yes
Q29: partial / yes / yes / n/a. Cause answer. It presents the full flow (sources, comparison, independent critics) as what "design help" does. .agents/skills/arcadia-design/SKILL.md "Choose the depth" says the default is a quick bounded answer with no record, and the full flow runs only when sustained or for a large module.
Q30: yes / yes / yes / n/a

## Totals (30 questions)

- correct: 22 yes, 8 partial, 0 no. Partials are Q2, Q4, Q15, Q22, Q23, Q24, Q26 and Q29.
- practical: 27 yes, 3 no (Q22, Q23, Q24).
- cited: 26 yes, 4 partial (Q11, Q21, Q22, Q23), 0 no.
- honest_limit: 6 yes, 2 no (Q15, Q22), 22 n/a.
- No wrong statement about authority, spending or merging was found. The authority answers (Q9 to Q11) match CONSTITUTION.md and docs/agent-guidance/pull-requests.md.
- Failure causes: retrieval 5 (Q2, Q4, Q15, Q22, Q23), answer 4 (Q11, Q21, Q26, Q29), guidance_gap 1 (Q24), guidance_stale 0, language 0 as a primary cause.
- Language is a secondary weakness. Answers use "worktree", "settle step", "reconciled", "pinned", "head", and Decision numbers without explanation. A first-timer would stumble on Q9, Q10, Q14, Q15, Q16 and Q26.

## Concrete guidance defects

1. There is no operator-facing first-time walkthrough. The setup document INSTALL_WITH_A_CODING_AGENT.md is addressed to the agent, START_HERE.md is 4,000+ lines, and docs/operating-model.md "Getting started" shows terminal commands that OPERATOR_CONTEXT.md says the operator should not need.
2. Three documents give three different commands for adding a Project: docs/operating-model.md uses `project add`, SETUP.md uses `project create`, and INSTALL_WITH_A_CODING_AGENT.md uses `project import` followed by `project metadata` and `project setup-context`. None says which applies to a client Project, or whether client work belongs in a private repository.
3. START_HERE.md names the Production page's Off control but never mentions the Actions-page STOP button. That button appears only in scripts/start-run.sh, docs/agent-guidance/operator-actions.md and docs/managed-production-readiness.md. START_HERE.md also doesn't tell the operator what stops running sessions (docs/managed-production-readiness.md "Bounded lifetime" does).
4. START_HERE.md "Stable demo deployment" describes Arcadia's own demo dashboard, but its title reads like a Project release. Nothing in START_HERE.md routes a first-timer from "deploy a website" to docs/operator-demo-and-release-contract.md. The only walked-through deploy path is the Astro Field Notes blog.
5. docs/arcadia-semantics.md "Concept Model" omits Plan, though Plan is the middle tier the operator sees. Plan is defined only in docs/managed-documents.md.
6. docs/AGENT_ORIENTATION.md says nothing links a generated image to a Project Artifact, and no operator-language path for requesting images exists in START_HERE.md.
7. No guidance gives any cost figure or per-Project spend view (Q25). docs/arcadia-semantics.md "Token Impact" is relative only, and the usage screen in START_HERE.md shows provider limits, not cost per Project. Absence is honest, but the operator question stays unanswered.
8. The Discord "review" channel in START_HERE.md "Where Discord messages land" exists only if the operator configured the category channels. The text doesn't say what the default setup looks like.
