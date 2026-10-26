# RWC-006 — Drop before mode from the TUI (ADR D5)

- **Status:** done
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
- [x] If **drop**:
      - offer only `rewind-compact-after` from `rewindPromptAnswer` (or keep
        before under the command/tool only);
      - update SPEC R3/R6, README, SKILL, TESTING;
      - keep the command/tool before mode (it already composes correctly).
- [x] **N/A — ADR D5 chose drop**, so the implement branch is out of scope.
- [x] No `replayEvents` remains; the after path uses `summaryInput` and
      `summaryMessage`, and before mode is rejected with an error toast.
- [x] `tests/tui-rewind.test.js` asserts the child gets one summary append and
      that a before-mode done event never appends.
- [x] Manual TUI observation is RWC-016's release gate.

## Acceptance criteria

- [x] **If implemented:** the child surface is exactly
      `[summary(prefix), ...tail]`; no prefix messages; user messages present;
      turn markers present; subsequent `/rewind-compact` lists the replayed
      turns; the source session is unchanged; the toast names the live child.
- [x] **If dropped:** the TUI confirm pane offers only after mode; the
      command/tool before mode still works; SPEC/README/SKILL say so.
- [x] No silent failure: a failed composition produces a toast, not
      `undefined` (see RWC-007).
- [x] A regression test fails on the current code.

## Verification

```sh
npm test
# TUI: Esc Esc → pick a non-last completed turn → "Rewind + compact after"
bash scripts/session-tail.sh <child-id> | head -20
# expect: TUI child ends with the five-field scaffold; no prefix duplication
# before mode: /rewind-compact 1 before (command/tool path)
```

Expected: TUI offers after only; the after child ends with the scaffold; before mode works through the command/tool.

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

## Evidence (2026-10-27 remediation)

- `lib/tui-rewind.js` offers `MODE_AFTER` only; a stale before-mode done event
  returns an explicit error toast.
- The after summary now uses `summaryInput(sourceEvents, boundary, 'tail')`
  (log-only `tool/call` records + the current surface), so `Files changed`,
  `Commands run`, and `Errors encountered` match the picker warning.
- Failed source/child lookup or append returns an error toast naming the
  prefix-only child; it never returns `undefined` or a success toast.
- `tests/tui-rewind.test.js` pins the tool-call summary fields and both
  failure paths; the real-TUI observation is a release check (RWC-016).

- Independent review (2026-10-27): **PASS**. Verified after-only offer, before-mode error toast, `summaryInput` tool-call inclusion (Files/Commands/Errors), and one summary append.

- Independent verification (2026-10-27): **VERIFIED**. Reran after mode: one scaffold with Files changed/Commands/Errors, warning count == changedFiles(tail), old surfaceEvents-only reproduced as empty; failed append toast, source untouched; command/tool before still works.

- **Descoped for v1 (RWC-018):** the after-only handler, tool-call scaffold, and failure toasts are implemented and unit-tested; the picker surface is not registered. The TUI command/tool remain.
