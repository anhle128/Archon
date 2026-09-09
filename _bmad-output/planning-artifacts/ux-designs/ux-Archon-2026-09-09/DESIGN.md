---
name: Archon
description: Readable agent transcript inside the node room, on both web surfaces. shadcn/Radix on Tailwind v4, dark-only; this DESIGN.md specifies the transcript delta over two inherited token sets and forks neither palette.
status: final
updated: 2026-09-10
sources:
  - ../../../specs/spec-readable-agent-transcript/SPEC.md
  - ../../../specs/spec-readable-agent-transcript/tool-presentation-contract.md
  - ../../../specs/spec-readable-agent-transcript/todo-fold-contract.md
  - ../../../specs/spec-workflow-run-view-hitl/ux-mockup/README.md
  - ../../../project-context.md
  - ../../../../packages/web/src/index.css
  - ../../../../packages/web/src/experiments/console/theme.css
colors:
  # Every value below is an EXISTING CSS variable. The CSS declares oklch; the hex here is the
  # gamut-clamped sRGB approximation for tooling. The variable name in the comment is the authority.
  #
  # Family chip hues — all four, shared by both surfaces. No token is introduced.
  node-bash: '#E49E22' # --node-bash      oklch(0.75 0.15 75)   index.css:30, Console inherits
  node-command: '#0089ED' # --node-command   oklch(0.62 0.18 250)  index.css:28, Console inherits
  node-prompt: '#7D5EE0' # --node-prompt    oklch(0.58 0.19 290)  index.css:29, Console inherits
  node-approval: '#FB794A' # --node-approval  oklch(0.72 0.17 40)   index.css:32, Console inherits
  #
  # Legacy surface — packages/web/src/index.css :root, hue 260
  surface-legacy: '#101215' # --surface
  surface-elevated-legacy: '#181B1F' # --surface-elevated
  surface-inset-legacy: '#050607' # --surface-inset
  surface-hover-legacy: '#1C1F24' # --surface-hover
  border-legacy: '#26292E' # --border
  border-bright-legacy: '#363B43' # --border-bright
  text-primary-legacy: '#E6E8EB' # --text-primary
  text-secondary-legacy: '#8C8F95' # --text-secondary
  text-tertiary-legacy: '#52555B' # --text-tertiary
  success-legacy: '#00AC5F' # --success
  error-legacy: '#DE3B3D' # --error
  warning-legacy: '#E49E22' # --warning
  running-legacy: '#35A9FF' # --accent-bright — index.css declares no --running; the mock uses accent-bright for ◐
  focus-legacy: '#35A9FF' # --accent-bright, 2px outline, offset -2px
  #
  # Console surface — console/theme.css .console-root, hue 265
  surface-console: '#0F1014' # --surface
  surface-elevated-console: '#15171B' # --surface-elevated
  surface-inset-console: '#06070A' # --surface-inset
  surface-hover-console: '#191C21' # --surface-hover
  border-console: '#25282E' # --border
  border-bright-console: '#383C44' # --border-bright
  text-primary-console: '#F5F7FA' # --text-primary
  text-secondary-console: '#A8ACB6' # --text-secondary
  text-tertiary-console: '#70757F' # --text-tertiary
  success-console: '#00D09B' # --success = --brand-teal
  error-console: '#FF4D64' # --error
  warning-console: '#E7B643' # --warning
  running-console: '#3DACFE' # --running
  focus-console:
    '#E400DE' # --accent-bright = brand magenta, opaque, 2px outline, offset 2px.
    # DELTA, not inheritance: console ships --accent-ring (30% alpha) at 1.4:1. See Colors.
typography:
  mono:
    note: 'Legacy --font-mono (JetBrains Mono, ui-monospace) · Console .console-root .font-mono (Geist Mono, ui-monospace). Inherited, never restated. Everything in the transcript except assistant prose.'
  sans:
    note: 'Legacy --font-sans (Inter) · Console .console-root (Geist with ss01/cv11). Assistant prose only.'
  row:
    fontSize: 12px
    fontWeight: '400'
  glyph:
    fontSize: 12px
    fontWeight: '700'
  chip:
    fontSize: 11px
    fontWeight: '400'
  badge:
    fontSize: 11px
    fontWeight: '400'
  body-bar:
    fontSize: 10.5px
    fontWeight: '400'
  body-text:
    fontSize: 11.5px
    lineHeight: '1.5'
  checklist:
    fontSize: 11.5px
    lineHeight: '1.85'
  phase-label:
    fontSize: 10px
    letterSpacing: 0.07em
  occurrence-header:
    fontSize: 10.5px
    letterSpacing: 0.08em
  assistant:
    fontSize: 12.5px
    lineHeight: '1.55'
  subtask-agent:
    fontSize: 11.5px
    fontWeight: '600'
