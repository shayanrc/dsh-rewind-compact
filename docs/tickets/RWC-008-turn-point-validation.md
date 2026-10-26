# RWC-008 — Fail closed on invalid or ambiguous turn points

- **Status:** done
- **Priority:** P1
- **Type:** bug
- **Estimate:** S
- **Owner:** wave-0 implementer (subagent)
- **Created:** 2026-10-27
- **Depends on:** —
- **Blocks:** —
- **Spec:** R6
- **Review:** 2026-10-27 review, P1-7

## Context

`boundaryForPoint` (`lib/events.js:162-167`) falls back to the newest boundary
for any out-of-range number:

```js
boundaries[numeric - 1] ?? boundaries[boundaries.length - 1 + (numeric < 0 ? numeric + 1 : 0)]
```

So `0`, `99`, and `-1` all resolve to the last turn. `/rewind-compact 99 after`
and the tool’s `point: "99"` silently fork to the newest turn instead of
erroring. For a rewind that discards context, a typo should fail closed. The
command also defaults any unrecognized mode token to `after`
(`lib/command.js:81`), so `/rewind-compact 2 sideways` silently compacts after.

## Tasks

- [x] Change the point contract: accept a 1-based turn number, an explicit turn
      id/number match, and optionally a documented `-1` (newest). Reject `0`,
      out-of-range positives, non-integers, and empty input with a clear error.
- [x] Update `boundaryForPoint` to return `undefined` on invalid points; move
      the “newest” alias into an explicit branch (e.g. only `-1`).
- [x] Validate the mode token in the command fast path: only `after`/`before`
      (default `after` only when omitted). Return an error with a usage hint.
- [x] Tool: `point` validation happens before any fork/append; the error code
      is stable (`REWIND_COMPACT_NO_TURN`).
- [x] Update the AGENTS “gotcha” and the skill text (“point is a completed turn
      number; out-of-range errors”).
- [x] Tests: `0`, `99`, `-1`, `1`, `n`, `''`, `2.5`, mode `sideways`.

## Acceptance criteria

- [x] `/rewind-compact 99 after` and `/rewind-compact 0 before` return an error;
      no fork occurs.
- [x] `rewind_compact` with `point: "99"` returns an error; no fork/compact.
- [x] `/rewind-compact 2 sideways` returns a usage error (or the default is
      documented and tested; prefer error).
- [x] A valid `-1` behavior is either supported and documented or removed.
- [x] Tests cover each case; the old fallback is gone.

## Verification

```sh
npm test
# in a profile: /rewind-compact 99 after  -> error, no new session
```

Expected: explicit error; no new session.

## Out of scope

- TUI row→turn mapping (RWC-005).
- Boundary list semantics (completed turns only).

## Notes / evidence

- Current `boundaryForPoint` uses `??` to fall back to the last boundary, so
  only a non-numeric miss can reach the “Unknown turn” path.
- `command.js:81` maps every non-`before` token to `after`.

## Completion

- **Completed:** 2026-10-27
- **Reviewed by:** independent subagent (`RWC-008 review`), verdict **approve**.
- **Verified by:** independent subagent (`RWC-008 verify`), verdict **pass**.
- **Changed files:** `lib/events.js` (strict point resolution + `parseRewindMode`),
  `lib/command.js` (mode/point validation before the fast path), `tests/events.test.js`
  (24 tests total), `AGENTS.md`, `skill/rewind-compact/SKILL.md`.
- **Evidence:** `npm test` 24/24 pass; `node --check` on the changed lib files;
  the verifier exercised `/rewind-compact 99 after`, `0 before`, and
  `2 sideways` with stubbed harness modules and observed `agents.create = 0`
  and `append = 0` before the error; valid `1`/`2`/`-1` paths still fork.
- **Follow-ups (not acceptance failures):**
  - `lib/tool.js`’s `point` description still says “turn index … or turn id” and
    omits `-1`/fail-closed; fold the wording into RWC-011 or a small docs patch.
  - The tool has no `isNoOp` guard, so `point: "-1"` + `after` (or `1` + `before`)
    can reach an empty/inverted compact range. Candidate follow-up ticket; the
    command already rejects this.
  - Handler-level tests are stubbed-import only; RWC-013 should own the
    profile-level regression.
