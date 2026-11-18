# Claims receipt: three stalls in an unattended coding-agent run

- Article: `docs/articles/2026-11-17-three-stalls-in-an-unattended-coding-agent-run.md`.
- Source-code revision: `b7460955df088a3786654c3499df944ab64041a9` in the public pmark/arcadia repository. All source file/line references below use that immutable revision.
- Assembly base: `7db079efff63b89fb0d89d3d6f72138337fdf5a2`.
- Article SHA256: `808a08a4932538519b5e5e33e5dc4f1d4240a4d6ba6eafc28a717a9098f6ab35`.
- Body count: 250 words, including headings, excluding front matter.
- Placement: archive, topics, author page and feed; excluded from home by `archive_only: true`.
- Classes: C = checked code, Git history or primary GitHub metadata; A = agent-reported, not independently observed; P = untested proposal. The [source-note excerpts](flynn-three-stalls-source-notes.md) are now publicly inspectable; their underlying host logs are not presented as verified facts.

| ID | Draft sentence | Class | Evidence | Limit |
| --- | --- | --- | --- | --- |
| 1 | Three incidents, one project, one operator, no controlled comparison, no count of non-stalls | C (scope) | The three source posts | A limit, not a result |
| 2 | All three rest on agent-written logs that I did not open; only the merge times and the guard code are checked | C (scope) | Claims 3-10 mark which parts are A and which are C | Replaces the v2 sentence that implied only the first incident rested on a log |
| 3 | Coordinating agent switched production off with an ID beginning .-, pasted from a text-replace flag output; the approval ended early | A | [source note](flynn-three-stalls-source-notes.md#approval-ended-early): C6, C10 (Signal log 11:25 and 11:55 AM); docs/notes-to-self.md:382-386 (agent-written; rg -r is --replace and its printed output was pasted as the id .-plan3-pins-13-15-complete-20261115) | No primary record of the day ending; not reproduced |
| 4 | The check counts any shutdown as a human stop unless it has the coordinator prefix or comes from the approved chain | C | src/operatorActions/startRunDayGrant.ts:68 (ROWAN_OFF_REQUEST) and :539-540 (refuses DAY_ENDED_BY_OPERATOR unless ROWAN_OFF_REQUEST matches or isExecutorOff) | Mechanism only; does not itself show the incident |
| 5 | Since PR 2743 the shutdown command refuses IDs not starting with a letter or digit | C | src/commands/production.ts:127 (WELL_FORMED_REQUEST_ID) and :150 (MALFORMED_REQUEST_ID refusal); merge d2b1f53a3 committed 2026-11-15T21:09:32-08:00; GitHub merged_at 2026-11-16T05:09:33Z (supplied by Rowan); tests/production-deactivate-request-id.test.ts | The guard is in the shutdown command, not in the day-approval check |
| 6 | Fix for failing checks on 2744 committed around 9:30 PM | C | git 158a03248: author 2026-11-15T21:26:08-08:00, committer 21:29:39; GitHub head_sha of 2744 is 158a03248286846a06ab8f916d2784dbdfe993a2 (supplied by Rowan) | Commit time, not push time |
| 7 | Branch showed the fix between 8:50 and 9:40 AM; push time unknown; about 11 to 12 hours | A | [source note](flynn-three-stalls-source-notes.md#repair-waiting-for-a-push) C8 (gh reads 16:50Z and 17:40Z) | Basis: fix commit to the branch showing it; 11 h 21 min to 12 h 11 min from 9:29 PM; a person-wait would start at the ping (9:50 PM, author-side), so up to about 20 min shorter; actor unknown |
| 8 | Logs say a human was pinged and the host blocks agent pushes; unverified | A | [source note](flynn-three-stalls-source-notes.md#repair-waiting-for-a-push) C3, C4 (S13 9:40 and 9:50 PM); C4 states the refusal for 2744 is inferred | Unverified; labelled in the draft |
| 9 | 2745 merged at 12:17 PM | C | git ba3cfe793 12:17:30-08:00; GitHub merged_at 2026-11-16T20:17:31Z (supplied) | |
| 10 | The log reports 2746 conflicted and the watcher kept waiting; a 5:50 PM entry says it was patched to exit on a conflict; about 5 to 5.5 hours by the log | A | [source note](flynn-three-stalls-source-notes.md#watcher-waiting-on-a-conflict) C1-C3 (S13 5:50 PM; the file describes the 16 Nov evening under a 17 Nov name). Duration: 12:17 PM merge to the 5:50 PM entry is 5 h 33 min; the log own figure is 5 h | Watcher and patch not found by me or the earlier critic; scripts/wait-for-event.sh is not shown to be the watcher and is not claimed |
| 11 | Untested suggestion: expiry, owner, never-ready as its own state | P | Nadia method note | Opinion, labelled untested |

## Primary GitHub merge records

- [PR #2743](https://github.com/pmark/arcadia/pull/2743): merged 2026-11-16T05:09:33Z; merge commit `d2b1f53a30c2c748935366329be22950ed1e724f`.
- [PR #2744](https://github.com/pmark/arcadia/pull/2744): merged 2026-11-16T17:46:07Z; merge commit `81dac1198d183a0bb7ac9ac2461a3c41eb39fa36`.
- [PR #2745](https://github.com/pmark/arcadia/pull/2745): merged 2026-11-16T20:17:31Z; merge commit `ba3cfe7931bc22bc57d8f3ad08892b481f12cbbf`.
- [PR #2746](https://github.com/pmark/arcadia/pull/2746): merged 2026-11-17T03:00:06Z; merge commit `494d24cc212d9fb5a80a77d54360298b336d38b5`.
- [PR #2747](https://github.com/pmark/arcadia/pull/2747): merged 2026-11-17T03:35:17Z; merge commit `bd434b702e6e0cd87d11b6dd3bac639747231074`.

## Limits and correction

The event accounts remain agent-reported: the day approval ending early, who pushed the PR #2744 fix, the notification and inferred host push block, the PR #2746 conflict, and the watcher/patch. The article discloses these limits. The [C5 correction](flynn-three-stalls-source-notes.md#correction-to-the-repair-notes-c5) rejects the unsupported 9:15 PM comparison; no original private receipt was silently rewritten.

## Assembly provenance

A separate Nadia critic approved the pre-publication draft (SHA256 `0093758ab2818b1e1c9b16b3153c338fe38be87e705637d78a1a744a6b931abd`) for archive placement. This assembly adds publication metadata, the required What is not done heading and an Incidents heading, and removes the duplicated words Three incidents from the scope paragraph. It changes no incident claim. The assembled prose and public-safe source notes received the independent review below; a subsequent one-line tags normalization received the separately recorded delta approval. No incident claim changed. The final PR head still receives independent review.

## Independent review

- Reviewer: Nadia (Critic Claudia Mason), separate read-only Claude Code process, not the author or assembler. [Full publication-assembly report](flynn-three-stalls-review.md).
- Reviewed article SHA256: `808a08a4932538519b5e5e33e5dc4f1d4240a4d6ba6eafc28a717a9098f6ab35`.
- Scope: code and timing claims checked against the immutable revision and primary-metadata package; all underlying incident accounts remain explicitly agent-reported and unverified. Source-note excerpts compared with originals; no blocking finding.
- Verdict: PASS

## Editorial review

- Critic: Nadia, independent continuation; see the [actual review report](flynn-three-stalls-review.md).
- Editorial verdict: APPROVE; archive-only placement, not home.
- Release authority: direct operator instruction on 2026-11-18 to publish this approved roll-up, within Decisions 0120, 0165 and 0257.
- Unpublish: set the article status to withdrawn in a reviewed PR and merge; the next Blog deploy removes the page and feed entry while preserving source history.
