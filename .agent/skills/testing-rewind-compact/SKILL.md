---
name: testing-rewind-compact
description: How to test this bundle for real — refresh the profile, drive the web E2E or the TUI picker, and recognise a pass. Use when verifying a change to the plugin, reproducing a fork/compact failure, or installing the bundle into a profile.
---

# Testing rewind-compact

Two rigs (web, TUI), one gate. Behavioural invariants and code gotchas live in
`AGENTS.md`; this file covers only the rig.

## 0. Gate first

```sh
npm run check        # contract probe + syntax + node --test
```

Its first two checks import the bundle **installed in a profile**
(`$DSH_HOME/profiles/<p>/node_modules/dsh-rewind-compact`), so they validate a
stale copy until you refresh one (§1). `tests/` and the seed check run from the
repo.

## 1. Refresh the installed copy — pnpm will not do it for you

`pnpm add file:` reports "Already up to date" and keeps the old files, so a
refresh is remove + add:

```sh
bash scripts/reload-profile.sh <profile>     # prints "OK: lib copy in sync"
```

| Profile | What it serves |
|---|---|
| `dsh-tui` | the live TUI |
| `tui-rc-test` | TUI throwaway |
| `web` | the live web app |
| `web-rc-test`, `web-rewind-test` | web throwaways |

Restart the profile's process (or resume the session) afterwards — a running
process keeps the old modules in memory. `~/.dsh` sits outside the workspace,
so a sandboxed session needs full file access for this write.

## 2. Web rig

The rig lives outside the repo in `<workspace>/.rwc-test/`: `venv/` (Playwright),
`browsers/` (chromium), step screenshots.

```sh
cd <workspace>/.rwc-test
dsh --profile web-rewind-test --port 8124 --no-open          # prints the token URL
PLAYWRIGHT_BROWSERS_PATH=$PWD/browsers ./venv/bin/python \
  <repo>/scripts/e2e-web-test.py "http://127.0.0.1:8124/?token=…"
```

The script drives New session → `Reply with exactly: alpha` → `…beta` →
`/rewind-compact` → pick turn 2 → **Compact before** → wait → prints the result
tail and writes `70-q1.png`, `71-q2.png`, `72-result.png`.

Three UI gates the script does not clear on a current build:

| Gate | Looks like | Clear it by |
|---|---|---|
| Internal Testing Notice | stacked `[role=dialog]` with one **Continue** | click Continue until no dialog remains |
| API key prompt | "Add an API key to get started" | only when the profile has no credentials — copy `.credentials.yaml` (§4), or "Configure later" (turns then produce nothing) |
| Mask over the sidebar | `div[role=presentation] > div._mask_…` intercepts `button[aria-label="New session"]` | `click(force=True)` |

Headless only in a sandboxed session: the full chromium build traps
(`core dumped`); the `chromium_headless_shell` binary is what runs.

## 3. TUI rig

Esc-Esc modes need the grant, already present in
`~/.dsh-tui/extension-grants.json`:

```json
{"grants": {"dsh-rewind-compact": [{"name": "session.rewind.intercept", "scope": "decision event subscription"}]}}
```

- Two or three turns → **Esc Esc** on empty input → the confirm pane lists the
  built-in rewind plus **Rewind + compact after / before** (a no-op side is
  omitted) → pick → the TUI forks and a toast names the child.
- Fast path — the one that exercises `lib/rewind.js`'s seed:
  `/rewind-compact 3 before`.
- Tool path: `rewind_compact` with `rewind: false` compacts in place (ungated);
  `rewind: true` forks and requires a turn the human typed.

## 4. Scratch-home rig (when `~/.dsh` must stay untouched)

```sh
SH=<workspace>/.rwc-test/dsh-home
mkdir -p $SH
cp -a ~/.dsh/storages ~/.dsh/.credentials.yaml ~/.dsh/settings.yaml \
      ~/.dsh/llm-deepseek ~/.dsh/.agent-presets $SH/
cp -a ~/.dsh/profiles/web-rewind-test $SH/profiles/          # an onboarded profile
cp -a <repo>/lib/. $SH/profiles/web-rewind-test/node_modules/dsh-rewind-compact/lib/
DSH_HOME=$SH dsh --profile web-rewind-test --port 8125 --no-open
```

Traps: without `.credentials.yaml` the app gates on the API key; pnpm cannot
install there (`ERR_SQLITE_ERROR`), so copying `lib/` over the installed bundle is
the way in; **delete the scratch home when done** — it holds a copy of your
credentials.

## 5. What a pass looks like

Plugin log:

```
[rewind-compact] entry loaded
[rewind-compact] picker answers: point=["turn 2 — …"] mode=["Compact before"]
[rewind-compact] forking: turn 2, mode before, boundary seq 21, 0 file(s) changed
[rewind-compact] fork done: child <uuid>, source <session-id>, hybrid false
```

UI completion message: `Rewound to turn N (<mode> mode). New session: <uuid>.
Pre-rewind session <id> keeps the discarded side and stays resumable. K file(s)
changed since this point — files were NOT reverted (v1).`

Child transcript (`$DSH_HOME/sessions/_no-cwd/<uuid>/session.v3.jsonl.zstd`):

```
seq 0  user/message       id=<uuid>  src=plugin  op=append   ← five-field scaffold
seq 1  user/message       id=…       src=user    op=append   ← kept side, verbatim
seq 2  assistant/message  id=…
seq 3  session/end-seed
```

Failure signatures: `seed user/message at index 0 lacks an identified message`
(summary envelope wrong); `session event at seq N lacks an identified message`
(an appended summary carried no `id`); `applied: false` with `ok: true` (no
compaction service — expected in these profiles, which ship none).

## 6. Forensics

Sessions live at
`$DSH_HOME/sessions/<normalized-cwd>/<session-id>/session.v3.jsonl.zstd` (read with
`unzstd -c`). Helpers in `scripts/`:

```sh
unzstd -c <session> | python3 scripts/seg.py <lo> <hi>          # one seq range
unzstd -c <session> | python3 scripts/hist.py prompts|tools|grep
unzstd -c <session> | python3 scripts/cmds.py <regex>           # commands run + first result line
unzstd -c <child>   | python3 scripts/dumpchild.py              # seed shape + scaffold
```

## 7. Rig traps

- `--port` must be free: a stale app on 8124 fails the boot with
  `EADDRINUSE` inside the profile tree.
- The forked child lands in the `_no-cwd` bucket, so it shows ungrouped in the
  sidebar — expected (v1).
- Never `pkill -f "dsh --profile …"` from a script whose own command line
  contains that string: it kills the script. Use a bracket pattern.