rounded:
  sm: 4px # family chip, Raw button. Same radius as the room's node type-pill.
  md: 6px # row hover, body box, sub-card. Equals the inherited --radius-sm (calc(0.625rem - 4px)).
  lg: 0.625rem # --radius. Room chrome only; the transcript never uses it.
  full: 9999px # Reserved for the room's run and node status badges. Never on a transcript chip.
spacing:
  row-y: 4px
  row-x: 6px
  row-gap: 8px
  chevron-w: 9px
  glyph-w: 12px
  body-indent: 29px # chevron-w + row-gap + glyph-w — the body rail sits under the chip
  body-rail: 2px
  body-pad-left: 10px
  body-margin-bottom: 8px
  box-pad: 8px 10px
  chip-pad: 1px 7px
  chip-max: 24ch
  subcard-pad: 6px 9px
  occurrence-margin: 10px 0 5px
  kv-key-w: 11ch
components:
  tool-row:
    font: '{typography.mono}'
    fontSize: '{typography.row.fontSize}'
    padding: '{spacing.row-y} {spacing.row-x}'
    gap: '{spacing.row-gap}'
    radius: '{rounded.md}'
    hover-legacy: '{colors.surface-hover-legacy}'
    hover-console: '{colors.surface-hover-console}'
    focus-legacy: '{colors.focus-legacy}'
    focus-console: '{colors.focus-console}'
  chevron:
    width: '{spacing.chevron-w}'
    # The only element left in text-tertiary. It is decoration, hidden from assistive
    # technology, and carries no fact - so the 2.5:1 it measures on Legacy costs nothing.
    legacy: '{colors.text-tertiary-legacy}'
    console: '{colors.text-tertiary-console}'
  status-glyph:
    width: '{spacing.glyph-w}'
    fontWeight: '{typography.glyph.fontWeight}'
    succeeded-legacy: '{colors.success-legacy}'
    succeeded-console: '{colors.success-console}'
    failed-legacy: '{colors.error-legacy}'
    failed-console: '{colors.error-console}'
    running-legacy: '{colors.running-legacy}'
    running-console: '{colors.running-console}'
    interrupted-legacy: '{colors.warning-legacy}'
    interrupted-console: '{colors.warning-console}'
    unknown-legacy: '{colors.text-secondary-legacy}'
    unknown-console: '{colors.text-secondary-console}'
  family-chip:
    fontSize: '{typography.chip.fontSize}'
    padding: '{spacing.chip-pad}'
    radius: '{rounded.sm}'
    maxWidth: '{spacing.chip-max}'
    background-legacy: '{colors.surface-elevated-legacy}'
    background-console: '{colors.surface-elevated-console}'
    border: '1px solid, family hue at 40% (search and glob at 45%)'
    shell: '{colors.node-bash}'
    file: '{colors.node-command}'
    web: '{colors.node-command}'
    search: '{colors.node-prompt}'
    glob: '{colors.node-prompt}'
    code: '{colors.node-bash}'
    todo: '{colors.node-approval}'
    task: '{colors.node-approval}'
    generic-legacy: '{colors.text-secondary-legacy}'
    generic-console: '{colors.text-secondary-console}'
  headline:
    text-legacy: '{colors.text-primary-legacy}'
    text-console: '{colors.text-primary-console}'
    path-head-legacy: '{colors.text-secondary-legacy}'
    path-head-console: '{colors.text-secondary-console}'
    folded-todo-legacy: '{colors.text-secondary-legacy}'
    folded-todo-console: '{colors.text-secondary-console}'
  badge:
    fontSize: '{typography.badge.fontSize}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
    exit-nonzero-legacy: '{colors.error-legacy}'
    exit-nonzero-console: '{colors.error-console}'
    added-legacy: '{colors.success-legacy}'
    added-console: '{colors.success-console}'
    removed-legacy: '{colors.error-legacy}'
    removed-console: '{colors.error-console}'
    running-legacy: '{colors.running-legacy}'
    running-console: '{colors.running-console}'
  tool-body:
    marginLeft: '{spacing.body-indent}'
    marginBottom: '{spacing.body-margin-bottom}'
    rail: '{spacing.body-rail}'
    rail-legacy: '{colors.border-legacy}'
    rail-console: '{colors.border-console}'
    paddingLeft: '{spacing.body-pad-left}'
  body-bar:
    fontSize: '{typography.body-bar.fontSize}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
  raw-toggle:
    fontSize: '{typography.body-bar.fontSize}'
    radius: '{rounded.sm}'
    padding: '{spacing.chip-pad}'
    minHeight: 24px # SC 2.5.8. Grown by padding, so the painted box is unchanged.
    background: transparent
    border-legacy: '{colors.border-legacy}'
    border-console: '{colors.border-console}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
    open-text-legacy: '{colors.text-primary-legacy}'
    open-text-console: '{colors.text-primary-console}'
    open-border-legacy: '{colors.border-bright-legacy}'
    open-border-console: '{colors.border-bright-console}'
  body-box:
    fontSize: '{typography.body-text.fontSize}'
    lineHeight: '{typography.body-text.lineHeight}'
    padding: '{spacing.box-pad}'
    radius: '{rounded.md}'
    background-legacy: '{colors.surface-inset-legacy}'
    background-console: '{colors.surface-inset-console}'
    text-legacy: '{colors.text-primary-legacy}'
    text-console: '{colors.text-primary-console}'
    annotation-legacy: '{colors.text-secondary-legacy}' # line numbers, code comments
    annotation-console: '{colors.text-secondary-console}'
    prompt-sigil: '{colors.node-bash}'
    path: '{colors.node-command}'
    keyword: '{colors.node-prompt}'
    string-legacy: '{colors.success-legacy}'
    string-console: '{colors.success-console}'
  checklist:
    fontSize: '{typography.checklist.fontSize}'
    lineHeight: '{typography.checklist.lineHeight}'
    done-legacy: '{colors.success-legacy}'
    done-console: '{colors.success-console}'
    current-legacy: '{colors.running-legacy}'
    current-console: '{colors.running-console}'
    blocked-legacy: '{colors.warning-legacy}'
    blocked-console: '{colors.warning-console}'
    pending-legacy: '{colors.text-secondary-legacy}'
    pending-console: '{colors.text-secondary-console}'
    abandoned: 'pending colour plus line-through'
    phase-label: '{typography.phase-label}'
  subtask-card:
    padding: '{spacing.subcard-pad}'
    radius: '{rounded.md}'
    background-legacy: '{colors.surface-elevated-legacy}'
    background-console: '{colors.surface-elevated-console}'
    agent: '{colors.node-approval}'
    agent-weight: '{typography.subtask-agent.fontWeight}'
  kv-list:
    fontSize: '{typography.body-text.fontSize}'
    keyWidth: '{spacing.kv-key-w}'
    key-legacy: '{colors.text-secondary-legacy}'
    key-console: '{colors.text-secondary-console}'
    value-legacy: '{colors.text-primary-legacy}'
    value-console: '{colors.text-primary-console}'
  occurrence-header:
    fontSize: '{typography.occurrence-header.fontSize}'
    letterSpacing: '{typography.occurrence-header.letterSpacing}'
    margin: '{spacing.occurrence-margin}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
    rule-legacy: '{colors.border-legacy}'
    rule-console: '{colors.border-console}'
  assistant-text:
    font: '{typography.sans}'
    fontSize: '{typography.assistant.fontSize}'
    lineHeight: '{typography.assistant.lineHeight}'
    text-legacy: '{colors.text-secondary-legacy}'
    text-console: '{colors.text-secondary-console}'
