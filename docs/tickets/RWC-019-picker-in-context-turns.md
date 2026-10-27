# RWC-019 — Picker lists only turns present in the current context

- **Status:** done
- **Priority:** P1
- **Type:** bug / ux
- **Estimate:** M
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-008, RWC-018
- **Blocks:** —
- **Spec:** R3.1, R6
- **Review:** 2026-10-27 live use (web `/rewind-compact` picker)

## Context

The bare `/rewind-compact` picker builds its turn list from
`listTurnBoundaries(events)` over the **raw event log**. Every completed turn
in the log is offered, including turns whose content is **no longer in the
model-visible context** — shadowed by a compaction checkpoint, or replaced by a
compact summary in a forked lineage. Users are offered rewind points whose
details no longer exist in context, which reads as "the compacted turns are
still there".

Two secondary defects in the same list derivation:

- the per-turn preview (`firstUserTextAfter`) takes the first `user/message`
  regardless of source kind, so a system notice ("The approval policy changed
  from 'ask' to 'never' …") surfaced as turn 1's preview in the live web
  session;
- the files-changed count is computed over the raw log, which double-counts
  content that the current surface no longer shows.

Spec rule (now in R3.1/R6): the turn list offers **only completed turns present
in the current model-visible context** — a turn is offered iff it still has at
least one message in the session's derived surface. The tool keeps accepting
explicit turn numbers for recovery; the picker never advertises an
out-of-context turn.

## Tasks

- [x] Derive picker options from the session surface: a completed turn is
      offered iff ≥1 of its messages is visible in the current derived context
      (not shadowed by a compaction checkpoint / prior summary).
- [x] Keep newest-first ordering, the files-changed count, and the preview;
      compute all three over the same in-context view.
- [x] Derive the preview text only from human/model surface messages — never
      from system notices or plugin summary rows.
- [x] Forked children: verify the child lists exactly its inherited (kept-side)
      turns plus its new turns, and never a summary-only range.
- [x] Tool: document that explicit `point` values still resolve
      out-of-context turns (recovery path); record the decision here.
- [x] Tests: a fixture with a compaction checkpoint shadowing a middle range
      offers the surrounding turns but skips the shadowed ones; a fork-child
      fixture lists inherited + new turns; the preview never shows
      system-notice text. Tests fail before the fix.
- [x] Docs: SPEC R3.1/R6 (done — rule recorded), README surfaces note, SKILL
      line ("you can only rewind to turns still in context").

## Acceptance criteria

- [x] A transcript with a compaction checkpoint shadowing turns N..M offers
      only turns with ≥1 surface message outside the shadowed range.
- [x] A forked child's picker lists its inherited kept-side turns plus new
      turns; the source session's picker is unchanged.
- [x] The preview never shows system/plugin notice text.
- [x] The tool's `point` resolution behavior matches the decision recorded in
      this ticket.
- [x] Regression tests fail before the fix.
- [x] `npm test` and `npm run check` green on the declared harness line.

## Verification

```sh
npm test
node scripts/check-contracts.mjs
# manual: session with a compaction checkpoint, then bare /rewind-compact —
# expect the shadowed turns absent from the list
```

Expected: only in-context turns offered; previews are human/model text.

## Out of scope

- The TUI Esc-Esc picker surface (RWC-018 descope).
- Changing what compaction shadows.
- Deleting or hiding turns in the source session (R4 recoverability).

## Notes / evidence

- Live web picker (session `da55c85a-…`, 54 completed turns) offered every
  turn; turn 1's preview showed the approval-policy system notice instead of
  the turn's human message.

## Recorded decision (recovery path)

Explicit points resolve out-of-context turns on BOTH explicit surfaces: the
tool's `point` (`lib/tool.js` `resolveRowSeq` → `listTurnBoundaries` over the
raw log — unchanged) and the command's fast path (`/rewind-compact <turn>`,
`lib/command.js` — now deliberately kept on `listTurnBoundaries` rather than
the picker's filtered list). Only the ADVERTISED list (the bare-command
picker's `boundaryOptions` → `inContextTurnBoundaries`) filters to in-context
turns, per SPEC R3.1 ("the picker never advertises one"). A rewind to an
out-of-context turn is coherent: the boundary is a cut in the raw log, and the
child's seed keeps replacement markers verbatim so the child's own fold
reproduces the same shadowing.

The picker's files-changed count and preview are computed over the in-context
view (`inContextEvents`), while the fork-time warning (`runFork`) and the
scaffold's `Files changed` field deliberately stay on the raw-log derivation
(the physical truth that files were changed and not reverted, and the
summary/warning agreement invariant in AGENTS.md).

