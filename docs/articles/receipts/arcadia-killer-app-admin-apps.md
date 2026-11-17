# Field Notes evidence: arcadia-killer-app-admin-apps

- Type: essay (technical writer, Clara). Operator-suggested idea, tested against the repository.
- Article: [2026-11-14-arcadia-killer-app-admin-apps.md](../2026-11-14-arcadia-killer-app-admin-apps.md)
- Source repository and revision checked: `pmark/arcadia` at `origin/main` 4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2, read on November 17, 2026 (America/Los_Angeles) by the independent reviewer.
- Decision: [0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md); [0165](../../decisions/0165-may-decision-0120-s-automatic-field-notes-publication-use-the-arcadia-field.md) adds the GitHub Pages blog as a destination.
- Release status: `status: draft` (held). The article passed an independent fact-check and was set to approved on the operator's chat words of November 17, 2026 ("Clara's essay only"), but it was merged (and briefly published) before the critic had reviewed it, and the critic recommended keeping it internal. The operator later directed that Field Notes publish only what the critic approves. Field Notes publishes only articles the critic approves (the `## Editorial review` gate in `site/stage.mjs`). To publish it, record a critic APPROVE under `## Editorial review` and set `status: approved` in a reviewed change.

## Claims

| ID | Claim | Evidence on the revision above | Result and limits |
| --- | --- | --- | --- |
| C1 | The idea comes from the operator; it is not written down as a goal in the repository. | Assignment text; absence found by searching for "admin app", "administration app", "admin site", "back-office" and "killer app" | Verified for the search terms used; attribution rests on the assignment |
| C2 | The dashboard has `/todo`, `/actions`, `/production`, review, projects and an `/admin` area (status, pull requests, dispatch journal, Intelligence). | `git ls-tree` of `apps/dashboard/app` | Verified |
| C3 | The dashboard mostly runs the Arcadia command line. | `docs/AGENT_ORIENTATION.md` lines 33-34 | Verified |
| C4 | Project detail pages open with a state-resolved demo block; for PPN it showed one Stable and one Candidate version with one primary action, verified against a running instance at that time. | `PROJECT.md` lines 122-127; `docs/plans/demo-first-delivery.md` lines 172, 181 | Verified as recorded; not re-run. The essay says "Checked, in part": one piece of an admin app, not a full one |
| C5 | Operator-only steps are bounded scripts and buttons; a button grants no authority. | `AGENTS.md` line 126; `docs/agent-guidance/operator-actions.md` line 11 | Verified |
| C6 | The operator never needs to touch the host; every step needs a remote surface (a page, a button, a Discord reply or a pull request merge). | `docs/agent-guidance/operator-actions.md` lines 13-24 | Verified |
| C7 | The Relay design brief names its audience: operators who design, build and deploy websites, apps and media for themselves and clients. | `docs/design/relay/brief.md` lines 21-24 | Verified |
| C8 | Relay is not built; unattended production is the first priority and Relay's first-timer onboarding is deferred behind it. | `docs/agent-guidance/relay-mode.md` line 6; `AGENTS.md` lines 15, 43-45; `docs/design/relay/brief.md` lines 11-12, 19 | Verified |
| C9 | The only admin app found in this repository is the dashboard. | `apps/dashboard` | Verified for this repository; a proposal (`docs/proposals/site-copy-and-seo-capability-modules.md` lines 154-156) says PPN's site studio renders a Nagel SEO report; the PPN repository was not inspected |
| C10 | The project detail page and its demo block already serve more than one project; no generator or schema for new admin screens was found. | `PROJECT.md` lines 122-123; `apps/dashboard/app/projects/[id]/page.tsx`; `src/proofTargets/targets.ts`; `src/proofTargets/hero.ts`; `config/defaults/template-registry.json` (a blog template only) | Verified as a design claim; the repository shows PPN as the only worked instance; absence is bounded to this repository |
| C11 | No Decision authorizes agents to build or deploy such an app for a live service; credentials, deployment and spending each need a Decision. | Bodies of all 254 files in `docs/decisions` searched for admin app, administration app, admin site, back-office, studio, site-studio, keystatic and client dashboard; `AGENTS.md` lines 93-94 | Verified as a bounded search; no authorizing Decision found |
| C12 | The Mission Log mentions PPN and Nagel verification work. | `MISSION_LOG.md` line 1356 | Verified for the mention |
| C13 | No other operator is known to have been asked or to have tested the idea. | None in the repository | Not verifiable from the repository; the essay states it as "I know of no other operator ... not recorded in the repository" and "not proved" |
| C14 | The proposals (several things to run, the same few screens, records and gates behind the screens, read freely and change only through governed actions, Relay as the way to ask) are opinion. | `AGENTS.md` lines 93-94 for the authority rule | Labelled 📐 Proposed in the essay; no factual claim |

## Not checked

- PPN's site studio (`site-studio/nagel/seo-report.astro`, in the PPN repository) and the Arcadia Studio article were not inspected.
- No live dashboard page was opened; C2 is from the file tree.
- The absence claims (C1, C9, C10, C11) are bounded to this repository and the search terms listed.

## Independent review

- Reviewer: a separate read-only Claude Code subagent (Sonnet 5.5, role fact-checker), not the author and not Flynn; it checked every sentence against `origin/main` 4c2cb0ee34b8918b4197f9a3189e57c1bb228ef2 and did not take the author's draft receipt on trust.
- Round 1: FAIL. It found four wrong or overstated sentences (the dashboard "does not keep its own data", "Relay is deferred", "Done: the pattern is proven once", "exactly one such app") and two unverifiable ones. The author corrected all of them.
- Round 2: PASS after one word change ("proposal" to "article" in the last "What is not done" bullet). The author applied exactly that change.
- Findings: no remaining unverified sentence; the links, canonical URL and front matter are fine; no email address, local path, tailnet host or credential in the article.
- Verdict: PASS