---

## Brand & Style

The transcript is a reading surface inside a room whose chrome is already settled.
It replaces two always-open blocks of JSON per tool call with one scan-line per call, so its whole aesthetic is restraint: monospace, one glyph, one coloured chip, one headline, badges at the right edge, nothing else until the reader opens a row.

Two surfaces render it and neither gets its own look.
Legacy (`WorkflowExecution` node room) inherits `packages/web/src/index.css`: hue 260, Inter, JetBrains Mono.
Console (`/console` node room) inherits `packages/web/src/experiments/console/theme.css`: hue 265, Geist, Geist Mono, brand teal as success, electric blue as running.
The row anatomy is byte-identical between the two key screens; only the `:root` block differs.
That is the visual proof of the one-presenter-two-renderers constraint, and it is the rule: the transcript never declares a colour, font, or radius that is not already a variable on the surface it sits in.

The brainstorm imports (`imports/superpowers-transcript-v1.html`, `imports/superpowers-transcript-v2.html`) settled the row anatomy but carry GitHub-dark hexes; none of those values survive.
Dark-only today, because both token sources are dark-only.

Where this file disagrees with any mock, wireframe, or import, this file wins.

## Colors

Salience runs status → chip → text.
The status glyph must be the loudest colour on the row, the family chip second, and everything else a grey.
That ordering is why the family palette has five treatments, not nine: siblings share a hue so nine distinct chips never compete with ✓ ✕ ◐ ⚠ for the eye.

