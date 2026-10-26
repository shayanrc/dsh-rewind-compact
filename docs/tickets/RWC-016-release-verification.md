# RWC-016 — Fresh-profile release verification

- **Status:** blocked
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

- [ ] Create a scratch profile from the shipped template (web and, if possible,
      a dsh-tui clone) under a throwaway name; never modify the live profile.
- [ ] Install the working tree or the packed tarball; run `--dump-config` and
      confirm the `rewind-compact/entry` layer and row.
- [ ] Boot and verify load (`[rewind-compact] entry loaded`) with no PENDING.
- [ ] Exercise, recording evidence for each:
      - `/rewind-compact` fast path (after and before);
      - bare command picker in web;
      - `rewind_compact` fork (`rewind: true`) with human authority;
      - `rewind_compact` in-place (`rewind: false`) on a compaction-enabled
        profile;
      - skill appears in the catalog and routes to the tool;
      - TUI Esc-Esc picker modes, after and before (if offered);
      - child header (cwd, parent, isSeeded), title suffix, summary, source
        resumability;
      - failure paths (no compaction service, invalid point, denied grant).
- [ ] Verify the source session is unmodified (transcript diff before/after).
- [ ] Uninstall the bundle; confirm the layer and surfaces disappear cleanly.
- [ ] Update `TESTING.md` with the exact commands, expected results, and
      environment (harness version, profile).
- [ ] Attach/record evidence (log excerpts, screenshots, session ids) in the
      ticket or a `docs/tickets/evidence/` file.
- [ ] Confirm no files under `~/.dsh` outside the scratch profile were touched.

## Acceptance criteria

- [ ] Composition check on a temporary profile shows the bundle layer and no
      loader errors.
- [ ] Every surface listed above was exercised and its result recorded; the
      in-place and TUI paths are no longer untested.
- [ ] The child has the expected header, title, and summary; the source is
      byte-identical and resumable.
- [ ] Failure paths produce the documented errors/toasts, not silent success.
- [ ] Uninstall removes the layer cleanly.
- [ ] `TESTING.md` is sufficient for another engineer to reproduce the run.
- [ ] All P0/P1 code tickets are closed; `npm run check` is green on the
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
