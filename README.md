# dsh-rewind-compact

Plugin bundle for the DeepSeek Harness (`dsh`): rewind the conversation to a chosen completed-turn boundary and compact one side of that boundary into a hybrid (scaffold + LLM prose) summary. The other side survives verbatim. The pre-rewind session always remains resumable by id — the discarded side is never lost.

## Surfaces

- TUI interactive picker — the native Esc-Esc rewind overlay gains two confirm-pane modes: **Rewind + compact after** / **Rewind + compact before** (files-changed warning in the description). Requires the `session.rewind.intercept` grant (default deny).
- TUI command `/rewind-compact [turn] [after|before]` — fast path; no arguments points at the picker.
- Model-invoked tool `rewind_compact(point, mode, rewind)` — compaction ungated; rewind requires user approval (fails closed headless).
- Skill `rewind-compact` — when to propose, tool rules, summary format, post-fork etiquette.

## Install

```
dsh plugin --profile <name> add <path-to-this-repo>
```

(Or the equivalent pnpm route the profile uses; see `dsh plugin --help`.)

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
- Forked-session title `<original> (rewound)` is passed as a create option; builds whose agent factory ignores it keep the default title (logged).
- The forked child session is stored under the `_no-cwd` session bucket instead of the source's workspace bucket (the TUI attaches the fork to the workspace in a separate step this bundle does not call yet); the child is complete and resumable, just ungrouped in the sidebar.
- **Verified end-to-end** in a real browser against the web profile: `scripts/e2e-web-test.py` (see TESTING.md) — new session → two turns → `/rewind-compact` → answer both dialogs → completion message, with the child log checked on disk for the seeded history plus the five-field scaffold.

## Harness seams used

- **Compaction** — `ctx.compaction.compactRegion(start, end, agent, signal)` (CompactionEngine contract, `dsh-compaction-basic`). Its signature takes no instructions argument, so the five-field scaffold is delivered **inside the compacted range** as its final message: the summarizer (`summarizeWithLlm`) appends its own instruction and condenses the range, preserving the scaffold's facts into the prose (hybrid summary, R5). For forks, the range compaction runs on the child session after seeding — the pre-rewind session is never appended to or truncated. Fallback: scaffold-only summary message when child-side compaction is unavailable.
- **Rewind/fork** — the TUI's fork-at-boundary recipe (`@deepseek-harness-tui/dsh-tui/lib/types/dsh-adapter/channel/session-rewind.js`): cancel agent → wait `turn/end` → settleCompaction → walk back to enclosing `turn/start`, cut at `turnStart.seq - 1` → `agents.create({sessionId: SessionId(randomUUID()), seed, inheritedCount, parentSession, setup: clear inbox + compact discarded side in the child})`. Never `sessions.fork()`; never mutate the pre-rewind session.
- **Tool registration** — `ctx.tools.register(defineTool({name, description, parameters, output: {schema, render}, execute, presentCall}))`, `defineTool` from `@deepseek-ai/dsh-tools`, schemastery parameter specs, per-property parameter map (the `dsh-tool-goal` dialect).
- **Command registration** — `ctx.commands.register({name: 'rewind-compact', description, handler})`; handler receives `{rawInput, agent, signal, commandId}` and returns `{kind, text}` (the `dsh-command-compact` shape; the adapter renders the leading slash).
- **Skill registration** — `ctx.skills.register({name, description, invocation: {modelInvocable, userInvocable}, path})` (`dsh-skill` runtime seam; `SKILL_NAME`-valid name, non-empty description required).
- **TUI picker seam** — decision events via plain `ctx.on`: `tui/rewind-prompt` (answer: `{modes: [{id, label, description}]}` — rendered in the confirm pane's choice list) and `tui/rewind-done` (post-fork payload carries `mode`, `boundarySeq`, `sourceSessionId`, `childSessionId`; the bundle replays and compacts the discarded side in the child and returns the toast string). Subscriptions are D-7-gated on the `session.rewind.intercept` grant (default deny — a denied subscription is a warned no-op; see TESTING.md for granting).
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
