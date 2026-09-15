# Structure review — UX spine pair, live-steering delta

Lens: structure (bmad-review). Scope: the steering delta only. The transcript half is settled and out of scope.
Reviewed 2026-09-12. Report is advisory; no reviewed file was modified.

## Document Summary

**Purpose.** The pair is one machine-readable contract for the node room on two web shells. `EXPERIENCE.md` holds behaviour, `DESIGN.md` holds visual specification and measurements. Downstream consumers (architecture, epics, story-dev, human or AI) source-extract decisions from it.

**Audience.** A builder who needs each decision to be unambiguous at the point of extraction. Not a reader who reads front to back.

**Reader type.** `customize.toml` sets `reader_type = "humans"`. The request overrides it with a builder / source-extractor. Request wins per `editorial-common.md`. Every finding below is calibrated to extraction, not to flow or engagement.

**Structure model.** **Reference/Database.** Both files are random-access: a consumer jumps to one component, one state, or one token and must get a complete answer there. The two governing rules of that model are the ones this review applies — **MECE** (one fact has one owner) and **consistent schema** (every item has the same shape). `Key Flows` is a deliberate Tutorial/Linear insert inside the reference body and is judged as such, not as a violation.

**Length.**

| File            | Words  | Steering delta (measured on the delta line ranges) |
| --------------- | ------ | -------------------------------------------------- |
| `EXPERIENCE.md` | 10,675 | ~4,480 (~42%)                                      |
| `DESIGN.md`     | 6,989  | ~1,990 (~28%)                                      |
| Combined        | 17,664 | ~6,470 (~37%)                                      |

Delta figures are measured, not estimated; the table rows include markdown pipe characters, so the true prose share is a few points lower. Two structural numbers matter more than the totals:

- `Accessibility Floor` (1,080) + `### The dock` (1,162) = **2,242 words, 21% of `EXPERIENCE.md`** — the largest `##` unit in either file.
- The child subsection **outweighs its own parent** (1,162 against 1,080).

**One contract, or two?** It reads as **one contract with visible seams, not two documents**. In every shared section the delta was integrated as rows inside the existing tables, following the pair's own two-axis schema (Component Patterns by component, State Patterns by state) — the same schema the transcript half has used since September. The seams show at exactly three kinds of place: the one section that split by feature instead of integrating (`### The dock`), the one section that landed after the flows instead of in Foundation (`Cross-spec dependency`), and mechanical insertion residue (`DESIGN.md:497` states one rule twice, three double-blank lines that fall exactly at insertion points, and a frontmatter banner that draws the dock boundary one component earlier than the prose does).

**Section order is still defensible.** The sequence runs shared rules → transcript specifics → flows → record. Steering adds no section that breaks it. The one real casualty of the order is `Cross-spec dependency`, which is recommendation 1.

---

## Recommendations

Ordered by comprehension impact. Aphorism cuts last. `PRESERVE` entries are at the end and are deliberate.

### 1. [MOVE] `EXPERIENCE.md:377-379` — `Cross-spec dependency`, and `EXPERIENCE.md:39`

**What it concerns.** `Cross-spec dependency` states that steering CAP-4 needs a change to `AgentHistoryItem` in `spec-readable-agent-transcript` that this spine cannot make, and ends "Open the change there before CAP-4 is built."

**Rationale.** This is a build-blocking prerequisite and it sits after all four Key Flows, 340 lines below the component it blocks. The memlog records it was added specifically "so CAP-4's dependency on spec-readable-agent-transcript is visible from the pair" — its placement defeats that purpose. A builder extracting `Component Patterns → Operator text` (`:125`) gets no signal that the item kind carrying that row does not exist yet. In a Reference/Database document, a prerequisite that is only reachable by reading to the end is unreachable.

`Foundation:39` already owns this class of fact: it states that the steering half "needs an engine seam, an additive field on a strict transcript-metadata schema, and a change to the resume path." The `AgentHistoryItem` change is the same kind of fact about a different spec. Two homes for one class of fact violates MECE.

**Proposed disposition.** Move the section to `Foundation`, immediately after `:39`, and merge the two into one statement of everything steering needs that this spine does not own. Keep the `Open the change there before CAP-4 is built` instruction verbatim — it is the actionable half.

