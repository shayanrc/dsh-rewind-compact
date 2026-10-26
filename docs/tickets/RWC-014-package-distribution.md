# RWC-014 — Fix package and distribution metadata

- **Status:** open
- **Priority:** P2
- **Type:** chore
- **Estimate:** S
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001; coordinate with RWC-013 (pack/test)
- **Blocks:** RWC-016
- **Spec:** R1, §6
- **Review:** 2026-10-27 review, P2-13

## Context

- `@deepseek-ai/schemastery` is declared as a peer dependency but unused in
  `lib/`; the README still mentions schemastery parameter specs.
- No `files` field: a pack includes tests, docs, scripts, and the worktree; this
  is not fatal for a path install but is noisy and risks missing/extra files.
- `private: true` blocks `npm publish`; decide whether the distribution path is
  path/git/tarball only or npm.
- No `engines.dsh`; the peer range is the only version gate and is stale
  (RWC-001).
- `lib/index.js` reads `skill/rewind-compact/SKILL.md` at module scope; the file
  must be in the published artifact or the entry fails to import.

## Tasks

- [ ] Remove the unused `schemastery` peer (and the README mention) unless a
      future Config needs it.
- [ ] Add `files`: `lib/`, `skill/`, `cordis.patch.yml`, `README.md`,
      `LICENSE`, `COPYING` (and `SPEC.md` if intended). Verify the entry’s
      `readFileSync` path resolves from the packed layout.
- [ ] Decide `private`: keep true and document path/tarball-only distribution,
      or set false and add `engines.dsh`/repository/version policy.
- [ ] Run `npm pack --dry-run` and inspect the file list.
- [ ] Install the packed tarball into a scratch profile and boot; verify the
      skill body loads (no ENOENT) and the patch applies.
- [ ] Add a short “Distribution” section to README (path, tarball, git caveat
      from the docs: `prepare` + `allowBuilds` + pinned SHA if git).
- [ ] Optionally add a `prepack`/`test` script that fails if the skill file is
      missing from the pack.

## Acceptance criteria

- [ ] `npm pack --dry-run` includes `lib/**`, `skill/rewind-compact/SKILL.md`,
      and `cordis.patch.yml`; it excludes tests/scripts if configured so.
- [ ] A scratch profile installed from the tarball loads the entry and the
      skill; no missing-file error.
- [ ] No unused peer dependencies remain.
- [ ] The version gate is declared (`engines.dsh` or peers) and passes on the
      supported line.
- [ ] The distribution path and `private` decision are documented.

## Verification

```sh
npm pack --dry-run
npm pack
dsh plugin --profile rwc-pack add --offline file:./dsh-rewind-compact-0.1.0.tgz
dsh --profile rwc-pack --dump-config | grep rewind-compact
```

Expected: pack contents correct; install/boot work; skill loads.

## Out of scope

- Publishing to npm (decision only).
- Git-install build-script support (documented caveat; no build step here).

## Notes / evidence

- `package.json` peerDependencies lines 13-17; no `files`, no `engines`.
- `lib/index.js:29` reads the skill file at import time.
- The docs’ distribution rules: `engines.dsh` or peer ranges gate install;
  a package without `dsh.bundle` installs as a plain dependency.
