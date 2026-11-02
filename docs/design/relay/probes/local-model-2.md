# Local model probe 2: tuning, and the bake-off to come

**Question:** the operator asked which local models are the absolute best for Relay, tuned and
optimized. **That can't be answered yet.** Only two suitable models were tuned, and I found no
independent head-to-head for this hardware and use. This probe shows that tuning matters a great
deal, and it defines the bake-off that can answer the question.

## Tuning results

[`local-model-2-tune.py`](local-model-2-tune.py) ran with the same runtime and limits as
[probe 1](local-model-1.md), at machine load between 55 and 135. Raw results are in
[`local-model-2-results.json`](local-model-2-results.json).

| Routing, on 18 prompts not used for tuning | Qwen3.5-9B, 4-bit | Qwen3-4B, 8-bit |
|---|---|---|
| Baseline prompt | 67% | 61% |
| Tuned prompt | **100%** | 89% |
| Tuned prompt, first token constrained to a label | 100% | 89% |
| Rules first, tuned, constrained | 100% | 89% |
| Typical time per routing decision, tuned, no cache | 6 to 8 s | about 3 s |
| Resists both injection prompts, tuned | Yes | No |

Tuning meant adding what Arcadia's terms are, marking the message as data, and nine worked examples,
none of them from the scored prompts.

| Prefix caching, on a 392-token prompt | Qwen3.5-9B, 4-bit | Qwen3-4B, 8-bit |
|---|---|---|
| First word, uncached | 8.9 s | 3.6 s |
| First word, with the prefix cached | not measured | **0.77 s** |

## What it means

- **The prompt mattered more than the model** on this small test, so comparing models untuned would
  pick the wrong winner.
- **Tuning has a latency price.** The longer prompt takes seconds per decision, so it depends on
  prefix caching, which cut first-word time by nearly five times where it was measured.
- **Don't route before replying.** Rules can take the clear cases, and a conversation can start at
  once while anything uncertain is settled by an explicit card.
- **Injection resistance isn't a safety boundary.** Passing two prompts is encouraging, but state
  changes still go through code and a card (C-044).

## Limits

- **These scores aren't truly held out.** I wrote the 18 prompts in the same sitting as the tuned
  prompt, and they share its style. 100% on 18 has a wide margin of error. A separate author has to
  write the scored set.
- **The 9B cache wasn't measured.** My test needed to trim its cache, and that model's cache can't
  be trimmed, so a different harness is needed. This isn't evidence that caching fails on it.
- **Load was heavy and varied,** and the runs weren't controlled against each other. Treat the times
  as rough. The rules-first row's times aren't comparable, since load moved during the run.
- **Probe 1's script changed after its results:** `local-model-1-bench.py` now resets peak memory
  between models, which the committed results didn't do.

## The bake-off

**Candidates** (sizes from each Hugging Face repository listing, 2026-11-02):

| Model | Source repository | Download | Why |
|---|---|---|---|
| Qwen3.5-9B, 4-bit | Installed | 0 | Current leader |
| Qwen3.5-2B, 4-bit | `mlx-community/Qwen3.5-2B-MLX-4bit` | 1.75 GB | Smallest and fastest candidate |
| Qwen3.5-4B, 4-bit | `mlx-community/Qwen3.5-4B-MLX-4bit` | 3.06 GB | Likely speed and quality balance |
| Gemma 4 E2B, 4-bit | `mlx-community/gemma-4-e2b-it-4bit` | 3.58 GB | Different family, small |
| Gemma 4 E4B, 4-bit | `mlx-community/gemma-4-e4b-it-4bit` | 5.18 GB | Different family, balanced |
| Qwen3.6-35B-A3B, 4-bit (stretch) | `mlx-community/Qwen3.6-35B-A3B-4bit` | 20.43 GB | Strongest candidate that may fit, for harder turns; probably too large alongside coding agents |

The Gemma repositories may need a different runtime path if they include vision components. That's
unverified.

**Protocol:**
1. A separate author writes scored prompts for routing, chat, grounded answers from Way passages, and
   turning an idea into a Plan outline, with answer keys and a safety block.
2. Every model gets the same tuning first, so the comparison is of tuned models.
3. A separate judge grades blind to which model answered.
4. Each runs through the live path, oMLX and LiteLLM, at an idle and a production-like load, with
   production Off.
5. Measure first word, speed, peak memory, cached and uncached, plus a 30-minute sustained run.
6. The operator sets the budgets, and a winner is the smallest model that meets them.

**Levers to tune, cheapest first:** system prompt and examples, prefix caching, a context cap, keeping
the model loaded, constrained output for typed decisions, quantization level, then draft-model
speculative decoding, whose published gains vary widely. Fine-tuning comes only if all of these fall
short.
