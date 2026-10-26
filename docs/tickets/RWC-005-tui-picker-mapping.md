# RWC-005 — TUI picker: map the picked message to its enclosing turn

- **Status:** open
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

- [ ] In `rewindPromptAnswer`, map `payload.seq` to its enclosing completed
      turn: walk back to `turn/start` (reuse/extract `forkBoundarySeq`), then
      find the boundary index. Do not compare the raw row seq to
      `turn/start` seqs.
- [ ] For a picked row inside the still-open turn (no completed boundary),
      return `undefined` (or only the modes the seam can support) with a
      comment explaining the choice.
- [ ] Derive the cut (`turnStart.seq - 1`) and use it for
      `filesChangedSince`, so the warning covers changes after the boundary.
- [ ] Keep no-op omission keyed to the chronological boundary index: last
      completed turn → no `after`; first turn → no `before`.
- [ ] Return the exact ids/labels:
      `rewind-compact-after` / `Rewind + compact after`;
      `rewind-compact-before` / `Rewind + compact before`.
- [ ] Add a unit test with a realistic transcript: turn/start seq 10, user
      message seq 15, turn/end seq 20; assert both modes for a non-edge turn,
      only `before` at the last, only `after` at the first.
- [ ] Add a manual TUI check to `TESTING.md` with the grant step and expected
      confirm-pane list.

## Acceptance criteria

- [ ] With `tui/rewind-prompt` payload `{seq: <user message>}` on a
      non-edge completed turn, the answer contains both modes with the exact
      ids and labels.
- [ ] On the last completed turn, only `rewind-compact-before` is offered; on
      the first, only `rewind-compact-after`.
- [ ] The warning count is computed from the turn cut, not the message seq.
- [ ] In a real TUI with the `session.rewind.intercept` grant, the confirm pane
      shows the two modes (screenshot/log in TESTING.md).
- [ ] Without the grant, the behavior is unchanged (warned no-op), and the
      plugin does not throw.
- [ ] The new test fails against the current code.

## Verification

```sh
npm test
# TUI: grant session.rewind.intercept, Esc Esc, pick a row:
# expect: Rewind + compact after / Rewind + compact before
```

Expected: modes appear for eligible rows; no-op sides omitted.

## Out of scope

- Composing the before-mode child (RWC-006).
- Changing the TUI’s row list or the built-in rewind.

## Notes / evidence

- `TuiRewindPromptEvent.seq` doc: “Session event seq of the picked message.”
- `Chat.js` rewind candidates: `row.kind === 'user' && row.label === undefined`.
- `tui/rewind-done` already receives the correct `boundarySeq` (the cut), so
  only the prompt path needs the new mapping.
