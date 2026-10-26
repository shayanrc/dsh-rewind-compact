# RWC-009 — Replace the retired plugin message source kind

- **Status:** open
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

- [ ] Pick a declared source kind:
      - `compact-checkpoint` with a generated `compactionId` (semantically the
        closest; verify it does not confuse compaction accounting), or
      - a namespaced kind such as `{ kind: 'rewind-compact' }` declared through
        `MessageSourceMap` in a `.d.ts`/JSDoc shim and accepted by consumers.
      Prefer the one the Web conversation UI and session projections render
      without special-casing.
- [ ] Update `summaryMessage()` and every append site (tool scaffold,
      TUI summary, seed summary) through the single helper.
- [ ] Update `tests/seed.test.js` and the contract probe to assert the new
      source; remove the `plugin` wrapper assertion.
- [ ] Verify on V4:
      - append a summary to a live session;
      - fork a child from a seed containing the summary;
      - reload the session list / Web UI and confirm it renders as a summary,
        not as a raw user message or an error.
- [ ] Document the source kind and its rendering in
      `docs/HARNESS-CONTRACTS.md` §7.

## Acceptance criteria

- [ ] `grep -R "{ kind: 'plugin'" lib tests scripts` returns nothing.
- [ ] The summary message has a declared, documented source kind.
- [ ] Appending and forking on 0.2.1 succeed; the next fork does not fail
      admission.
- [ ] The Web UI and session projections render the summary without errors.
- [ ] Tests assert the new shape and fail on the old one.

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
