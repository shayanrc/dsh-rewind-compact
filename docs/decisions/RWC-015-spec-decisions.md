# ADR RWC-015 — Spec decisions for rewind-compact v1

- **Status:** Accepted — signed off 2026-10-27 (owner: user)
- **Decision date:** 2026-10-27 (signed in session)
- **Harness line:** `dsh 0.2.1-rc.2`, packages `@deepseek-ai/dsh-* 0.2.1-rc.2`
  (the installed line at review time); TUI `@deepseek-harness-tui/dsh-tui` 0.17.0.
  [RWC-001](../tickets/RWC-001-harness-baseline.md) re-baselined
  `docs/HARNESS-CONTRACTS.md` on 0.2.1-rc.2 on 2026-10-27.
- **Owner:** user (direct sign-off in session, 2026-10-27) — recorded per
  [RWC-015](../tickets/RWC-015-spec-decisions.md)
- **Blocks:** [RWC-004](../tickets/RWC-004-in-place-compaction.md),
  [RWC-006](../tickets/RWC-006-tui-before-mode.md),
  [RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
  [RWC-016](../tickets/RWC-016-release-verification.md)
- **Scope:** decisions and the spec text they require. This document does not
  edit `SPEC.md`, change code, or move ticket statuses; those happen after
  sign-off (RWC-011 and the owning tickets).

## Context

The 2026-10-27 spec audit found clauses that assume a seam or behavior the
harness does not provide, or that contradict another clause. Implementing
before choosing produces churn: every shipped fork path is scaffold-only while
[R5](../../SPEC.md) promises hybrid prose; the in-place `compactRegion` path
cannot succeed on 0.2.1; the TUI picker compares a picked-message seq to
`turn/start` seqs; the TUI before mode duplicates the prefix; and the skill
promises an approval prompt that does not exist.

This ADR records one recommendation per decision, the spec text each requires,
and the tickets affected. All decision fields read
**"Recommended - awaiting owner sign-off"** until the sign-off table at the
bottom is filled in. Nothing here is a license to code.

### Principles used

1. Do not promise a surface or a summary mode the harness cannot deliver on the
   declared line; scope the promise instead.
2. A rewind always remains recoverable: the pre-rewind session is untouched and
   the child is a fork. Nothing in these decisions weakens that.
3. Ship the mechanical value (the five-field scaffold) that is provably
   testable; defer LLM prose until a closed-range seam is proven.
4. Prefer dropping one surface's mode over shipping a second, unverified child
   or a duplicated prefix.
5. Every behavior change is written into `SPEC.md` and covered by a regression
   test; docs only claim what a test or a recorded manual run proves.

## Decision index

| # | Decision | Recommended direction | Ticket numbering |
|---|---|---|---|
| D1 | R4 "always forks" vs R7 in-place path | Scope R4 to rewind runs; in-place is a compaction, not a rewind | Decision 1 |
| D2 | R5 hybrid vs scaffold-only | Retire the in-place path for v1; ship scaffold-only forks | Decision 2 |
| D2b | R5 scaffold-inside-range in the open-step tool | Scope the requirement to closed ranges; defer open-step compaction | (sub-decision of 2) |
| D3 | R5 child-side compaction on 0.2.1 | Not proven; defer child-side hybrid, record the spike conditions | Decision 3 |
| D4 | R6 overlay row model | Map picked user message to its enclosing completed turn; open-turn rows ineligible | Decision 4 |
| D5 | TUI before mode | Drop before from the TUI; keep it on command/tool | Decision 5 |
| D6 | R11 "decision prompt" vs R7 | Direct-human authority check only; no plugin prompt | Decision 6 |
| D7 | R12 title | Append a best-effort `session/title` event; no create option | Decision 7 |
| D8 | R10 field 1 "Files changed" | Conservative write/edit + structured-metadata derivation | Decision 8 |
| D9 | R2 "summaries go through compaction" | Bind LLM summaries only; scaffold-only is a permitted fallback | Decision 9 |
| D10 | Section 6.3 verification | Keep the scratch copy + dump-config gate, and add a live scratch boot per surface | Decision 10 |

### Tension coverage (the ten items in the request)

| Tension | Covered by |
|---|---|
| 1. R4 "always forks" vs R7's ungated in-place path | D1 |
| 2. R5 hybrid vs scaffold-only fallback; child-side compaction on 0.2.1 | D2, D3 |
| 3. R6 overlay row model (picked message → completed turn; open-turn rows) | D4 |
| 4. TUI before mode: drop or summary-first child | D5 |
| 5. R11 "decision prompt" vs R7's direct-human check | D6 |
| 6. R12 title as a `session/title` event, not a create option | D7 |
| 7. R10 field 1 "Files changed" derivation | D8 |
| 8. R2 "summaries go through compaction" scope | D9 |
| 9. R5 scaffold-inside-range in the open-step tool context | D2b |
| 10. Section 6.3 verification (temporary dsh-tui profile + `--dump-config`) | D10 |

---

## D1 — R4 "always forks" vs R7's ungated in-place path

**Context.** R4 opens with "A rewind-compact run always **forks** to a new
session", which is unconditional. R7 then defines an ungated tool path (`mode`
with `rewind = false`) that shadows a range in place and explicitly does not
fork, and R3 makes that path the tool's default. The two clauses cannot both be
literal. The in-place path is also the one that cannot run on 0.2.1 (D2).

**Options.**

- **A. Remove the in-place mode entirely** and make the tool fork-only. Deletes
  R7's first bullet, changes R3's signature, and loses the ungated use case.
- **B. Scope R4 to rewind runs** (recommended): the fork rule binds `rewind:
  true` and every TUI/command fork; `rewind: false` is a compaction governed by
  R5/R7 and is never called a rewind.