**Word impact.** 71 words relocated; about −15 if the two openers merge. No content lost.

### 2. [CONDENSE] `DESIGN.md:497` — Typography, the bold rule

**What it concerns.** The sentence pair reads: "Inside the transcript, only the status glyph is bold — the dock's controls sit at weight 500 (`{typography.control}`), the one place in the panel that does, because a control is not a fact. Otherwise: only the status glyph is bold (`{typography.glyph.fontWeight}`)."

**Rationale.** The same rule is stated twice in two consecutive sentences. This is insertion residue: the dock clause was prepended and the original sentence was not removed. It is the clearest single artifact of scripted insertion in the pair, and it is in the machine-readable half, where a source-extractor reads a rule twice and must decide whether the second statement qualifies the first. The `{typography.glyph.fontWeight}` token reference in the second half is the only part not already present in the first.

**Proposed disposition.** One sentence: "Only the status glyph is bold (`{typography.glyph.fontWeight}`) — except the dock's controls at weight 500 (`{typography.control}`), the one place in the panel that carries weight, because a control is not a fact."

**Word impact.** −12. Value is correctness, not volume.

### 3. [QUESTION] `EXPERIENCE.md:247` — `Stopping…` may dim but may not vanish

**What it concerns.** The bullet justifies the dim state with: "SC 1.4.3 exempts a disabled control from the contrast minimum by its own wording, so the dim state is allowed."

**Rationale.** The rule is correct and must stay. The **justification predates the C-3 fix and is now superseded.** The memlog records C-3 moving `Stopping…` to `aria-disabled` precisely "since the SC 1.4.3 inactive-component exemption no longer applies to a focusable control." `DESIGN.md:349-351` and `DESIGN.md:629` both carry the corrected reasoning; `EXPERIENCE.md:245`, two bullets above, establishes the `aria-disabled` decision. So within two bullets the document establishes the control is focusable and then invokes an exemption that only applies to controls that are not.

The consequence is concrete: a builder who extracts `:247` alone reads that dimming is exempt from the contrast minimum, and may dim to `--text-tertiary` (2.31:1). `DESIGN.md:352-353` pins the floor at `--text-secondary` (5.33:1 / 7.90:1). `:247` states no floor, so it does not contradict the number — it licenses a reading the number forbids.

**Proposed disposition.** Not a cut. Replace the justification clause so it matches the corrected reasoning, and keep both the rule and the sibling-movement reason that follows it. This is the author's call, not the reviewer's — flagging rather than prescribing wording.

**Word impact.** About −5.

### 4. [QUESTION] `DESIGN.md:480` — dangling pointer into Open Questions

**What it concerns.** "That shipped button is still out there — the Legacy ask card's own Submit reads 3.1:1 today — which is a production finding this run surfaces and does not own; it is listed in Open Questions."

**Rationale.** It is not listed in Open Questions. Grepped `ask card`, `AskCard`, `Submit`, `3.06`, and `3.1:1` across both files: the only hits are `DESIGN.md:333-334` (frontmatter comment), `:476` (the rejected table row), `:480` itself, and `:625`. `DESIGN.md` Open Questions (`:658-685`) carries only the `--node-prompt` question and the resolved list. `EXPERIENCE.md` Open Questions (`:381-402`) carries only the finished-node dock question.

The section's own lede compounds it: `DESIGN.md:660` opens "**One, and it is narrow**" and `:675` repeats "One question is open, above." A second entry cannot be added without changing that count. So the pointer and the section disagree, and this line was added this run.

**Proposed disposition.** Two clean answers, and the choice is the owner's: either add the production finding to Open Questions and update the "One" count, or change `:480` to stop pointing at a section that does not carry it. The finding itself is worth keeping either way — it is a real production defect this run surfaced.

**Word impact.** 0 to +30 depending on which answer is taken.

### 5. [MOVE] `EXPERIENCE.md:250-251` — swap two adjacent bullets

**What it concerns.** `:250` opens "Being a sibling puts the dock outside the room's landmark, which is the price of the SC 2.4.11 answer below." `:251` is where the sibling decision is actually made.

