# Testing rewind-compact

Testing has **two gates**, both on throwaway profiles — never the live `web` or
`dsh-tui` profile, and never the live TUI:

1. **Compose gate** — copy a profile to a new scratch directory under
   `$DSH_HOME/profiles/`, install this repo into the copy, and assert that
   `dsh --profile <scratch> --dump-config` contains `rewind-compact/entry`.
   This is the earliest and cheapest failure detector for a bad patch layer.
2. **Live scratch run** — boot the scratch profile and exercise a shipped
   surface: `scripts/test-web-profile.sh` + `scripts/e2e-web-test.py` for the
   web command path, and a manual TUI picker run for the after-only
   decision-event surface.

Never edit, install into, rename, or delete an existing profile; never touch a
live session or lock file. Remove the scratch profile at the end — on success
and on failure — with `rm -rf "$DSH_HOME/profiles/<scratch-name>"`, and record
that cleanup in the run's evidence.

## Contract baseline (dsh 0.2.1-rc.2)

Declared harness line: `dsh >=0.2.1-rc.2 <0.3.0-0` (`engines.dsh`, mirrored by
the `@deepseek-ai/dsh-*` peers; the `<0.3.0-0` bound also excludes
`0.3.0-rc.x`). Before any boot:

```sh
dsh --version        # expect 0.2.1-rc.2
npm run check        # version gate + contract probe + syntax + unit tests
```

The probe imports `lib/` from **this checkout** (no profile refresh needed) and
resolves harness packages from `$DSH_HOME/profiles/node_modules`. It requires a
`session.v4` fixture with surface events (a v3-only home fails the probe) and runs the harness's own `Session.create` validator
over seeds built by `lib/seed.js`, so editing `lib/` changes the probe result
without reinstalling the bundle.

The probe also pins the current create/summary contract: the summary message
carries the declared `source.kind="rewind-compact"` (the legacy
`{kind: "plugin"}` wrapper is rejected), `agents.create` receives
`meta{cwd, parentSession, isSeeded, agentPreset}` + `inheritedEventCount` with
no pre-0.2.1 top-level aliases, and the title is appended as a `session/title`
event rather than passed as a create option. It also writes a prepared child
through the shipped JSONL backend and reads it back, asserting the header
(`cwd`, `parentSession`, `isSeeded`, `agentPreset`), the `session/title` line,
the inherited `session/end-seed` marker, and that the child is not grouped under
`_no-cwd`.

Every probe check is a hard contract; a v3-only transcript, a wrong role map,
a retired `plugin` source kind, or a flattened after-mode replacement fails the
run. A running dsh outside the declared line fails the probe with the exact
range. Verify that failure path without uninstalling anything:

```sh
RWC_PROBE_DSH_VERSION=0.3.0 npm run check   # expected: exit 1, version-gate error
```

## Gate 1 — compose a scratch profile

`dsh-tui` is not a shipped template, so `--from-default-profile dsh-tui` is not
available: copy the directory instead. Never reuse or overwrite an existing
profile name.

```sh
# Run from the repo root (file:$PWD is the install source).
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SCRATCH="rwc-compose-$(date +%s)"
test ! -e "$DSH_HOME/profiles/$SCRATCH"            # must be a new name
cp -a "$DSH_HOME/profiles/dsh-tui" "$DSH_HOME/profiles/$SCRATCH"
dsh plugin --profile "$SCRATCH" add --offline "file:$PWD"
dsh --profile "$SCRATCH" --dump-config | grep rewind-compact/entry   # gate
rm -rf "$DSH_HOME/profiles/$SCRATCH"               # on success AND failure
```

A missing `rewind-compact/entry` line is the failure; a successful install and
compose only prove the patch layer parses and registers, not that a surface
behaves. `scripts/test-web-profile.sh` performs the web equivalent of both
gates (see below).

## Gate 2 — live scratch runs

### Web rig (command path)

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
# Each run: drive the E2E against a live scratch web profile
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

**Scope:** the script exercises the web `/rewind-compact` command picker only.
It does not cover the tool, the TUI decision events, or the skill surface; those
are separate checks below. The script prints the result and writes screenshots
rather than asserting — read the printed tail and check the child log.