- **C. Keep both clauses and call the in-place path "a rewind that does not
  fork"**. Leaves the contradiction in the living spec; rejected.

**Recommendation.** **Option B.** R4's subject is rewind, not the plugin's
whole output space. The tool already distinguishes the paths (`rewind`
parameter, `hybrid` field); the spec should say so.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- No behavior change by itself; the fork path already exists. The change is
  vocabulary: "rewind" means fork, "compact" means in-place, and outputs/docs
  must not use them interchangeably.
- RWC-004's retire branch (D2) no longer has to argue against R4; the scoping
  stands even if in-place returns later, because R7 names it.
- R4's acceptance criteria still apply in full to forks; add a negative check
  that the in-place call sites contain no `agents.create`.

**Affected tickets / spec.** [RWC-004](../tickets/RWC-004-in-place-compaction.md),
[RWC-006](../tickets/RWC-006-tui-before-mode.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-007](../tickets/RWC-007-failure-atomicity.md); `SPEC.md` R4, R7, R3.

**Spec text to change.**

- R4 first sentence → "A **rewind run** — any TUI/command fork, or the tool with
  `rewind: true` — always forks to a new session seeded at the chosen
  boundary."
- Append to R4: "The tool's in-place path (`rewind: false`) is a compaction
  under R5/R7, not a rewind, and in v1 is retired (RWC-015 D2)."
- R7 first bullet → reference that it is not a rewind and is ungated; it must
  never create a session.

---

## D2 — R5 hybrid vs scaffold-only fallback

**Context.** R5 requires every compacted side to be "a mechanical five-field
scaffold followed by LLM prose", with the scaffold inside the compacted range.
Reality: every fork path delivers the scaffold as one `user/message` and never
calls `ctx.compaction`; only the tool's in-place path sets `hybrid: true`, and
that path cannot succeed on 0.2.1 — `compactRegion` needs surface nodes and a
balanced range, the tool's own call is open (its assistant message has an
unresolved `tool-call`), `turn/start + 1` is typically non-surface, and the
scaffold is appended before validation, so a rejection leaves a stray message.
R5's fallback sentence ("when child-side compaction is unavailable, the
scaffold-only message remains") already describes what ships. The audit's
finding is not that the code is broken in one place; it is that the spec
promises a hybrid that has no working seam.

**Options.**

- **A. Repair the in-place path and implement fork-side hybrid.** Rebuild the
  range from `session.surface.nodes`, exclude the system head, wait for a
  balanced boundary, pass an `AbortSignal`, then prove child-side compaction.
  Large, and R5's open-step requirement still fails (D2b).
- **B. Retire the in-place path for v1; ship scaffold-only forks** (recommended).
  The tool's `rewind: false` returns a documented unsupported result instead of
  throwing or appending; forks keep the five-field scaffold as the summary.
- **C. Retire in-place and make the tool fork-only.** Cleanest API, but a larger
  R3/R7/R11 edit (removes the ungated mode entirely).
- **D. Keep the current path and label it hybrid.** Rejected; it cannot succeed
  on the declared line and already leaves stray messages on failure.

**Recommendation.** **Option B.** It delivers one testable summary path and
removes a P0 failure rather than betting v1 on two unproven seams. If the owner
prefers C, D1/D6 still hold; choose it explicitly, not by default.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- `lib/tool.js`: `rewind: false` performs no `compactRegion` call, appends
  nothing, and returns `ok: false`, `applied: false`, a documented
  `reason` (e.g. `in_place_retired`), and a note pointing at the fork path.
  RWC-004 estimate drops to S.
- `hybrid` remains `false` on every shipped path; the README headline changes
  from "hybrid (scaffold + LLM prose)" to "five-field scaffold summaries in v1;
  LLM prose deferred". R5's five-field contract and nested-summary note still
  bind.
- The web E2E expectation (child log ends with the scaffold message) stays
  valid; no profile-specific behavior is introduced.
- A hybrid return is a v2 decision requiring a proven closed-range seam; do not
  promise it in README/SKILL. RWC-007 must surface the retired result as a
  clear message, not an unhandled error.
- R5's "range compaction runs on the child after seeding" becomes a v2 target,
  not a v1 acceptance check (see D3).

**Affected tickets / spec.** [RWC-004](../tickets/RWC-004-in-place-compaction.md),
[RWC-006](../tickets/RWC-006-tui-before-mode.md),
[RWC-007](../tickets/RWC-007-failure-atomicity.md),
[RWC-010](../tickets/RWC-010-files-changed-accuracy.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-013](../tickets/RWC-013-test-probe-hardening.md),
[RWC-016](../tickets/RWC-016-release-verification.md); `SPEC.md` §1, R3 (both
bullets), R5, R7.

**Spec text to change.** Retiring the in-place path changes every clause that
still names it as the default or as a hybrid producer. D2 therefore edits §1,
R3 §1, R3 §2, R5, and R7 together; leaving any of them as written would leave
`SPEC.md` contradicting D2/D3/D9.

- §1 Purpose → first paragraph: "A plugin bundle for the DeepSeek Harness
  (`dsh`) that combines the harness's existing primitives — the TUI's
  fork-at-boundary rewind recipe and, for any future LLM summary,
  `ctx.compaction` — into one user-controlled **rewind-compact** feature,
  exposed on three surfaces (TUI command, model-invoked tool, skill)." Second
  paragraph: "Rewind-compact rewinds the conversation to a chosen completed-turn
  boundary and summarizes one side of that boundary as the mechanical five-field
  scaffold (R5); the other side survives verbatim. LLM prose summaries are
  deferred to v2 (RWC-015 D3)."
