# Field Notes evidence: weekly-big-think

- Type: essay
- Article: docs/articles/2026-11-11-weekly-big-think.md
- Source repository and pinned revision: pmark/arcadia@43ef6dab9
- Cadence window: not a ship note; essay at a genuine milestone (first big think, 2026-11-11, America/Los_Angeles)
- Evidence collection: 2026-11-11 Pacific, from the session notes folder listed under Claims
- Previous verified publication/cutoff: none; no earlier Field Note covers this
- Eligibility: essay at a milestone (first weekly big think ran today and produced a brief); the cadence, big-bets list and two-model picks are proposals and are labelled so in the article
- Decision: [0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md)

## Claims

Sources are held outside the repository in the session notes folder: `big-bets-proposal.md` (BBP), `start-from-plan-design.md` (SPD) and `signal8-log.md` (S8L). Decision 0120 (D0120) and PR #2500 are public.

| ID | Exact factual sentence, summary or number | Pinned public evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | The operator proposed a weekly big think, in which Claude and Codex each pick one bet independently. | BBP L4 (the weekly think), L14–19 (independent sessions) | Proposal |
| C2 | The W1 card met seven refusals or no-go findings; a deterministic check could have found them earlier. | SPD L12 | Design brief's account |
| C3 | The design job started at 12:39 PM Pacific. | S8L 12:39 PM entry | Observed in session log |
| C4 | Its first turn ran on Opus because the start command ignored the model; from the next turn it ran on Fable High. | S8L 12:41 PM and 12:52 PM entries | Observed in session log |
| C5 | The brief describes one command that turns a Plan into a ready start card. | SPD L1, L7, L13 | Design only |
| C6 | The brief has five implementation slices, S1 to S5. | SPD section 8 | Design only |
| C7 | S6 (refresh) is a follow-on slice that follows once one live card exists. | SPD section 8, L170 | Design only; parked layer 2 waits on D2, S6 does not |
| C8 | The brief leaves two decisions open, D1 and D2. | SPD section 7 | Open |
| C9 | An independent critic found two blocking and seven lesser issues; all nine were folded in; this does not prove the design right. | SPD L182 | Critique by a Sonnet plan-critic |
| C10 | The design was previewed as Agent Ask agentask_3b51c166bf47d52943, still proposed. | SPD L174; S8L 12:52 PM entry | Preview; zero Project writes |
| C11 | The launch-rule change was made by a Haiku-tier implementer at low effort, with 66 of 66 tests passing and a light critic PASS. | S8L 8:12 AM entry (Haiku, low effort) and 8:18 AM entry (66/66 tests, light critic PASS) | Observed; one data point |
| C12 | That change merged to main as #2500. | [PR #2500](https://github.com/pmark/arcadia/pull/2500); S8L 10:25 AM entry (merge) and 10:34 AM entry (CI green on 0696677c3) | Observed merge |
| C13 | Signal 8 recorded that light was enough for that change. | S8L 8:18 AM entry | Operator-side judgment recorded in the log |
| C14 | The cadence runs after the weekly allowance resets; Claude and Codex pick independently; a Sonnet comparison puts both picks to the operator as a lettered menu, recommendation first; the file is `docs/big-bets.md`; entries are capture, not authority; each think spends about 5% of that model's weekly allowance. | BBP L7–8, L13–22 | Proposal |
| C15 | The proposal is Agent Ask agentask_2b232759ad92d311b1, still proposed and not accepted. | S8L 12:41 PM entry only (BBP does not contain this ID) | Proposal |
| C16 | The design's timing targets, about two minutes for the checks and about twenty for the replay, are unmeasured. | SPD L97, L181 | Stated targets, not measured |
| C17a | Only the Claude side of the proposed pairing ran; the Codex side did not. | BBP L32 ("on the Claude side only"); no Codex session appears in S8L | Statement in the proposal source |
| C17 | One think has run; it has not been compared with a week without one. | S8L 12:41–12:52 PM entries; BBP L32 | Absence in sources |
| C18 | Whether two independent picks differ usefully, and whether lowest-tier implementation holds quality, is unknown. | No measurement in any source | Absence in sources |
| C19 | The operator makes the pick; Rowan turns a chosen bet into a Plan through an Agent Ask. | BBP L26–27 | Proposal |
| C20 | The design keeps the production press, spend, credentials and every merge gate with the operator, and grants no authority. | SPD L141, L143 (the press may also be Rowan's inside the operator's day approval under Decision 0173) | Design only |
| C21 | Publication follows Decision 0120 only if an independent fact-check finds no blocking issue; the operator can unpublish. | [D0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md) options and rationale | Decision text |
| C22 | Under Decision 0120, nothing is posted to other platforms and no account is created. | D0120 option text | Decision text |
| C23 | No second think has run; `docs/big-bets.md` does not exist yet. | BBP L7 (proposed file); repository has no such file | Checked |
| C24 | The start-from-Plan command is designed, not built; no slice is merged. | SPD L3 ("no code, no PR"); SPD section 8 | Design only |
| C25 | The production press for the next route is pending, and main stays frozen until it happens. | S8L 1:48–1:53 PM entries | Observed as of the log |

## Mechanical checks

- Front matter: title, ISO date, `type: essay`, slug, summary, author, status, receipt path, `not_done: true`, canonical, `channels: [site, rss]`, tags present; status is `approved` after the PASS recorded below.
- Body: about 700 words of prose, within the essay range.
- The canonical URL is the planned public address under the site's posts path; it is not a source claim and is not cited as evidence. Sections: problem, evidence, operator consequence, not done.
- All public links are GitHub URLs or repository-relative paths.

## Independent review

- Reviewer identity and independent lineage: Critic Claudia Swift <critic.claudia.swift@agents.arcadia.local>, Haiku subagent, read-only, without the author's verdict. The author session was escalated from light (Claudia Swift, Haiku) to standard (Claudia Mason, Sonnet) after four light-tier fact-check rounds ended in HOLD.
- Reviewed article and receipt revision: article blob a6fdb13018b4b675d68b3e366e8d2060e01fad63 (full fresh check, round five). The receipt rows were also checked.
- Source revision: pmark/arcadia@43ef6dab9
- Report: summarized here. Rounds one to four were HOLD on wording, unsupported claims, tier labels, missing links and stale citations; each was corrected. Round five found no blocking findings; every article sentence was supported and the Codex side was described as not run.
- Verdict: PASS
- Findings and resolution: the reviewer's non-blocking notes were applied to this receipt (C5, C14, C17a and C20 citations). The article body is unchanged from the reviewed blob except the `status` field, changed from draft to approved after this PASS.

## Delivery handoff

Pending. Destination: the Arcadia Field Notes blog (`https://pmark.github.io/arcadia/posts/weekly-big-think/`) under Decision 0120. Publication needs the site PR merged and GitHub Pages enabled; enabling Pages is an operator step. Notification: one ping to the operator with the verified link after publication. Unpublish: set `status: withdrawn` and merge.
