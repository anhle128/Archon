# Validation Report — Readable agent transcript (Archon)

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-09/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-09/EXPERIENCE.md`
- **Reviewers:** `review-rubric.md`, `review-accessibility.md`
- **Snapshot re-checked at:** 2026-09-10T00:53:50+07:00
- **Run at:** 2026-09-10T00:55:50+07:00

## Overall verdict

The token layer is the strongest part of this pair, and it is verifiably correct: 89 distinct `{path.to.token}` references over 236 defined paths resolved with zero misses, and an independent recomputation of all 20 published contrast ratios from the oklch declarations reproduced every cell. The weak part was the transcript's relation to the room around it. The Information Architecture section stated a surface difference in occurrence filtering that the shipped code contradicted, and the whole `Run N` occurrence header — the reader-visible payoff of CAP-6 — depended on that statement. Three more faults were stale text: a decision was resolved in one section and its earlier assumption was left standing in another, so a builder found two answers to the same question.

The accessibility lens re-measured every ratio from the CSS rather than from the spine, and it moved the picture in one direction: the shortfall was wider than the spine recorded. Console failed on tertiary text as well as Legacy, the hovered row was worse than the resting row on both surfaces, and the Console focus ring composited to 1.4:1 against a 3:1 floor. The lens also recorded what the design gets right, and that part is real — outcome never depends on colour, the primary reading path passes everywhere, and the spine published its own failing cells instead of hiding them.

**This is a post-resolution report.** Both reviewers ran, and the spines changed after each one returned. Every finding carries a disposition beside its severity. Severity is the reviewer's judgment of the snapshot they read, and it is never re-graded here. Disposition is a separate axis and records what happened next. Of 41 findings, **30 are closed and 11 remain open** against the spines at the snapshot timestamp. Two of the eleven are cosmetic wording items and one is mock-only, which leaves eight that change what a builder makes — two of them critical.

## Disposition key

| Disposition       | Meaning                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| **fixed**         | The spine changed. The finding no longer applies to the text.                            |
| **user decision** | The question went to the user, and the user answered it. Three questions took this path. |
| **accepted**      | The shortfall stays, and the spine records the reason.                                   |
| **superseded**    | A later correction made the finding moot.                                                |
| **open**          | The finding still applies to the spines at this report's timestamp.                      |

## Category verdicts

- Flow coverage — adequate
- Token completeness — strong
- Component coverage — thin
- State coverage — adequate
- Visual reference coverage — strong
- Bloat & overspecification — strong
- Inheritance discipline — thin
- Shape fit — strong

## Findings by severity

Two findings were reached by both lenses. Each is counted once, at the higher severity, and cross-referenced.

### Critical (13)

**[Rubric §1 Flow coverage]** — Flow 2 rests on the occurrence-filtering claim (EXPERIENCE.md → Key Flows, Flow 2 steps 2–3) · **open**
Reviewer: "Under an occurrence chip the messages request carries `occurrenceId`, so Run 1's rows are not in the payload." The fix was two steps: settle the filtering question, then re-walk Flow 2.
Disposition: the root cause is fixed and the second step is not done. Information Architecture is rewritten. Flow 2 step 3 still lists Run 1 and Run 2 together under one occurrence chip, which the corrected rule contradicts.
Next: re-walk Flow 2 steps 2–3.

**[Rubric §3 Component coverage]** — The `web` family has no body arm anywhere (EXPERIENCE.md → Component Patterns; DESIGN.md → Components) · **open**
Reviewer: "A builder opening a `WebFetch` row has no rule." The upstream contract declares one: `tool-presentation-contract.md`, row `web`, "url and title, output as markdown".
Disposition: six `Body box` rows exist and none covers `web`.
Next: add a `Body box: web` row and its visual arm, or state which existing arm `web` uses.

**[Rubric §3 Component coverage]** — The `⚠` glyph did not reach two `DESIGN.md` sections (DESIGN.md → Components, Do's and Don'ts) · **fixed**
Reviewer: "Components is the section a builder implements."
Disposition: fixed at both sites. Components now reads "✓ success, ✕ error, ◐ running, ⚠ interrupted, – unknown", and the Do's row carries the same five characters.

**[Rubric §3 Component coverage]** — Two chip-label rules stand at once (EXPERIENCE.md and DESIGN.md, four sites) · **fixed**
Reviewer: the two rules count different things — the contract counts characters of the tool name, and `{spacing.chip-max}` is a CSS width of `24ch`.
Disposition: fixed. A tool name over 24 characters now chips the family, so `get_command_or_subagent_output` reads `generic`, and the cap is stated as a guard that should never fire. Residual: three secondary sites still name the cap without that guard sentence.

**[Rubric §3 Component coverage]** — The full-output control has two homes (EXPERIENCE.md → Component Patterns, State Patterns, Flow 3) · **fixed**
Disposition: fixed. The superseded assumption is deleted, the body bar says the control is not there, and Flow 3 names the button under the body. The reason is recorded: the control fetches more bytes, and Raw redraws the same bytes.

**[Rubric §4 State coverage + Accessibility N-1]** — Two keyboard rules stand at once (EXPERIENCE.md → Interaction Primitives, Accessibility Floor) · **fixed**
Accessibility lens: "There is no such native behaviour … Arrow keys do nothing to focus."
Disposition: fixed. The superseded assumption is deleted. Only the resolved answer remains, with its reason: a transcript is a list of disclosures, not a composite widget.

**[Rubric §7 Inheritance discipline]** — The occurrence-filtering claim is contradicted by the code it cites (EXPERIENCE.md → Information Architecture) · **fixed**
Reviewer: "the absence of a client-side second pass is not the absence of filtering … This is new evidence, not a counter-argument: it names two files the recorded decision does not cite."
Disposition: fixed. The section now separates the two filters — the server applies the occurrence filter from `occurrenceId` and `attemptId`, and the client applies the loop-iteration slice — and confirms the quoted README wording for both rooms.

**[Rubric §7 Inheritance discipline]** — "Console does not filter at all" is false (EXPERIENCE.md → Information Architecture) · **fixed**
Reviewer: "the cited lines 379-400 render a different surface … not a tool transcript."
Disposition: fixed. The section states that both surfaces behave the same way and cites Console's own call site and its own copy of the module.

**[Accessibility B-1 + Rubric §2 low]** — The Console focus ring fails, and the spine records the wrong value for it (console/theme.css:153-157; DESIGN.md:54) · **fixed**
Accessibility lens: "ratio **1.36:1** … A builder who trusts the frontmatter will ship an invisible focus ring and believe it was specified."
Disposition: fixed, and both lenses are recorded because each contributed a different fact. The rubric asked for the hex, the comment and the variable name to agree. This lens supplied the measurement and the ownership: the shipped token is 1.36:1, and the passing 2px `--accent-bright` outline "exists only in the states sheet" — neither room mockup defines a focus rule at all. The spine now carries both: the shipped 1.4:1 value is a row in the contrast table, and `--accent-bright` for the transcript row is named as a deliberate departure from the shipped Console rather than an inheritance. The 1.4:1 ring stays on the room chrome, which is out of scope. Neither lens chose the remedy; this one listed four options and declined ("Options A and B touch a token, which is outside my remit").

**[Accessibility B-2]** — Legacy `--error` is below 4.5:1 for the `exit n` badge (4.29:1, and 3.78:1 on hover) · **accepted**
Accessibility lens: "The failure stands whichever way the glyph is classified." On the deletion argument: "That is a product judgement, not an accessibility one. It is the user's to make."
Disposition: accepted with a recorded reason. The contrast table carries the shortfall in bold: "error glyph and `exit n` badge on surface — **4.3:1** Legacy, 5.9:1 Console". The second half of the finding is fixed — the false threshold argument is gone, and no section now claims the bold `✕` passes a 3:1 graphical-object floor. One number did not travel: the 3.78:1 hover figure is in the review file only, and the spine's table carries the resting value.

**[Accessibility B-3]** — The folded todo `✓` at 55% opacity fails on both surfaces (2.70:1 Legacy, 3.58:1 Console) · **fixed**
Accessibility lens: "the glyph is the outcome carrier for the row … The glyph is the only status the reader gets."
Disposition: fixed. The opacity is dropped. The user's own glyph choice was full-strength colour reinforcement, so the dimming was an unratified assumption. The folded row keeps its subordination by dropping its headline from primary to secondary. Nothing was made quieter to restore the difference; the content was made louder.

**[Accessibility B-4]** — The Raw button has no perceivable boundary and no readable label on Legacy · **user decision**
Accessibility lens: "border 1.29:1 … label 2.51:1 … 1.4.11 permits a weak boundary when the label alone identifies the control. That exception does not apply here, because the label also fails."
Disposition: both halves are closed, by two different routes. The label is fixed by user decision — every transcript fact moved to `--text-secondary`, so Raw's label measures 5.8:1 Legacy and 8.4:1 Console. The border is accepted with a recorded reason, and the spine answers the lens on its own ground: the border stays at 1.3:1 and 1.2:1 "because the criterion asks for the information _required to identify_ a control, and the word `Raw` at 5.8:1 / 8.4:1 does that". That is the 1.4.11 exception the lens ruled out while the label was failing, and it applies now that the label passes.

**[Accessibility B-5]** — Legacy `--text-tertiary` carries the unknown outcome at 2.51:1 (EXPERIENCE.md:120-121) · **user decision**
Accessibility lens: "This is not secondary information. It is one of the five outcomes the feature exists to report."
Disposition: fixed by user decision, and wider than the finding asked. Every transcript fact moved from `--text-tertiary` to `--text-secondary` on both surfaces. `--text-secondary` clears the floor everywhere (5.8:1 / 8.4:1) and is an existing token, so the no-new-token constraint holds. `--text-tertiary` now has exactly one use: the chevron, which carries no fact and is hidden from assistive technology.

### High (4)

**[Rubric §3 Component coverage]** — The subtask card is collapsible with no visual disclosure spec (DESIGN.md → Components, Subtask card) · **open**
Reviewer: "no toggle affordance and no expanded appearance. The upstream contract requires it: `SPEC.md` CAP-4."
Next: add the disclosure affordance and the expanded appearance.

**[Rubric §4 State coverage]** — An open row whose result has not arrived has no rule (EXPERIENCE.md → State Patterns) · **open**
Reviewer: "Nothing states what the body holds when there is no output — an empty terminal box, a partial one, or the body bar alone."
Next: add a state row for an expanded tool with no result yet.

**[Rubric §4 State coverage]** — The iteration filter and the occurrence header collide · **open in part**
Reviewer: "Both rules are deterministic; the intent is not recorded."
Disposition: the Information Architecture rewrite settles the occurrence-chip half — the server scopes the payload, so no header renders there. The loop-iteration half is unrecorded.
Next: state what the header does under an active iteration filter.

**[Rubric §7 Inheritance discipline]** — Two sections disagree on whether the surfaces differ · **fixed**
Reviewer judged Responsive & Platform right and Information Architecture wrong.
Disposition: fixed with the rewrite. The claim of a genuine difference is gone, and the two sections agree.

### Medium (11)

**[Rubric §1 Flow coverage]** — CAP-4 is claimed but never walked · **fixed** — Flow 1 now opens the task row, so CAP-4 is demonstrated and not only claimed.

**[Rubric §2 Token completeness]** — The `interrupted` badge has no colour token · **superseded** — the text-tier decision gave every badge one colour, `text-secondary`, on both surfaces, so a per-state badge pair is no longer the open question it was. The glyph keeps its own warning pair.

**[Rubric §3 Component coverage]** — The Raw button has no hover state and no focus appearance · **fixed** — the Raw toggle block now states "Hover and focus raise it to `border-bright` and `text-primary`, which is where the affordance is confirmed." The states reuse the tokens the open state already holds, so the frontmatter needs no new key.

**[Rubric §4 State coverage]** — The transcript has no load-error state · **open** — cold load and connection lost are covered; a failed fetch of the node's messages is not. Next: add the state, or state that it stays the room's.

**[Rubric §4 State coverage]** — One assumption has no matching Open Question (Raw placement) · **superseded** — the Open Questions list now reads "None", and Raw's placement is stated as a rule at Component Patterns.

**[Rubric §7 Inheritance discipline]** — A count does not match the table it cites ("four inherited token pairs") · **fixed** — the sentence no longer states a count.

**[Accessibility N-2]** — Screen-reader semantics are unspecified, and two defaults read badly · **fixed** — the chevron is hidden from assistive technology, the glyph carries a required accessible name, and the elision reconciliation kept the CSS two-span rule authoritative, because the produced-string wording would have destroyed the path for assistive technology and for copy. `aria-expanded` comes free from the native element, with a build-time verification step recorded.

**[Accessibility N-3]** — Family is conveyed by colour alone (WCAG 1.4.1) · **user decision** — the family now travels on three channels: the chip's accessible name, the chip's `title`, and the first word of the body bar. The body bar always works, so that word is a requirement and is never dropped under width pressure. A family prefix inside the chip was rejected because it costs row width on the one line that must never wrap.

**[Accessibility N-5]** — Streaming: no scroll anchoring and no focus-stability rule · **fixed** — scroll anchoring and focus-on-append are specified from Console's shipped behaviour, with `scroll-margin-top` against the sticky header. The announcement rule was corrected at the same time to one polite `role="status"` region for node transitions and failures; the earlier "announce nothing" plan rested on a panel badge that has no role and no live region.

**[Accessibility N-7]** — Target size is borderline and must be measured in a browser · **user decision** — the Raw toggle grows to a 24px minimum height through padding, so its painted box is unchanged. The 22px tool row keeps its 2px shortfall against SC 2.5.8 as a recorded decision: row density is the feature the transcript exists to deliver, and the surface is reached with a pointer. Revisit if the surface is ever targeted at touch.

**[Accessibility N-9]** — Occurrence headers are not headings · **open** — the header is still a plain `<div>` and neither spine states a heading level or a labelled region. Next: render it as a heading at the right level, or give the group a labelled region. It stays non-interactive either way.

### Low (13)

**[Rubric §1]** — The capability-coverage line was false for Flow 3 · **fixed** — the line now scopes CAP-6 to Flows 1 and 2 and gives the reason.

**[Rubric §1]** — The protagonists carry no context · **fixed** — the invented persona is replaced by a role, because the project context declares one user and inventing a second would put a fictional person in a contract.

**[Rubric §2]** — Three defined tokens are never referenced by `{ref}` · **accepted** — raised as a note for a mechanical extractor, not as a defect.

**[Rubric §5]** — §D is never cited by anchor · **open** — next: cite §D from the body-box rows in Component Patterns.

**[Rubric §5]** — The states sheet §E mixes the two vocabularies · **accepted** — the spine wins on conflict, so this is a mock artefact. Reviewer: "Fix: none needed."

**[Rubric §5]** — The two room mocks are older than the spines · **accepted**, as the reviewer filed it ("noted for the next mock pass") — all three mocks were regenerated after the accessibility lens returned, and they still trail the spines. A mock lagging a settling spine is expected, and the spines win on conflict. See N-8 for one value that did not survive the regeneration.

**[Rubric §6]** — The elision and badge rule is stated three times · **open**, cosmetic — next: keep the section and make the other two point to it.

**[Rubric §6]** — "Provider normalization at the edge" partly restates its source · **open**, cosmetic — next: keep the reader-visible consequence and cite the mechanism.

**[Rubric §6]** — Pixel literals appear in Components prose · **accepted** as one-offs.

**[Rubric §6]** — Prose names surface tokens without the surface suffix · **accepted** — the component objects carry both variants, so the ambiguity is recoverable.

**[Accessibility N-4]** — Chip borders are 1.73:1 to 2.28:1 · **accepted** with a recorded reason — the chip is not interactive and the border is not the only means of identifying it, so 1.4.11 does not apply. The borders stay as non-essential decoration.

**[Accessibility N-6]** — Reduced motion is assumed, not specified · **fixed** — the assumption is now a rule. The rotation is the transcript's only animation, so honouring the preference costs one media query.

**[Accessibility N-8]** — The Console mockup's `--error` does not match `theme.css` · **open** — the mockup still carries the drifted value. Both values pass, so no verdict depends on it. Next: correct the mockup so a later reviewer measures the shipped token.

## Found after the reviewers

Three defects reached the spines after both lenses returned, and re-checking found them rather than a reviewer. They sit outside the severity totals above.

**high · fixed** — Flow 1 claimed each subtask card carries its own outcome. `TaskSubtask` is `{name, agent, prompt}` at `tool-presentation-contract.md:49` and has no outcome field, so the presenter has nothing to render. The flow now says the cards show what was dispatched, and the row's own glyph is the only status.

**medium · fixed** — Two contrast cells were written from estimate, not arithmetic. `surface-hover` was published as 5.4:1 and 7.7:1; recomputed through oklch to sRGB to relative luminance it is **5.1:1 and 7.5:1**. `surface-inset` was right at 6.3:1 and 8.9:1. The converter was first calibrated against the ten cells the rubric had already verified and reproduced all ten, so the new numbers are trustworthy. The warning glyph was measured at the same time (8.3:1 and 10.1:1) and added. The header no longer calls the cells an approximation, because they are computed.

**medium · fixed** — A dangling token reference was left by an earlier edit. One `{path.to.token}` reference survived the edit that removed the token it named — the exact failure the token-completeness pass exists to catch, introduced after that pass ran. A re-check at this report's timestamp resolves 74 distinct references against 244 defined paths with zero misses.

## Mechanical notes

- **The spines moved while this report was written.** Findings are re-checked against a snapshot taken at 2026-09-10T00:53:50+07:00. Several rubric findings that still stood at the rubric's own post-write check were fixed between that check and this one.
- **Token check, twice.** The rubric counted 236 defined paths and 89 distinct references, zero unresolved. The re-check at report time counts 244 paths and 74 distinct references, zero unresolved. The drift is expected: the text-tier decision replaced many bare token references with one rule, and later edits added paths.
- **Contrast check, reproducible.** All 20 originally published cells match an independent OKLab-to-sRGB and WCAG relative-luminance computation. Cells added later were recomputed after the converter was calibrated against those 20.
- **Two findings were reached by both lenses.** The focus ring (rubric §2 low, accessibility B-1) and the arrow keys (rubric B4, accessibility N-1). Each is counted once, at the higher severity.
- **Locations are quoted as each reviewer cited them.** The spines have been edited many times since both lenses ran, so the line numbers no longer point at the quoted text. The section names still resolve, and every finding above was re-checked by section rather than by line.
- **One residual from the occurrence-filtering fix.** The Information Architecture rewrite is complete, and the resolved-questions table still summarises the old answer ("Filter, and only for an iteration chip"). Bring the summary row into agreement with the section it points at.
- **Frontmatter dates.** Both spines carried `status: draft` and an older `updated:` date while their content changed. Finalize sets both at the end, so this is expected mid-gate.
- **`.working/` duplicates `mockups/`.** The promote step copied rather than moved, so a later edit to one copy does not reach the other.
- **No broken cross-references.** Every `mockups/` and `imports/` link resolves, every cited §-anchor exists, and all twelve `sources:` entries resolve on disk.

## Reviewer files

- `review-rubric.md`
- `review-accessibility.md`