**Family chips** — every hue is an existing `--node-*` token declared in `index.css` and inherited by Console.
No token is introduced on either surface.
Legend and all nine families are rendered in `mockups/key-transcript-states.html` §A and §C.

| Family       | Token                                                                | Why this hue                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shell, code  | `{colors.node-bash}`                                                 | The room already paints bash nodes amber; a shell call inside a node is the same idea one level down, and `eval` executes too. Chip text (`eval` against `run_terminal_command`) carries the distinction. |
| file, web    | `{colors.node-command}`                                              | Blue is the room's "reads a named thing" colour. A URL is a path.                                                                                                                                         |
| search, glob | `{colors.node-prompt}`                                               | Violet is the room's prompt hue; searching is asking the repo a question.                                                                                                                                 |
| todo, task   | `{colors.node-approval}`                                             | Orange is the room's human-gate colour; planning and dispatch are the agent's own coordination.                                                                                                           |
| generic      | `{colors.text-secondary-legacy}` / `{colors.text-secondary-console}` | No hue. An unknown tool must not borrow a family's meaning.                                                                                                                                               |

**`code` sharing amber is a user decision, taken after the mock review.** The review first settled a six-treatment mapping that gave `code` its own green `--node-script`; reconciling the imports then showed that token is declared **only** in `console/theme.css:88`, whose own comment scopes it to the console "until the production palette needs them", and that `index.css` has no such token — so the mapping was not, as recorded, all-inherited. Presented with promoting the token or folding `code` into amber, the user chose amber.
Giving `code` its own hue would mean promoting a production token and updating the brand guide with it — out of scope for a track that changes no backend and adds no token, for a family that is 3.6% of the corpus.
If Console ever replaces Legacy, `--node-script` is present by definition and splitting `code` back out is a one-line change.

**Status** — glyph colour reinforces the character, never replaces it.
✓ `{colors.success-legacy}` / `{colors.success-console}`; ✕ `{colors.error-legacy}` / `{colors.error-console}`; ◐ `{colors.running-legacy}` / `{colors.running-console}`; ⚠ `{colors.warning-legacy}` / `{colors.warning-console}`; – `{colors.text-secondary-legacy}` / `{colors.text-secondary-console}`.
Legacy has no `--running`; the ◐ glyph uses `--accent-bright`, the surface's only bright blue.
A folded-away todo call keeps the ✓ glyph at **full strength**, and the – glyph stays reserved for a genuinely unknown outcome or missing output.
Dimming the glyph was measured and dropped: `--success` at 55% over `--surface` gives 2.69:1 on Legacy and 3.56:1 on Console, and a 12px bold character is not large text, so both fail 4.5:1 and Legacy also falls under the 3:1 floor this document invokes for glyphs elsewhere.
The row is already subordinate through its tertiary `todo updated` headline and its `op: <op>` badge, so the dimming bought redundant emphasis with the one budget the glyph could not spare. Full strength also restores the user's own choice of glyph treatment, in which colour reinforces the character and never carries state alone.

`⚠` covers the fifth outcome, `interrupted`, and it is a fifth _character_ rather than a recoloured `✕` because the tool was **stopped**, not failed — the two need different reader responses.
`--warning` is declared on **both** surfaces (`index.css:24`, `console/theme.css:79`), so the glyph inherits with no new token; the gap that caught `code` and `--node-script` does not repeat here.
Only Claude ever produces the outcome, from the `PostToolUseFailure` hook when `is_interrupt` is true (`packages/providers/src/claude/provider.ts:952-959`) — a hook that already writes the same glyph into the output text, so the row and its body agree without extra work.
Codex cannot produce it at all: its union is `success`/`error`/`unknown` (`codex/provider.ts:644-650`).

