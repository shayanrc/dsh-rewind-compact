# RWC-012 — Load on every profile (including sdk-minimal)

- **Status:** open
- **Priority:** P1
- **Type:** bug
- **Estimate:** M
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001
- **Blocks:** RWC-013, RWC-016
- **Spec:** R9
- **Review:** 2026-10-27 review, R9 partial

## Context

`lib/index.js:25` requires:

```js
const inject = ['tools', 'commands', 'skills', 'agents'];
```

A missing required service leaves the whole plugin PENDING — silently, by
Cordis design. `@deepseek-ai/dsh-base` provides `commands` and `skills`, so the
web/TUI/headless profiles load. **`sdk-minimal` deliberately does not apply
`dsh-base`** and its patch has no `dsh-commands` or `dsh-skill` entries; the
plugin therefore never loads there, including the tool. SPEC R9 says the bundle
loads in all profiles; the current entry does not.

`sdk-minimal` does include `tools`, `agents`, `session-projection`, and
`compaction-basic`, so the tool would be runnable if it loaded — and would
exercise the broken in-place path (RWC-004).

## Tasks

- [ ] Decide the hard dependency set: `tools` and `agents` are genuinely
      required; `commands`/`skills` are optional surfaces.
- [ ] Probe optional services with `probeService(ctx, 'commands'/'skills')` and
      register each surface only when present; log one clear line when a
      surface is skipped.
- [ ] Alternatively/additionally split the entry into child plugins
      (`ctx.plugin`) so a missing commands/skills service only disables that
      surface, not the tool.
- [ ] Keep `compaction`/`logger`/`sessionProjections` probed (already done).
- [ ] Ensure `apply` remains one effect with per-surface disposers; do not
      regress cleanup.
- [ ] Verify composition/load on: web, headless, sdk, sdk-minimal, dsh-tui
      (scratch profiles where possible).
- [ ] Add a composition test or a documented `--dump-config` check for
      sdk-minimal.
- [ ] Update README’s surface/profile matrix and SPEC R9 wording if the bundle
      intentionally cannot provide commands/skills there.

## Acceptance criteria

- [ ] `dsh --profile sdk-minimal --dump-config` includes
      `rewind-compact/entry` and boot logs `[rewind-compact] entry loaded`.
- [ ] On sdk-minimal, `rewind_compact` is registered and callable; the missing
      command/skill surfaces are logged once and do not wedge the plugin.
- [ ] Web/TUI keep the tool, command, and skill surfaces; no PENDING.
- [ ] Removing/omitting `commands` or `skills` in a scratch profile still loads
      the tool.
- [ ] No profile-specific branching in the patch.
- [ ] Tests or a documented check cover the sdk-minimal case.

## Verification

```sh
dsh --profile sdk-minimal --dump-config | grep rewind-compact
# boot the profile and check the log line
# then call rewind_compact with a valid point (expect RWC-004 behavior)
```

Expected: entry composes and loads; no “waiting for services”.

## Out of scope

- Fixing the in-place compaction path (RWC-004).
- Adding commands/skills to sdk-minimal.

## Notes / evidence

- `dsh-base/cordis.patch.yml` includes `dsh-skill` and `dsh-commands`.
- `dsh-sdk-minimal/cordis.patch.yml` includes tools/agents/compaction but no
  skill/commands entries, and intentionally does not apply base.
- Cordis PENDING is silent; the plugin currently gives no diagnostic.
