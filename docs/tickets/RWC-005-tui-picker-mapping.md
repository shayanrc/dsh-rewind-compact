# RWC-005 — TUI picker: map the picked message to its enclosing turn

- **Status:** done
- **Priority:** P0
- **Type:** bug
- **Estimate:** S
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001
- **Blocks:** RWC-006, RWC-011, RWC-013, RWC-016
- **Spec:** R3, R6
- **Review:** 2026-10-27 review, P0-3

## Context

`lib/tui-rewind.js:49` does:

```js
const index = boundaries.findIndex((b) => b.seq === seq);
```

`boundaries` are `turn/start` events. The TUI’s Esc-Esc rewind overlay offers
**user-message rows** (`Chat.js` filters `row.kind === 'user'`), and
`tui/rewind-prompt` documents `seq` as the “Session event seq of the picked
message.” A message seq never equals the enclosing `turn/start` seq, so
`index` is `-1`, `rewindPromptAnswer` returns `undefined`, and the confirm pane
never shows “Rewind + compact after/before”.

The same wrong seq is used for the files-changed warning:
`filesChangedSince(events, seq)` counts from the picked message, not from the
turn boundary.

## Tasks

- [x] In `rewindPromptAnswer`, map `payload.seq` to its enclosing completed
      turn: walk back to `turn/start` (reuse/extract `forkBoundarySeq`), then
      find the boundary index. Do not compare the raw row seq to
      `turn/start` seqs.
- [x] For a picked row inside the still-open turn (no completed boundary),
      return `undefined` (or only the modes the seam can support) with a
      comment explaining the choice.
- [x] Derive the cut (`turnStart.seq - 1`) and use it for
      `filesChangedSince`, so the warning covers changes after the boundary.
- [x] Keep no-op omission keyed to the chronological boundary index: last
      completed turn → no `after` (ADR D5 drops the TUI's before mode).
- [x] Return the exact id/label:
      `rewind-compact-after` / `Rewind + compact after`.
- [x] Add a unit test with a realistic transcript: turn/start seq 10, user
      message seq 15, turn/end seq 20; assert **after only** for a non-edge
      turn (ADR D5), the after no-op omitted at the last completed turn, and
      ineligibility for an open-turn row.
- [x] Add a manual TUI check to `TESTING.md` with the grant step and expected
      confirm-pane list (after only).

## Acceptance criteria

- [x] With `tui/rewind-prompt` payload `{seq: <user message>}` on a
      non-edge completed turn, the answer contains the after mode with the
      exact id/label (`rewind-compact-after` / `Rewind + compact after`).
- [x] On the last completed turn the after side is a no-op and no mode is
      offered; an open-turn row is ineligible. Before mode is not offered on
      the TUI (ADR D5).
- [x] The warning count is computed from the turn cut, not the message seq.
- [x] The handler is unit-tested for the after-only answer; the interactive
      confirm-pane observation is RWC-016's release gate (grant + screenshot).
- [x] Without the grant, the behavior is unchanged (warned no-op); the handler
      does not throw.
- [x] The new test fails against the current code.

## Verification

```sh
npm test
# TUI: grant session.rewind.intercept, Esc Esc, pick a row:
# expect: Rewind + compact after (after only; ADR D5)
```

Expected: after mode appears for eligible non-last rows; no-op/open-turn rows omitted.

## Out of scope

- TUI before-mode composition (dropped by ADR D5; command/tool before is
  RWC-006/003).
- Changing the TUI’s row list or the built-in rewind.

## Notes / evidence

- `TuiRewindPromptEvent.seq` doc: “Session event seq of the picked message.”
- `Chat.js` rewind candidates: `row.kind === 'user' && row.label === undefined`.
- `tui/rewind-done` already receives the correct `boundarySeq` (the cut), so
  only the prompt path needs the new mapping.

## Evidence (2026-10-27 remediation)

- `lib/events.js` `enclosingCompletedTurnStart` maps a picked message seq to
  its completed `turn/start`; `lib/tui-rewind.js` cuts at `turnStart.seq - 1`
  and counts files from that cut.
- `tests/tui-rewind.test.js` uses turn/start 10, user 15, turn/end 20, and a
  mid-turn queued message at 35; it asserts after-only, no-op omission, open-turn
  ineligibility, and the warning count from the cut.
- The real-TUI confirm-pane observation is a release check (RWC-016); the
  decision handler itself is covered by the unit test.

- Independent review (2026-10-27): **PASS**. Verified message→completed-turn mapping, cut `turnStart.seq-1`, after-only answer, last-turn no-op, open-turn rejection, and warning count from the cut.

- Independent verification (2026-10-27): **VERIFIED**. Reran turn 14/message 18/end 23: maps to turn 14, cut 13, after-only, last/open-turn undefined, warning 1 from cut vs 0 from row seq.

- **Descoped for v1 (RWC-018):** the seq→turn mapping and after-only answer are implemented and unit-tested, but the picker surface is not registered because a profile bundle cannot use the TUI host DecisionEvents registry. The TUI command/tool are the shipped surfaces.
