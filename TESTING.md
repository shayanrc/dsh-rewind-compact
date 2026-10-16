# Testing rewind-compact on the web profile

Two layers of testing:

1. **Smoke test** — `scripts/test-web-profile.sh`: creates a throwaway profile
   from the shipped web template, installs this repo as a bundle, verifies the
   patch composes, boots the web app on a scratch port. Never touches the live
   `web` profile.
2. **Automated browser E2E** — `scripts/e2e-web-test.py` (Playwright): drives
   the real web UI through the whole flow and asserts the completion message.
   This is the layer that caught every real bug (seed envelope, seq
   renumbering, surfaceOp markers, message shapes).

## Automated browser E2E — verified green

The script drives a real browser, so it needs a Playwright install of its
own: a virtualenv plus a chromium download. Neither belongs in the repo — build
them once per machine in a scratch dir outside it.

```sh
# One-time: scratch dir with venv + chromium (a few hundred MB, any writable path)
REPO=$(git rev-parse --show-toplevel)        # run from the repo root
SCRATCH="${SCRATCH:-$HOME/.rwc-test}"        # venv, chromium and screenshots live here

python3 -m venv "$SCRATCH/venv"               # any CPython 3.9+ (3.13 used here)
"$SCRATCH/venv/bin/python" -m pip install --upgrade pip playwright
PLAYWRIGHT_BROWSERS_PATH="$SCRATCH/browsers" \
  "$SCRATCH/venv/bin/python" -m playwright install chromium
```

```sh
# Each run: drive the E2E against a live web profile
cd "$SCRATCH"                                # the script writes its step screenshots to cwd
PLAYWRIGHT_BROWSERS_PATH="$SCRATCH/browsers" \
  "$SCRATCH/venv/bin/python" "$REPO/scripts/e2e-web-test.py" \
  "http://127.0.0.1:8124/?token=<fresh-boot-token>"
```

`PLAYWRIGHT_BROWSERS_PATH` must be the same at install and run time; that is
what keeps chromium out of `~/.cache/ms-playwright`. To start over — or to
relocate the scratch dir — `rm -rf "$SCRATCH"` and rerun the one-time block: a
venv records its own absolute path when it is created, so moving an existing
one breaks its `pip`/`playwright` entry points. The install needs network
access to PyPI and a writable pip cache.

What it does: new session → two turns → `/rewind-compact` → pick a turn and a
side in the two dialogs → wait → print the result message.

Verified result (before mode, web profile):

```
Rewound to turn 2 (before mode). New session: 82dc479d-….
Pre-rewind session session-14d959c2-… keeps the discarded side and stays resumable.
0 file(s) changed since this point — files were NOT reverted (v1).
```

On-disk verification: the child session log contains the seeded history
(system + both turns) followed by the five-field scaffold message
(`## Files changed / none`, …) — the mechanical half of the hybrid summary;
prose is skipped here because the web template ships no compaction service
(the plugin logs `summaries degrade to scaffold-only` and continues).

Browser-automation gotchas (already handled in the script): the chat input is
a `contenteditable` whose aria-label changes after the first message; the
picker options are `button[role=radio]` that **ignore mouse clicks** — focus
them and press Space, then Enter to advance; a pending dialog dies with the
page, so one run must complete the whole flow.

**Known limitation:** the forked child session is stored under the
`_no-cwd` session bucket instead of the source's workspace bucket. The TUI
recipe attaches the fork to the workspace in a separate step
(`attachSessionToWorkspace`); the bundle does not call it yet, so the child
shows up ungrouped in the sidebar. Functionally the child is complete and
resumable.

## Smoke test

```sh
bash scripts/test-web-profile.sh            # profile web-rewind-test, port 8123
bash scripts/test-web-profile.sh my-test 9999
```

What each step proves:

1. **Init from template** — `dsh --profile <name> --from-default-profile web`
   creates the profile from the same template as the real web profile (the
   first boot is killed; it exists only to materialize the profile).
2. **Install** — `dsh plugin --profile <name> add --offline file:<repo>`
   runs pnpm in the profile dir, then reconciles `dsh.profile.bundles`: a
   dependency declaring `dsh.bundle` joins the layer stack automatically.
3. **Compose** — `--dump-config` must contain `rewind-compact/entry`. This is
   the earliest real failure detector: a bad patch layer dies here.
4. **Boot + registration** — the web app boots with the bundle loaded; the
   log must show `[rewind-compact] entry loaded`, plus any registration
   warnings from the tools/commands/skills services.

## Manual interactive checks

### TUI (the interactive picker, per the design)

1. **Grant the permission** (default deny, D-7): in the TUI's permission UI
   grant `session.rewind.intercept` to `dsh-rewind-compact`, or add it to the
   host grants file `~/.dsh-tui/extension-grants.json`:
   ```json
   { "grants": { "<componentId>": [{ "name": "session.rewind.intercept", "scope": "decision event subscription" }] } }
   ```
   If the grant is missing, the TUI logs a warning naming the plugin identity —
   use the exact id from that log as `<componentId>` (the guard identifies the
   subscribing plugin by its verified component identity).
2. **Open the rewind overlay** (Esc Esc on empty input) and pick a turn.
   The confirm pane must now show a choice list: the built-in
   conversation-only rewind, then **Rewind + compact after** and
   **Rewind + compact before** (with the files-changed warning when
   applicable). No-op sides are omitted (last turn has no "after", first turn
   has no "before").
