# Arcadia agent insignia — Astra’s design and generation prompts

Design proposal, 23 October 2026. Requested adviser: Astra (`gpt-6-astra` launch request; actual runtime model metadata unavailable). Intake: [Issue #1720](https://github.com/pmark/arcadia/issues/1720). This is a visual exploration brief, not selected brand assets or validated production icons. Arcadia’s canonical Critic remains Nadia.

## Recommended direction

One family of open, rounded marks, with identity as the primary visual signal. Give each colleague a memorable silhouette. Show the assigned role, selected skill and active Behavior only where that additional information is useful.

The family should feel like small, carefully shaped tools: approachable, precise and comfortable beside lowercase **arcadia**. Borrow the operator reference’s economy, generous space and soft terminals. Do not copy its dot-over-U arrangement into eight variations. Avoid planetary rings and orbit imagery entirely.

| Concept | Visual treatment | Normal use |
|---|---|---|
| Identity | A substantial, distinctive central glyph | Standalone beside the colleague’s name |
| Role | A light, open supporting frame | Assignment detail or explanatory diagram |
| Skill | A separate small rectangular tile containing a method motif | Skill catalogue or selected-method list |
| Behavior | An unenclosed method motif beside a short vertical separator | A labelled indication of the method currently being followed |

An identity remains unchanged when its assignment changes. Ellis receives a planner frame **or** an implementer frame, never a hybrid. Mira and Vida share the researcher frame but retain clearly different identity glyphs.

Do not make all four layers compulsory. A 24-pixel colleague icon should normally contain only the identity. In larger diagrams, place the role around it, a skill tile nearby, and any Behavior in an adjacent labelled annotation. Do not shrink everything into a decorated badge.

These marks identify functions and working methods. They do not assert permission, independence, successful verification, health, expertise or completion.

## Copy-and-paste generation recipe

Generate **one symbol per prompt**. Assemble each prompt as:

**Global prefix + one category instruction + one item description + one rendering suffix + exclusions.**

Names and explanatory meanings remain outside the artwork.

### Global prefix

> Create one original abstract symbol for Arcadia, a calm, approachable system for coordinating creative and technical work. Flat vector-like artwork, front view, one centered symbol, generous empty space. Use a small number of deliberate geometric paths and solid forms, rounded terminals, softly rounded corners, consistent visual weight and clearly shaped negative space. The geometry should feel friendly and exact, never ornamental. Design first for recognition in a single color. For identity glyphs, use an imaginary 24-by-24 grid, with the main form occupying roughly the central 16-by-16 area. For role frames and skill tiles, follow the category-specific dimensions below. Preserve clear gaps of approximately one stroke width or more. No text within the artwork.

### Identity category instruction

> Draw the primary identity glyph only. Use approximately 2.5-unit stroke weight, with no surrounding frame, tile or decorative border. Keep its orientation fixed and its silhouette distinctive. Interpret the following geometry as a construction brief; preserve its defining parts and open spaces.

### Role category instruction

> Draw an open assignment frame with an empty center. Use approximately 1.75-unit stroke weight on an imaginary 32-by-32 grid. Reserve the central 18-by-18 area completely empty for a separately supplied identity glyph. Do not invent or draw an identity. Keep all frame elements away from that central area.

### Skill category instruction

> Draw a small method tile: a horizontal rounded rectangle approximately 30 units wide and 24 units tall, with a 1.5-unit outline and four-unit corner radius. Center the described method motif inside it, using approximately two-unit stroke weight. Leave generous space between the motif and the tile outline. The tile denotes a reusable instruction package. No text, tabs, folded page corner or interface controls.

### Behavior category instruction

> Draw a compact horizontal method annotation, without any enclosing tile or frame. On the left place a short vertical separator. After a generous gap, draw the described method motif. The separator is a category cue, not a progress indicator. Keep the composition static, sparse and clearly readable. No attached identity glyph.

### Monochrome rendering suffix — use first

> Render every visible part in solid ink #17130f on warm white #fbfaf8. No tonal differences. Crisp edges, generous margins, square canvas for identities and frames. Produce one finished symbol, not a sheet of alternatives.

### Dark rendering suffix

> Preserve exactly the approved geometry. Render every visible part in warm light ink #f4efe9 on night navy #0c0f1d. No glow, translucency or additional detail.

### Optional accent rendering suffix — after monochrome selection

> Preserve exactly the approved geometry. Render the entire primary glyph in Arcadia rust #c43f16 on warm white #fbfaf8, or orange #ff6a33 on night navy #0c0f1d. Use only the specified pair. Do not assign different colors to different identities.

### Exclusions

> No letters, initials, numbers, captions, logo mockups, human figures, faces, robots, eyes, hands, animals, planets, orbits, planetary rings, stars, zodiac or tarot imagery. No crowns, rank insignia, military patches, shields, checkmarks, locks, trophies or certification seals. No circuit-board decoration, cyberpunk styling, gradients, shadows, glow, glass, metallic surfaces, bevels, perspective or 3D. No invented telemetry. No extra dots, decorative flourishes or dense detail.

The reference blue `#7cc0ff` is an optional later comparison against the operator’s reference, not a required second identity color. The safest initial family is monochrome, followed by a single shared rust accent.

### Fully assembled Mira prompt

> Create one original abstract identity symbol for Mira, Arcadia’s Investigator. Arcadia is a calm, approachable system for coordinating creative and technical work. Produce flat vector-style raster artwork: one centered symbol, front view, generous empty space, crisp edges, no text.
>
> Use an imaginary 24-by-24 grid with the form occupying the central 16-by-16 area. Draw one substantial path, approximately 2.5 units thick, traveling from the lower left toward the upper right. Begin with a short horizontal segment, bend upward through the middle, then turn right into a short level ending. Use softly rounded bends and rounded terminals. Place one solid circular point directly beyond the final horizontal ending, separated by a clear gap of one stroke width. The point is beside the ending, never above it. Keep the path open and asymmetrical, without loops. Make the dot substantial enough to remain visible when reduced.
>
> Render every visible part in solid ink #17130f on warm white #fbfaf8. Preserve clear negative space. Draw the identity alone, without a frame, tile, border or secondary emblem. Produce one symbol, not a sheet of alternatives.
>
> No letters, initials, captions, human figures, faces, eyes, robots, magnifying glasses, question marks, arrows, planets, orbits, rings, stars, shields, checkmarks or rank insignia. No gradients, shadows, glow, textures, glass, bevels, perspective, 3D, mockups or decorative dots. The single specified point is essential geometry. Prioritize a distinct monochrome silhouette over embellishment.

This prompt requests a raster concept with vector-like simplicity; production SVG construction remains a later step.

## Eight identity glyphs

### Rowan — Coordinator: the gathering stem

> Draw one connected branching form. A short vertical stem rises from the bottom center to a junction slightly below the center. From that junction, two broad curves open toward the upper left and upper right. A shorter straight branch continues upward between them. All three upper ends are rounded and stop at visibly different heights: center highest, left slightly lower, right lowest. Keep broad open wedges of empty space between the branches. No dots at the ends, arrowheads, enclosing circle or lower crossbar.

Meaning: Several responsibilities meet in one accountable coordinating point. The open ends suggest ongoing work, without implying command rank.

### Mira — Investigator: the evidence trace

> Draw one thick, gently bent path traveling from the lower left toward the upper right. Begin with a short horizontal segment, bend upward through the middle, then turn right into a short level ending. Place one solid circular point directly beyond that ending, separated by a clear gap of one stroke width. The point is the destination of the trace, not above it. Keep the path open, asymmetrical and free of loops. No magnifying glass, eye, question mark or arrowhead.

Meaning: Follow evidence to a specific observation. The deliberate gap preserves the distinction between a proposed explanation and what has actually been established.

### Ellis — Engineer: the fitted joint

> Draw two separate, thick right-angle forms with softly rounded outer corners. Place one in the upper left, turning downward and then right; place the other in the lower right, turning upward and then left. Their short horizontal arms face each other across the center without touching. Arrange them to create one broad stepped channel of negative space between the pieces. Use equal weight and balanced proportions. No puzzle-piece knobs, gears, tools or enclosing outline.

Meaning: Shape parts so their interfaces fit. The same identity works for designing an interface and implementing it; the assigned role distinguishes those responsibilities.

### Nadia — Critic: the opposing premise

> Draw two substantial shallow bent strokes facing inward across a wide central opening. The left stroke bends toward the center and sits slightly higher. The right stroke bends toward the center and sits slightly lower. Each bend is rounded, each pair of arms short. Keep the two bends offset rather than meeting tip to tip. The middle negative space should form an irregular open passage, not a diamond. No arrows, warning triangle or enclosing frame.

Meaning: Put an assumption under pressure from a different direction. The disagreement stays visible rather than resolving into an approval symbol.

### Sage — Reviewer: the inspected corner

> Draw a softly rounded square outline with its upper-right corner completely absent, leaving a broad opening. Inside the square, place one short diagonal stroke pointing toward that missing corner, separated from every edge. Keep the inner stroke blunt and rounded, not a slash reaching through the boundary. Use a substantial square silhouette with a clearly open corner. No document lines, magnifying glass, checkmark or folded-page effect.

Meaning: Inspect a bounded candidate and locate a specific defect. The interrupted perimeter and local interior mark distinguish review from general critique.

### Quinn — Verifier: the comparison bars

> Draw two equal, substantial horizontal bars, one above the other, with rounded ends and a generous gap between them. To their right, place one separate short vertical bar centered between their heights. Leave a clear horizontal gap between the pair and the vertical bar. The whole composition is wider than it is tall. Keep every part disconnected. No checkmark, enclosing box, arrow or unequal bar lengths.

Meaning: Compare expected and observed evidence against an explicit boundary. The mark describes verification, not a passing result.

### Vida — Health Assessor: the sampled columns

> Draw three separate upright capsules standing on the same invisible baseline. The center capsule is tallest, the left medium height, the right shortest. Use equal capsule widths, generous equal spacing and fully rounded ends. Keep the difference in heights large enough to survive reduction. No baseline, chart axes, numbers, heartbeat trace, cross, leaf or additional dots.

Meaning: Assess several conditions while preserving their differences. These fixed geometric proportions are an identity, never live health data.

### Clara — Technical Writer: the clear ribbon

> Draw one continuous, substantial horizontal ribbon-like stroke with two broad, gentle bends. It begins low on the left, rises into a rounded crest just left of center, descends into a shallow valley just right of center, then ends level toward the upper right. Use rounded ends and a uniform stroke width. Make the left sweep longer than the right, giving a deliberate reading direction without an arrow. No loop, second parallel ribbon, pen, book, speech bubble or letterform.

Meaning: Turn complex material into a clear line a reader can follow. A single flowing form gives Clara a softer silhouette without making the identity decorative.

## Seven role frames

Use these with the **role category instruction**. Their purpose is to support assignment reading at larger sizes. At small sizes, print the role in text instead.

| Role | Prompt-ready form |
|---|---|
| `lead` | A shallow open cradle beneath the empty center: one horizontal bottom stroke with two short upward-curving ends. Leave the entire top and both upper sides open. |
| `planner` | Four separate short right-angle corner marks around the empty center. Keep long gaps between all corners. The result suggests a proposed extent without a continuous boundary. |
| `plan-critic` | Two broad, shallow inward bends outside the left and right sides of the empty center, vertically offset. Keep the top and bottom entirely open. |
| `implementer` | One substantial open L-shaped support extending along the left and bottom of the empty center, with one softly rounded lower-left corner. Leave the top and right completely open. |
| `code-reviewer` | Two straight-sided square brackets, one on each side of the empty center. Use short inward-facing top and bottom returns. Keep generous gaps above and below. |
| `qa` | Two horizontal rails, above and below the empty center. Add short inward-facing returns at both ends of each rail. Keep the left and right sides open. |
| `researcher` | Two shallow curved parentheses, one on each side of the empty center. Use broad, quiet curvature and open top and bottom. No circular enclosure or central point. |

The square reviewer frame and curved researcher frame must remain visibly different. The `qa` frame uses horizontal emphasis; the reviewer frame uses vertical emphasis. No frame is a permission boundary or a security indicator.

## Ten skill tiles

Use these with the **skill category instruction**. Motifs deliberately reuse familiar visual ideas where the underlying method overlaps.

| Skill | Prompt-ready interior motif | Intended association |
|---|---|---|
| `arcadia-release-manager` | Two short horizontal bars arranged end to end on one level, separated by a large central gap. Above the gap, place one short horizontal bridge, clearly disconnected from both bars. | Identify the remaining evidence gap and the work needed to close it. |
| `arcadia-studio-scout` | Draw a squared U turned sideways, opening to the right: two short horizontal arms joined by one vertical stroke on the left, with softly rounded corners. Place one separate short horizontal probe directly opposite the opening, outside the U and centered between its arms. Leave a conspicuous gap before the probe reaches the opening. | A bounded probe approaching an integration interface. |
| `arcadia-supervisor` | One broad, shallow horizontal arch above two short upright strokes. Keep the arch separated from both strokes and leave the sides open. | Attend to assigned work and its signals without enclosing or taking custody of it. |
| `arcadia-github-issues` | Three short horizontal strokes arranged vertically on the left; one softly bent path on the right connects the level of the upper stroke to the level of the lower stroke. Keep the path separate from all three. | Reconcile and route intake signals. |
| `arcadia-guardrail` | Two equal vertical rails with a short horizontal capsule centered between them. Keep the capsule separated from both rails. | Focus a change within declared bounds. |
| `next-action-grader` | Draw three equal short upright strokes in a horizontal row, evenly spaced. Beneath them, place one separate horizontal bar spanning the width of the row. Leave a generous vertical gap between the bar and all three strokes. No connecting baseline, ticks, numbers or checkmark. | Examine one proposed action against a consistent set of criteria. |
| `arcadia-process-critic` | Three short horizontal segments in a left-to-right sequence; lift the middle segment above the common baseline. Keep all three disconnected and evenly spaced. | Expose a discontinuity in a process before or after a run. |
| `arcadia-release-investigator` | A simplified version of Mira’s bent evidence trace, ending before one separated circular point. Preserve the open gap and lower-left to upper-right direction. | Evidence tracing and competing-cause investigation. |
| `arcadia-role` | Two separate right-angle supports: one at upper left, one at lower right, with a single short horizontal stroke centered between them. Leave all three parts disconnected. | A bounded assignment with shared inputs, evidence and handoff. |
| `arcadia-hacker` | One open path travels from left to right, makes a broad upward rectangular detour with rounded corners, then returns to its original level. No obstacle shape, arrowhead or enclosing loop. | Find an existing permitted route when repeated attempts fail. |

The tile is the category cue. The contained motif describes the instructions, not a running operation. A skill being available or loaded must not appear as a successful result.

Skill collision refinement: Scout has a connected sideways socket plus an external probe; guardrail has two disconnected vertical boundaries around an internal capsule. Grader has three upright strokes above a separate horizontal reference; role retains diagonal corner supports. Astra revised these descriptions after the parent identified two geometric duplicates. This is a design-level comparison, not a small-size rendering test.

## Three explicitly named Behavior examples

The bounded source review identifies **supervision, Hacker recovery and release investigation** as named Behavior contracts. This is not an exhaustive registry: Arcadia treats Behavior as a composable supporting concept, and the investigation skill explicitly uses that term.

Reuse the corresponding skill motif, but remove the tile and add the **Behavior category instruction’s short separator**. Reuse is intentional: the tile means “instructions for this method”; the labelled unenclosed form means “this assignment is following this method.”

| Behavior | Prompt-ready motif after the separator |
|---|---|
| Supervision | One broad shallow arch above two separate short upright strokes, with clear space between the arch and both strokes. |
| Hacker recovery | One left-to-right open path with a broad rounded rectangular upward detour and a return to its starting level. |
| Release investigation | One bent ascending evidence trace ending before a separate solid circular point, with a conspicuous gap before the point. |

Use labels such as **Following: release investigation** only when the assignment actually binds that method. Never pulse these marks, rotate them or display them as permanent “always watching” indicators.

Causal analysis, protocol analysis, architecture analysis and technical writing remain text labels describing the selected focus or method. Do not invent a badge registry for every specialization.

## Example compositions

**Mira investigating a recurring failure:** Use Mira’s trace alone in the compact interface. In an explanatory assignment card, place it within the curved researcher frame. Place the release-investigator skill tile in a separate methods row. If active method information matters, show the unenclosed investigation motif with its label. Do not show both the tile and Behavior annotation in every compact view.

**Ellis designing an architecture correction:** Use Ellis’s fitted joint within the four-corner planner frame. Caption it **Ellis · planner · execution-lifecycle architecture**. Architecture is the specialization, not an invented role or skill. No implementer frame appears.

**Ellis implementing the repair:** Use the same fitted joint within the open implementer support. Caption it **Ellis · implementer · execution-lifecycle repair**. The guardrail tile may appear in the methods row. Add the Hacker recovery annotation only when that Behavior is actually assigned. The change in role is explicit; the identity has not silently acquired permissions.

**Clara preparing an explanation:** Use Clara’s ribbon within the implementer support. Caption it **Clara · implementer · technical writing**. Keep the writing method in text; this inventory contains no dedicated Clara skill. Editorial ownership and any publication state belong in the assignment’s ordinary text and evidence.

## Small-size and collision review

At **16 pixels**, use the identity alone, with optical adjustment and at least a visibly open one-pixel gap. At **24 and 32 pixels**, preserve the same topology; improve spacing rather than adding detail. Use layered illustrations at roughly **64 pixels and above**, with ordinary labels beside them.

Before adoption, compare these likely collision pairs:

- **Clara / Quinn:** Clara is one asymmetric flowing stroke; Quinn is three disconnected straight bars.
- **Nadia / Ellis:** Nadia’s opposing bends stay shallow and offset; Ellis uses orthogonal construction and a stepped central channel.
- **Mira / Hacker:** Mira rises toward a detached evidence point; Hacker returns to its original level and has no point.
- **Rowan / Vida:** Rowan is one connected branching form; Vida is three disconnected vertical solids.
- **Sage / role frames:** Sage’s substantial interior diagonal is essential. Never use its broken square alone.
- **Reviewer / researcher frames:** Preserve square corners versus broad curves; use labels wherever reduction weakens this distinction.

The first proof should be eight separately generated monochrome identity candidates, followed by a manually assembled comparison at actual 16/24/32-pixel sizes on both backgrounds. Review them without names first, then with names. Check recognition, contrast, optical weight and ambiguity; redraw weak geometry before exploring color.

Generation provides a visual concept, not guaranteed clean vector paths. Once selected, rebuild as deliberate SVG geometry and export transparent PNGs at the required sizes. Create matching monochrome, light and dark versions from the same geometry. Verify functional icon contrast against the actual UI surface, and provide accessible text names. No accessibility or recognition test has yet been performed.

## Source and scope

This brief covers **eight canonical identity profiles, seven registered roles, ten named repository skill entrypoints, and three explicitly named Behavior examples** found in those bounded sources. It proposes a visual treatment; it does not change their definitions or add a registry.

Inspected sources:

- Clara's article and its receipt at exact head `e549da88957c46a945c48258aa4428f996df8846` in [PR #1719](https://github.com/pmark/arcadia/pull/1719): [article](https://github.com/pmark/arcadia/blob/e549da88957c46a945c48258aa4428f996df8846/docs/articles/2026-10-23-agent-identities-roles-and-behaviors.md), [claims receipt](https://github.com/pmark/arcadia/blob/e549da88957c46a945c48258aa4428f996df8846/docs/articles/receipts/agent-identities-roles-and-behaviors.md). The design proposal does not claim that article has merged or been published.
- Canonical Arcadia revision `a5ff41566d6edbf9dc5be45c99bc2bf54e8b7cd7`: [Behavior and identity profiles](https://github.com/pmark/arcadia/blob/a5ff41566d6edbf9dc5be45c99bc2bf54e8b7cd7/docs/arcadia-semantics.md#roles-specializations-and-optional-names), [role composition, Vida, Clara and recovery](https://github.com/pmark/arcadia/blob/a5ff41566d6edbf9dc5be45c99bc2bf54e8b7cd7/docs/agent-guidance/session-roles-and-briefs.md), [seven-role registry](https://github.com/pmark/arcadia/blob/a5ff41566d6edbf9dc5be45c99bc2bf54e8b7cd7/config/defaults/agent-roles.json), and opening descriptions/purpose sections plus targeted Behavior terminology scans of the ten [repository skill entrypoints](https://github.com/pmark/arcadia/tree/a5ff41566d6edbf9dc5be45c99bc2bf54e8b7cd7/.agents/skills) listed above.
- Arcadia [conversational workspace design](https://github.com/pmark/arcadia/blob/a5ff41566d6edbf9dc5be45c99bc2bf54e8b7cd7/docs/design/arcadia-conversational-workspace.md#identity), Identity and operator-feedback sections: approachable lowercase direction, the [operator reference](https://github.com/pmark/arcadia/blob/a5ff41566d6edbf9dc5be45c99bc2bf54e8b7cd7/docs/design/assets/arcadia-conversational-workspace/operator-logo-reference.jpg), and explicit avoidance of planetary rings/orbits.
- AMC local source revision `c0347d93c964e50779ebb44b16e690642d857ebd`: [typography and light/dark tokens](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/styles/global.css), [Mars Mission Control theme](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/docs/design/mars-mission-control-theme.md), including truthful status, surfaces, color and type.

The AMC checkout was inspected as a local source; its revision is not asserted to be the latest deployed site. The warm-dot/open-blue-form reference establishes an operator preference, not a selected master logo. Astra supplied the proposed visual language and refined two skill-motif collisions; the parent assembled this portable source and clarified category-specific grid dimensions. No images, source code, brand adoption or publication were produced by this design assignment.