**Rationale.** The consequence is stated before its premise, and `:250` has to point forward to fix it ("the SC 2.4.11 answer below"). In a random-access document a reader may extract `:250` alone and meet a price with no purchase. Swapping them removes the forward reference and lets the argument run decision then consequence.

**Proposed disposition.** Put `:251` first, then `:250`, and drop the now-unneeded "below".

**Word impact.** 0 (−2 for the dropped pointer).

### 6. [CONDENSE] `DESIGN.md:276-278` — the frontmatter `── Steering dock ──` banner

**What it concerns.** The banner sits above `operator-text` (`:279`) and `message-status` (`:291`), and its comment reads "Write affordances."

**Rationale.** Neither block is a write affordance and neither is in the dock. An operator row and its status badge render in the transcript. The prose draws the boundary correctly one component later — `DESIGN.md:553` states "Everything from **Composer dock** down is the dock" — so the frontmatter and the prose draw the same boundary in two different places, 277 lines apart. The frontmatter is the half a source-extractor parses.

**Proposed disposition.** Retitle the banner to `── Steering ──` and reword the comment, or keep `── Steering dock ──` and move it down to sit directly above `composer-dock` (`:297`), giving `operator-text` and `message-status` their own one-line marker. Either fixes it; the second matches `:553` exactly.

**Word impact.** −3 to +5.

### 7. [CONDENSE] `DESIGN.md:629` — Stop control, the focus-blur narration

**What it concerns.** The paragraph re-argues why the native `disabled` attribute is wrong: the blur to `<body>`, the return to the top of the document, the whole transcript between the operator and the dock, the up-to-ten seconds.

**Rationale.** `DESIGN.md:551` states the file's own contract: "Visual spec only. Behaviour is in `EXPERIENCE.md` Component Patterns." This paragraph is almost entirely behaviour, and the identical argument is already complete at `EXPERIENCE.md:245`, where it belongs. This is a scope violation against a rule the file states 78 lines earlier — and it is one of the passages that makes the pair read as two documents, because the delta wrote the same reasoning into both halves rather than letting each half own its axis.

**Proposed disposition.** Keep the causal chain as one clause, not as the argument. The retained text is the rule, the link, and both measurements — for example: "The control is `aria-disabled`, so it stays focusable and the SC 1.4.3 inactive-component exemption does not apply; the dim floor is therefore `--text-secondary` (**5.33:1 / 7.90:1**), not tertiary (**2.31:1 / 3.88:1**). Why it must stay focusable is at `EXPERIENCE.md` Accessibility Floor → The dock." What is cut is the re-narration of the focus path — the blur to `<body>`, the return to the top of the document, the ten seconds — which is the argument, and it is already complete at `EXPERIENCE.md:245`. No measurement and no recorded reversal is lost.

**Word impact.** About −55.

### 8. [CONDENSE] `DESIGN.md:529` against `DESIGN.md:618` — stop-left / send-right stated with full rationale twice

**What it concerns.** The prior review counted this rule five times across the pair. Confirmed, and the five are not equivalent:

| Location                    | What it is                                                       |
| --------------------------- | ---------------------------------------------------------------- |
| `EXPERIENCE.md:50`          | IA `Holds` column — contents, no rationale                       |
| `EXPERIENCE.md:129`, `:130` | `Where` column — positional locators, the table's own schema     |
| `EXPERIENCE.md:399`         | Resolved-questions record — Q, A, where it lives                 |
| `DESIGN.md:529`             | Layout & Spacing — **rule plus full safety rationale**           |
| `DESIGN.md:618`             | Components → Composer dock — **rule plus full safety rationale** |
| `DESIGN.md:656`             | Do's and Don'ts — one-line index row                             |

The prior review's five are `:50`, `:399`, `:529`, `:618` and `:656`. The `Where` column at `:129`/`:130` is listed above for completeness but is not one of them — it is the Component Patterns table's own locator schema, which every row in the table carries.

**Rationale.** Only two of these are true redundancy: `:529` and `:618` state the same rule with the same reason in near-identical words ("never a thumb's width apart" / "never sit under the same thumb"). The other four each do a different job and are preserved below. This is not a proposal to cut a rationale — the rationale is stated twice, and keeping it once is keeping it.