What it does: new session → two turns → `/rewind-compact` → pick a turn and a
side in the two dialogs → wait → print the result message.

Verified result (before mode, web profile):

```
Rewound to turn 2 (before mode). New session: 82dc479d-….
Pre-rewind session session-14d959c2-… keeps the discarded side and stays resumable.
0 file(s) changed since this point — files were NOT reverted (v1).
```

This run remains valid real-run evidence for the command path: the command keeps
both modes, so `before` is still selectable there (only the TUI picker dropped
it).

On-disk verification: for a **before-mode** fork the child log begins with the
five-field scaffold (the summary of the discarded prefix), then the inherited
policy facts and the folded kept tail; for an **after-mode** fork it is the
verbatim kept prefix followed by the scaffold at the end. The scaffold is the
whole summary — v1 is scaffold-only and the web template has no compaction
service, so there is no prose step to check. The summary message carries the
declared `source.kind="rewind-compact"`.

Browser-automation gotchas (already handled in the script): the chat input is
a `contenteditable` whose aria-label changes after the first message; the
picker options are `button[role=radio]` that **ignore mouse clicks** — focus
them and press Space, then Enter to advance; a pending dialog dies with the
page, so one run must complete the whole flow.

Child placement/title: the fork passes `meta.cwd`, so an absolute source cwd
groups the child under the source workspace bucket; there is no `_no-cwd`
bucket. The title is a best-effort `session/title` event
`<source title> (rewound)` — its absence (an untitled source, or a failed
append) is not a fork failure.

### TUI rig (after-only picker)

Use the throwaway profile from Gate 1 (or `tui-rc-test`), not the live `dsh-tui`
profile.

**Descoped for v1:** the Esc-Esc picker mode does not render on dsh-tui 0.17.0 (RWC-018: backend bundle vs host DecisionEvents). The `/rewind-compact` command and the tool work in the TUI. The picker steps below are the post-v1 target, not a release gate.

1. **Grant the permission** (default deny, D-7): in the TUI's permission UI
   grant `session.rewind.intercept` to `dsh-rewind-compact`, or add it to the
   host grants file `~/.dsh-tui/extension-grants.json`:
   ```json
   { "grants": { "<componentId>": [{ "name": "session.rewind.intercept", "scope": "decision event subscription" }] } }
   ```
   If the grant is missing, the TUI logs a warning naming the plugin identity —
   use the exact id from that log as `<componentId>` (the guard identifies the
   subscribing plugin by its verified component identity). A missing grant is
   the expected warned no-op, not a test failure.
2. **Open the rewind overlay** (Esc Esc on empty input) and pick a **user
   message row** — the overlay lists messages, and the plugin maps the row to
   its enclosing completed turn (ADR D4). Expected confirm-pane list:
   - the built-in conversation-only rewind, then
   - **Rewind + compact after** (with
     `(N file(s) changed since this point — not reverted)` when file-editing
     tools ran after the turn cut).

   Only after mode is offered on this surface: before mode was dropped from the
   TUI (ADR D5) and remains on the command/tool. The after side is omitted on
   the last completed turn (no tail), and a row in the still-open turn is
   ineligible (no plugin modes; the built-in rewind remains). The count is
   derived from the turn cut (`turnStart.seq - 1`), not from the picked message
   seq, so a message picked mid-turn does not hide earlier changes.
3. **Pick "Rewind + compact after"** — the TUI forks, then the plugin appends
   the scaffold to the child; a toast reports
   `Rewound and compacted after this point (scaffold summary …). Source session
   <id> keeps the discarded side and stays resumable. Files were NOT reverted
   (v1).` Verify: the new session ends with the five-field scaffold summary
   (v1 is scaffold-only), the pre-rewind session keeps the discarded side and
   stays resumable. If the append fails, the toast is an error naming the
   prefix-only child — not a silent success (see "Failure messages"). No before
   mode should ever be offered here; if a stale TUI dispatches one, the toast
   says before mode is not available on the TUI.
4. **Fast path**: `/rewind-compact 3 after` forks directly with the same
   result; `/rewind-compact 3 before` is also valid here (the command keeps
   both modes); bare `/rewind-compact` points at the picker.

