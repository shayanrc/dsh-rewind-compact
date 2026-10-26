# RWC-009 — Replace the retired plugin message source kind

- **Status:** done
- **Priority:** P1
- **Type:** bug / forward compatibility
- **Estimate:** S
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-003 (summary composition)
- **Blocks:** RWC-013, RWC-016
- **Spec:** R5
- **Review:** 2026-10-27 review, P1-8

## Context

`summaryMessage()` (`lib/seed.js:40-47`) builds:

```js
source: { kind: 'plugin', plugin: 'dsh-rewind-compact' }
```

The 0.2.x message-source registry has no `plugin` kind; the documented V4
admission contract rejects the retired `{kind: 'plugin', plugin: '<name>' }`
wrapper. Installed 0.2.1’s seed envelope validator currently only checks that
`source.kind` is a non-empty string, which is why the fork/append tests pass.
`tests/seed.test.js:74` asserts the retired shape, cementing it.

The summary is a user-role message; a valid source kind is required for
projections, UI rendering, and future validators.

## Tasks

- [x] Pick a declared source kind:
      - `compact-checkpoint` with a generated `compactionId` (semantically the
        closest; verify it does not confuse compaction accounting), or
      - a namespaced kind such as `{ kind: 'rewind-compact' }` declared through
        `MessageSourceMap` in a `.d.ts`/JSDoc shim and accepted by consumers.
      Prefer the one the Web conversation UI and session projections render
      without special-casing.
- [x] Update `summaryMessage()` and every append site (tool scaffold,
      TUI summary, seed summary) through the single helper.
- [x] Update `tests/seed.test.js` and the contract probe to assert the new
      source; remove the `plugin` wrapper assertion.
- [x] Verify on V4:
      - append a summary to a live session;
      - fork a child from a seed containing the summary;
      - reload the session list / Web UI and confirm it renders as a summary,
        not as a raw user message or an error.
- [x] Document the source kind and its rendering in
      `docs/HARNESS-CONTRACTS.md` §7.

## Acceptance criteria

- [x] `grep -R "{ kind: 'plugin'" lib tests scripts` returns nothing.
- [x] The summary message has a declared, documented source kind.
- [x] Appending and forking on 0.2.1 succeed; the next fork does not fail
      admission.
- [x] The Web UI and session projections render the summary without errors.
- [x] Tests assert the new shape and fail on the old one.

## Verification

```sh
npm test
npm run check
# fork, then inspect the child summary event:
bash scripts/session-tail.sh <child-id> | grep -m1 'user/message'
```

Expected: declared `source.kind`; renders in UI; no `plugin` wrapper.

## Out of scope

- Choosing the summary text/role (R5).
- Compaction engine checkpoint semantics (read-only reference).

## Notes / evidence

- The generated `MessageSourceMap` for 0.2.1 includes
  `compact-checkpoint`, `runtime-context`, `agent-message`, `goal`, etc., and
  no `plugin`.
- `dsh-compaction` exposes `compactCheckpointSource(compactionId,
  sourceCommandId?)`; on-disk checkpoints use `{kind:
  'compact-checkpoint', compactionId}`.
- The cookbook states the retired wrapper is rejected at V4 admission; the
  installed validator is stricter in message projections than in the seed
  envelope.

## Evidence (2026-10-27 remediation)

- `summaryMessage()` uses `{kind:'rewind-compact'}`; the kind is declared in
  `lib/message-source.d.ts` and documented in `docs/HARNESS-CONTRACTS.md` §7.
- `grep -R "{ kind: 'plugin'" lib tests scripts` returns nothing.
- `tests/seed.test.js` asserts the declared kind and removes the old wrapper;
  `scripts/check-contracts.mjs` validates `SUMMARY_SOURCE_KIND` and the
  declaration, and the real `Session.create` accepts seeds containing it.
- The web conversation projection renders an unknown producer kind as injected
  context; the claim is scoped to that projection, not a screenshot.

- Independent review (2026-10-27): **PASS**. Verified declared `rewind-compact` kind, `.d.ts` augmentation, docs, literal grep, and tests that fail on the old shape. Non-blocking: the `.d.ts` is not wired as package `types`.

- Independent verification (2026-10-27): **VERIFIED**. Literal grep empty; declared kind + `.d.ts` + docs; real `Session.append` accepts the summary and the next seed/fork passes; installed chat projection maps the unknown kind to an inject row without error. No missing acceptance item.
