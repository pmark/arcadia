---
title: "Way lookup finds words, not answers"
date: "2026-11-03"
type: essay
slug: "way-lookup-finds-words-not-answers"
summary: "arcadia way lookup is a deterministic search over Arcadia's own guidance. On 30 newcomer questions it reached the right material in its top three results for 16, and 9 of its 20 matches missed the right material. It did refuse all 17 off-topic queries."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
status: draft
claims_receipt: "docs/articles/receipts/way-lookup-finds-words-not-answers.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/way-lookup-finds-words-not-answers/"
channels: [site, rss]
---

# Way lookup finds words, not answers

If your agents follow written rules, the rules get long. Reading every document before acting is slow, and reading a fragment may miss the exception. Arcadia added a command to help, then measured it. The measurements are the interesting part.

## What the command does

```sh
arcadia way lookup "How do I stop everything immediately?"
```

It searches a fixed list of Arcadia's checked-in guidance: the guidance folder, the Constitution, the operator guides, the command reference and each skill. It splits each file at `##` and `###` headings, ranks the passages with BM25 over lightly stemmed words, and returns the best few. It uses no model or network and writes nothing.

By default you get at most three passages and 1,500 bytes of excerpt. Each comes with an address (`path#heading`) and a note when it was cut. Sections headed superseded, historical, obsolete or outdated are left out. The Constitution, and any passage that states a rule with an exception, come back whole when they fit.

The [command reference](../COMMANDS.md#look-up-the-exact-way-passage) is blunt about one field. `matched` is true when enough of the question's words were found in one chunk. It is about wording, not correctness. Output opens by saying the results may not answer the question. When nothing matches, the command says the Way does not clearly answer and lists only nearby addresses.

## What was measured

The test came from the Relay design, which needs a conversational agent to answer newcomers' questions about Arcadia. The [probe](../design/relay/probes/way-knowledge-1.md) used 30 questions written from a first-timer's point of view, without consulting the guidance. The lookup was then measured on the same 30.

| Measure | Result |
| --- | --- |
| Right material in the top three | 16 of 30 |
| Questions that matched | 20 of 30 |
| Matched results that missed the right material | 9 of 20 |
| Off-topic queries refused | 17 of 17 |
| Typical output | about 1.7 KB |
| Lookup alone, cold | about 150 to 320 ms, depending on load |

A separate reviewer reproduced 16 of 30, 17 of 17 and the output size.

These are development data. The same author wrote the questions and built the lookup, so this is a measurement of a tool its author could see, not a pass. It was one run, with one judge and no answer key, and no real first-time operator was involved.

## What the numbers say

The useful half is the refusals. Given 17 off-topic queries, it declined every one, so it is not a tool that always returns something plausible.

The weak half is that a match is not an answer. Nine of the 20 matches pointed at the wrong material. The probe's example is the question about stopping everything. It matches. At commit `74dc1f07c`, on 2026-11-05, the first result is still the guidance on what an agent does before it stops. The question was about the operator's stop control. The probe found that documented elsewhere and missing from the operator's start guide. A paragraph on it was added to the guide afterwards, and the lookup's numbers have not been measured again since.

Part of this is the guidance, not the search. The probe also had an agent answer the 30 questions from the same material, with ordinary file search and before the lookup existed. A judge found 22 fully correct and 8 partial. That is 73% fully correct, short of the probe's 90% pass mark. One answer wrongly said there was no one-press stop. The judge tied several misses to gaps in the guidance, and eight defects were filed as [Issue 2013](https://github.com/pmark/arcadia/issues/2013). A better search cannot find a passage that is missing.

## How to use it

The Relay mode skill tells agents to try the lookup first, never to treat a match as the answer, and then to read the guidance index and the matching procedure before replying. That is the right way to hold it. Use the lookup to find where to read, not to decide that you know.

Two scoping facts also matter. The corpus is Arcadia's own checked-in guidance, and the package does not ship it, so an installed copy finds it only inside a checkout. The design's own author wrote that the lookup may suit agents' own vocabulary better than newcomer wording. That is unmeasured.

## What is not done

- The numbers come from one development set that its author had seen. A held-out set written by someone else, ideally real newcomers, has not been run.
- Agent-written queries, which may suit the tool better, have not been measured.
- The lookup is not wired into a Relay, because Relay does not exist. Only the skill's instruction to try it first uses it.
- In another Project, the lookup reads that Project's guidance if it has an index file, and otherwise falls back to Arcadia's own checkout and says so. No probe from an adopting Project is recorded.