### Web manual checks (tool and skill)

With a scratch web profile running at `http://127.0.0.1:<port>/`:

1. **Command**: type `/rewind-compact 3 after` to fork directly (the bare
   command opens the picker). Verify: a new session appears, the old session
   still exists with the full transcript (resumable = recoverable discarded
   side).
2. **Tool (retired in-place)**: ask the model to run `rewind_compact` with
   `rewind: false` (or omit it). Expect `ok: false`, `applied: false`,
   `reason: "in_place_retired"`, and a note pointing at `rewind: true`; the
   transcript must be unchanged and no approval prompt appears. This is the
   retired path, not a successful compact.
3. **Tool (gated rewind)**: ask the model to run it with `rewind: true` in a
   turn you typed. It should succeed and fork (`hybrid: false`); from a
   non-human turn it must fail closed with
   `REWIND_COMPACT_APPROVAL_REQUIRED`. The plugin shows no decision prompt; if
   the model asks first, that is conversational guidance, not the gate.
4. **Skill**: check the model's skill catalog shows `rewind-compact`, and that
   it proposes a fork when context pressure climbs.

## Smoke test (scripted web instance of both gates)

```sh
bash scripts/test-web-profile.sh            # profile web-rewind-test, port 8123
bash scripts/test-web-profile.sh my-test 9999
```

What each step proves:

1. **Init from template** — `dsh --profile <name> --from-default-profile web`
   creates the profile from the same template as the real web profile (the
   first boot is killed; it exists only to materialize the profile). This is a
   new scratch profile, never the live `web` profile.
2. **Install** — `dsh plugin --profile <name> add --offline "file:<repo>"`
   runs pnpm in the profile dir, then reconciles `dsh.profile.bundles`: a
   dependency declaring `dsh.bundle` joins the layer stack automatically.
3. **Compose (Gate 1)** — `--dump-config` must contain
   `rewind-compact/entry`. This is the earliest real failure detector: a bad
   patch layer dies here.
4. **Boot + registration (Gate 2)** — the web app boots with the bundle
   loaded; the log must show `[rewind-compact] entry loaded` (the full line
   notes scaffold-only summaries and retired in-place compaction), plus any
   registration warnings from the tool/command/skill services.

## Expected child artifacts and messages

Read a child log with `unzstd -c -f` from
`$DSH_HOME/sessions/<normalized-cwd>/<child-id>/session.v4.jsonl.zstd`:

- **Header** (first line): `cwd` = source cwd, `parentSession` = source id,
  `isSeeded: true`, `agentPreset` copied when the source had one. The seed
  length is passed as `inheritedEventCount`; no pre-0.2.1 top-level aliases are
  used.
- **Title**: best-effort `session/title` event
  `{title: "<source title> (rewound)", messageSeqs: [], source: {kind:
  "user"}}`. No event when the source has no folded title; a failed append is
  logged and does not abort the fork, so the suffix may be absent.
- **Summary**: exactly one appended `user/message` whose `data` is the message
  itself (`id`, `role: "user"`, `content` blocks,
  `source.kind: "rewind-compact"`). Its text is the five-field scaffold
  (`## Files changed` … `## Outstanding TODOs`, `none` for empty fields, plus
  `Note: includes a prior compact summary.` when the range held one). After
  mode: the kept prefix, then this message last. Before mode: this message
  first, then the inherited prefix policy facts and the folded kept tail.
- **TUI after summary**: built from the discarded tail with
  `summaryInput(sourceEvents, boundarySeq, "tail")`, so the tail's `tool/call`
  records are included. `Files changed`, `Commands run`, and `Errors
  encountered` are populated when the tail had write/edit/bash calls; selecting
  a mid-turn message must not hide earlier calls (the cut is
  `turnStart.seq - 1`).

Failure messages:

- **Retired in-place** (`rewind: false` or omitted): `ok:false`,
  `applied:false`, `hybrid:false`, `reason:"in_place_retired"`, and a note
  ending `… call rewind_compact again with rewind: true …`; the transcript is
  byte-identical and `compactRegion` is never called (this is not a working
  compact path).
- **Tool rewind without direct human authority**:
  `REWIND_COMPACT_APPROVAL_REQUIRED` (fail closed). No decision prompt appears;
  a conversational question from the model is not the gate.
