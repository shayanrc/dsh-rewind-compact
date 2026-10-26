# RWC-010 — Make “Files changed” accurate

- **Status:** open
- **Priority:** P1
- **Type:** bug
- **Estimate:** M
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001
- **Blocks:** RWC-013, RWC-016
- **Spec:** R5 (field 1), R6 (warning), R10
- **Review:** 2026-10-27 review, P2-10

## Context

“Files changed” is supposed to mean **created/modified/deleted**. The current
derivation is over-inclusive:

- `buildScaffold` adds `read` paths to `Files changed` as `"<path> (read)"`
  (`lib/scaffold.js:70-75`).
- For `bash`, every path found in the command **and its output** is added as
  `"<path> (modified by bash)"` (`:61-68`), so an `ls`, `git status`, or fetched
  page lists many files that were never modified.
- `extractPaths` treats URLs and version strings as paths. Verified:
  `extractPaths('…/v1.2.3 … v20.11.1 src/main.ts')` returns
  `https://deepseek-harness.github.io/docs/v1.2.3`, `v20.11.1`, `src/main.ts`.
- `filesChangedSince` uses the same heuristic for the picker warning, so the
  “N file(s) changed” count is inflated.

## Tasks

- [ ] Define the derivation in one place (a new pure helper, or a documented
      function):
      - `write`/`edit`: count their `file_path`/path arguments (and any
        structured metadata already recorded);
      - `bash`: count only when the tool result exposes a reliable file-change
        fact; otherwise do not count, or document a conservative rule;
      - `read`, `grep`, `glob`, `ls`, web tools: never count;
      - ignore URLs, version strings, and non-path tokens.
- [ ] Deduplicate by normalized path; cap the list for the scaffold.
- [ ] Use tool result metadata (`presentationMeta`/`result.meta`) where it
      already carries applied paths; do not scrape prose if structured data
      exists.
- [ ] Update `scaffold.js` and `events.js` to share the helper; update
      `filesChangedSince` to use it.
- [ ] Tests:
      - read is not a change;
      - URL/version are not paths;
      - `write`/`edit` are;
      - a `bash` `ls` is not;
      - a fixture that reflects a web-research session returns 0 changes.
- [ ] Update README/SKILL wording if the derivation is intentionally
      conservative.

## Acceptance criteria

- [ ] A transcript containing only `read`, `grep`, `glob`, and web fetches
      reports **0** files changed.
- [ ] A transcript with `write`/`edit` reports the exact set of paths.
- [ ] A `bash ls`/`git status` does not add its listed paths as changes.
- [ ] The picker warning count matches the scaffold set for the same range.
- [ ] Tests cover the false positives above and fail on the current code.

## Verification

```sh
npm test
node --input-type=module -e "
  import { extractPaths } from './lib/events.js';
  console.log(extractPaths('https://example.com/a/v1.2.3 v20.11.1 src/main.ts'));
"
```

Expected: only `src/main.ts` (or the helper no longer used for counting).

## Out of scope

- File revert/snapshotting (explicit v1 non-goal).
- Detecting filesystem changes made outside tool calls.

## Notes / evidence

- `lib/scaffold.js:22` `PATH_BEARING_TOOLS` includes read/glob/grep, but only
  read/write/edit/bash are added.
- `lib/events.js:87-99` `extractPaths` regex matches URLs and dotted versions.
- R5 defines `Files changed` as created/modified/deleted; R10 says report only.
