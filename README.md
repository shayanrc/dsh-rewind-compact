# dsh-rewind-compact

Plugin bundle for the DeepSeek Harness (`dsh`): rewind the conversation to a chosen completed-turn boundary and compact one side of that boundary into a hybrid (scaffold + LLM prose) summary. The other side survives verbatim. The pre-rewind session always remains resumable by id — the discarded side is never lost.

## Surfaces

- TUI interactive picker — the native Esc-Esc rewind overlay gains two confirm-pane modes: **Rewind + compact after** / **Rewind + compact before** (files-changed warning in the description). Requires the `session.rewind.intercept` grant (default deny).
- TUI command `/rewind-compact [turn] [after|before]` — fast path; no arguments points at the picker.
- Model-invoked tool `rewind_compact(point, mode, rewind)` — compaction ungated; rewind requires user approval (fails closed headless).
- Skill `rewind-compact` — when to propose, tool rules, summary format, post-fork etiquette.

## Install

```sh
# Run from this checkout; --offline avoids the read-only npm cache on this machine.
dsh plugin --profile <name> add --offline "file:$PWD"
```

Profiles declare ordered `dsh.profile.bundles`; after a successful package
operation DSH adds the new bundle dependency to that list automatically.
Refreshing an already-installed `file:` dependency needs `remove` + `add`
(see TESTING.md).

## Distribution

The package is distributed by **path or tarball**; `private: true` is deliberate
— it is not published to npm.

- **Path**: `dsh plugin --profile <name> add --offline "file:$PWD"` (above).
- **Tarball**: `npm pack` in this checkout produces
  `dsh-rewind-compact-0.1.0.tgz`; install it with
  `dsh plugin --profile <name> add --offline "file:./dsh-rewind-compact-0.1.0.tgz"`.
  The `files` allowlist ships `lib/`, `skill/`, `cordis.patch.yml`, `README.md`,
  `LICENSE`, and `COPYING`; tests, scripts, docs, and `SPEC.md` stay in the
  repository.
- **Git**: not a supported install path. There is no build step (`prepare` is
  absent), and a git install would need `prepare` + `allowBuilds` plus a pinned
  commit SHA to be reproducible — use the path or tarball forms instead.

`lib/index.js` reads `skill/rewind-compact/SKILL.md` at import time, so that
file must be in the installed artifact; it is covered by `files` and appears in
`npm pack --dry-run`. The harness gate remains `engines.dsh` (below).

## Compatibility

Declared harness line: **`dsh >=0.2.1-rc.2 <0.3.0-0`** (`engines.dsh`, mirrored
by the `@deepseek-ai/dsh-*` peer ranges) — verified on `0.2.1-rc.2`. Older
`0.1.x` / `0.2.0-rc.x` builds are not supported, and the `<0.3.0-0` upper bound
excludes `0.3.0` prereleases (`0.3.0-rc.x`) as well as `0.3.0`. `npm run check`
enforces the line and probes the 0.2.1 contracts (Session v4, `createAgent`
options, `compactRegion`) against **this checkout's** `lib/`; see
`docs/HARNESS-CONTRACTS.md` for the compatibility matrix and anchors.

## Surfaces and where they work

| Surface | Where it works |
|---|---|
| Esc-Esc rewind picker modes | TUI profile (decision-event seam `tui/rewind-prompt` / `tui/rewind-done`; needs the `session.rewind.intercept` grant — see TESTING.md) |
| `/rewind-compact` command | TUI profile (harness command seam, composed into every human-command adapter) |
| `rewind_compact` tool | every profile that loads the bundle (model-invoked) |
| `rewind-compact` skill | every profile that loads the bundle (model-invoked) |

Headless/sdk: the tool's compact path works ungated; the rewind path fails closed (no direct human input in a goal-round turn).

## v1 limitations

- No file revert: the plugin reports which files changed after the boundary but never restores them (deferred v2).
- Profiles without a compaction service: the in-place compact path is a no-op and reports `applied: false` with a `note` (the fork path still summarizes, scaffold-only).
- Headless/sdk approval for rewind fails closed.
- Forked-session title `<original> (rewound)` is passed as a legacy create option; 0.2.1's `CreateAgentOptions` has no `title`, so the child keeps the default title (baseline deviation tracked with the fork-metadata work).
- The forked child session is stored under the `_no-cwd` session bucket instead of the source's workspace bucket: 0.2.1 reads `cwd` from `meta.cwd` and the current fork call still passes the pre-0.2.1 top-level alias. The child is complete and resumable, just ungrouped in the sidebar.
- **Verified end-to-end** in a real browser against the web profile: `scripts/e2e-web-test.py` (see TESTING.md) — new session → two turns → `/rewind-compact` → answer both dialogs → completion message, with the child log checked on disk for the seeded history plus the five-field scaffold.

