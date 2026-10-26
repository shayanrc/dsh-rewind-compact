# RWC-006 — Drop before mode from the TUI (ADR D5)

- **Status:** open
- **Priority:** P1
- **Type:** bug
- **Estimate:** M (drop)
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-005 (RWC-015 signed 2026-10-27)
- **Blocks:** RWC-007, RWC-011, RWC-016
- **Spec:** R4, R5
- **Review:** 2026-10-27 review, P1-4

## Post-ADR scope (authoritative, 2026-10-27)

ADR D5 drops before mode from the TUI. Implement **only the drop branch**: the
Esc-Esc confirm pane offers `rewind-compact-after` only; before mode remains on
the command and tool. Update SPEC/README/SKILL/TESTING (RWC-011 applies the SPEC
delta) and remove the dead before-mode TUI composition code. Do not create a
summary-first child.

## Context

The TUI forks the child with the **prefix** (everything before the cut), then
dispatches `tui/rewind-done`. For before mode, `lib/tui-rewind.js:110-117`
appends the tail to that prefix child and then appends a summary of the prefix
at the end. The result is:

```
[prefix messages] [tail messages] [summary(prefix)]   // wrong order + duplicate prefix
```

R4 requires `[summary(prefix)] [tail verbatim]`. Also `replayEvents` only
appends records with `data.message`, so real `user/message` rows (whose `data`
*is* the message) are dropped, and no `turn/start`/`turn/end` markers travel;
future rewinds cannot see the replayed turns.

The TUI seam cannot retroactively remove the prefix child’s messages
(append-only), so a correct before-mode child must be created by the plugin
itself (or before mode must be dropped from this surface).

## Tasks

- [x] **Decision input:** RWC-015 chooses “drop before from TUI” or “create a
      correct child”. Record it in this ticket. (D5: drop.)
- [ ] If **drop**:
      - offer only `rewind-compact-after` from `rewindPromptAnswer` (or keep
        before under the command/tool only);
      - update SPEC R3/R6, README, SKILL, TESTING;
      - keep the command/tool before mode (it already composes correctly).
- [ ] If **implement**:
      - on `tui/rewind-done` with before mode, create a new child with
        `agents.create` seeded as `[summary(prefix), ...tail]` (tail materialized
        from the current source surface, preserving user/assistant/tool-result
        and turn markers);
      - do not append the prefix to the child; do not reuse the TUI-created
        child as the final session (dispose/leave it or switch to the new one
        through the same adoption/switch path the TUI uses);
      - set metadata/title per RWC-002 and source kind per RWC-009;
      - return a toast that identifies the actual child;
      - define behavior when the TUI child was already adopted (user-visible
        switch, ordering).
- [ ] Fix `replayEvents` either way: user messages must be replayable by
      appending `record.type, record.data` (data is the message), and turn
      markers must be preserved if the child will ever list inherited turns.
- [ ] Add a test that asserts the child’s surface order and contents.
- [ ] Manual TUI verification with screenshots/logs.

## Acceptance criteria

- [ ] **If implemented:** the child surface is exactly
      `[summary(prefix), ...tail]`; no prefix messages; user messages present;
      turn markers present; subsequent `/rewind-compact` lists the replayed
      turns; the source session is unchanged; the toast names the live child.
- [ ] **If dropped:** the TUI confirm pane offers only after mode; the
      command/tool before mode still works; SPEC/README/SKILL say so.
- [ ] No silent failure: a failed composition produces a toast, not
      `undefined` (see RWC-007).
- [ ] A regression test fails on the current code.

## Verification

```sh
npm test
# TUI: Esc Esc → pick a non-first turn → "Rewind + compact before"
bash scripts/session-tail.sh <child-id> | head -20
# expect: summary first, then tail; no prefix duplication; turn/start present
```

Expected: summary-first child; future rewind lists the replayed turns.

## Out of scope

- Tool/command before-mode seed (already correct; verify under RWC-003).
- TUI row→turn mapping (RWC-005).

## Notes / evidence

- The TUI child seed is the prefix only (`session-rewind.js` slices at the cut
  and calls `agents.create`).
- `replayEvents` (`lib/tui-rewind.js:80-87`) requires `data.message`;
  real `user/message` data has no `message` key (verified in a v4 transcript).
- Append-only sessions cannot prepend; the summary-first order requires a new
  child or a different seed.
