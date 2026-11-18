# Source notes for Three stalls in an unattended coding-agent run

These are public-safe excerpts of Flynn’s agent-written evidence notes, not independent proof of the underlying events. The source notes cite agent-written coordination logs that the roll-up writer and critic did not open. Code and GitHub merge metadata were checked separately. Times are Pacific; the incidents concern 15–16 November 2026.

## Approval ended early

Source note: `flynn-chronicle-2026-11-15-noon.md`. Excerpted claims retain their original identifiers and qualifications.

| ID | Source statement | Evidence cited by Flynn | Limit in Flynn’s note |
| --- | --- | --- | --- |
| C6 | The day approval ended early because Rowan's Off id '.-plan3-pins-13-15-complete-20261115' did not match ^rowan-off-, so it read as an operator Off (DAY_ENDED_BY_OPERATOR). | SL 11:25 AM entry | Signal's account; the check and the root-cause Issue were not opened |
| C10 | Ellis's root cause for the early end is that the ".-" in the Off id came from an rg -r substitution. | SL 11:55 AM entry | Per SL (Ellis's report); the report itself was not opened |

## Repair waiting for a push

Source note: `flynn-chronicle-2026-11-16-8am.md`. Excerpted claims retain their original identifiers and qualifications.

| ID | Source statement | Evidence cited by Flynn | Limit in Flynn’s note |
| --- | --- | --- | --- |
| C3 | By 9:50 PM the fix was ready and the operator had been pinged for push words. | S13 9:50 PM entry (fix 158a03248, [notification receipt omitted]) | Per S13 |
| C4 | The host does not let an agent push that fix. | SL 8:50 PM and S13 9:05 PM entries (host refused Rowan 18's pushes for #2743); S13 9:40 and 9:50 PM entries (operator push words needed for #2744) | Per SL and S13; the refusal for #2744 itself is inferred from the same pattern |
| C8 | By 9:40 AM #2744's head was 158a03248 (the prepared fix), pushed between my reads at 8:50 AM (old head 3decd9449) and 9:40 AM; production was still Active with no admitted work at 9:40 AM. | `gh pr view 2744` reads at 2026-11-16 16:50Z and 17:40Z; `arcadia production status` 17:40Z | Observed; who pushed and the exact time were not checked |

## Watcher waiting on a conflict

Source note: `flynn-chronicle-2026-11-17-8pm.md`. Excerpted claims retain their original identifiers and qualifications.

| ID | Source statement | Evidence cited by Flynn | Limit in Flynn’s note |
| --- | --- | --- | --- |
| C1 | #2745 merged at 12:17 PM Pacific and #2746 then went conflicted (MISSION_LOG.md). | [#2745](https://github.com/pmark/arcadia/pull/2745) (merged 2026-11-16T12:17:30-08:00); S13 5:50 PM entry | Merge time from GitHub; the conflict is per S13 |
| C2 | The watcher armed to merge #2746 waited silently for about five hours. | S13 5:50 PM entry ("pr-ready waited silently for 5h") | Per S13; the watcher script was not opened |
| C3 | Signal patched the watcher to exit on a conflict. | S13 5:50 PM entry | Per S13 |

## Correction to the repair note’s C5

The original note states that the operator pushed the PR #2743 repair at 9:15 PM, about ten minutes after a 9:05 PM notification. Keep that comparison unsupported pending reconciliation. GitHub records [PR #2743](https://github.com/pmark/arcadia/pull/2743) merged at 2026-11-16T05:09:33Z, or 9:09:33 PM Pacific on 15 November. A 9:15 PM repair push would be after that merge and cannot explain it. The roll-up does not use this claim. The source note’s C4 claim about the host blocking the PR #2744 push is an inference, and C8 does not establish who pushed or the exact push time.

The note named `flynn-chronicle-2026-11-17-8pm.md` describes the previous evening, 16 November; its filename is not the incident date.