**Proposed disposition.** `Components → Composer dock` (`:618`) is the canonical home: it is where a builder assembling the dock reads, and it already owns the component. Reduce `:529` to the mechanical layout it is responsible for — column, `{spacing.dock-pad}`, `{spacing.dock-gap}`, a flex control row with the two controls at opposite edges — and let the safety rationale live once, at `:618`.

**Word impact.** About −30.

### 9. [CONDENSE] `EXPERIENCE.md:252` — the fourth telling of the send-control reversal

**What it concerns.** "Contrast is measured, not inherited, and the measuring changed the design." The bullet re-narrates the whole reversal: the earlier claim, the 3.1:1 inherited button, the bordered decision, the two bold cells.

**Rationale.** The reversal is recorded four times: `DESIGN.md:332-336` (frontmatter comment), `DESIGN.md:480`, `DESIGN.md:625`, and here. The calibration protects recorded reversals, and keeping it once keeps it. This is the fourth telling and the least entitled one — `EXPERIENCE.md:213` opens the section with "Contrast measurements are in `DESIGN.md` Colors", so the section states that it does not own this and then narrates it at length anyway.

**Proposed disposition.** Reduce to the behavioural claim plus the pointer: every dock pairing is measured in `DESIGN.md` Colors, and the send control is bordered because the inherited filled button measured 3.1:1. The full reversal record stays at `DESIGN.md:625`, which is the canonical home — it is where a builder reads the component.

**Word impact.** About −60. No measurement and no reversal is lost; three copies remain.

### 10. [CONDENSE] `EXPERIENCE.md:248` — target-size measurements in the behaviour file

**What it concerns.** The bullet states the 32px `{spacing.control-min-h}` floor, SC 2.5.8's 24px, and the 24×24 draft-item exception, with the reason "an 11px row cannot carry a 32px control without becoming a card."

**Rationale.** The transcript half set the pattern 17 lines earlier: `EXPERIENCE.md:231` states the target-size rule and routes the numbers out — "The dimensions and the reasoning are in `DESIGN.md` Open Questions → Resolved during finalize, **which owns every measurement in this design**." The steering half states the rule and the numbers. The delta diverged from a convention the file states about itself, which is exactly the "two documents" signal in miniature. `DESIGN.md:367` and `:636` already carry every number, one of them with the identical card phrase.

**Proposed disposition.** Keep the behavioural claim — the dock's controls are deliberately not subject to the tool row's density trade-off, and the draft item's per-item controls are the exception — and route the numbers to `DESIGN.md` the way `:231` already does. Every figure survives at `DESIGN.md:367` and `:636`.

**Word impact.** About −50.

### 11. [MOVE] `EXPERIENCE.md:199` and `:128` — the send shortcut is buried

**What it concerns.** `Cmd`/`Ctrl`+`Enter` appears exactly once in the pair, in `Interaction Primitives:199`. `Component Patterns → Composer field` (`:128`) describes `Enter` behaviour in detail — "`Enter` inserts a newline and never sends — the send is a control" — and never states what does send.

**Rationale.** A builder extracting the Composer field component learns what `Enter` does not do and not what the alternative is. `:199` itself argues the point: "**The shortcut is stated where it is used**, on the send control's accessible name and as a hint in the composer, because an undiscoverable shortcut is the same as none." The composer hint is a composer-field requirement, and the component row that owns the composer field does not carry it. In a random-access document, one mention is one mention.

**Proposed disposition.** State the shortcut on the `Composer field` row. Keep the accessible-name requirement and the discoverability argument at `:199`.

**Word impact.** About +8. This one adds words and is worth it.

### 12. [QUESTION] `EXPERIENCE.md:201` — a required string the pair never specifies

**What it concerns.** "**The queue is per node, as well as per tab.** … Both scopes are stated in the interface, because either one alone would mislead."

**Rationale.** Only one scope has copy. `this tab only` is specified at Voice and Tone `:90`, State Patterns `:181`, and Flow 4 `:365`. Grepped both files: no string states the per-node scope anywhere. So the rule requires two statements in the interface and the contract supplies one. A builder extracting this cannot satisfy it without inventing copy — and Voice and Tone is exactly the section that exists to stop invented copy.

**Proposed disposition.** Add the per-node string to the Voice and Tone table beside `this tab only`, or soften `:201` to require one statement. The memlog records the per-node scope as a rubric-medium fix for previously undefined behaviour, so the rule is deliberate and the gap is the copy, not the decision.

