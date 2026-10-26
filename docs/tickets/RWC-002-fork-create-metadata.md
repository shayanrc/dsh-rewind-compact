# RWC-002 — Correct fork creation metadata and title

- **Status:** open
- **Priority:** P0
- **Type:** bug
- **Estimate:** M
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001
- **Blocks:** RWC-003 (coordination), RWC-013, RWC-016
- **Spec:** R4, R12
- **Review:** 2026-10-27 review, P0-2

## Context

`lib/rewind.js:80-91` calls:

```js
ctx.agents.create({
  sessionId, seed, inheritedCount: seed.length, parentSession, cwd, title, setup,
})
```

In 0.2.1 `createAgent` reads `sessionId`, `seed`, `meta`, `inheritedEventCount`,
`agentOptions`, `setup`, and `parentAgent`. Only `sessionId`, `seed`, and
`setup` are honored. Consequences observed in the README’s “known limitations”
are in fact fixable bugs:

- no `parentSession` in the child header (no lineage);
- no `cwd` in the header → child stored under `_no-cwd` and ungrouped;
- no `isSeeded`/inherited count → the child treats the seed as its own live
  history;
- no `agentPreset` → scoped preset contributions are lost;
- `title` is ignored and `session.title` is not a live-session property
  (titles are logged `session/title` events).

## Tasks

- [ ] Add a `buildCreateOptions({ source, seed, cwd, title, agentPreset })`
      helper in `lib/rewind.js` (or a small new module) that returns the exact
      `agents.create` options for the declared harness line.
- [ ] For 0.2.1 (and the `isSeeded` runtime line): pass
      `meta: { cwd, parentSession, isSeeded: true, agentPreset? }` and
      `inheritedEventCount: seed.length`. Do not pass top-level
      `inheritedCount`, `cwd`, `parentSession`, or `title`.
- [ ] If the other runtime line (`seedLength`) must be supported, detect the
      line or gate on a capability; do not send both shapes.
- [ ] Copy `agentPreset` from the source session/agent when available.
- [ ] Set the title through the title seam: append a `session/title` event in
      `setup` (or immediately after create) with `<source title> (rewound)`,
      using the same payload shape a manual rename uses. Skip cleanly when no
      title is known.
- [ ] Keep `setup` clearing the child inbox and preserve
      `forkAtBoundary`’s “never cancel the caller” invariant.
- [ ] Add a focused test asserting the exact options object; add an integration
      check that reads the child header and `session/title` event.
- [ ] Update `README.md` “Harness seams used” and the v1 limitations that this
      fixes; update `AGENTS.md` fork-recipe bullet.

## Acceptance criteria

- [ ] The child session header contains `cwd` (absolute), `parentSession`
      (source id), `isSeeded: true`, and the inherited count. Verified from the
      child JSONL, not just from the call site.
- [ ] The child is grouped under the source workspace bucket, not `_no-cwd`.
- [ ] The child has a `session/title` event whose title ends with
      ` (rewound)`; the UI/session list shows it.
- [ ] The `agents.create` call contains none of `inheritedCount`, top-level
      `cwd`, top-level `parentSession`, or `title`.
- [ ] The source session is still unmodified and resumable.
- [ ] Tests fail before the change and pass after.

## Verification

```sh
# fork from a session with a title, then:
bash scripts/session-tail.sh <child-id> | head -5     # header fields
bash scripts/session-tail.sh <child-id> | grep session/title
ls "$DSH_HOME/sessions" | grep -i no-cwd                # must not list the child
npm test
```

Expected: header `cwd`/`parentSession`/`isSeeded`; title event; no `_no-cwd`.

## Out of scope

- Seed content (RWC-003).
- Title UX or i18n (the suffix is fixed by SPEC R12).
- Migrating existing forked children.

## Notes / evidence

- `createAgent` destructures only known fields; unknown options are silently
  ignored (`dsh-agent-loop/lib/index.js`).
- `SessionStore.prepare` reads `meta.cwd`, `meta.parentSession`,
  `meta.isSeeded`, `meta.agentPreset`, and `options.inheritedEventCount`.
- `session.title` is not defined in 0.2.1’s `Session`; titles are folded from
  `session/title` events (`dsh-session-title`).
- The TUI’s `liveSessionCreateOptions`/`liveSessionSeedMetadata` compat helper
  is the cross-line reference; use it for validation, not as a runtime import.
