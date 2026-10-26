# RWC-018 — TUI picker requires a host-mediated DecisionEvents activation

- **Status:** blocked
- **Priority:** P0
- **Type:** bug / architecture
- **Estimate:** L
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-015 (D5/D7)
- **Blocks:** RWC-016
- **Spec:** R3.1, R6
- **Review:** 2026-10-27 release run; discovered after RWC-017

## Context

The real TUI picker never shows **Rewind + compact after**. A scratch
`dsh-tui` profile loads the bundle (`entry loaded`, `subscribed to
tui/rewind-prompt and tui/rewind-done`), and replaying `rewindPromptAnswer`
against the same session events returns the correct after mode. The TUI
confirm pane still shows only the built-in “Rewind conversation to this
message?”.

Root cause (verified in dsh-tui 0.17.0):

- `dispatchTuiDecision` reads only the host-mediated DecisionEvents registry
  (`dsh-adapter/extension-events.js`); raw Cordis `ctx.on` listeners are
  “intentionally absent” from that path.
- A DSH bundle loaded from the profile is a **backend** activation. It cannot
  call `ctx.tuiPluginHost.subscribeDecision`: the service is mounted in the
  TUI host composition and the backend call fails with
  `mediated capability requires a non-root activation context from the host
  composition`.
- The raw `ctx.on` fallback is vetoed by the D-7 guard when the activation has
  no verified TUI Component identity. The plugin's “subscribed” log is
  misleading: it is emitted even when the guard returns a no-op disposer.
- Adding a package-root `dsh-plugin.json` and a `tui-extension.js` host facet
  does not help in 0.17.0: `facets.host.entry` is validated/projected but never
  imported; no facet loader exists. The admission loader only admits rows in
  the TUI host composition, and profile bundle rows are in the DSH backend.
- The grant file also used the wrong key/scope (`dsh-rewind-compact` /
  `"decision event subscription"`); even with the corrected
  `dsh.rewind-compact` / `session:*` grant, admission does not bridge the
  backend activation.

This is not a seq→turn or summary bug: the decision handler itself is correct
and unit-tested. It is a missing host integration seam between a DSH bundle and
the TUI's DecisionEvents registry.

## Options

1. **Ship a TUI-native plugin package** (separate package id, `dsh-plugin.json`
   `DecisionEvents` contract, host facet) and install it through the TUI plugin
   manager; it must also be able to read the live DSH session/agent services to
   compose the child summary.
2. **Add a DSH→TUI bridge** so a profile bundle activation can register
   DecisionEvents (and expose sessions/agents to the host handler).
3. **Descope the TUI picker for v1**; keep the TUI command and tool surfaces,
   document the limitation, and revise R3.1/R6/RWC-005/RWC-006.

Option 1 is the intended ecosystem path; option 3 is the only honest v1 ship
without new harness work.

## Tasks

- [ ] Choose the option (owner decision) and record it in RWC-015/RWC-016.
- [ ] If native plugin: add the package/manifest/facet, wire it to the DSH
      session services, install it through the TUI plugin manager, and record a
      real Esc-Esc run.
- [ ] If bridge: add the host-mediated registration path for profile bundles
      and a session/agent access seam; add an integration test.
- [ ] If descope: update SPEC R3.1/R6, README, SKILL, TESTING, and reopen/
      descope RWC-005/RWC-006/RWC-007's TUI acceptance.
- [ ] Add a test that fails when the real TUI pane omits the plugin mode (not
      just the handler unit test).
- [ ] Record the exact grant key/scope and admission evidence.

## Acceptance criteria

- [ ] A real scratch TUI Esc-Esc run shows `Rewind + compact after` for an
      eligible completed turn, and selecting it appends the scaffold to the
      child with a visible toast.
- [ ] The handler is registered through the host-mediated DecisionEvents
      registry (or the picker is explicitly descoped in the spec/docs).
- [ ] The misleading “subscribed” log is gone or reports the actual
      registration result.
- [ ] RWC-016 can record the TUI surface as pass or descoped.

## Verification

```sh
# scratch dsh-tui profile with the bundle; grant session.rewind.intercept
# Esc Esc on a completed turn:
# expect: Rewind + compact after
```

Expected: plugin mode in the confirm pane, or a documented descope.

## Out of scope

- Changing the built-in rewind.
- A full TUI plugin marketplace.

## Notes / evidence

- Scratch profile `rwc-rel-tui-1`, resumed session `5ca496a0-73f8-410d-b1c1-87bc2786f80b`.
- `rewindPromptAnswer` replay against that transcript returned
  `rewind-compact-after`; the TUI pane did not.
- Grant fix tested: `{"grants":{"dsh.rewind-compact":[{"name":"session.rewind.intercept","scope":"session:*"}]}}`
  → admission `compatible`; the pane still showed only the built-in rewind
  because the backend activation is not in the TUI host composition.
- Live grant file restored after the test; scratch profiles removed.