## Implementation notes (2026-10-27)

- `lib/events.js`: `shadowedSeqRanges` (replays the `foldSurfaceRecords` splice
  rule and records each effective replace marker's inclusive range — surface
  nodes AND log-only rows inside it), `inContextEvents` (the log minus shadowed
  ranges), `inContextTurnBoundaries` (completed turns with ≥1 message in the
  current derived surface; entries extend `listTurnBoundaries` with `endSeq`).
- `lib/command.js`: `boundaryOptions` derives ordering, count, and preview from
  the in-context view; `firstHumanOrModelTextAfter` accepts only `user/message`
  with `source.kind === 'user'` or `assistant/message` rows, bounded by the
  turn's `endSeq` (robust even when the turn/end marker itself is shadowed);
  the fast path uses `listTurnBoundaries` (all turns); the picker's empty-list
  message now names the context restriction.
- Regression tests: 4 of 6 new command tests failed on the pre-fix code
  (shadowed turns offered, notice preview, raw-log count, empty-context
  message); the fork-child parity test and the fast-path recovery test are
  deliberate guards that pass before and after. One tool test pins the
  recovery-path decision. `npm run check` green.

## Review findings addressed (independent code review, 2026-10-27 — approve)

1. **Picker no-op dead end (minor):** `isNoOp` was evaluated over the filtered
   in-context list, so after-mode at the newest in-context boundary was
   refused even when a real (shadowed) tail existed — and with one in-context
   turn both modes were refused. Fixed: the picker's no-op test now runs
   against the FULL `listTurnBoundaries` list; a regression test (fails on
   the pre-fix branch code) covers the shadowed-newer-turns shape.
2. **Interval under-approximation (minor):** `shadowedSeqRanges` recorded only
   the numeric `[startSeq, endSeq]` interval; a later span splicing an earlier
   replacement node positioned inside but numerically outside the interval
   left that node's row in `inContextEvents`. Fixed: spliced node seqs outside
   the interval are recorded as exact singleton ranges; unit-tested with the
   nested-marker case.
3. **Ticket wording (nit):** the pre-fix failure list miscounted "notice
   preview ×2" — there is one notice-preview test among the four. Corrected.
4. **Coverage gaps (nit):** added direct unit tests for `shadowedSeqRanges`
   (effective / ineffective / nested markers), `inContextEvents` (including
   the log-only-row-inside-interval case and the no-marker identity fast
   path), and `inContextTurnBoundaries` (visibility, endSeq, between-turn
   rows, open turn); added a command test pinning the preview's `endSeq` bound
   (a turn whose only visible row is a tool result gets no preview even
   though a later turn's human text is in the view).

Post-review suite: `npm test` 93/93; `npm run check` ALL CONTRACTS PASS. The
reviewer also validated the new functions against 211 real transcripts under
`~/.dsh/sessions` (largest: 2893 events / 50 turns) with zero divergence.

## Completion

- **Completed:** 2026-10-27
- **Reviewed by:** independent subagent (`RWC-019 code review`), verdict **approve** — 2 minor findings + nits, all addressed in 236ca4c (picker no-op over the full turn list; exact spliced-node recording; unit tests for the new exports; endSeq-bound pin; ticket wording).
- **Verified by:** independent subagent (`RWC-019 acceptance check`), verdict **pass** — all six criteria verified empirically, including /tmp reproductions of both the pre-fix failures (4 of 6 original command tests) and the pre-review failures (both review-fix guards fail on the pre-review code).
- **Changed files:** `lib/events.js` (`shadowedSeqRanges`, `inContextEvents`, `inContextTurnBoundaries`), `lib/command.js` (picker in-context derivation, human/model preview, full-list no-op, fast path on all turns), `tests/command.test.js` (8 RWC-019 tests), `tests/events.test.js` (3 unit tests), `tests/tool.test.js` (1 recovery test), `README.md`, `skill/rewind-compact/SKILL.md`, `docs/tickets/` (ticket, board, dependency graph).
- **Evidence:** `npm test` 93/93; `npm run check` ALL CONTRACTS PASS on 0.2.1-rc.2; real-transcript sweep (211 sessions) with zero divergence.
- **Merged:** into `main` after both sign-offs, per the review-gate protocol (RWC-020 had merged first; the known cross-branch test-file conflicts were resolved by keeping both test blocks).
- **Follow-ups (not acceptance failures):**
  - The `Final sequence` / dependency-graph statuses are synced in this merge; `docs/tickets/README.md` remains the status source of truth.
  - A between-turns human message (exotic transcript shape) could still be attributed to no turn by design — previews for such rows are intentionally never shown.