One collision is worth naming. On Legacy, `--warning` and `--node-bash` are the same value — `oklch(0.75 0.15 75)` at `index.css:24` and `:30` — so an interrupted **shell** row draws its `⚠` in the same amber as its own chip, the one case where the glyph does not out-shout the chip beside it. The shape still separates them, the case is rare (Claude only, and only on a true interrupt), and the alternative is a new token this track has ruled out. Recorded, not redesigned.

**Surfaces** — three tonal steps and no more.
`surface` is the panel.
`surface-elevated` lifts chips and subtask cards off it.
`surface-inset` sinks terminal, diff, match, path, code, and raw boxes into it.
`surface-hover` appears only on a hovered row.

**Text** — three tiers.
`text-primary` is the headline and the filename tail.
`text-secondary` is the path head, body text, assistant prose, and the generic chip.
`text-secondary` is badges, body bar, occurrence header, key-value keys, and the "todo updated" headline — everything that carries a _fact_ but is not the headline.
`text-tertiary` is the chevron, and nothing else. The three-tier ramp therefore reads primary → secondary → _weight and rhythm_, not primary → secondary → dimmer: the folded todo row stays subordinate because its headline drops from primary to secondary while every other headline stays primary, and the badge stays quieter than the headline for the same reason.

**Inside body boxes**, four accents reuse the palette so the eye learns one vocabulary: `$` sigil in `{colors.node-bash}`, paths in `{colors.node-command}`, keywords in `{colors.node-prompt}`, strings in `{colors.success-legacy}` / `{colors.success-console}` — the same green the diff and pass lines already use.
Diff lines use success for `+` and error for `−`; `FAILED`/`ok` markers use error/success bold.

**Measured contrast** — every cell converted oklch → sRGB → relative luminance from the two token files, not estimated. Target 4.5:1 for all transcript text, which is 10–12px.

| Pair                                                                      | Legacy    | Console   |
| ------------------------------------------------------------------------- | --------- | --------- |
| text-primary on surface                                                   | 15.3:1    | 17.7:1    |
| text-secondary on surface                                                 | 5.8:1     | 8.4:1     |
| text-tertiary on surface — chevron only, decorative                       | 2.5:1     | 4.1:1     |
| success glyph on surface                                                  | 6.3:1     | 9.5:1     |
| error glyph and `exit n` badge on surface                                 | **4.3:1** | 5.9:1     |
| running glyph on surface                                                  | 7.4:1     | 7.7:1     |
| node-bash chip on surface-elevated                                        | 7.6:1     | 7.9:1     |
| node-command chip on surface-elevated                                     | 4.8:1     | 4.9:1     |
| node-prompt chip on surface-elevated                                      | **3.8:1** | **3.9:1** |
| node-approval chip on surface-elevated                                    | 6.5:1     | 6.8:1     |
| text-secondary on surface-hover (the state a pointer reader is in)        | 5.1:1     | 7.5:1     |
| text-secondary on surface-inset (raw box, key column)                     | 6.3:1     | 8.9:1     |
| warning glyph on surface (`⚠`)                                            | 8.3:1     | 10.1:1    |
| node-prompt on surface-inset (code-body keywords)                         | **4.4:1** | **4.4:1** |
| focus ring on surface — `--accent-ring`, the token Console ships          | **1.4:1** | **1.4:1** |
| focus ring on surface — `--accent-bright`, the token this spine specifies | 7.4:1     | 4.9:1     |

The bold cells are inherited product tokens that fall short. The last two rows are the exception to "used exactly as the mocks use them", and the difference matters:

**The focus ring is the one place this spine knowingly departs from the shipped surface.** Console's `:focus-visible` is `outline: 2px solid var(--accent-ring)` (`theme.css:153-156`), and `--accent-ring` is magenta at 30% alpha (`theme.css:68`), which composites over `--surface` to **1.4:1** — under the 3:1 floor of SC 1.4.11, and a keyboard reader effectively cannot see where they are. All three mocks quietly drew the opaque token instead, and this spine now states that on purpose: **the transcript row's focus ring is `--accent-bright`**, which is an existing token, so the no-new-token constraint holds.

That is scoped to the transcript row. The same 1.4:1 ring is on every other focusable element in the console, which is room chrome and out of scope here — recorded so the next person finds it, not silently inherited.