**Word impact.** About +6.

### 13. [CONDENSE] `EXPERIENCE.md:236` — the dock subsection lede under-describes its own subsection

**What it concerns.** "Steering adds four status channels to a panel whose whole guarantee is that status never rides on colour. Each is answered here."

**Rationale.** The subsection then runs 17 bullets and 1,162 words. Four are the status channels; the rest cover focus management across two transitions, target size, dock growth, landmark membership, SC 2.4.11, and contrast. A reader who takes the lede at its word expects four items and stops looking after them. This is the scaffolding failure behind the "is anything buried" question — the subsection is not mis-placed, but its own opening hides two thirds of it.

Note the size while it is in view: at 1,162 words the child outweighs its 1,080-word parent, and `Accessibility Floor` plus `### The dock` is the largest `##` unit in `EXPERIENCE.md` at 21%. That is defensible — dock accessibility is a genuine cluster and it is the one place the two features had different answers — but the lede has to name what the subsection actually covers.

**Proposed disposition.** Rewrite the lede to name the four groups the subsection really has: status channels, focus, target size, and layout hazards. Do not split the subsection; the clustering earns its place.

**Word impact.** About −5.

### 14. [CUT] `EXPERIENCE.md:130` — "and a dead control is worse than none"

**Rationale.** The rule is "absent once the node is stopped". The reason is "there is nothing left to stop". The clause after it restates that reason as an aphorism and adds no rule. Named by the prior review.

**Word impact.** −8.

### 15. [CONDENSE] `EXPERIENCE.md:170` — "a bar that does not track anything is a lie told smoothly"

**Rationale.** The load-bearing content is the citation and the inference: the signal reaches the node on a poll of up to ten seconds (`dag-executor.ts:2304-2334`), so a bar would be tracking nothing. Keep both — the citation is protected and the inference is the argument. The aphorism wrapper carries voice, not rule. Named by the prior review.

**Proposed disposition.** "…and a bar would be tracking nothing." Citation untouched.

**Word impact.** −7.

### 16. [CUT] `EXPERIENCE.md:172` — "A dock that evaporates mid-keystroke is the worst version of this feature."

**Rationale.** The row already states the rule ("The removal must not take the operator's text or their focus with it"), the mechanism (draft and text preserved, focus to the last transcript row), and the reason (a node can finish at any moment, including mid-sentence). The closing sentence restates the reason as judgement.

**Word impact.** −12.

### 17. [CUT] `EXPERIENCE.md:176` — "Better never offered than offered and refused."

**Rationale.** The reason is already complete and specific in the sentence before it: a steer carries the node id and retry epoch it was written against, so a message composed against a non-live execution would be rejected on arrival. The closing sentence is the same point as a maxim.

**Word impact.** −7.

### 18. [CUT] `EXPERIENCE.md:376`, `DESIGN.md:528`, `DESIGN.md:546` — double blank lines

**Rationale.** Three consecutive-blank-line pairs, and all three fall exactly at a scripted insertion point (before `Cross-spec dependency`, before the dock layout paragraph, before the dock shapes paragraph). No other double blank exists in either file. Cosmetic, but it is literally where the seam shows.

**Word impact.** 0.

---

### PRESERVE — looks cuttable, earns its place

### 19. [PRESERVE] `EXPERIENCE.md:36` — "is the shipped HITL contract and does not change" beside "Steering adds exactly one thing to it"

Reads like a self-contradiction and is not one. The memlog records this conflict being surfaced to the user rather than silently rewritten, and the user choosing "a one-sentence amendment rather than an override." The amendment is the bold sentence, and the header-wrap rationale with `NodeRoomHeader.tsx:58-95` is the measurement that justifies it. Flagging it for the lead so it is clear this was seen and left alone deliberately.

### 20. [PRESERVE] The Component Patterns / State Patterns overlap on every dock control

`Stop control` at `:130` carries its own state machine, and States `:169-174` carry the same transitions again. An outside reviewer would call that redundancy. It is the pair's two-axis schema: Component Patterns answers "what is this control", State Patterns answers "what does the panel look like in state X", and a Reference/Database reader arrives on one axis or the other. The transcript half does exactly the same thing — `Tool row:104` states collapsed-on-success, and States `:148`/`:149` state it again. The steering delta followed the established convention here, which is the strongest single piece of evidence that this is one contract.

