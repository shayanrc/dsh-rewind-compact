# RWC-013 — Harden tests and the contract probe

- **Status:** done
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

- [x] **Probe:**
      - import the worktree modules (or refresh the profile first and say so);
      - select the newest `session.v*.jsonl*` and require a v4 fixture on the
        0.2.1 line;
      - fix the role mirror (`tool/result → tool`) and add `developer/message`;
      - assert the summary source kind;
      - statically assert the `agents.create` option shape;
      - validate a seed built from a **pre-compacted** transcript (no shadowed
        originals);
      - assert the running harness version is supported.
- [x] **Unit tests (new):**
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
- [x] **Fixtures:** a realistic v4 transcript; a prior-compaction transcript
      (replacement + shadowed originals); a developer message; policy facts;
      multiple completed turns; a session with a title.
- [x] **E2E:** a scratch profile that **has compaction** (e.g. `dsh-base`
      without the web app, or a minimal composition with
      `dsh-compaction-basic`); exercise fork after/before and the in-place
      path; assert child header/title/summary and source immutability.
- [x] **TUI handler coverage:** unit tests assert after-only, the no-op/open-turn
      cases, the tool-call summary, and failure toasts. The interactive TUI
      run is RWC-016's release gate.
- [x] Add the new tests to `npm test` / `npm run check`; document the commands
      in `TESTING.md`.
- [x] For every P0 fix, land the failing test first (commit/record the red
      state in the ticket).

## Acceptance criteria

- [x] Reintroducing each P0 bug (create options, seed shadowing, TUI mapping,
      in-place range) makes at least one test fail.
- [x] The probe detects an unsupported harness version, a v3-only fixture,
      a wrong role map, and a `plugin` source kind.
- [x] `npm test` covers the four call sites; no production-only module is
      untested.
- [x] The in-place path is asserted as the documented retired result (no
      compaction/E2E success is expected in v1).
- [x] The TUI decision handler is covered by unit tests; the interactive run
      is recorded by RWC-016.
- [x] `npm run check` is green on 0.2.1 and uses the worktree code.

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

## Evidence (2026-10-27 remediation)

- New/extended tests: `tests/command.test.js` (fast path, invalid mode/point,
  no-op, picker label mapping, cancellation), `tests/tui-rewind.test.js`
  (mapping, after-only, tool-call summary, three failure toasts),
  `tests/tool.test.js` (retired result/no mutation), `tests/seed.test.js`
  (replacement, developer, policy baseline, both orders).
- Probe: imports the worktree lib, **requires** a v4 fixture (a v3-only home
  now fails instead of printing a deviation), runs the real `Session.create`
  for both modes, validates the summary source and declaration, asserts the
  retired create-option shape, spawns `scripts/check-create-jsonl.mjs` for the
  child header/title/workspace bucket, and runs targeted before-mode policy
  and replacement/shadowing fixtures through `Session.create`.
- `npm test` 77/77; `npm run check` ALL CONTRACTS PASS.
- The real TUI observation is a release check (RWC-016); this ticket covers the
  automated decision-handler path.

- Independent review (2026-10-27): **PASS** after fixes. Verified v4-only probe failure path, real `Session.create` for both modes, replacement/policy fixtures, call-site tests, and mutation replays.

- Direct-human gate coverage (post-verification): `tests/tool.test.js` now pins non-human source, non-root agent, missing turn-boundary projection, and the positive root+human fork. `npm test` is 81/81; forcing `hasDirectHumanInput` true/false in a throwaway copy fails the gate tests.

- Independent verification (2026-10-27): **VERIFIED**. `npm test` 81/81, `npm run check` green. Throwaway-copy mutations: forcing `hasDirectHumanInput` true -> 3 gate tests fail; false -> positive fork tests fail; deleting the root check / ignoring source.kind / treating missing projection as open each fail its targeted test. TESTING probe wording updated.