- R3 §1 → two phrase replacements. Mode list: "…the bundle answers
  `tui/rewind-prompt` with the after mode only (`rewind-compact-after`; the
  before mode is dropped from the TUI, D5)…". Done clause: "…on pick the TUI
  forks and dispatches `tui/rewind-done`, which the bundle answers by appending
  the five-field scaffold to the child session (scaffold-only in v1; child-side
  compaction is a post-v1 target, D3)." The command keeps both `after` and
  `before`.
- R3 §2 → "`rewind = true` is the gated fork path (R7). The `rewind = false`
  branch keeps its default parameter value for signature compatibility only; in
  v1 it is retired and returns the documented unsupported result (D2), never
  calling `compactRegion` and never appending to the transcript."
- R5 opening → "Every compacted side is summarized as the mechanical five-field
  scaffold. Where a closed, balanced range and a compaction service exist, the
  scaffold is delivered inside that range so the summarizer preserves its facts
  into prose. **v1 ships scaffold-only summaries**: the in-place path is retired
  (D2) and child-side fork compaction is deferred (D3)."
- R5's "For forks, the range compaction runs on the child…" → mark as the
  post-v1 target, not a v1 acceptance criterion; keep the fallback sentence as
  the v1 behavior.
- R7 first bullet: mark the in-place path retired in v1 (no `compactRegion`
  call, documented unsupported result); keep it as the forward contract only if
  a closed-range design is approved later.

---

## D2b — R5's scaffold-inside-range requirement in the open-step tool context

**Context.** R5's acceptance says the scaffold is "delivered inside the
compacted range … never via an unsupported `compactRegion` instructions
argument". Inside `execute`, this is structurally impossible: the range end must
be a balanced surface boundary, and the calling assistant message's `tool-call`
block has no `tool/result` until `execute` returns; the range start would land
on a non-surface seq or the per-step system head; and appending the scaffold
before validation leaves a stray fake user message. A repaired in-place path
therefore cannot satisfy "scaffold inside the range" in the tool's open step.

**Options.**

- **A. Defer compaction** to `agent/turn-stopping` or the next step, when the
  step is closed and a balanced range exists; the scaffold can then sit at the
  range end.
- **B. Compact only up to the last balanced node before the open step**, then
  append the scaffold after the summary ("summary then scaffold"). Violates
  inside-range; the summarizer never sees the facts.
- **C. Scope the requirement to closed-range contexts** and keep the open-step
  tool path out of v1 (recommended, consistent with D2). If v2 revives
  in-place, A is the only conforming design.

**Recommendation.** **Option C** now, with A recorded as the required design if
in-place returns. B is rejected because it cannot preserve scaffold facts into
prose and would silently produce an unscaffolded summary.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- v1 has no append-before-validate path in the tool; no `compactRegion` call
  from `execute`. Tests assert that a forced failure leaves the transcript
  byte-identical.
- R5's "inside the range" is conditional on a closed, balanced range; the
  before-mode fork is explicitly excluded too — the scaffold must precede the
  kept tail, so it sits at the transcript end, outside the compacted prefix.
- Any future in-place implementation must defer to a step-closed hook, not
  append outside the range, and must never pass instructions through
  `compactRegion` (4 parameters only on 0.2.1).

**Affected tickets / spec.**
[RWC-004](../tickets/RWC-004-in-place-compaction.md),
[RWC-006](../tickets/RWC-006-tui-before-mode.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-013](../tickets/RWC-013-test-probe-hardening.md); `SPEC.md` R5.

**Spec text to change.** R5 acceptance → "the scaffold is delivered inside the
compacted range **whenever a closed, balanced range exists**; the open-step
tool context must defer compaction to a step-closed hook rather than append
outside the range. The before-mode fork is scaffold-first by R4 and is not a
range-compaction case."

---

## D3 — R5 child-side compaction on 0.2.1

**Context.** R5 says fork summaries are produced by compacting the discarded
side on the child after seeding. On 0.2.1, `compactRegion(start, end, agent,
signal)` requires `start`/`end` to be nodes of the current surface and balanced
before/after; RWC-015's note records that it requires an open turn, while
`compactNow(agent, signal, sourceCommandId)` is the idle-session entry point.
`compactNow` takes no range, so it cannot target only the discarded side — it
would condense the kept prefix too. No shipped path calls either function on a
fork child, and no spike has proven that a freshly created, seeded child can
compact an appended discarded tail. "Child-side unavailable" is therefore
**not proven**; it is unimplemented and unverified.

**Options.**

- **A. Prove it**: seed the child with the discarded side plus the scaffold,
  open a turn (or hook the first turn), and call `compactRegion` on the
  discarded range. Then the child's surface must still read as kept side +
  summary; this needs a design for the extra shadowed events.
- **B. Use `compactNow` on an idle child seeded only with the discarded side**,
  then create a second summary-first child. Different fork shape, extra session,
  and the first child must be disposed or left orphaned; rejected as a
  user-visible complication.
- **C. Defer child-side hybrid**; keep scaffold-only forks and record exactly
  what a spike must prove before v2 promises prose (recommended).

**Recommendation.** **Option C.** v1 does not need child-side compaction to be
useful, and the seam is unverified. Deferring is honest; guessing risks a
half-compacted child or a mutated source.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- v1 has no LLM summary; `hybrid: false` on every path; R5's "runs on the
  child after seeding" is marked deferred. README/SKILL say "scaffold-only".
- A future hybrid spike must record: the idle/child entry point used, the exact
  range (surface nodes, balanced, excludes the system head), how the scaffold
  stays inside the range, how before mode would work, and the source-session
  immutability check. Until then, no claim.
