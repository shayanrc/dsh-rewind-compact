# RWC-013 — Harden tests and the contract probe

- **Status:** open
- **Priority:** P1
- **Type:** test
- **Estimate:** L
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001; final gate after RWC-002–010 and RWC-012
- **Blocks:** RWC-014, RWC-016
- **Spec:** §5 (tests), §6 (verification)
- **Review:** 2026-10-27 review, P2-12

## Context

Only `scaffold`, `seed`, and `events` have unit tests. The four call sites that
contain the serious bugs have none: `tui-rewind.js` (prompt mapping, done
composition), `tool.js` (range, gating, output), `command.js` (picker mapping,
invalid input), `rewind.js` (create options). The browser E2E runs against the
web template, which has **no compaction service**, so the hybrid path was never
exercised; there is no TUI E2E.

`scripts/check-contracts.mjs` gives false confidence:

- it imports lib modules from the installed profile copy (stale after edits);
- it only finds `session.v3` fixtures while 0.2.1 writes v4;
- its `MESSAGE_ROLE_BY_TYPE` says `tool/result → 'user'` (the validator expects
  `'tool'`);
- it does not check the summary source kind, create options, surface/range
  validity, or shadowing;
- its `modeRange` unit test uses a cut seq while `tool.js` passes a turn/start
  seq, so the test blesses a different convention.

## Tasks

- [ ] **Probe:**
      - import the worktree modules (or refresh the profile first and say so);
      - select the newest `session.v*.jsonl*` and require a v4 fixture on the
        0.2.1 line;
      - fix the role mirror (`tool/result → tool`) and add `developer/message`;
      - assert the summary source kind;
      - statically assert the `agents.create` option shape;
      - validate a seed built from a **pre-compacted** transcript (no shadowed
        originals);
      - assert the running harness version is supported.
- [ ] **Unit tests (new):**
      - `tui-rewind`: picked-message seq → turn mapping; both/one/no modes;
        warning uses the cut; done-event after mode; done-event before mode
        ordering; failure returns a toast string.
      - `tool`: point resolution; gating pass/fail; output branches; no-op
        `applied: false`; range validity (surface nodes/balance) with a fake
        surface.
      - `command`: fast path; invalid turn; invalid mode; picker answer mapping
        (label/selected) → boundary/mode.
      - `rewind`: exact create options; title event; source unmutated.
      - `hasDirectHumanInput`: user vs non-user source; no projection; non-root.
- [ ] **Fixtures:** a realistic v4 transcript; a prior-compaction transcript
      (replacement + shadowed originals); a developer message; policy facts;
      multiple completed turns; a session with a title.
- [ ] **E2E:** a scratch profile that **has compaction** (e.g. `dsh-base`
      without the web app, or a minimal composition with
      `dsh-compaction-basic`); exercise fork after/before and the in-place
      path; assert child header/title/summary and source immutability.
- [ ] **TUI E2E/manual:** grant `session.rewind.intercept`, open Esc-Esc, assert
      the modes appear, pick after/before, assert the child composition.
- [ ] Add the new tests to `npm test` / `npm run check`; document the commands
      in `TESTING.md`.
- [ ] For every P0 fix, land the failing test first (commit/record the red
      state in the ticket).

## Acceptance criteria

- [ ] Reintroducing each P0 bug (create options, seed shadowing, TUI mapping,
      in-place range) makes at least one test fail.
- [ ] The probe detects an unsupported harness version, a v3-only fixture,
      a wrong role map, and a `plugin` source kind.
- [ ] `npm test` covers the four call sites; no production-only module is
      untested.
- [ ] The compaction-enabled E2E runs the in-place path successfully (or
      asserts the documented retired behavior).
- [ ] The TUI modes are observed in a real TUI run and recorded.
- [ ] `npm run check` is green on 0.2.1 and uses the worktree code.

## Verification

```sh
npm test
npm run check
# E2E: see TESTING.md; run the scratch web/TUI and in-place profiles
```

Expected: all green; red on each reintroduced regression.

## Out of scope

- Fixing the code (the other tickets).
- CI infrastructure beyond a documented local command.

## Notes / evidence

- `tests/` contains only `events.test.js`, `scaffold.test.js`, `seed.test.js`.
- `scripts/check-contracts.mjs` fixture find: `session.v3.jsonl.zstd`.
- `tests/seed.test.js:26` role map is wrong for 0.2.1.
- `lib/index.js` reads `SKILL.md` at import; a test that imports the entry
  covers the file path.
