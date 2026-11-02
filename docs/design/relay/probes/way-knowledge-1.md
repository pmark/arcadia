# Way knowledge probe 1: result

**Question tested:** is the checked-in guidance enough for an agent to answer a first-time
operator correctly and practically? This is the design's riskiest assumption.

**Status: failed.** It misses S012's pass mark on both clauses: 73% fully correct against 90%, and
it was wrong on stopping (Q15). An earlier version of this file called the result inconclusive,
which scrutiny finding R1-F3 corrected.

## Method

- [Thirty questions](way-knowledge-1-questions.md) written from a first-timer's point of view,
  without consulting the guidance.
- One agent [answered](way-knowledge-1-answers.md) from the checked-in material only, in at
  most 100 words each: Claude Sonnet 5.5 with file search and bounded reads, told to start from
  the guidance index and the `arcadia-relay` skill.
- A separate, read-only [judge](way-knowledge-1-judgment.md) graded each answer against the
  guidance, the Decisions and the code.

## Result

| Measure | Yes | Partial | No |
| --- | --- | --- | --- |
| Correct | 22 | 8 | 0 |
| Practical | 27 | | 3 |
| Cited | 26 | 4 | 0 |
| Honest about limits (8 applied) | 6 | | 2 |

- **No wrong statement about authority, spending or merging.**
- **Failure causes:** 5 retrieval, 4 the answer itself, 1 missing guidance, 0 stale guidance.
- **Language:** a secondary weakness on 6 answers, using terms such as "worktree" and "settle"
  unexplained.
- **The worst miss:** asked how to stop everything, the answer said there was no one-press
  stop. A STOP button exists, but `START_HERE.md` doesn't mention it.
- **Cost:** about 157,000 tokens for 30 answers, roughly 5,000 per question, in about three
  minutes, as the runtime reported it.

## What it means

The guidance answered most questions, and nothing was wrong about authority, spending or
merging. It isn't safe enough, though: one answer said there was no one-press stop when a
STOP button exists, and another implied that work is safe in any crash, when that holds only
for managed production sessions. The failures split between finding the right document (5),
the answer itself (4) and missing guidance (1), so Relay likely needs both a first-timer's map
of the guidance and fixes to the guidance. Eight concrete defects are in
[Issue 2013](https://github.com/pmark/arcadia/issues/2013), including that no first-time
walkthrough exists.

The judge's own defect list ties four of the five "retrieval" misses to guidance defects, so
"1 missing guidance" understates the gap (R1-F3).

## Lookup measurement

`arcadia way lookup` was then built and measured on these same questions. This is development
data, already seen by its author, so it's a measurement and not a pass (R1-F9).

| Measure | Result |
| --- | --- |
| Right material in the top three | 16 of 30 |
| Off-topic queries correctly refused | 17 of 17 |
| Output for a typical question | about 1.7 KB |
| Compiled CLI run | about 0.5 s, nearly all of it importing the CLI |
| Lookup alone, cold | about 150 ms |

It misses the stop, add-a-Project and deploy questions. It's small, fast and honest about what it
doesn't know, but it doesn't yet reach first-timer wording. These figures are the implementer's,
and the Lead reran the test suite.

## Limits

- One author wrote the questions and one judge graded them. No real first-time operator was
  involved.
- A frontier model with full file search is likely an upper bound. A local model hasn't been
  tried, so the cheapest-answer path (C-016) is untested for Way questions.
- The judge used no fixed answer key, so another judge may grade differently.
- 5,000 tokens per question is high for a chat, so retrieval needs narrowing.
