# Routing probe 3: rules, models and the terse protocol

**Question:** can deterministic rules and a local model route an operator's messages to the right
tool, with a streamlined input and output format, as S017 proposes?

**Result:** one larger model routes well on unseen messages at no cost, and the terse format was
faster with it, by a margin that varied between runs. Rough rules reach about half of messages at once,
but aren't yet accurate enough to run ahead of it.

## Method

Separate agents wrote two message sets from a tool list alone, with answer keys:
[60 messages](routing-3-dev-prompts.json) and [80 more](routing-3-heldout-prompts.json). The second set
wasn't seen by me until the rules were frozen. No model's prompt was tuned against the second set.
The prompt was written before the first set existed, though two of its examples resemble messages in it.
[`routing-3-toolroute.py`](routing-3-toolroute.py) and [`routing-3-rules.py`](routing-3-rules.py)
are the code, and the `routing-3-results-*.json` files hold the raw results. Sixteen tools, temperature 0,
installed models only. Machine load ranged from 13 to 106.

## Models on the 80 unseen messages (terse format)

| Model | Runtime size | Right tool | Typical time | Wrongly chose a production lever |
|---|---|---|---|---|
| **Qwen3.6 27B coding, nvfp4** | 18 GB loaded | **94%** | 5.2 s | 0 |
| Qwen2.5-Coder 32B, q4 | about 19 GB on disk | 83% | 5.1 s | 2 |
| Qwen2.5 7B instruct | about 4.7 GB on disk | 79% | 1.5 s | 3 |
| Qwen2.5-Coder 14B, q8 | about 15 GB on disk | 78% | 2.9 s | 4 |

The lever column counts only starting or stopping production. Qwen2.5 7B, Coder 14B and Coder 32B each
also wrongly chose to answer a Decision once.

On the 60-message set, Qwen3.6 27B scored 95%, against 70% for both Qwen3.5-9B and Qwen3-4B 8-bit, whose
times were 7.8 s and 3.4 s. Those two weren't run on the unseen set.

**The second suggestion in S018 is only partly tested.** It named `Qwen2.5-14B-Instruct-8bit` and
`Qwen2.5-32B-Instruct-4bit`, on MLX. Those exact builds aren't installed, so the Coder builds through
Ollama stood in. Its claim that a 14B generates tokens "incredibly fast" isn't supported by probe 1, which
measured about 5 tok/s for a 14B at 4-bit under load. The 8-bit build it named wasn't timed for speed.

## Terse or JSON output

With the 27B on unseen messages, accuracy matched at 94%, and terse took 5.2 s against JSON's 9.8 s. On
the 60-message set, terse took 7.8 s against 9.95 s, and JSON was slightly more accurate, 97% against 95%.
So **a streamlined format looks faster with this model, by an uncertain margin.** On that set JSON also
beat terse for the smaller models, by 13 points for Qwen3.5-9B and 7 for Qwen3-4B. The format needs
testing per model.

## Rules

- **Ask's deterministic intake today, on the first 60 messages:** a median of about 0.2 ms per message, but
  58 of 60 came back low confidence, and most were "unclear". It extracts work requests, and has no routes for lookups.
  Project names here were invented, so its Project matching wasn't exercised.
- **A rough rule prototype, on the 80 unseen messages,** written from the first set and then frozen: 0.1 ms
  per message. It decided 46% of them, 81% of those correctly, which is 38% correct overall. No message wrongly reached
  a production lever or a Decision, and it left fragments such as `stop` undecided.
- **Rules ahead of the 27B made things worse:** 71 of 80 right, against 75 for the model alone, because
  the rules were wrong more often than the model on what they took. Rules have to beat the model's
  accuracy on whatever they claim, and abstain on the rest.

## What it means

- **At least 50% from rules looks reachable,** especially once they know real Project names. 80% from
  rules alone is unproved. **Most routing could stay free:** the 27B alone got 94% right, and rules ahead of
  it got 89%, so rules have to improve before they help accuracy. They'd still save time.
- **Fast enough isn't settled.** 5 s for a routing decision is too slow to feel like a chatbot, so rules
  take what they can and Relay acknowledges at once. Prefix caching is untested on this model.
- **Memory is the catch.** The 27B takes 18 GB. Reported free memory went from 85% to 25% with it loaded,
  and reached 11 to 12% by the end of the runs with other work on the machine. I read these from
  `ollama ps` and `memory_pressure` during the runs, and they aren't in the raw result files. Coding agents and production
  run on this same laptop.

## Limits

- 80 messages, written by one agent imagining an operator, not real operator messages.
- One run per model, at uncontrolled load, and across two runtimes.
- Tools were scored for choice and a keyword in the argument, not for running them.
- Hostile messages were few: 4 in the unseen set and 6 in the first.
- The rule prototype's overall accuracy depends on this set's mix.
- `routing-3-rules.py` lists tool names as a hostile signal, which won't hold up against varied attacks.
