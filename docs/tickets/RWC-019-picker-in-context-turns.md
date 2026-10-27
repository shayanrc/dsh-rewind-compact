# RWC-019 — Picker lists only turns present in the current context

- **Status:** in-progress (implementation + tests green; awaiting independent code review + acceptance check)
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

- [ ] A transcript with a compaction checkpoint shadowing turns N..M offers
      only turns with ≥1 surface message outside the shadowed range.
- [ ] A forked child's picker lists its inherited kept-side turns plus new
      turns; the source session's picker is unchanged.
- [ ] The preview never shows system/plugin notice text.
- [ ] The tool's `point` resolution behavior matches the decision recorded in
      this ticket.
- [ ] Regression tests fail before the fix.
- [ ] `npm test` and `npm run check` green on the declared harness line.

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
  (shadowed turns offered, notice preview ×2, raw-log count, empty-context
  message); the fork-child parity test and the fast-path recovery test are
  deliberate guards that pass before and after. One tool test pins the
  recovery-path decision. `npm test` 88/88 and `npm run check` green.
