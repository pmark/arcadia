# Way knowledge probe 1: result

**Question tested:** is the checked-in guidance enough for an agent to answer a first-time
operator correctly and practically? This is the design's riskiest assumption.

**Status: inconclusive, leaning supported.** The operator hasn't set the pass mark, and this
tested a stronger setup than Relay may use.

## Method

- [Thirty questions](way-knowledge-1-questions.md) written from a first-timer's point of view,
  without consulting the guidance.
- One agent [answered](way-knowledge-1-answers.md) from the checked-in material only, in at
  most 100 words each: Claude Sonnet 5.5 with file search and bounded reads.
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

The corpus is strong enough to answer most questions safely. The failures are mostly about
finding the right document, which suggests Relay needs a first-timer's map of the guidance
more than it needs more guidance. Eight concrete guidance defects are in
[Issue 2013](https://github.com/pmark/arcadia/issues/2013).

## Limits

- One author wrote the questions and one judge graded them. No real first-time operator was
  involved.
- A frontier model with full file search is likely an upper bound. A local model hasn't been
  tried, so the cheapest-answer path (C-016) is untested for Way questions.
- The judge used no fixed answer key, so another judge may grade differently.
- 5,000 tokens per question is high for a chat, so retrieval needs narrowing.