Everything else bold is listed under Open Questions; this spine changes no token the user has ruled out changing.

## Typography

Monospace is the transcript's voice.
Rows, chips, badges, bodies, checklists, occurrence headers, and key-value lists all set `{typography.mono}` at the sizes in the frontmatter ramp.
Assistant prose is the one exception and sets `{typography.sans}` at `{typography.assistant.fontSize}` / `{typography.assistant.lineHeight}`, so the model's sentences read as sentences between the machine's lines.

The ramp is narrow on purpose: 12px row, 11px chip and badge, 11.5px body, 10.5px body bar and occurrence header, 10px phase label.
Two pixels separate a row from its body and a body from its bar; that is enough hierarchy for a panel 460–520px wide.

Only the status glyph is bold (`{typography.glyph.fontWeight}`).
A subtask's agent name is semibold (`{typography.subtask-agent.fontWeight}`); everything else is regular weight.
Uppercase with tracking marks exactly two things: the occurrence header (`{typography.occurrence-header.letterSpacing}`) and a todo phase label (`{typography.phase-label.letterSpacing}`).

Chip text is the tool name as the provider sent it — `read_file`, `Edit`, `Grep`, `eval` — because that is what the reader recognises; only the colour says which family it resolved to.

## Layout & Spacing

One row is one scan-line, laid out as a flex line with `{spacing.row-gap}` between five parts:

```
▸    ✓    [chip]   headline ……………………………   badges
9px  12px  auto     flex 1 · min-width 0       auto
```

The chevron and glyph are fixed columns so every chip starts at the same x.
The chip is `flex: 0 0 auto` capped at `{spacing.chip-max}` with an ellipsis inside the pill. The cap is a guard that should never fire: a name over 24 characters is replaced by the family name upstream, in the resolver, so the pill has nothing left to truncate.
The headline takes the remaining width and must carry `min-width: 0` or it will not shrink.
Badges are `flex: 0 0 auto` and never wrap.

A path headline is two spans: a head that may shrink (`flex: 0 1 auto`) and a tail that may not (`flex: 0 0 auto`), which is how the filename survives on a narrow panel.
The head must not grow; a grow value pushes the tail away on short paths (fix recorded from the screenshot pass).

The expanded body indents `{spacing.body-indent}` — chevron plus gap plus glyph — so its `{spacing.body-rail}` rail sits directly under the chip, then pads `{spacing.body-pad-left}`.
Inside, the body bar is a flex line with the Raw button pushed to the far right by `margin-left: auto`.
Grep results flow `path:line` inline, not in a fixed line-number column; the fixed `3ch` column is for diff line numbers only.

**The transcript must not depend on a panel width.** No shipped component pins one; the only number in the room contract is `#node-panel { width: 460px }` (`../../../specs/spec-workflow-run-view-hitl/ux-mockup/styles.css:1111`), which its Console and Legacy mockups share, and the 520px in this run's Console mock is the mock's own choice with no source behind it. Treat 460px as the width to verify against, because it is the narrower of the two and the only one the contract states.
The transcript adapts by elision and badge priority, never by wrapping a row.
See `mockups/key-console-node-room.html` and `mockups/key-legacy-node-room.html` for the transcript at each width.

## Elevation & Depth

No shadows.
Depth is tonal: chips and subtask cards sit on `surface-elevated`, body boxes sink to `surface-inset`, everything else rests on `surface`.
The body rail (`{spacing.body-rail}` of `border`) is the only line that says "this belongs to the row above".
A hovered row lifts to `surface-hover`; a focused row gets a 2px outline in the surface's focus colour and no fill.
The occurrence header's horizontal rule is `border`, 1px, and fills the width after the label.

## Shapes

`{rounded.md}` (6px) on rows, body boxes, subtask cards, and focus rings — the same 6px as the inherited `--radius-sm`.
`{rounded.sm}` (4px) on the family chip and the Raw button, matching the room's node type-pill so a chip reads as "a kind of thing", not a status.
`{rounded.full}` is reserved for the room's run and node status badges; a transcript chip is never a pill, so a family chip can never be mistaken for a status badge.
`{rounded.lg}` belongs to the room chrome and does not appear inside the transcript.

## Components

Visual spec only. Behaviour is in `EXPERIENCE.md` Component Patterns.
All nine families, four hard cases, glyph row, occurrence header options, and the open Raw toggle are rendered in `mockups/key-transcript-states.html`.