One small inconsistency inside that schema, low priority: `Stop control:130` carries its own states inline while `Send control:129` routes its blocked state to `State Patterns:175` and mentions no blocked state at all. Worth one clause on `:129` if the owner wants the two rows symmetric.

### 21. [PRESERVE] `DESIGN.md:656` and the whole Do's and Don'ts table

Every row in this table restates a rule stated elsewhere. That is the section's schema — a scannable index for a reader who wants the rule without the argument. The five steering rows follow it exactly. Judging them as duplication would mean cutting the section.

### 22. [PRESERVE] `EXPERIENCE.md:129` — the CAP-5 clause and the `Send now` wording

The cell is large (about 190 words against 40-80 for its neighbours) and the "Bare `Send` is banned in Voice and Tone" sentence looks like a duplicate of `:86`. It is not a duplicate; it is the justification for why the declared-capability reading uses two words instead of one. The memlog records the advisor review forcing this exact change, and records the deliberate decision that CAP-5's rule "lives on the Send control row" because the capability has no journey. Both are recorded decisions.

### 23. [PRESERVE] `EXPERIENCE.md:399-402` — four steering rows in the resolved-questions table

Each restates a decision made elsewhere. That is what the table is: a Q, an A, and where it now lives. It is the record a future editor needs to see that a question was closed rather than dropped.

### 24. [PRESERVE] `DESIGN.md:553` and `DESIGN.md:492` — the two best-integrated pieces of the delta

`:553` ("The panel holds two halves… Everything from **Composer dock** down is the dock") is the scaffolding that makes the Components section extractable with two features in it, and it correctly leaves the operator row on the read side. `:492` rewrote the shared sans exception into three cases — what a human wrote, what a human is writing, what the model wrote — instead of appending a dock clause to a transcript rule. These are the model of how the rest of the delta should read, and recommendations 2, 7 and 10 are all "do what `:492` did."

---

## Summary

**24 recommendations:** 4 CUT, 0 MERGE, 2 MOVE, 8 CONDENSE, 4 QUESTION, 6 PRESERVE. (Recommendation 1 is a MOVE with a merge inside it.)

**Estimated reduction if every cut and condense is accepted:** about **265 words**, roughly **1.5%** of the combined 17,664. Two recommendations add words (11 and 12, about +14 together) and are worth it. No length target was given, and volume is not what this review is for — the reduction is small on purpose. The value is in recommendations 1 through 6, none of which are about length: a build-blocking prerequisite that is unreachable where it sits, a rule stated twice in one sentence pair, a justification that the C-3 fix superseded, a pointer into a section that does not carry its target, an out-of-order pair of bullets, and a frontmatter boundary that disagrees with the prose.

**Comprehension trade-offs:** none. Every CUT is an aphorism that restates a reason already given in the same passage. Every CONDENSE names the canonical home of the fact and leaves it there. No measurement, no `file:line` citation, and no recorded reversal is removed by any recommendation; recommendations 7, 9 and 10 each state which copy survives and where.

**One-contract verdict:** one contract. Fix recommendations 1, 2, 6 and 18 and the mechanical seams are gone; fix 7, 9 and 10 and the two halves stop writing into each other's axis.

## Unresolved questions for the owner

1. **Recommendation 4** — is the Legacy ask-card `Submit` 3.1:1 production finding meant to be an Open Question entry (which changes the "One, and it is narrow" count), or should `DESIGN.md:480` stop pointing there?
2. **Recommendation 12** — what is the per-node scope copy? The rule at `:201` requires a string the pair never supplies.
3. **Recommendation 3** — confirm that `EXPERIENCE.md:247`'s SC 1.4.3 justification is stale rather than a deliberate second reading. Reading the memlog C-3 entry against `DESIGN.md:349-351`, it looks like a survivor the fix did not reach, but the author owns that call.
4. **Recommendation 20, low priority** — should `Send control:129` carry its blocked state inline the way `Stop control:130` carries its states, or is routing it to State Patterns the intended asymmetry?
