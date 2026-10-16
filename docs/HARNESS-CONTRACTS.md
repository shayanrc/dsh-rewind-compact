# Harness contracts (verified 2026-10-15)

The facts this plugin depends on, each verified against an installed artifact
during the 2026-10-14/15 implementation and live-testing. Every claim has a
file:line anchor in the installed harness (`dsh` 0.1.5-rc.x, harness packages
`0.1.5-rc.2`). Re-verify against the anchors before trusting an upgraded
harness. This is a **reference document**: read it when implementing, not
every turn.

Paths used below:

- `D`: `$(npm root -g)/@deepseek-ai/dsh` (launcher; resolved from the global npm root)
- `N`: `D/node_modules/@deepseek-ai` (harness packages)
- `H`: `$DSH_HOME/profiles/node_modules/@deepseek-ai` (profiles-level hoist)
- `T`: `$DSH_HOME/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui`

## 1. Bundle anatomy

- A bundle is an npm package whose manifest declares
  `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` (`D/README.md`).
- The patch file is a YAML array of loader patch entries: row overrides
  `{id, name?, disabled?, config?}` or `insert:` lists. A patch **replaces the
  targeted row's whole config** — never merges. Layer order: bundle patches →
  profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`
  overlays; last-write-per-id wins (`D/lib/profile-boot-*.js:232-256`).
- Profiles declare `dsh.profile.bundles` (ordered). `dsh plugin --profile <p>
  <pnpm args>` forwards to pnpm in the profile dir, then reconciles: any
  dependency resolving to a package that declares `dsh.bundle` joins the
  layer stack automatically (`D/lib/plugin-*.js:25-128`).
- Shipped templates: `acp`, `web`, `headless`, `sdk`, `sdk-minimal`
  (`N/dsh-app-boot/lib/index.js:328`). `dsh-tui` is NOT a template — clone a
  profile by copying the directory.
- `patchReload: live` hot-applies patch/config changes but does **not**
  re-import changed bundle module code: restart the profile process for lib
  changes.

## 2. Plugin shape (Cordis)

- Entry modules export `{name, inject, apply}`; `apply(ctx)` runs under
  `ctx.effect(function* () { yield disposer; ... })`
  (`N/dsh-command-compact/lib/index.js:77-100`).
- **`ctx.<service>` throws on any property not declared in `inject`** —
  optional-chaining cannot guard it (`cannot get property "X" without
  inject`). Probe optional services via `ctx.get('name')` in try/catch.
- Harness packages resolve from the profiles-level hoist (`H`) for
  profile-installed bundles; declare harness deps as `peerDependencies`
  (pattern: `T/package.json`).

## 3. Tool contract (`ctx.tools.register(defineTool({...}))`)

- `defineTool` from `@deepseek-ai/dsh-tools`; parameters = **per-property
  map** `{name: {type, required?, description?, enum?}}`, NOT JSON Schema
  (`N/dsh-tool-goal/lib/index.js:275-300`).
- `output.schema` = **raw JSON Schema in the harness's enforced subset**:
  `required: true` rides INSIDE each property, objects close
  `additionalProperties: false`, null via `{type: 'null'}`, unions via
  `oneOf` (`N/dsh-tool-goal/lib/index.js:125-246`). Schemastery is NOT
  accepted here (`unsupported JSON schema: schema must be a value schema
  object` — `N/dsh-tools/lib/index.js:772`). Schemastery 3.18 has **no
  `.nullable()`**.
- `output.render(args, value) => [{type:'text', text}]`;
  `presentCall` returns a presentation card `{card:'generic', title, kind,
  rawInput}` (`N/dsh-tool-goal/lib/index.js:248-254`).
- `execute(args, exec)` — `exec.agent`; the calling agent's session is
  `agent.session`; events via `agent.session.snapshotEvents()`.
- Typed errors: `new HarnessError(message, code)` from `@deepseek-ai/dsh-llm`.
- Direct-human authority pattern: `ctx.sessionProjections.stateOf(agent.session,
  'turnBoundary')` → `openTurnStartSeq`, then a user-sourced `user/message`
  in the open turn (`N/dsh-tool-goal/lib/index.js:18-76`).

## 4. Command contract (`ctx.commands.register({name, description, handler})`)

- `handler(invocation)` receives `{rawInput, agent, signal, commandId}` and
  returns `{kind: 'success'|'error', text, sourceEventSeq?}`
  (`N/dsh-command-compact/lib/index.js:48-96`). The adapter renders the
  leading slash.
- Interactive prompts: `ctx.userQuestions.ask({questions: [{id, question,
  header?, options: [{label, description}], multiSelect?}], agent, signal})`
  → `{answers: [{id, selected: string[], custom?}]}` — rendered natively in
  web and TUI (`N/dsh-tool-ask-user/lib/index.js:86-115`).

## 5. Skill contract (`ctx.skills.register(skill)`)

- Register accepts `{name (SKILL_NAME-valid), description (non-empty),
  invocation: {modelInvocable, userInvocable}, ...}` and defaults
  `provider`/`invocation` (`N/dsh-skill/lib/index.js:185-215`).
- The **load-time** validator (`validateDefinition`, not exported,
  `N/dsh-skill/lib/index.js:478-495`) requires `source`, `provider`, AND
  `content` to be strings — a `path` alone yields `loaded skill "…" source
  must be a string`. Ship the SKILL.md body inline as `content`.

## 6. Compaction contract

- `ctx.compaction`: `compactIfNeeded`, `compactNow(agent, signal,
  sourceCommandId)`, `compactRegion(start, end, agent, signal)` — exactly 4
  params, no instructions argument (`N/dsh-compaction-basic/lib/index.js:930`).
- The summarizer (`summarizeWithLlm`) appends its own instruction as the
  final input and condenses the range; deliver custom facts **inside the
  compacted range** as the final message so they survive into the prose
  (`N/dsh-compaction-basic/lib/index.js:240-300`).
- The web template profile has NO compaction bundle — probe the service and
  degrade to scaffold-only summaries.

## 7. Session/transcript contract

- Transcripts: `$DSH_HOME/sessions/<mangled-cwd>/<session-id>/
  session.v3.jsonl.zstd`; one JSON record per line: `{type, seq, time, data}`
  (+ optional `surfaceOp`, `sourceEventSeqs`, `ignorable`). Types include
  `user/message`, `assistant/message`, `tool/call`, `tool/result`,
  `turn/start|end`, `step/start|end`, `command/run|done`,
  `agent/inbox/spliced`, `request/header` (which carries the per-request tool
  list — the definitive "is my tool exposed?" check), `session/end-seed`.
- **Append-only**: committed events are never rewritten; compaction shadows
  ranges via `surfaceOp: {op: 'replace', startSeq, endSeq}`. Only the four
  surface types may carry `surfaceOp`.
- **Fork seed** = full event envelopes `{type, seq, time, data}` (the
  source's own surface records, cloned) — `agents.create` validates the
  envelope and rejects `{role, content}` shapes
  (`N/dsh-session/lib/index.js:849-865`: allowed keys, string type,
  non-negative safe-integer seq/time, `data !== undefined`).
- `session.lock` is a kernel flock lease; never delete.

## 8. Fork recipe (rewind)

The TUI's own recipe (`T/lib/types/dsh-adapter/channel/session-rewind.js`):

1. cancel agent (only from UI-driven flows — a command/tool fork must NOT
   cancel its own caller) → wait `turn/end` → settleCompaction;
2. walk back from the selected row to the enclosing `turn/start`, cut at
   `turnStart.seq - 1`; `boundary < 0` = "cannot rewind to the very first
   message";
3. `childId = SessionId(randomUUID())` (`@deepseek-ai/dsh-session`);
4. `ctx.agents.create({sessionId: childId, seed, inheritedCount:
   seed.length, parentSession: sourceId, setup: async (_ctx, agent) => {
   agent.inbox.clear(); … }})` — never `sessions.fork()`;
5. the pre-rewind session is never mutated; the discarded side is compacted
   on the CHILD after seeding.

## 9. TUI decision events (the interactive picker seam)

- Plugins subscribe with plain `ctx.on('tui/rewind-prompt', listener)` —
  the listener's return value is the decision: `{cancel: true, reason}` or
  `{modes: [{id, label, description}]}` (max 8), sanitized by
  `normalizeRewindPromptDecision` (`T/lib/types/dsh-adapter/channel/decisions.js:31`).
- `tui/rewind-done` fires after the TUI's fork with `{text, mode,
  boundarySeq, sourceSessionId, childSessionId, cwd}`; the first non-empty
  string return becomes the toast.
- Subscriptions are D-7-gated: `tui/rewind-prompt` requires the
  `session.rewind.intercept` grant (default deny); a denied subscription is a
  warned no-op. Grants live in `~/.dsh-tui/extension-grants.json`:
  `{"grants": {"<componentId>": [{"name": "session.rewind.intercept",
  "scope": "decision event subscription"}]}}`
  (`T/lib/types/adapter/standard/grants.js`).

## 10. pnpm `file:` install quirks

- `pnpm add file:<path>` does NOT re-copy changed files ("Already up to
  date"); a refresh is `remove` + `add` (see `scripts/reload-profile.sh`).
- Offline installs: `dsh plugin --profile <p> add --offline file:<path>`
  (registry writes fail EROFS on this machine).

## 11. The dev loop that works

1. `bash scripts/check-contracts.mjs --profile <p>` — catches contract bugs
   before boot (validates tool/skill/seed/inject against the harness's own
   rules).
2. `bash scripts/reload-profile.sh <p>` — refresh the installed copy.
3. Boot via `scripts/test-web-profile.sh` (logs to a file; background-job
   stdout is buffered and hides runtime logs).
4. When the UI misleads: `bash scripts/session-tail.sh <session-id>` — the
   transcript is ground truth (`command/run` vs `command/done` shows hangs,
   `request/header` shows the exposed tool list).
