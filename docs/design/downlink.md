# Downlink: artifacts drawn in the sky's ink

Operator request, 2026-10-26: intake [Issue 1798](https://github.com/pmark/arcadia/issues/1798), following [Issue 1761](https://github.com/pmark/arcadia/issues/1761)
and the [workspace feed](operator-presence.md). No governed Action exists. This
note captures the idea so it can become a Plan; nothing here is authorized to run.

## The request

> I want there to be a sense of surprise and delight and even magic. And I know
> for myself that when Claude produces an artifact that exceeds my expectations,
> I have a wow reaction. I want the UI to present these opportunities to the
> user. … Perhaps there could be embeddable overlays with fully interactive
> features, or also just screenshot images or mermaid diagrams for schematics.
> And in general, by default, if the visual artifacts had transparent
> backgrounds, then there could be a very cool blueprint style technical
> presentation motif. For example, a mermaid diagram with clean lines and a
> transparent background could appear in the main view and seems like it's
> perfectly and seamlessly integrated with the rest of the view and could
> easily appear and go away or come back in a fluid way.

Rowan asked Ellis (registered role `planner`, read-only solution design, one
bounded pass) to sort the ideas. Ellis's design is below, integrated with what
the prototype proved. Material marked *inference* is unverified.

## The idea

A rover's best moment is its first image back from the surface. A **Downlink**
is an agent's deliverable arriving on the operator's sky as part of the view
rather than as a boxed preview. It is drawn in **Schematic ink**, the sky's own
line color, over a transparent background. The operator lifts it onto the
**Stage**, docks it back to its message, or pins it faintly to the sky, and can
call it back at any time.

The wow comes from a gap: the operator expected a status line and got the
thing itself, already in place. For an operator who steers agents, a picture of
the change (the before and after, the route, the plan's shape) is also faster
to judge than a log. Blueprints suit Arcadia: mission control is schematics,
traverse maps and instrument plates, and the sol sky already supplies night
(cyan ink on stars) and day (deep ink on bright dust).

The existing workspace specification already expects that "contextual cards,
artifact previews, and the map appear when useful" as phases of one workspace
([arcadia-conversational-workspace.md](arcadia-conversational-workspace.md),
"Broader MVP vision"). Downlink is the presentation layer for those previews.

## Artifact kinds

| Kind | How it renders | Trust boundary | How it arrives |
|---|---|---|---|
| **Screenshot or raster** (PNG, JPEG, WebP) | `<img>` from a blob URL, in a thin ink "viewport frame", with ink callouts drawn over it | Untrusted bytes in a safe image context. The existing artifact route checks signature, root and the 4 MiB cap | Run-linked Artifact through the Ask receipt (exists); a feed entry is new |
| **Agent-authored SVG** | Still `<img>`, never inlined. Ink comes from a CSS mask filled with `--ink` (*inference*: needs a same-origin check) | An `<img>` SVG runs no script and fetches nothing; the route already refuses DTD and ENTITY and sets a sandbox CSP | As above |
| **Schematic source** (Mermaid `.mmd`, or a small Arcadia schematic JSON) | Agents send source, not markup. A trusted renderer draws it inline in ink | Untrusted data, trusted renderer: Mermaid with `securityLevel: "strict"` and `htmlLabels: false`, click directives ignored. A new dependency | `.mmd` is a new type, served as `text/plain` |
| **Deterministic schematic** (a Plan, a Journey route) | Drawn by Arcadia from its own records, such as `arcadia-plan-journey-v1` | Fully trusted, and cheapest under the Constitution's economy order | Journey mission screen and the feed |
| **Live data or charts** | Agents send CSV or JSON; a trusted chart component draws it | Untrusted text, escaped by React; no agent code runs | Artifact viewer and the feed |
| **Interactive instrument** (embed or overlay) | A sandboxed `<iframe sandbox="allow-scripts">` with no `allow-same-origin`, ideally from a separate origin, and `connect-src 'none'` | Agent script in the operator's browser. **Needs a Decision**; not in the first slice | Explicit tap only |
| **Reveal** (a finished deliverable) | A trusted composite: before and after with a wipe slider, a PR's test delta, an Action's acceptance Artifact | Trusted layout around untrusted images or data | When a PR merges or an Action arrives; opened by tap |

Every Downlink carries a small manifest:
- its kind;
- alt text;
- a one-line "what changed";
- the Run, Action or PR it came from.

The alt text and caption are untrusted and are only ever shown as escaped text.

## Schematic ink

**What agents emit:**
- SVG with a `viewBox`, no fixed width or height, and no background `<rect>`.
- `stroke="currentColor"` and `fill="none"` by default.
- Optional classes from a closed list: `ink-1`, `ink-2` (faint), `ink-accent` and `ink-signal`.
- `<title>` and `<desc>`.
- No `<script>`, `foreignObject`, external `href` or embedded fonts.

Rasters may use alpha. Screenshots stay opaque and get the frame instead.

**How the view themes it:**
- The sky controller already publishes `--night` and the `--sky-*` colors on the workspace root (`components/workspace/sky/controller.ts`). CSS derives the ink tokens from them:
  - `--ink`: ivory-cyan at night, deep ink by day;
  - `--ink-faint`: the drafting grid;
  - `--ink-accent`: the existing ember;
  - `--ink-signal`: the phase colors in `feed.css`.
- Trusted renderers use the tokens directly. Agent SVG gets `--ink` through the mask, which flattens it to one color. That is a deliberate limit of the safe path.
- The ink follows the sol phase and the dark or light scheme. `sol-phase.ts` stays unmodified.

**Accessibility:**
- **Contrast floor.** Lines at least 3:1 against `--sky-mid`, labels at least 4.5:1. Where a phase misses it, a faint vellum plate appears behind the artifact: transparent is the default, but legibility wins.
- **Text alternative.** `<title>`, `<desc>` or the manifest alt text is the accessible name, and Mermaid source stays available as text.
- **Reduced motion.** No ink drawing and no lift; the artifact appears in place.
- **Proof.** Check at the frozen `#dawn`, `#day`, `#dusk` and `#night` phases in both schemes.

## Choreography

- **Arrival** (from data, quiet): a Downlink's plate draws itself in place once, within about 400 ms. Nothing shifts layout, takes focus or changes view.
- **Lift to the Stage** (operator tap only): the plate grows into the Stage. The feed behind it dims and blurs, a faint drafting grid fades in, and the lines draw in ink. The View Transitions API is an option, with a crossfade fallback (*inference*: browser support varies).
- **Dock** (Escape, tap outside, or Dock): the drawing shrinks back to its plate. Focus returns to the opener, and URL, drafts and storage are unchanged. The current viewer's e2e test already proves this contract.
- **Pin to sky:** the drawing stays faintly behind the feed, like a watermark on the sky, with a chip to unpin it or open it again. Pinned state is browser-local, like the Journey screen.
- **Never automatic:** opening the Stage, switching Feed or Journey, moving focus, sound, fullscreen, or running an instrument.

The rule is surprise in quality, never in control. It is the same rule as the Journey button, which never switches views on its own.

## Where the wow comes from

- **A PR lands:** before and after with a wipe slider, and the test delta as a small chart.
- **A Plan drawn as a schematic:** Actions as stations on a route, with the current leg lit and blocked legs marked. Deterministic, from Journey data.
- **Rover traverse:** a mission's legs as a route over faint contour lines, with "Your move" as a waypoint.
- **Architecture on the sky:** `docs/architecture.md` is already Mermaid.
- **First light:** an Action's acceptance Artifact shown at the moment it arrives.

**Guardrail: delight must carry information.**
- Each Downlink answers what changed, what is next, or what needs the operator.
- Where motion adds no information, it stays under 400 ms and plays once.
- Failures are plain, never cute.
- Weather and ink are never the only channel; the status pill and text alternatives say the same thing.

## Prototype

[`prototypes/downlink.html`](prototypes/downlink.html) is a throwaway sketch, also
published as the operator's private Claude artifact. Open it in a browser with
network access, because Mermaid loads from jsDelivr. It shows three plates in a
feed over a sol sky with a Dawn, Day, Dusk and Night control:

1. **Schematic.** This PR's real data flow (three GET reads to `buildFeed()`, `readSky()` and the Journey button) as transparent Mermaid that draws itself in ink.
2. **Capture.** A real phone screenshot from the `workspace-feed` e2e run, with ink callouts on the System pill, Presence and the Journey button.
3. **Instrument.** The Journey fleet ring as a touchable tool labelled "no network, no authority".

Each plate lifts onto the Stage, docks back, or pins to the sky, and the ink
follows the sky phase.

**What it proved for the renderer:**
- Mermaid scopes its stylesheet and markers by SVG id. Each rendered copy needs its own id, or a second copy loses its styles. Once Mermaid's colors are rewritten to `currentColor`, the sky's ink is the only color in the drawing.
- `htmlLabels: false` must be set at the top level of the Mermaid config, not only under `flowchart`. Otherwise labels render as `foreignObject` HTML and ignore the ink.
- Annotated captures need callouts laid out in the screenshot's own coordinates with proportional insets. Otherwise a height cap on the Stage shears them off their targets.

## Capture

- Intake: [Issue 1798](https://github.com/pmark/arcadia/issues/1798).
- Proposal Ask: [`agent-ask-proposal-downlink-2026-10-26.yaml`](../../.arcadia/asks/agent-ask-proposal-downlink-2026-10-26.yaml) (`intent: proposal`, propose-only). `agent-ask draft` validated it, but it is not yet registered, because the cloud session had no workspace. To register it, run from a host with the live workspace:

  ```sh
  pnpm -s arcadia agent-ask preview --file .arcadia/asks/agent-ask-proposal-downlink-2026-10-26.yaml --json
  ```

## Reuse and candidate Actions

**Reuse:**
- `app/api/workspace/artifacts/[id]/route.ts` and `lib/workspace-artifact.ts`: root containment, the race-safe open, size and signature checks, and the CSP.
- `components/workspace/workspace-artifact-viewer.tsx`: native `<dialog>`, focus return and `<img>`-only SVG. This becomes the Stage.
- `tests/e2e/workspace-artifact.spec.ts`: its checks for no external request, no script and no state change set the security bar for every new kind.
- The sky variables, `feed.css` phase colors, `lib/journey-fleet.ts` and `lib/workspace-feed.ts`.

There is no diagram dependency today: the dashboard has only `react-markdown`
and `remark-gfm`, and fenced code renders as plain `<pre>`.

**Candidate Actions, smallest first:**

1. **Draw the Journey route as a schematic.** No untrusted input. Acceptance:
   - a Schematic toggle on the mission screen renders inline SVG in the ink tokens;
   - the contrast floor passes at all four frozen phases in both schemes;
   - reduced motion shows the drawing with no animation;
   - phone and desktop captures.
2. **Add ink tokens and mask theming to the artifact viewer.** Acceptance: a fixture SVG renders in `--ink` with no background, and the existing viewer e2e test passes unchanged.
3. **Turn the viewer into the Stage.** Acceptance:
   - lift from the plate, dock on Escape or tap outside, return by tap, and pin to the sky;
   - focus, URL and storage unchanged;
   - nothing opens automatically;
   - a reduced-motion variant.
4. **Render Mermaid source safely.** Add the `.mmd` type and a lazy-loaded Mermaid with the renderer rules above. Acceptance:
   - a hostile fixture (`click` directives, `javascript:` links, HTML labels, `%%{init}%%` overrides) runs no script and makes no external request;
   - the dependency review is recorded.
5. **Add a Downlink feed item.** A new `FeedKind` built from a read of recent Run-linked Artifacts. Acceptance: it appears in its own section, opens only on tap, and the feed stays read-only.
6. **Run an instrument spike.** Design only until a Decision exists: a separate-origin sandbox and a CSP proof.

Actions 4–6 depend on rendering untrusted content safely. The rule is: source
in, trusted renderer out, and anything executable stays in an opaque-origin
sandbox.

## Risks

- Contrast on a moving sky.
- Masking flattens multi-color agent SVG.
- Mermaid's bundle size and its history of XSS issues (*inference*, from general knowledge).
- GPU cost alongside the sky and weather canvases.
- Delight fatigue.
- A screenshot can capture a secret.
- The artifact route requires an Ask receipt. A Downlink from an Action or PR needs a different correlation guardrail, such as an Action or Run id, which is a new read contract.

## Decisions needed

- Whether agents may emit **interactive instruments** at all, which means agent script running in the operator's browser.
- **Network access from instruments.** The proposed default is none.
- **Publishing or sharing** Downlinks outside the dashboard, for example Discord or public links. That is publication or messaging.
- **Storage** beyond the workspace `artifacts/` root, such as thumbnails or remote storage.
- **Showing Downlinks to agents** or attaching them to Asks, following the Presence precedent.

## Operator answers (2026-10-27)

The operator chose the two matters of taste, and accepted the defaults that
follow from UX practice for the other four.

- **Names:** Downlink, Stage and Schematic ink stay as the design and docs vocabulary. On screen, controls use plain words, such as "Open", "Pin", "Diagram" and "Screenshot".
- **Where Downlinks appear:** where their work happens, and in the feed. A Downlink from an Ask or Action sits beside that Ask or Action. A Downlink from a PR, such as a Reveal, sits on that PR's feed item and on the Journey leg the PR belongs to. There is one Stage component, so a Downlink behaves the same everywhere.
- **Screenshots:** a screenshot is evidence, so the source bitmap is never cut out or edited. The viewer adds a thin ink frame, and any callouts are non-destructive overlays drawn over the image.
- **Sound:** none by default. A later opt-in switch would also start off.
- **Pinned Downlinks:** a pin persists on that device until the operator unpins it or the work behind it finishes. A Run-linked pin clears when the Run ends, an Action-linked pin when the Action closes, and a PR-linked pin when the PR merges or closes. A quiet note says when a pin clears, so it never disappears unexplained.
- **Agent output:** agent guidance asks agents to send diagrams as Mermaid source or as transparent SVG that follows the Schematic ink contract. Screenshots and charts keep their own formats.
