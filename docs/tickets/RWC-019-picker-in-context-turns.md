# RWC-019 — Picker lists only turns present in the current context

- **Status:** open
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

- [ ] Derive picker options from the session surface: a completed turn is
      offered iff ≥1 of its messages is visible in the current derived context
      (not shadowed by a compaction checkpoint / prior summary).
- [ ] Keep newest-first ordering, the files-changed count, and the preview;
      compute all three over the same in-context view.
- [ ] Derive the preview text only from human/model surface messages — never
      from system notices or plugin summary rows.
- [ ] Forked children: verify the child lists exactly its inherited (kept-side)
      turns plus its new turns, and never a summary-only range.
- [ ] Tool: document that explicit `point` values still resolve
      out-of-context turns (recovery path); record the decision here.
- [ ] Tests: a fixture with a compaction checkpoint shadowing a middle range
      offers the surrounding turns but skips the shadowed ones; a fork-child
      fixture lists inherited + new turns; the preview never shows
      system-notice text. Tests fail before the fix.
- [ ] Docs: SPEC R3.1/R6 (done — rule recorded), README surfaces note, SKILL
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
