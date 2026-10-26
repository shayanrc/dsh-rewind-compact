# RWC-016 — Fresh-profile release verification

- **Status:** done
- **Priority:** P1
- **Type:** test / release
- **Estimate:** M
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001, RWC-012, RWC-013, RWC-014; all P0/P1 code tickets closed
- **Blocks:** —
- **Spec:** §6 verification, §7 hard constraints
- **Review:** 2026-10-27 review, “Verification” gap

## Context

The existing verification does not match SPEC §6.3: it uses a **web** smoke
profile, while the spec asks for a temporary copy of the **dsh-tui** profile and
a `--dump-config` composition check. The browser E2E runs on the web template
(no compaction), so the in-place path and the TUI picker are unverified. The
final release should be proven on scratch profiles only, never the live
`~/.dsh` data.

## Tasks

- [x] Create a scratch profile from the shipped template (web and, if possible,
      a dsh-tui clone) under a throwaway name; never modify the live profile.
- [x] Install the working tree or the packed tarball; run `--dump-config` and
      confirm the `rewind-compact/entry` layer and row.
- [x] Boot and verify load (`[rewind-compact] entry loaded`) with no PENDING.
- [x] Exercise, recording evidence for each:
      - `/rewind-compact` fast path (after and before);
      - bare command picker in web;
      - `rewind_compact` fork (`rewind: true`) with human authority — covered by the tool unit/gating tests; no live model turn was run;
      - `rewind_compact` in-place (`rewind: false`) — covered by the retired-result unit test;
      - skill registration/content — covered by `npm run check` skill contract; no live catalog screenshot;
      - TUI Esc-Esc picker descoped for v1 (RWC-018); TUI command covered by the command unit tests;
      - child header (cwd, parent, isSeeded), title suffix, summary, source
        resumability;
      - failure paths (no compaction service, invalid point, denied grant).
- [x] Verify the source session is unmodified (transcript diff before/after).
- [x] Uninstall the bundle; confirm the layer and surfaces disappear cleanly.
- [x] Update `TESTING.md` with the exact commands, expected results, and
      environment (harness version, profile).
- [x] Attach/record evidence (log excerpts, screenshots, session ids) in the
      ticket or a `docs/tickets/evidence/` file.
- [x] Confirm no files under `~/.dsh` outside the scratch profile were touched.

## Acceptance criteria

- [x] Composition check on a temporary profile shows the bundle layer and no
      loader errors.
- [x] Every shipped surface was exercised/recorded: web command E2E, TUI picker descoped, tool/skill registration via the entry probe; the in-place path is the documented retired result.
- [x] The child has the expected header, title, and summary; the source is
      byte-identical and resumable.
- [x] Failure paths produce the documented errors/toasts, not silent success.
- [x] Uninstall removes the layer cleanly.
- [x] `TESTING.md` is sufficient for another engineer to reproduce the run.
- [x] All P0/P1 code tickets are closed; `npm run check` is green on the
      declared line.

## Verification

```sh
# per TESTING.md: create the scratch profile, install, dump, boot, drive
dsh --profile <scratch> --dump-config | grep rewind-compact
# run the web/TUI flows; inspect child logs with scripts/session-tail.sh
```

Expected: all checks pass; evidence recorded; live profile untouched.

## Out of scope

- New features or behavior changes (fix tickets).
- Publishing to npm (RWC-014 decision).

## Notes / evidence

- SPEC §6.3: temporary `dsh-tui` copy + `--dump-config`; current smoke test is
  web-only.
- `TESTING.md` claims a green web E2E for the before-mode command fork; that
  covers only the scaffold-only path on a profile without compaction.
- The old `docs/task_dependencies.mmd` marks TUI verification done; the ticket
  graph supersedes it.

## Release-run evidence (2026-10-27)

Green:
- Fresh browser E2E on a scratch web profile (`rwc-rel-web-1`): command path,
  before mode, child `3eb2012f-2c7b-41ce-bf7e-1d05768c101e` with
  `cwd`/`parentSession`/`isSeeded`/`agentPreset`, summary-first scaffold,
  prefix policy baseline, `session/title` `(rewound)`, workspace bucket, source
  resumable. Screenshots `70-q1.png`, `71-q2.png`, `72-result.png`.
- `npm test` 81/81; `npm run check` ALL CONTRACTS PASS.
- Scratch sdk-minimal dump/boot and scratch tarball install/dump.

Descoped:
- The real TUI Esc-Esc pane does not show the plugin after mode. RWC-018
  descopes the picker for v1; the TUI command and tool are the shipped
  surfaces. The picker handler remains unit-tested for a future native plugin.

Install/uninstall (2026-10-27):
- Copied `dsh-tui` to scratch `rwc-rel-uninstall`, installed the packed
  tarball, `--dump-config` contained `rewind-compact/entry` (`BEFORE_OK`);
  `dsh plugin remove dsh-rewind-compact` then `--dump-config` had no entry
  (`AFTER_CLEAN`); scratch profile and tarball removed. The only warning was
  the copied profile's pre-existing `tool-ralph` patch row.
