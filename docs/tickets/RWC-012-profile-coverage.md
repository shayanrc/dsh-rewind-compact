# RWC-012 — Load on every profile (including sdk-minimal)

- **Status:** done
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

- [x] Decide the hard dependency set: `tools` and `agents` are genuinely
      required; `commands`/`skills` are optional surfaces.
- [x] Probe optional services with `probeService(ctx, 'commands'/'skills')` and
      register each surface only when present; log one clear line when a
      surface is skipped.
- [x] Alternatively/additionally split the entry into child plugins
      (`ctx.plugin`) so a missing commands/skills service only disables that
      surface, not the tool.
- [x] Keep `compaction`/`logger`/`sessionProjections` probed (already done).
- [x] Ensure `apply` remains one effect with per-surface disposers; do not
      regress cleanup.
- [x] Verify composition/load on: web, headless, sdk, sdk-minimal, dsh-tui
      (scratch profiles where possible).
- [x] Add a composition test or a documented `--dump-config` check for
      sdk-minimal.
- [x] Update README’s surface/profile matrix and SPEC R9 wording if the bundle
      intentionally cannot provide commands/skills there.

## Acceptance criteria

- [x] `dsh --profile sdk-minimal --dump-config` includes
      `rewind-compact/entry` and boot logs `[rewind-compact] entry loaded`.
- [x] On sdk-minimal, `rewind_compact` is registered (entry applies, tool
      registration runs); the missing command/skill surfaces are logged once
      and do not wedge the plugin. A live model call is RWC-016's release gate.
- [x] Web/TUI keep the tool, command, and skill surfaces; no PENDING.
- [x] Removing/omitting `commands` or `skills` in a scratch profile still loads
      the tool.
- [x] No profile-specific branching in the patch.
- [x] Tests or a documented check cover the sdk-minimal case.

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

## Evidence (2026-10-27 remediation)

- `lib/index.js` injects only `tools`+`agents`; `lib/surfaces.js` probes
  `commands`/`skills` and logs one skip line each.
- Live scratch evidence (removed after the run): a fresh sdk-minimal profile's
  `--dump-config` contained `rewind-compact/entry`; `dsh --profile <scratch>
  --help` and a stdio SDK mount each logged exactly once:
  `no commands service…`, `no skills service…`, `entry loaded`.
- `scripts/check-contracts.mjs` §7 drives the real entry with an
  sdk-minimal-like double: `rewind_compact` + the two TUI listeners register
  and yield 2 disposers; the full-profile double registers tool+command+skill
  and yields 4 disposers.
- `probeLogger` now falls back to stderr, so SDK JSON-RPC stdout stays clean.
- A live model call on sdk-minimal is a release check (RWC-016); credentials
  were unavailable here.

- Independent review (2026-10-27): **PASS**. Verified inject `[tools,agents]`, one skip line per absent surface, minimal/full disposer counts, stderr-only `probeLogger`, and the scratch-profile evidence/callability deferral.

- Independent verification (2026-10-27): **VERIFIED**. Reran a throwaway sdk-minimal profile: dump-config entry, once-only skip lines + entry loaded on stderr, pure JSON-RPC stdout, full profile zero skips; live call deferred to RWC-016.