3. **Pick "Rewind + compact after"** — the TUI forks; a toast reports the
   compact summary. Verify: the new session contains the hybrid summary, the
   pre-rewind session keeps the discarded side and stays resumable.
4. **Fast path**: `/rewind-compact 3 after` forks directly with the same
   result; bare `/rewind-compact` points at the picker.

### Web (no TUI overlay there — command/tool/skill only)

With the app running at `http://127.0.0.1:<port>/`:

1. **Command**: type `/rewind-compact 3 after` to fork directly (the bare
   command explains the TUI picker path). Verify: a new session appears, the
   old session still exists with the full transcript (resumable = recoverable
   discarded side).
2. **Tool (ungated compact)**: ask the model to run `rewind_compact` with
   `rewind: false`. It should complete without any approval prompt.
3. **Tool (gated rewind)**: ask the model to run it with `rewind: true` in a
   turn you typed. It should succeed; from a non-human turn it must fail
   closed with `REWIND_COMPACT_APPROVAL_REQUIRED`.
4. **Skill**: check the model's skill catalog shows `rewind-compact`, and
   that it proposes a rewind when context pressure climbs.

## Installing into the real web profile (optional)

Same two commands, pointed at the live profile — this changes your real web
environment:

```sh
REPO=$(git rev-parse --show-toplevel)     # run from the repo root
dsh plugin --profile web add --offline "file:$REPO"
dsh --profile web --dump-config | grep rewind-compact/entry   # verify compose
dsh web                                                       # normal boot
```

Remove it with `dsh plugin --profile web remove dsh-rewind-compact`.

## Cleanup

```sh
rm -rf "$DSH_HOME/profiles/web-rewind-test"   # throwaway profile
kill <boot pid>
```

## Environment notes (observed on this machine)

- npm registry writes fail (`EROFS` on `~/.npm/_cacache`); the method is
  offline by design (`--offline`, local `file:` install).
- Harness peers (`@deepseek-ai/dsh-tools`, `dsh-session`, `dsh-llm`,
  `schemastery`) are declared as `peerDependencies` and resolve from the
  profiles-level hoisted `node_modules` (`$DSH_HOME/profiles/node_modules`),
  the same pattern `@deepseek-harness-tui/dsh-tui` uses. If a pnpm build ever
  rejects the offline peer resolution, drop the `peerDependencies` block —
  runtime resolution walks up the same tree regardless.
- The web template bundles include `ds-harness-remote`; the web app may need
  network/credentials to fully start. Entry-load verification works even if
  the remote API is unreachable, but drive the interactive checks only on a
  boot that reached a healthy state.

## Live-boot findings already fixed (this is what the test caught)

The first boots failed at runtime with three real bugs, all now fixed and
verified on a green boot (log shows `[rewind-compact] entry loaded`):

1. **Schemastery has no `.nullable()`** (3.18.x): the tool's output schema
   crashed the entry import. Fixed to raw JSON Schema in the harness's
   enforced subset (`required` inside each property, closed
   `additionalProperties`, `oneOf` branches) — mirroring
   `dsh-tool-goal`'s `GOAL_VALUE_SCHEMA`; `defineTool` compiles `output.schema`
   as raw JSON Schema, not schemastery.
2. **`inject` hard-required `compaction` and `logger`**, which the web
   profile does not provide, blocking activation. Fixed: inject only
   `tools, commands, skills, agents`; `compaction`/`logger`/`sessionProjections`
   are probed via `ctx.get()` in try/catch (Cordis throws on uninjected
   property access, so `?.` cannot guard it). Without a compaction service
   the plugin degrades to scaffold-only summaries and logs a warning — on the
   web template, `ctx.compaction` does not exist at all.
3. **`pnpm add file:` does not re-copy changed files** ("Already up to
   date"). Refresh the profile's copy with remove + add:
   `dsh plugin --profile <name> remove dsh-rewind-compact && dsh plugin --profile <name> add --offline file:<repo>`.
4. **The fork seed used the assistant message shape.** The summary record was
   built as `data.message.{role,content}` — the shape `assistant/message`
   uses — with a bare string for content and no `id`, so every fork died in
   the seed validator with `seed user/message at index 0 lacks an identified
   message`. A `user/message`'s `data` object **is** the message: `id`,
   `role: "user"`, `source.kind`, and `content` as blocks. The fork path had
   not been re-run since the refactor that introduced this, and the unit tests
   covered only `scaffold.js`/`events.js`. Seed composition now lives in the
   pure `lib/seed.js`, `tests/seed.test.js` pins the envelope, and
   `scripts/check-contracts.mjs` builds a seed from a real transcript.
   The same trial showed the in-place compact path reporting `ok: true` for a
   no-op on a profile with no compaction service; it now returns
   `applied: false` plus a `note`, which the rendered output surfaces.
   Reading the validator also turned up the same defect one layer down:
   `session.append()` neither assigns nor requires a message `id`, so the two
   append sites wrote a summary that stayed valid in the transcript but failed
   the *next* fork with `session event at seq N lacks an identified message`.
   Both sites now append the shared `summaryMessage()` payload, which carries
   its own id.