- **TUI after with a failed append**: a toast containing
  `compact summary could not be appended (<error>)` and `prefix only`; the
  source still holds the discarded side. It must not be a silent success.
- **TUI before** (never offered; stale client): a toast containing
  `before mode is not available on the TUI`.
- **Point/boundary errors**: no completed turns → `REWIND_COMPACT_NO_TURNS`;
  unknown or out-of-range point → `REWIND_COMPACT_NO_TURN`; a cut before the
  first event → `REWIND_COMPACT_FIRST`.

## Cleanup

```sh
rm -rf "$DSH_HOME/profiles/web-rewind-test"   # scripted web throwaway
rm -rf "$DSH_HOME/profiles/<scratch-name>"    # Gate 1/2 scratch copy
kill <boot pid>
```

Record the scratch-directory removal in the run's evidence. Never remove a
profile you did not create.

## Environment notes (observed on this machine)

- npm registry writes fail (`EROFS` on `~/.npm/_cacache`); the method is
  offline by design (`--offline`, local `file:` install).
- `package.json` declares `engines.dsh = ">=0.2.1-rc.2 <0.3.0-0"`. dsh reads
  the runtime version from app-boot's own manifest and evaluates `engines.dsh`
  alone (peers are ignored for that gate), so installer and probe agree.
- The contract probe needs `unzstd` on `PATH` to read `.zstd` transcripts
  (Session logs are multi-frame; one frame per flush).
- Harness peers (`@deepseek-ai/dsh-tools`, `dsh-session`, `dsh-llm`) are
  declared as `peerDependencies` and resolve from the profiles-level hoisted
  `node_modules` (`$DSH_HOME/profiles/node_modules`), the same pattern
  `@deepseek-harness-tui/dsh-tui` uses. If a pnpm build ever rejects the offline
  peer resolution, drop the `peerDependencies` block — runtime resolution walks
  up the same tree regardless.
- The web template bundles include `ds-harness-remote`; the web app may need
  network/credentials to fully start. Entry-load verification works even if
  the remote API is unreachable, but drive the interactive checks only on a
  boot that reached a healthy state.

## Live-boot findings already fixed (this is what the test caught)

The first boots failed at runtime with real bugs, now fixed and verified on a
green boot (log shows `[rewind-compact] entry loaded`):

1. **The first output-schema attempt used a schemastery builder** (3.18.x has
   no `.nullable()`), and the tool's schema crashed the entry import. Fixed to
   raw JSON Schema in the harness's enforced subset (`required` inside each
   property, closed `additionalProperties`, `oneOf` branches), mirroring
   `dsh-tool-goal`'s `GOAL_VALUE_SCHEMA`; `defineTool` compiles
   `output.schema` as raw JSON Schema.
2. **`inject` hard-required `compaction` and `logger`**, which the web
   profile does not provide, blocking activation. Fixed: inject only
   `tools, agents`; `commands`/`skills` (optional surfaces, RWC-012) and
   `compaction`/`logger`/`sessionProjections` are probed via `ctx.get()` in
   try/catch (Cordis throws on uninjected property access, so `?.` cannot
   guard it). A missing command/skill service logs one skip line and only that
   surface is absent — sdk-minimal provides neither and still loads the tool.
   Compaction is not required: v1 never calls `ctx.compaction`, so the web
   template's missing service changes nothing.
3. **`pnpm add file:` does not re-copy changed files** ("Already up to
   date"). Refresh the profile's copy with remove + add:
   `dsh plugin --profile <name> remove dsh-rewind-compact && dsh plugin --profile <name> add --offline "file:<repo>"`.
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
   no-op on a profile with no compaction service. That path is retired in v1:
   it now returns `ok: false`, `applied: false`,
   `reason: "in_place_retired"`, plus a note, and never changes the
   transcript. Reading the validator also turned up the same defect one layer
   down: `session.append()` neither assigns nor requires a message `id`, so the
   two append sites wrote a summary that stayed valid in the transcript but
   failed the *next* fork with `session event at seq N lacks an identified
   message`. Both construction sites now use the shared `summaryMessage()`
   payload, which carries its own id.