**Tool row** (`{components.tool-row}`) — a `<details>` whose `<summary>` is the scan-line; the native marker is hidden and replaced by the chevron.
Padding `{spacing.row-y} {spacing.row-x}`, radius `{rounded.md}`, `{typography.row}`.
Hover fills `surface-hover`; focus-visible draws the surface's focus outline; open rotates the chevron 90° over 120ms.

**Status glyph** (`{components.status-glyph}`) — a 12px fixed column, bold, centred: ✓ success, ✕ error, ◐ running, – tertiary.
Four different characters; colour is added on top.

**Family chip** (`{components.family-chip}`) — `{typography.chip}` on `surface-elevated`, padding `{spacing.chip-pad}`, radius `{rounded.sm}`, 1px border in the family hue mixed to 40% (search and glob 45%), text in the family hue.
The generic chip has text-secondary text and the plain `border` colour.
Max width `{spacing.chip-max}`; overflow ellipsises inside the pill, never bursts it.

**Headline** (`{components.headline}`) — text-primary, single line, end-ellipsis.
A path headline is head (text-secondary, shrinkable) plus tail (text-primary, fixed).
The folded "todo updated" headline is text-secondary — one step down from a live row's primary headline, which is what makes it subordinate.

**Badges** (`{components.badge}`) — `{typography.badge}` in text-secondary, `·`-separated.
Non-zero exit codes and `−m` use error; `+n` uses success; the word `running` uses the running colour.

**Tool body** (`{components.tool-body}`) — indent, rail, padding as specified.
Its first line is the **body bar** (`{components.body-bar}`): text-secondary facts on the left, the **Raw toggle** (`{components.raw-toggle}`) at the far right.
**The body bar opens with the resolved family**, then the family's own facts — `shell · exit 101 · 41.2s · cwd …`, `file · 1 hunk · replace_all: false`. That one word is the only place the family is stated in text, and it is what a reader who cannot separate the chip hues has to read instead. The chip carries the same string as a `title`, so a pointer reader gets it without opening the row.
Raw is a bordered text button, transparent fill; open state swaps to text-primary text and `border-bright`, with a `▾` suffix.

**Body box** (`{components.body-box}`) — the container for terminal, diff, matches, paths, code, and raw JSON: `surface-inset`, 1px `border`, radius `{rounded.md}`, `{spacing.box-pad}`, `{typography.body-text}`, text-secondary, `pre-wrap`.
Terminal: `$` sigil in node-bash, `FAILED` bold error.
Diff: a `3ch` right-aligned tertiary line-number column, `−` lines error, `+` lines success.
Matches: path in node-command, `:line` tertiary inline, then the match text.
Paths: one node-command path per line.
Code: keywords node-prompt, strings success, comments tertiary; the result sits in a second box 6px below.
Raw: text-secondary JSON.

**Checklist** (`{components.checklist}`) — `{typography.checklist}`, text-secondary items.
Phase label is `{typography.phase-label}` uppercase tertiary with 4px top margin.
Item glyphs: ☑ success, ◐ running colour, ⊘ warning, ☐ tertiary, and an abandoned item is ☐ with line-through in tertiary followed by `· dropped`.
A blocked item carries `· blocked: <reason>` in tertiary.

**Folded todo row** — a Tool row for every todo call except the last: glyph `✓` at full strength, the todo chip in `{colors.node-approval}`, headline `todo updated` in text-secondary (`{components.headline.folded-todo-legacy}` / `{components.headline.folded-todo-console}`), badge `op: <op>`.
Same height and anatomy as any other row, so it does not interrupt the scan.

**Subtask card** (`{components.subtask-card}`) — `surface-elevated`, 1px `border`, radius `{rounded.md}`, `{spacing.subcard-pad}`, 5px top margin.
Agent name in node-approval semibold, `·`, subtask name bold, `—` then prompt excerpt in tertiary.
Batch context, when present, is one text-secondary line above the first card.

**Key-value list** (`{components.kv-list}`) — up to three rows, key in tertiary at `{spacing.kv-key-w}`, value in text-secondary; `{…}` and `[n]` are literal text.

**Occurrence header** (`{components.occurrence-header}`) — `{typography.occurrence-header}` uppercase tertiary label, then a 1px `border` rule to the right edge; margin `{spacing.occurrence-margin}`.