- Remove the dead `compaction.settle()` probe as part of RWC-004; it does not
  exist on 0.2.1 and is not needed by the scaffold-only path.
- `compactNow` must not be used as a substitute region compactor; document the
  no-range limitation where the probe discusses compaction capability.

**Affected tickets / spec.**
[RWC-003](../tickets/RWC-003-surface-correct-seed.md),
[RWC-004](../tickets/RWC-004-in-place-compaction.md),
[RWC-006](../tickets/RWC-006-tui-before-mode.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-013](../tickets/RWC-013-test-probe-hardening.md); `SPEC.md` R2, R4, R5.

**Spec text to change.** R5 child-side sentence → "Fork-side LLM compaction is a
post-v1 target: it requires a proven child-side closed-range seam. In v1 the
scaffold-only message is the summary (the fallback below), on every surface."

---

## D4 — R6 overlay row model: picked user message → enclosing completed turn

**Context.** The TUI's Esc-Esc overlay lists **user messages**
(`Chat.js` filters `row.kind === 'user'`), and `tui/rewind-prompt.seq` is the
"session event seq of the picked message". R6 says the overlay lists "completed
turn boundaries only", and `lib/tui-rewind.js` compares the row seq to
`turn/start` seqs, so the lookup is `-1` and the confirm pane never shows the
plugin's modes. The same wrong seq feeds `filesChangedSince`, inflating the
warning. On the done side, `tui/rewind-done` already carries the correct cut
(`boundarySeq = turnStart.seq - 1`).

**Options.**

- **A. Ask the TUI to emit boundary rows.** Requires a harness/UI change; out
  of scope for this plugin.
- **B. Map the picked message to its enclosing completed turn** (recommended):
  walk back to `turn/start`, require a `turn/end`, map to the chronological
  boundary index, and use the same cut for the warning.
- **C. Keep comparing raw seqs.** Current broken behavior; rejected.

**Recommendation.** **Option B**, with an explicit open-turn rule: a row whose
enclosing turn has not ended yet is ineligible — the plugin answers no modes
(`undefined`/empty), logs the reason at debug level when a logger is present,
and the pane falls back to the TUI's built-in rewind. After that turn ends, the
same row becomes eligible.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- RWC-005 is a small, testable fix: use an events accessor to walk
  `user/message` → enclosing `turn/start`, check `turn/end`, then
  `boundaries.findIndex(b => b.seq === turnStart.seq)`.
- Warning count uses `turnStart.seq - 1` (the cut), matching the done event's
  `boundarySeq`; scaffold and warning share the D8 helper.
- No-op omission stays keyed to the chronological boundary index (last completed
  turn → no after; first → no before). There is no path that selects a mid-turn
  step.
- Edge cases covered by tests: picked row in the open turn (no modes), first
  message row (no before), newest completed turn (no after), and a transcript
  with non-surface seqs around the turn marker.

**Affected tickets / spec.**
[RWC-005](../tickets/RWC-005-tui-picker-mapping.md),
[RWC-006](../tickets/RWC-006-tui-before-mode.md),
[RWC-008](../tickets/RWC-008-turn-point-validation.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md); `SPEC.md` R3, R6.

**Spec text to change.** R6 first bullet → "The overlay lists user-message rows.
The plugin maps the picked row to its enclosing `turn/start` and requires that
turn to have ended; a row in the open turn is ineligible. There is no mid-turn
point." Also state that the cut is `turnStart.seq - 1` and that the warning
count is derived from the cut, not the row seq.

---

## D5 — Before mode on the TUI: drop it or create a summary-first child

**Context.** For before mode, the TUI forks a child with the **prefix**
(everything before the cut), then dispatches `tui/rewind-done`. The plugin can
only append, so it currently produces `[prefix][tail][summary(prefix)]` — wrong
order, duplicated prefix, and `replayEvents` drops real `user/message` rows
because their `data` is the message, not `data.message`. A correct
`[summary(prefix)][tail]` child cannot be produced from an append-only prefix
child; the plugin would have to create a second child and switch to it, leaving
the TUI-created child orphaned (or requiring the TUI's adoption/switch path and
a user-visible session jump).

**Options.**

- **A. Drop before mode from the TUI surface** (recommended). The TUI offers
  after only; before stays on `/rewind-compact … before` and the tool, whose
  fork seed already composes correctly (verify under RWC-003).
- **B. Create a summary-first child on `rewind-done`** and switch to it. Large:
  second `agents.create`, adoption ordering, orphan handling, toast must name
  the actual live child, and a failure leaves two children.
- **C. Fix only `replayEvents`.** Does not fix the order or the duplicate
  prefix; rejected.

**Recommendation.** **Option A** for v1. It removes an unbuildable surface mode
with an S-sized edit, keeps R4's before semantics testable elsewhere, and avoids
shipping a second unverified child-creation path.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- `rewindPromptAnswer` returns only `rewind-compact-after` (plus the no-op
  rules); the confirm pane shows the TUI's built-in rewind and the after mode.
- `tui/rewind-done` with an unexpected before mode returns an error toast
  ("before mode is not available on the TUI"), never `undefined`; no silent
  failure.
- The command and tool keep `before`; R4's before-mode acceptance applies to
  them. README/TESTING get a per-surface matrix; RWC-006 becomes the drop path
  (estimate S).
- Trade-off: feature parity differs by surface. This is explicit and documented
  rather than hidden.
- `replayEvents` still needs its `user/message` fix if any replay remains; with
  before dropped, the tail-replay path is unused on the TUI and can be deleted
  with the mode.

