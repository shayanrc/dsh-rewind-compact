# RWC-007 — Failure atomicity and error surfacing

- **Status:** blocked
- **Priority:** P0
- **Type:** bug
- **Estimate:** M
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-004, RWC-006
- **Blocks:** RWC-011, RWC-016
- **Spec:** R5, §5 (fail loudly)
- **Review:** 2026-10-27 review, P1-6

## Post-ADR note (2026-10-27)

ADR D2 retires in-place and D5 drops TUI before mode. Keep this ticket focused
on the remaining failure paths: TUI after-mode summary append/replay errors,
fork/seed errors, and any retired-path result that could be mistaken for
success. The in-place partial-mutation scenario is historical unless D2 is
reopened.

## Context

Two failure modes hide or compound errors:

1. **Tool in-place path:** `lib/tool.js:155-161` appends the scaffold, then
   calls `compactRegion`. If compaction rejects (surface/balance/engine), the
   catch rethrows, but the appended scaffold remains in the live transcript as
   a fake user message. The next model request sees it. Nothing reports that
   the transcript was partially mutated.
2. **TUI composition:** `lib/tui-rewind.js:118-120` catches any composition
   failure, logs a warning, and returns `undefined`. The TUI shows no toast and
   the child may silently lack its summary; the user believes the rewind
   succeeded.

The spec’s standards say: “Errors: fail loudly with actionable messages; never
swallow the LLM or compaction errors.”

## Tasks

- [ ] Tool path: validate everything that can reject **before** appending:
      range membership in `session.surface`, pairing balance, open-step check,
      compaction service presence, abort signal.
- [ ] If the engine can still reject after append (race/async), report the
      partial state explicitly in the thrown error and in the tool result:
      “scaffold appended at seq N; compaction failed; transcript now contains
      an uncompacted summary”.
- [ ] Prefer an order that cannot leave a stray message: either compact first
      and append the scaffold after (document the order), or reserve/validate a
      range the engine will accept.
- [ ] TUI path: return a first non-empty string (the toast normalization) on
      failure, e.g. “rewind succeeded but the summary was not composed:
      <reason>; the child contains the prefix only”. Log the stack at warn/error.
- [ ] Do not return `undefined` for a failure that the user must know about;
      only return `undefined` for “no opinion” on the prompt event.
- [ ] Command/tool error text should identify the surface, source id, and
      whether anything was mutated.
- [ ] Add tests that force:
      - compaction rejection after append;
      - TUI `appendSummary`/`replayEvents` rejection;
      - missing session in `sessionFor`.
- [ ] Update `TESTING.md` with the expected failure messages.

## Acceptance criteria

- [ ] A forced compaction rejection leaves the live transcript unchanged (or
      the result explicitly reports the appended seq and the user sees it).
- [ ] The TUI failure path produces a visible toast and a log line; it never
      silently returns `undefined` after a failed composition.
- [ ] `applied`/`ok` never claim success when the summary is missing.
- [ ] Error messages include the source/child id and the failing step.
- [ ] Regression tests fail before the fix.

## Verification

```sh
npm test
# monkeypatch compactRegion/append to throw in a test harness;
# assert transcript length and toast/error string
```

Expected: no silent failure; no orphan scaffold without a report.

## Out of scope

- Making compaction succeed (RWC-004).
- TUI before-mode design (RWC-006).

## Notes / evidence

- `lib/tool.js:156` appends before `compactRegion`; the catch wraps and throws.
- `lib/tui-rewind.js:118-120` catches, warns, returns `undefined`.
- The TUI normalizes the first non-empty string return into a toast, so an
  error string is the right channel.