**Assistant text** (`{components.assistant-text}`) — sans, text-secondary, with a 10px uppercase tertiary `assistant` role label above it on the room screens.
Inline code inside it is mono at 11px.

## Do's and Don'ts

| Do                                                                       | Don't                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Resolve every colour to an existing `--*` variable on the surface        | Carry a GitHub-dark hex from the brainstorm imports                 |
| Keep the row anatomy identical on both surfaces; vary only `:root`       | Give Console or Legacy a different chevron, glyph, or chip shape    |
| Let the status glyph out-shout the chip, and the chip out-shout the text | Add a sixth chip treatment or split a sibling pair onto its own hue |
| Show the ✓ ✕ ◐ – character and colour it                                 | Encode outcome in colour alone, a dot, or a left bar                |
| Elide paths in the middle so the filename survives                       | Tail-cut a path                                                     |
| Cap the chip at `{spacing.chip-max}` and ellipsise inside it             | Let a Codex command or MCP name burst the chip                      |
| Sink bodies to `surface-inset`, lift chips to `surface-elevated`         | Use shadows, gradients, or the brand gradient inside the transcript |
| Use `{rounded.sm}` on chips, `{rounded.md}` on rows and boxes            | Use `{rounded.full}` on anything in the transcript                  |
| Keep raw JSON in a text-secondary body box behind Raw                    | Render JSON as a default presentation anywhere on the row or body   |
| Set assistant prose in sans                                              | Set tool rows, chips, or badges in sans                             |

## Open Questions

1. **The family hue for a sighted colour-blind reader.** The screen-reader half is closed — the family now travels in the chip's accessible name. The visual half is not: `--node-bash` (75°) against `--node-approval` (40°) collapses under protanopia and deuteranopia, so five treatments become two or three, and the generic grey that means _"this tool was not recognised"_ stops being distinguishable from a recognised one. The tool name usually implies the family, but the two cases this document itself calls out — `eval` against `run_terminal_command` sharing amber, and generic against recognised — are exactly where the name does not carry it.
   Resolved — see the entry below.

Every question this run opened is now answered. What follows is the record.

**Resolved during finalize**, from the accessibility review, from live code, and from three user decisions:

- **Every transcript fact moved from `--text-tertiary` to `--text-secondary`, on both surfaces** — a user decision, taken with the measurements in hand. `--text-tertiary` carried every badge, body bar, occurrence header and key name at 10–11.5px, where 4.5:1 applies without argument, and it measured 2.53:1 on Legacy and 4.07:1 on Console resting, worse on hover. The headline beside a failing badge passes at 15.3:1, so the effect was exact: a reader with low contrast sensitivity got the command and not the result. `--text-secondary` clears the floor everywhere (5.82:1 / 8.37:1) and is an existing token, so the no-new-token constraint holds. `--text-tertiary` now has exactly one use, the chevron, which is decoration hidden from assistive technology. The third tonal step is replaced by the primary-to-secondary headline drop and by the `·` rhythm.
- The old question about the `exit 101` badge went with it: the badge is now `--text-secondary` with `--error` kept on the digits, so nothing in it sits under the floor.
- **The Raw toggle carries `min-height: 24px`; the tool row keeps its 22px** — a user decision. Raw was the target that genuinely missed SC 2.5.8: about 15–17px, at the far right of the body bar, near the panel's drag-to-resize edge. It grows through padding, so the painted box does not change. The row's 2px shortfall is accepted deliberately, because density is the feature the transcript exists to deliver and the audience reaches it with a pointer — recorded here so a later audit inherits a reason rather than a surprise. Revisit if the surface is ever targeted at touch.
- **The family reaches a colour-blind reader through the body bar and a tooltip, not a chip prefix** — a user decision. A prefix would have cost row width on the one line that must never wrap, and at 460px the path headline pays first. See **Components → Tool body**.
- `interrupted` takes `⚠` in `--warning` — see **Colors → Status**.
- The Console focus ring is `--accent-bright`, opaque, **not** `--accent-ring`. The frontmatter previously named the 30%-alpha glow token, which composites to 1.35:1 over `--surface` and would leave every keyboard user on the default route without a visible position. The mocks always used the opaque token at 4.85:1; the spine now agrees with them.
- The folded-todo `✓` renders at full strength. Dimming it to 55% measured 2.69:1 on Legacy and 3.56:1 on Console — see **Colors → Status**.
