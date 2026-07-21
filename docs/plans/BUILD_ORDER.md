# Consolidated Build Order — All Specs

Spans every plan under `docs/plans/`. This is the authoritative ordering; the
individual plan READMEs defer to it. **Specifications only — nothing is built.**

Plans covered:
[Daily Orientation Packet](./daily-orientation-packet/README.md) ·
[Discord Reply Router](./discord-reply-router/README.md) ·
[Image Playground Loop](./playground-image-loop/README.md).

## Recommended order

| Step | What | Why here |
|---|---|---|
| **0** | **Discord Reply Router** (shared seam) | Prerequisite for both features' reply loops. Small. Build once so nothing duplicates it. |
| **1** | **Daily Orientation Packet** | The stated blocker to daily adoption; daily-use value; and it is the feature that *forces the router into existence and battle-tests it* before the Playground inherits it. Ship in two sub-slices: **1a** ledger + CLI + composed packet (no Discord) to land value fast and de-risk; **1b** Discord push + reply via the router. |
| **2** | **Image Playground — Phase 1** (Loop primitive + image consumer) | Core generation loop. **Decide Q1 (does evaluation need vision?) first** — vision is unreachable today (no multimodal transport). |
| **3** | **Image Playground — Phase 2** (admin views) | Read-only over Phase 1 schemas; **merge into the existing `/admin/intelligence` surface**, not a new page. Can land beside/before step 4. |
| **4** | **Image Playground — Phase 1b** (Discord subscriber) | Now **trivial**: it consumes the router built in step 0 and hardened in step 1, supplying only a `ReplyHandler`. |
| **5** | **Image Playground — Phase 3** (Asset Library) | **Deferred.** Largest new surface (R2, backups, public URLs), contested new "Asset" noun, missing promotion hop. Playground persists locally until then. |

## On the user's prior ("Orientation comes first") — I agree, with one refinement

After reading the code, the prior holds and is well-founded:

- **It is the highest-value, daily-use feature and the stated adoption blocker.**
  The Playground is valuable but discretionary; Orientation is the thing that
  makes Arcadia part of the day.
- **It creates the leverage the prior intuited.** Both features need identical
  Discord reply machinery. Building Orientation first means the **shared Reply
  Router (step 0) gets built and exercised by a daily-use feature**, so the
  Playground's Phase 1b (step 4) inherits a proven seam instead of co-inventing
  one. That is the strongest sequencing argument here.
- **Its dependencies are lighter than the Playground's contested pieces** — no
  vision-transport question, no ComfyUI-loop cancellation gap, no R2. Its one
  net-new dependency (a scheduled trigger) is a modest launchd-plist addition
  reusing an existing pattern.

**Refinement:** the *literal* first buildable unit is the **Reply Router (step
0)**, and Orientation should land in two sub-slices (ledger/CLI first, Discord
second) so value arrives even before the router is ready. So "Orientation first"
is right at the feature level; step 0 is its enabling prerequisite, not a
competing priority.

**One honest caveat:** Orientation is not the *smallest* first slice — it adds
net-new plumbing (router + scheduler) that the Playground alone would not have
required first. The value and the shared-seam leverage justify paying that cost
up front; if the goal were purely minimal risk, the Playground's Phase 1 (which
reuses the existing worker/ComfyUI wholesale) is technically the lower-risk
starting point. I still recommend Orientation first on value grounds.

## Cross-cutting decisions that gate multiple steps

- **Q1 (Playground):** evaluation vision vs text-only — gates step 2 scope.
- **OQ-1 (Orientation):** scheduler shape (date-guarded `StartInterval` poller
  recommended) — gates step 1b.
- **Reply Router union:** keep `ReplyFeature` a closed union while there are two
  consumers — gates step 0.
- **OQ-4 (Orientation):** ledger↔`work_items` boundary (link-only, never mutate)
  — gates step 1 schema.
