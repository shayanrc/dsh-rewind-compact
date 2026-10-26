# RWC-014 — Fix package and distribution metadata

- **Status:** done
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

- [x] Remove the unused `schemastery` peer (and the README mention) unless a
      future Config needs it.
- [x] Add `files`: `lib/`, `skill/`, `cordis.patch.yml`, `README.md`,
      `LICENSE`, `COPYING` (and `SPEC.md` if intended). Verify the entry’s
      `readFileSync` path resolves from the packed layout.
- [x] Decide `private`: keep true and document path/tarball-only distribution,
      or set false and add `engines.dsh`/repository/version policy.
- [x] Run `npm pack --dry-run` and inspect the file list.
- [x] Install the packed tarball into a scratch profile and boot; verify the
      skill body loads (no ENOENT) and the patch applies.
- [x] Add a short “Distribution” section to README (path, tarball, git caveat
      from the docs: `prepare` + `allowBuilds` + pinned SHA if git).
- [x] Optionally add a `prepack`/`test` script that fails if the skill file is
      missing from the pack.

## Acceptance criteria

- [x] `npm pack --dry-run` includes `lib/**`, `skill/rewind-compact/SKILL.md`,
      and `cordis.patch.yml`; it excludes tests/scripts if configured so.
- [x] A scratch profile installed from the tarball loads the entry and the
      skill; no missing-file error.
- [x] No unused peer dependencies remain.
- [x] The version gate is declared (`engines.dsh` or peers) and passes on the
      supported line.
- [x] The distribution path and `private` decision are documented.

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

## Evidence (2026-10-27 integrated review)

- `npm pack --dry-run` (2026-10-27, working tree): `total files: 18`,
  including `lib/**`, `skill/rewind-compact/SKILL.md`,
  `cordis.patch.yml`, `README.md`, `LICENSE`, and `COPYING`; tests/scripts/docs
  are excluded by `files`.
- `npm pack --dry-run` output includes the 11 `lib/` modules, the skill, the
  patch, README, LICENSE, and COPYING; tests/scripts/docs are absent.
- Independently reviewed and verified: the tarball installs into a throwaway
  `DSH_HOME`, `--dump-config` shows `rewind-compact/entry`, the entry loads,
  the tool and skill register, peer ranges match `0.2.1-rc.2`, and the unused
  `schemastery` peer is gone.
- `README.md` documents path/tarball distribution and the git caveat.

- Independent review (2026-10-27): **PASS** (no regression). Verified 18-file pack list, engines/peers, no schemastery, and ticket evidence updated with the pack output.

- Independent verification (2026-10-27): **VERIFIED**. `npm pack --dry-run` 18 files; engines/peers on the 0.2.1 line; no schemastery; independent tarball install into a fresh DSH_HOME showed `rewind-compact/entry` in `--dump-config`, and the installed entry loaded tool/command/skill with no ENOENT.