**Affected tickets / spec.**
[RWC-003](../tickets/RWC-003-surface-correct-seed.md),
[RWC-005](../tickets/RWC-005-tui-picker-mapping.md),
[RWC-006](../tickets/RWC-006-tui-before-mode.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-013](../tickets/RWC-013-test-probe-hardening.md),
[RWC-016](../tickets/RWC-016-release-verification.md); `SPEC.md` R3, R4, R6.

**Spec text to change.** R3 §1 and R6: the TUI confirm pane offers the after
mode only in v1; before remains on the command and tool. R4: before-mode
paragraph applies to the command/tool fork (the TUI does not offer it; see R3).

---

## D6 — R11 "decision prompt" vs R7's direct-human check

**Context.** R7 defines the gate precisely: through the tool, a rewind requires
direct human authority in the current turn (a user-sourced `user/message` in the
open turn, as `dsh-tool-goal`'s `requireDirectHuman` does), and fails closed in
headless/sdk/goal-round turns. There is no decision event and no
`userQuestions.ask` on that path. R11 tells the model that rewind "will surface
a decision prompt", which the code never does. Adding one would be extra code
and would still not replace the authority check (a prompt cannot run where there
is no human).

**Options.**

- **A. Add an approval prompt** (decision event or `ask_user_question`) before
  a tool fork. New surface, latency, and it still cannot run headless; it would
  be advisory on top of the real gate.
- **B. Document the direct-human check only** (recommended): the skill says the
  current turn must be human-typed, says the headless failure code, and does not
  promise a prompt. The model may ask the user conversationally before calling;
  that is not the gate.
- **C. Leave the prompt wording.** Docs lie; rejected.

**Recommendation.** **Option B.** R7 is already implemented and fail-closed;
the fix is R11's wording and the SKILL text, not new machinery.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- No prompt code. The observable failure is
  `REWIND_COMPACT_APPROVAL_REQUIRED` (or the ticket's chosen code); headless
  remains fail-closed.
- R11 item 2 → "rewind requires direct human authority in the current turn; it
  fails closed when there is no human. The plugin does not show a decision
  prompt; ask the user in conversation first if unsure."
- SKILL/README/TESTING stop claiming a prompt; RWC-011 greps for the phrase.
- A user who typed the turn can still be surprised by a fork; the skill's
  etiquette section tells the model to explain the recovery semantics first.
  That is guidance, not a harness gate.

**Affected tickets / spec.**
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-007](../tickets/RWC-007-failure-atomicity.md); `SPEC.md` R7, R11.

**Spec text to change.** R11 item 2 → the sentence above. R11 item 4 → recovery
wording per surface (fork vs retired in-place). R7: add "no plugin-authored
decision prompt; R11 defers to this clause."

---

## D7 — R12 title as a `session/title` event, not a create option

**Context.** R12 requires the forked session title `<original title> (rewound)`.
On 0.2.1, `agents.create` reads only known options and silently ignores
`title`; `session.title` is not a live-session property. Titles are folded from
`session/title` events (`dsh-session-title`). RWC-002 records that the current
`title` option is ignored, so the acceptance check cannot pass as written.

**Options.**

- **A. Pass `title` to `agents.create`.** Impossible on the declared line;
  rejected.
- **B. Append a `session/title` event in the child's `setup`, before
  publication** (recommended), with `<source title> (rewound)`.
  Best-effort: read the source title from folded events, skip cleanly when it
  is unknown, and never fail the fork if the append fails.
- **C. Drop the title requirement.** Loses a small, useful lineage cue; not
  needed to fix the bug.

**Recommendation.** **Option B**, best-effort. The title is metadata, not part
of the rewind's correctness; a failed title append must not abort a fork that
otherwise succeeded.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- RWC-002 appends the event with the payload shape a manual rename uses and
  greps the child JSONL for `session/title`; the test asserts the suffix.
- Untitled source → no title event (do not invent `<session-id> (rewound)`);
  log at info. README says "title is best-effort".
- No create-time `title` option is sent; the `agents.create` options test
  asserts its absence alongside `cwd`/`parentSession`/`inheritedCount`.
- The UI/session list shows the suffix when it folds the event; no guarantee is
  made about a render that happens before the append.

**Affected tickets / spec.**
[RWC-002](../tickets/RWC-002-fork-create-metadata.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md); `SPEC.md` R12, R4.

**Spec text to change.** R12 last bullet/acceptance → "The forked session
receives a `session/title` event `<source title> (rewound)` in the child's
`setup`, before publication (best-effort; skipped when the source has no
title). No create-time title option is used."

---

## D8 — R10 field 1 "Files changed" derivation

**Context.** R5 defines `Files changed` as created/modified/deleted. The current
derivation is over-inclusive: `read` paths are listed as `(read)`, every path in
a `bash` command *and its output* is listed as `(modified by bash)` (so `ls`,
`git status`, a fetched page inflate it), and `extractPaths` matches URLs and
version strings. `filesChangedSince` reuses the same heuristic, so the R6
warning is inflated too. The field name is right; the derivation is not.

**Options.**

- **A. Keep the heuristic and rename the field** to "Paths mentioned". Honest,
  but loses the safety signal the warning exists for.
- **B. Conservative derivation from structured data** (recommended): count
  `write`/`edit` path arguments (`write` → created/modified, `edit` →
  modified, distinguished further only when the tool result carries structured
  metadata); count a dedicated delete/move tool by its structured argument if
  one exists; never count `read`, `grep`, `glob`, `ls`, or web tools; for
  `bash`, count only paths the tool result exposes as applied changes, never
  scrape prose; normalize and deduplicate; cap the list for the scaffold.
- **C. Parse `bash` output accurately.** Unreliable across commands and
  locales; rejected.

**Recommendation.** **Option B**, with one shared helper used by both the
scaffold and `filesChangedSince`, so the count and the list always agree.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- RWC-010 implements the helper; a research-only transcript (read/grep/glob/
  fetch) reports **0** files changed, and a `bash ls`/`git status` reports 0.
- The warning count is derived from the same helper and the D4 cut; a test
  asserts equality with the scaffold set for the same range.
- Under-reporting bash-made changes is accepted and documented as the v1
  conservative rule; no prose scraping is added later without a structured
  source.
- `extractPaths` URL/version false positives are fixed or the helper stops
  using it for counting.
- The field keeps its name; README/SKILL describe the derivation in one
  sentence. R10's "warn, don't revert" is unchanged.

**Affected tickets / spec.**
[RWC-010](../tickets/RWC-010-files-changed-accuracy.md),
[RWC-005](../tickets/RWC-005-tui-picker-mapping.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-013](../tickets/RWC-013-test-probe-hardening.md); `SPEC.md` R5 field 1, R6
warning, R10.

**Spec text to change.** R5 field 1 → "`Files changed` — created/modified/
deleted, derived from `write`/`edit` arguments (and structured result metadata
where present); `bash` counts only paths the result exposes as applied changes;
reads, searches, and fetches never count; paths are normalized and deduplicated.
R10 defines the same set for the warning."

---

## D9 — R2's "summaries go through compaction" scope

**Context.** R2's acceptance says "summaries go through the `ctx.compaction`
contract". Every fork summary is a mechanical scaffold built by
`lib/scaffold.js`; the web template has no compaction service; D2 retires the
only in-place LLM path. Read literally, R2 makes the shipped fallback
non-conforming and forces either an LLM summarizer (which R2 also forbids) or
failure where no service exists.

**Options.**

- **A. Bind R2 to every summary**, including the fork fallback. Then v1 is
  non-conforming and must not ship; requires implementing hybrid first.
- **B. Scope R2 to LLM summarization** (recommended): when a summary is
  LLM-generated it must go through `ctx.compaction`; the five-field scaffold is
  a permitted scaffold-only delivery under R5's fallback, not a second
  summarizer. Session/storage/locking/context assembly stay un-reimplemented.
- **C. Delete R2's compaction clause.** Loses the composition requirement and
  invites a hand-rolled summarizer later; rejected.

**Recommendation.** **Option B.** It keeps the composition intent (no second
LLM-call plumbing) while acknowledging R5 already defines the fallback. The
plugin must label the degraded mode as "scaffold-only" wherever it reports a
summary.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- R2 opening and acceptance reworded; the contract probe/tests assert there is
  no LLM call path outside `ctx.compaction` and that a profile without the
  service still loads (the existing `probeService` behavior).
- README/SKILL state: v1 summaries are scaffold-only; hybrid is deferred (D2,
  D3); when hybrid lands, it must call `ctx.compaction`, not a new summarizer.
- No contradiction with R5's fallback or with D2's retirement.

**Affected tickets / spec.**
[RWC-003](../tickets/RWC-003-surface-correct-seed.md),
[RWC-004](../tickets/RWC-004-in-place-compaction.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-013](../tickets/RWC-013-test-probe-hardening.md); `SPEC.md` R2 (opening
and acceptance), R5.

**Spec text to change.** R2's opening binds `ctx.compaction` to unqualified
"summaries", so editing only the acceptance would leave the opening promising a
compaction path that D2 retires and D3 defers. Both halves of R2 change.

- R2 opening → "The plugin reuses the harness's existing machinery everywhere it
  exists: the fork-at-boundary rewind recipe (section 2), and the
  `ctx.compaction` contract for **any LLM-generated summary**. It must not
  reimplement session storage, locking, context assembly, or the LLM
  summarization call; the five-field scaffold (R5) is built by the plugin and is
  not an LLM summary."
- R2 acceptance → "…rewind goes through `agents.create`
  with a sliced seed (or a thin equivalent); **any LLM-generated summary** goes
  through the `ctx.compaction` contract. A profile without the service, or a path
  with no closed range, delivers the R5 five-field scaffold alone as the documented
  scaffold-only fallback; the plugin never implements its own summarizer,
  persistence, locking, or context assembly."

---

## D10 — Section 6.3 verification: temporary dsh-tui copy + `--dump-config`

**Context.** §6.3 requires running `dsh --dump-config` against a **temporary
copy** of the `dsh-tui` profile with the bundle added, never the live profile
and never booting the live TUI. That proves composition (the patch layer loads)
but not behavior: the in-place path and the TUI picker were never exercised, and
the web E2E runs on a template with no compaction service. `dsh-tui` is not a
shipped template, so the copy must be a directory copy; `--from-default-profile
dsh-tui` is not available. The ticket asks whether to keep the dump-config
requirement or replace it with the actual scratch-profile + E2E workflow.

**Options.**

- **A. Keep dump-config only.** Cheap and safe, but proves only that the patch
  parses/composes; the two surfaces with real risk stay unverified.
- **B. Replace it with scratch-profile + E2E only.** Proves behavior, but loses
  the earliest, cheapest failure detector for a bad patch layer.
- **C. Keep both** (recommended): the compose gate on a throwaway copy of
  `dsh-tui`, plus at least one live boot of a scratch profile per shipped
  surface — web E2E for command/tool, a manual TUI picker run with the grant and
  logs for the decision-event surface. Never the live profile, never the live
  TUI.

**Recommendation.** **Option C.** The dump-config check is the first thing that
fails on a malformed patch and costs seconds; the live checks are the only
evidence for R3/R6/R7. RWC-016 should record both.

**Decision:** Accepted — owner sign-off 2026-10-27

**Consequences.**

- §6.3 rewritten to two gates: (1) copy `$DSH_HOME/profiles/dsh-tui` to a new
  throwaway profile directory, install
  `dsh plugin --profile <scratch> add --offline file:$PWD`, then
  `dsh --profile <scratch> --dump-config | grep rewind-compact/entry`;
  (2) the per-surface live run (`scripts/test-web-profile.sh` +
  `scripts/e2e-web-test.py`; TUI manual steps in `TESTING.md` with the
  `session.rewind.intercept` grant and screenshots/logs).
- Never edit an existing profile and never boot the live TUI; a missing grant is
  recorded as the expected warned no-op, not a test failure.
- RWC-016's evidence list and TESTING.md steps change; cleanup
  (`rm -rf "$DSH_HOME/profiles/<scratch-name>"`, run on success and on failure)
  is part of the run and is recorded in the evidence.
- The TUI manual run can only exercise after mode (D5); before mode is verified
  through the command/tool fork.

**Affected tickets / spec.**
[RWC-001](../tickets/RWC-001-harness-baseline.md),
[RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
[RWC-013](../tickets/RWC-013-test-probe-hardening.md),
[RWC-016](../tickets/RWC-016-release-verification.md); `SPEC.md` §6.3, §7.

**Spec text to change.**

- §6.3 → the two-gate text above, explicitly allowing a throwaway profile copy
  under `$DSH_HOME/profiles/` while still forbidding edits to existing
  profiles/sessions and a live-TUI boot.
- §7 first bullet → "Never modify an existing profile, session, or storage under
  `~/.dsh/`. In v1 the only permitted write under that tree is creating a **new,
  throwaway profile directory** at `$DSH_HOME/profiles/<scratch-name>/` (with
  `$DSH_HOME` defaulting to `~/.dsh` and the name not already existing) by
  copying a template or `dsh-tui`, and installing the bundle into that copy.
  Never edit, install into, rename, or delete an existing profile; never touch a
  live session or lock file; never boot the live TUI. At the end of the run — and
  on failure — remove the scratch directory with
  `rm -rf "$DSH_HOME/profiles/<scratch-name>"` and record the cleanup in the
  run's evidence."
- §7's other clauses are unchanged. The exception is scoped to the new scratch
  directory only: if any harness or package-manager step would write outside it
  (for example the shared `$DSH_HOME/profiles/node_modules`), the run stops and
  records a blocker in RWC-016 rather than widening the exception. RWC-011 must
  write this exception into `SPEC.md` before any verification run relies on it;
  the "§7 stays as is" wording in the earlier draft is withdrawn.

---

## Consolidated SPEC.md delta (for RWC-011 to apply after sign-off)

| Clause | Required edit | Decision |
|---|---|---|
| §1 Purpose | The v1 summary is the five-field scaffold; hybrid prose is a v2 target; `ctx.compaction` is named only as the seam for a future LLM summary | D2, D3 |
| R2 opening + acceptance | Bind only LLM-generated summaries to `ctx.compaction`; scaffold-only is the documented fallback; no second summarizer/persistence/locking/context assembly | D9 |
| R3 §1 | TUI answers with after only and appends the scaffold to the child it forked (no child-side compaction in v1); command/tool keep both modes | D2, D3, D5 |
| R3 §2 | `rewind: false` is retired in v1 (documented unsupported result, no transcript write); `rewind: true` is the gated fork path | D2 |
| R4 opening | "rewind run" instead of every run; in-place is not a rewind and is retired in v1 | D1, D2 |
| R4 before-mode | Applies to command/tool forks; TUI does not offer it | D5 |
| R5 opening | Scaffold is the summary in v1; prose only with a closed range + service; child-side is a post-v1 target | D2, D3 |
| R5 field 1 | `write`/`edit` + structured metadata only; bash conservative; reads/searches/fetches never count; dedupe | D8 |
| R5 acceptance | Inside-range is conditional on a closed, balanced range; before-mode fork is scaffold-first, not a range compaction | D2b |
| R6 first bullet | User-message rows mapped to the enclosing completed turn; open-turn rows ineligible; cut = `turnStart.seq - 1` | D4 |
| R6 mode list | After only on the TUI; before on command/tool | D5 |
| R7 | In-place retired in v1; no plugin decision prompt; if it returns it stays ungated and must satisfy the closed-range rule | D1, D2, D2b, D6 |
| R10 | Same conservative "Files changed" set as R5 field 1; warn only | D8 |
| R11 item 2 | Direct-human authority, fail-closed; no prompt | D6 |
| R11 item 3/4 | Scaffold-only summaries; title is best-effort metadata | D2, D7 |
| R12 title | `session/title` event in `setup` before publication, best-effort; no create-time option | D7 |
| §6.3 | Two gates: scratch-copy dump-config + live scratch run per surface | D10 |
| §7 | First bullet gains one concrete exception: a new throwaway profile directory under `$DSH_HOME/profiles/`, never an existing one, with `rm -rf` cleanup and evidence | D10 |

## Affected tickets (canonical) and backlog consequences

The table below is the single source of truth for the ticket mapping; each
decision's "Affected tickets" list repeats the same set. "Status unchanged"
means this ADR does not move the ticket, but its Context/Tasks/Out-of-scope,
tests, or verification steps must be updated after sign-off — which is what
makes RWC-015's check "no affected ticket still describes a rejected design as
required" verifiable.

| Ticket | Decisions | What changes after sign-off |
|---|---|---|
| [RWC-001](../tickets/RWC-001-harness-baseline.md) | D10 | The re-baselined profile layout, `dsh plugin add`, and `--dump-config` facts §6.3's gates depend on |
| [RWC-002](../tickets/RWC-002-fork-create-metadata.md) | D7 | No create-time title; append a best-effort `session/title` event instead |
| [RWC-003](../tickets/RWC-003-surface-correct-seed.md) | D3, D5, D9 | Seed composition stays; child-side hybrid, TUI before mode, and R2 binding of plain summaries drop out |
| [RWC-004](../tickets/RWC-004-in-place-compaction.md) | D1, D2, D2b, D3, D9 | Retire branch: `rewind: false` returns the documented unsupported result; hybrid/inside-range expectations become v2 |
| [RWC-005](../tickets/RWC-005-tui-picker-mapping.md) | D4, D5, D8 | Picked row maps to its enclosing completed turn; after-only TUI; shared conservative files helper |
| [RWC-006](../tickets/RWC-006-tui-before-mode.md) | D1, D2, D2b, D3, D4, D5 | Drop branch: before mode leaves the TUI and remains on the command/tool |
| [RWC-007](../tickets/RWC-007-failure-atomicity.md) | D1, D2, D6 | Retired in-place result is a clean documented error; no approval prompt; no append-before-validate path |
| [RWC-008](../tickets/RWC-008-turn-point-validation.md) | D4 | A picked row must resolve to a completed turn; there is no mid-turn point |
| [RWC-010](../tickets/RWC-010-files-changed-accuracy.md) | D2, D8 | Conservative `Files changed` derivation; no in-place dependency |
| [RWC-011](../tickets/RWC-011-docs-spec-alignment.md) | D1, D2, D2b, D3, D4, D5, D6, D7, D8, D9, D10 | Applies the consolidated delta; docs/skill stop claiming hybrid, in-place, a prompt, or a create-time title |
| [RWC-013](../tickets/RWC-013-test-probe-hardening.md) | D2, D2b, D3, D5, D8, D9, D10 | Tests/probe assert the retired path, scaffold-only summaries, after-only TUI, the new derivation, and the two §6.3 gates |
| [RWC-016](../tickets/RWC-016-release-verification.md) | D2, D5, D10 | Evidence list no longer requires in-place success; TUI after only; two §6.3 gates plus scratch-directory cleanup |

- **Eligible after sign-off:** RWC-004 (retire branch), RWC-006 (drop branch),
  RWC-011 (docs/spec edits), subject to their remaining dependencies. RWC-007
  then integrates the retired in-place result and the TUI after-only behavior;
  RWC-016's verification list changes per D10.
- **Status unchanged, scope affected:** RWC-001, RWC-002, RWC-003, RWC-005,
  RWC-007, RWC-008, RWC-010, RWC-013, RWC-016. The earlier "not changed by this
  ADR" list is withdrawn: it contradicted D2/D3/D5/D8/D9/D10, which change
  RWC-013's assertions and probe in particular.
- **Unaffected:** RWC-009 (message source kind), RWC-012 (profile coverage),
  RWC-014 (package distribution); no decision changes their scope.
- **Explicitly not decided here:** whether to open a hybrid spike ticket (owner
  call after sign-off); the exact `reason` code for the retired in-place result;
  whether `Files changed` distinguishes created vs modified beyond structured
  metadata. Those are implementation details that do not change these
  decisions.
- **No ticket or spec edits are made by this document.** RWC-011 applies the
  table above; the owning tickets update their own Context/Tasks/Out-of-scope.

## Sign-off

RWC-015 requires explicit owner sign-off on decisions 1–7 (the
behavior-changing ones). D8 changes the same derivation the R6 warning uses and
should be signed with them; D9–D10 are bundled because they change what the docs
may claim and how verification is done. Reply in RWC-015 with "approved" or with
per-decision changes.

| Decisions | Owner | Date | Notes |
|---|---|---|---|
| D1–D7 (behavior-changing) | user (session) | 2026-10-27 | Approved; editorial follow-ups tracked in RWC-011. |
| D8 (Files changed derivation) | user (session) | 2026-10-27 | Approved with D1–D7. |
| D9–D10 (R2 scope, §6.3 verification) | user (session) | 2026-10-27 | Approved with D1–D7. |

Signed off 2026-10-27. The decisions are binding; RWC-011 still applies the
SPEC delta and the owning tickets update their Context/Tasks. RWC-004, RWC-006,
and RWC-011 are eligible to proceed, subject to their remaining dependencies.

## References

- [SPEC.md](../../SPEC.md) — §1, R2, R3, R4, R5, R6, R7, R10, R11, R12,
  §6.3, §7
- [RWC-015 ticket](../tickets/RWC-015-spec-decisions.md)
- [Dependency graph](../tickets/dependency-graph.md)
- [Harness contracts](../HARNESS-CONTRACTS.md) — compaction, fork recipe, TUI
  decision events, transcript envelope
- [TESTING.md](../../TESTING.md) — web E2E, smoke test, TUI manual checks
- Affected tickets (matches the canonical table above):
  [RWC-001](../tickets/RWC-001-harness-baseline.md),
  [RWC-002](../tickets/RWC-002-fork-create-metadata.md),
  [RWC-003](../tickets/RWC-003-surface-correct-seed.md),
  [RWC-004](../tickets/RWC-004-in-place-compaction.md),
  [RWC-005](../tickets/RWC-005-tui-picker-mapping.md),
  [RWC-006](../tickets/RWC-006-tui-before-mode.md),
  [RWC-007](../tickets/RWC-007-failure-atomicity.md),
  [RWC-008](../tickets/RWC-008-turn-point-validation.md),
  [RWC-010](../tickets/RWC-010-files-changed-accuracy.md),
  [RWC-011](../tickets/RWC-011-docs-spec-alignment.md),
  [RWC-013](../tickets/RWC-013-test-probe-hardening.md),
  [RWC-016](../tickets/RWC-016-release-verification.md)