## Harness seams used

- **Compaction** — `ctx.compaction.compactRegion(start, end, agent, signal)` (CompactionEngine contract, `dsh-compaction-basic`). Its signature takes no instructions argument, so the five-field scaffold is delivered **inside the compacted range** as its final message: the summarizer (`summarizeWithLlm`) appends its own instruction and condenses the range, preserving the scaffold's facts into the prose (hybrid summary, R5). Forked children have no open turn, so the fork path ships the five-field scaffold-only summary and reports `hybrid: false`; the hybrid `compactRegion` path is the tool's in-place compaction on the live session. The pre-rewind session is never appended to or truncated.
- **Rewind/fork** — the TUI's fork-at-boundary recipe (`@deepseek-harness-tui/dsh-tui/lib/types/dsh-adapter/channel/session-rewind.js`): cancel agent → wait `turn/end` → settleCompaction → walk back to enclosing `turn/start`, cut at `turnStart.seq - 1` → `agents.create({sessionId: SessionId(randomUUID()), seed, meta: {parentSession, cwd, isSeeded: true, agentPreset?}, inheritedEventCount: seed.length, setup})`. Never `sessions.fork()`; never mutate the pre-rewind session. (The current `lib/rewind.js` still passes the pre-0.2.1 `inheritedCount`/top-level `parentSession`/`cwd` aliases, which 0.2.1 ignores — the probe reports that as a documented baseline deviation.)
- **Tool registration** — `ctx.tools.register(defineTool({name, description, parameters, output: {schema, render}, execute, presentCall}))`, with `defineTool` from `@deepseek-ai/dsh-tools`: `parameters` is a per-property map and `output.schema` is raw JSON Schema in the enforced subset (the `dsh-tool-goal` dialect).
- **Command registration** — `ctx.commands.register({name: 'rewind-compact', description, handler})`; handler receives `{commandId, agent, rawInput, attachments, signal}` and returns `{kind: 'success'|'error', text, sourceEventSeq?}` (the `dsh-command-compact` shape; the adapter renders the leading slash).
- **Skill registration** — `ctx.skills.register({name, description, invocation: {modelInvocable, userInvocable}, source, content, path})` (`dsh-skill` runtime seam; the load-time validator requires string `source`/`provider`/`content`, so the SKILL.md body ships inline as `content`).
- **TUI picker seam** — decision events via plain `ctx.on`: `tui/rewind-prompt` (payload `{text, seq, sessionId, cwd}` where `seq` is the picked **message** seq; answer `{modes: [{id, label, description}]}` — rendered in the confirm pane's choice list) and `tui/rewind-done` (post-fork payload carries `mode`, `boundarySeq` = the inclusive cut `turnStart.seq - 1`, `sourceSessionId`, `childSessionId`; the bundle replays and compacts the discarded side in the child and returns the toast string). Subscriptions are D-7-gated on the `session.rewind.intercept` grant (default deny — a denied subscription is a warned no-op; see TESTING.md for granting).
- **Rewind gating** — direct-human authority check (a user-sourced `user/message` inside the open turn, via `ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')`), the same authority pattern as `dsh-tool-goal`'s `requireDirectHuman`.
- **Errors** — typed `HarnessError(message, code)` from `@deepseek-ai/dsh-llm`.

## Layout

- package.json — bundle manifest
- cordis.patch.yml — patch layer
- lib/ — implementation (index.js entry; events.js accessors; scaffold.js, seed.js, rewind.js, tool.js, command.js, tui-rewind.js, errors.js)
- tests/ — node:test unit tests (scaffold, seed envelopes)
- skill/rewind-compact/SKILL.md — the skill
- SPEC.md — the approved spec

## License

LGPL-3.0-or-later — see [LICENSE](LICENSE). The LGPL incorporates the GNU GPL v3 by reference; its text ships as [COPYING](COPYING).
