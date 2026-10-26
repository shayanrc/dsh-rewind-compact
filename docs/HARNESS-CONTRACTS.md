# Harness contracts (verified 2026-10-27 on dsh 0.2.1-rc.2)

The facts this plugin depends on, each verified against the installed artifacts
on 2026-10-27 (Node 26.8.1). Every claim carries a file:line anchor; re-verify
the anchors after any harness upgrade. `npm run check` re-asserts the version
line and the Session / `CreateAgentOptions` / `compactRegion` facts below.

Paths used below:

- `D`: `$(npm root -g)/@deepseek-ai/dsh` — launcher, `0.2.1-rc.2`
- `N`: `D/node_modules/@deepseek-ai` — harness packages, `0.2.1-rc.2`
- `H`: `$DSH_HOME/profiles/node_modules/@deepseek-ai` — profiles-level hoist,
  `0.2.1-rc.2` (where profile plugins resolve harness peers)
- `T`: `$DSH_HOME/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui`
  — TUI, `0.17.0`

## 0. Supported line and version gate

- Declared line: `engines.dsh = ">=0.2.1-rc.2 <0.3.0-0"` in `package.json`; the
  `@deepseek-ai/dsh-*` peer ranges mirror it. Running version: `0.2.1-rc.2`.
- The gate reads the runtime version from app-boot's own `package.json`
  (`H/dsh-app-boot/lib/index.js:271-275`) and evaluates `engines.dsh` **alone**
  when present — peer ranges are then ignored for the gate
  (`H/dsh-app-boot/lib/index.js:279-320`). Ranges use
  `semver.satisfies(runtime, range, {includePrerelease: true})`
  (`H/dsh-app-boot/lib/index.js:276-277`), so `0.2.1-rc.2` participates. The
  upper bound is `<0.3.0-0`, not `<0.3.0`: under prerelease semantics the
  latter admits `0.3.0-rc.x`, which is outside the verified line.
- Compatibility matrix:

| Harness line | Supported | Notes |
|---|---|---|
| `0.1.x`, `0.2.0-rc.x` | no | dropped from peers; contracts below were re-verified on 0.2.1 |
| `0.2.1-rc.2` | **yes, verified** | the installed line this document anchors |
| later `0.2.x` | allowed by the range, untested | run `npm run check` before claiming support |
| `>=0.3.0-0` (incl. `0.3.0-rc.x`) | no | Session format, agent, and decision seams may move |

## 1. Bundle anatomy

- A bundle's manifest declares `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`;
  `patch` is one file **or an ordered list** of files
  (`H/dsh-app-boot/lib/index.js:490-495,517-520`).
- The tree is composed by applying each bundle's patch lists in
  `dsh.profile.bundles` order over an empty entry list, then the profile's
  `cordis.patch.yml`, then the home layer and `--patch` overlays
  (`H/dsh-app-boot/lib/index.js:1053,1112,3207`). A patch replaces the targeted
  row's whole config — never a deep merge (`H/dsh-app-boot/lib/index.js:3044`).
- `dsh plugin --profile <p> <pnpm args>` forwards to pnpm in the profile dir
  (`D/lib/bin.js:117-120`); after a successful operation DSH reconciles
  `dsh.profile.bundles` and activates new bundle dependencies automatically
  (`H/dsh-app-boot/lib/index.js:1202-1221`).
- The profile's user patch layer is hot-reloaded on long-lived surfaces
  (`H/dsh-app-boot/lib/index.js:508`), but package contents and loaded modules
  are **not** reloaded (`H/dsh-app-boot/lib/index.js:3530`): restart the profile
  process after changing bundle code.

## 2. Plugin shape (Cordis)

- Entry modules export `{name, inject, apply}`; `apply(ctx)` registers through
  `ctx.effect(function* () { yield disposer; ... })`.
- **`ctx.<service>` throws on any property not declared in `inject`** —
  optional chaining cannot guard it. Probe optional services with
  `ctx.get('name')` inside try/catch (this plugin does so in `lib/events.js`).
- Harness packages resolve from the profiles-level hoist (`H`): declare them as
  `peerDependencies` (pattern: `T/package.json`).

## 3. Tool contract (`ctx.tools.register(defineTool({...}))`)

- `defineTool` from `@deepseek-ai/dsh-tools` (`H/dsh-tools/lib/types/schema.d.ts:248`;
  compiles `output.schema` at `H/dsh-tools/lib/index.js:792,838`).
- `parameters` is a **per-property map** `{name: {type, required?, description?,
  enum?}}`, not JSON Schema. `output.schema` is raw JSON Schema in the harness's
  enforced subset: `required: true` rides inside each property, objects close
  `additionalProperties: false`, unions use `oneOf`, null is `{type: 'null'}`.
  Schemastery is not accepted there (the `dsh-tool-goal` dialect: `N/dsh-tool-goal/lib/index.js:264-300`).
- `output.render(args, value) => [{type: 'text', text}]`; `presentCall` returns
  `{card, title, kind, rawInput}`. `execute(args, exec)` reaches the caller via
  `exec.agent` → `agent.session`.
- `register(definition)` is `H/dsh-tools/lib/types/index.d.ts:637`. Typed errors:
  `new HarnessError(message, code)` from `@deepseek-ai/dsh-llm`.

## 4. Command contract (`ctx.commands.register({...})`)

- Registration is `{name (lowercase, no slash), description, handler, input?,
  recordInput?, definitionId?}` (`H/dsh-commands/lib/types/index.d.ts:38-55,94`).
- `handler(invocation)` receives `{commandId, agent, rawInput, attachments,
  signal}` (`H/dsh-commands/lib/types/index.d.ts:19-37`) — no `signal`-less
  shape and no `sourceEventSeq` input. It returns
  `{kind: 'success'|'error', text, sourceEventSeq?}`
  (`H/dsh-commands/lib/types/types.d.ts:34-40`).
- Interactive prompts: `ctx.userQuestions.ask({questions: [{id, question,
  header?, options: [{label, description}], multiSelect?}], agent, signal})`
  → `{answers: [{id, selected: string[], custom?}]}`.

## 5. Skill contract (`ctx.skills.register(skill)`)

- Registration accepts `{name (SkillName-valid), description, content,
  source, invocation?: {modelInvocable, userInvocable}, provider?, path?,
  whenToUse?, resourceBase?}` (`H/dsh-skill/lib/types/index.d.ts:78-88`), and
  omitting `provider`/`invocation` is allowed (`register` at `:193-215`, where
  the defaults are applied; `:257` is inside `get()`).
- The load-time validator (`validateDefinition`, not exported,
  `H/dsh-skill/lib/index.js:471-489`) requires `source`, `provider`, AND
  `content` to be strings. A `path` alone fails with `loaded skill "…" source
  must be a string`; ship the SKILL.md body inline as `content` (this bundle
  does, and also passes `path` as display metadata).

## 6. Compaction contract

**v1 scope:** this bundle calls neither `compactRegion` nor `compactNow`; every
surface ships the five-field scaffold alone (hybrid prose is a post-v1 target,
RWC-015 D2/D3). The facts below are the **future/hybrid seam**, kept so a v2
design can be checked without re-deriving them — they are not current behavior.

- `ctx.compaction.compactRegion(start, end, agent, signal?)` — exactly four
  parameters, no instructions argument
  (`H/dsh-compaction/lib/types/index.d.ts:141-158`).
- `start` and `end` are **inclusive surface-node seqs** (not numeric seq order):
  both must name existing surface nodes, `startIdx <= endIdx`, no compaction
  may already be active, and the session must have an open turn (the events are
  enclosed in it) (`H/dsh-compaction-basic/lib/index.js:450-462,549-563`).
  Both edges must be tool-pairing-balanced — no split call/result pair and no
  open step (`H/dsh-compaction/lib/index.js:80,91`; errors at
  `H/dsh-compaction-basic/lib/index.js:557-558`).
- The summarizer receives the selected span, appends its own instruction, and
  replaces the span with a user message carrying
  `source.kind = 'compact-checkpoint'`
  (`H/dsh-compaction-basic/lib/index.js:292-344,582-627`;
  `compactCheckpointSource` at `H/dsh-compaction/lib/index.js:109-121`).
  If a hybrid summary is implemented later, deliver custom facts **inside the
  compacted range** as its final message so they survive into the prose; v1
  makes no such call.
- `compactNow(agent, signal, sourceCommandId?)` is the idle-session variant: it
  requires no open turn (busy otherwise) and flushes persistence
  (`H/dsh-compaction-basic/lib/index.js:985-1011`). It takes no range, so it
  cannot compact only the discarded side — it is not a substitute for
  `compactRegion`.
- The web template profile has no compaction bundle; v1 already ships
  scaffold-only summaries, so the plugin must load and behave with the service
  absent (probe it through `ctx.get()`, never inject it).

## 7. Session/transcript contract

- Current format is **v4** (`SESSION_FORMAT_VERSION = 4`,
  `H/dsh-session/lib/index.js:56`; header validation
  `:1040-1064`; prepared header `:1819-1827`). The filename is
  `session.v4.jsonl.zstd` (`H/dsh-session-format/lib/index.js:470-479`,
  `H/dsh-session-persistence-jsonl/lib/index.js:767`).
- Installed logs **can be multi-frame zstd** (observed): a live session grew by
  appending frames, so Node's `zlib.zstdDecompressSync` returned only the first
  one. Read them with `unzstd -c -f` or a streaming decoder — a probe gotcha,
  not a harness contract.
- Surface event types: `system/message`, **`developer/message`**,
  `user/message`, `assistant/message`, `tool/result`
  (`H/dsh-session/lib/types/types.d.ts:443`). `developer/message` carries
  `{turn, step, message: DeveloperMessage, headerSeq?}` (`:297-304`, role at
  `H/dsh-llm/lib/types/message.d.ts:141`). `tool/result` messages have
  **`role: 'tool'`** and `source: {kind: 'tool', callId}` plus a matching
  `toolCallId` (`H/dsh-llm/lib/types/message.d.ts:152-158`;
  `H/dsh-session/lib/index.js:1183-1194`).
- Message sources are a merge-extensible map: `user`, `model`, `tool`,
  `system-prompt` (`H/dsh-llm/lib/types/message.d.ts:96-108`). There is **no
  shared catch-all `plugin` kind**; producers declare their own `kind` by
  module augmentation (compaction adds `compact-checkpoint`,
  `H/dsh-compaction/lib/types/index.d.ts:19-22`; live transcripts also show
  `agent-instructions`, `runtime-context`, `skill-catalog`, `time-context`).
  The validator only requires a non-empty string `kind` on a user message
  (`H/dsh-session/lib/index.js:1205`), so unknown user kinds load; consumers
  fall through. (Legacy v3 transcripts used `{kind: 'plugin', plugin}`; that
  wrapper is not current on 0.2.1 and is not used here — `summaryMessage()`
  declares `kind: 'rewind-compact'` via `lib/message-source.d.ts`.)
- Surface markers: only the five surface types carry `surfaceOp` — `'append'`
  or `{op: 'replace', startSeq, endSeq}` naming an existing span of the current
  surface (`H/dsh-session/lib/types/types.d.ts:443-466`); a replacement must
  also list every shadowed surface node in `sourceEventSeqs`
  (`H/dsh-session/lib/index.js:313-331,446-455`). The child surface is folded
  from the seed by replaying these markers (`:425-469`), so a seed that keeps
  them reproduces the source's current surface.
- Fork seeds: the TUI cuts by passing a raw prefix of the source log through
  the boundary — `sliceLiveSessionSeed` returns
  `events.slice(0, boundary + 1)` with seqs unchanged
  (`T/lib/types/dsh-adapter/compat/liveSession.js:119-145`) — so each event's
  envelope, including a replacement `surfaceOp` and its `sourceEventSeqs`,
  travels into the child. A hand-built or renumbered seed must remap
  `surfaceOp.startSeq`/`endSeq` and `sourceEventSeqs` onto the child seqs
  (optional source provenance on append records may instead be dropped) and
  must **not** flatten a kept replacement to `append`: replaying it as an
  append resurrects the shadowed originals in the child surface (the RWC-003
  shadowing bug). `lib/seed.js` follows that split: after mode copies the kept
  prefix verbatim, so seqs and replacement markers are unchanged; before mode
  keeps the folded current-surface tail plus the latest discarded-prefix policy
  facts, renumbers from 0, and re-emits the kept surface nodes as `append`
  without their `sourceEventSeqs` — correct, because a folded node is already
  the current surface, not a replacement. The harness's own seed validator is
  `H/dsh-session/lib/index.js:1113-1142,1194-1225` and seq contiguity is
  enforced at `:1405-1406`.
- `session.lock` is a kernel flock lease; never delete.

## 8. Fork recipe (rewind)

The TUI's own recipe (`T/lib/types/dsh-adapter/channel/session-rewind.js`):

1. cancel the agent (UI-driven flows only — a command/tool fork must NOT cancel
   its own caller) → wait `turn/end` → `settleCompaction` (`:34-42`);
2. walk back from the picked row to the enclosing `turn/start`, cut at
   `turnStart.seq - 1`; `boundary < 0` means "cannot rewind to the very first
   message" (`:44-62`);
3. `childId = SessionId(randomUUID())` (`@deepseek-ai/dsh-session`);
4. `agents.create({sessionId, seed, meta: {cwd, parentSession,
   isSeeded: true, agentPreset?}, inheritedEventCount: seed.length,
   agentOptions, setup})` — never `sessions.fork()`; the TUI maps its request
   through `liveSessionCreateOptions` (`:88-102`,
   `T/lib/types/dsh-adapter/compat/liveSession.js:157-165,206-223`);
5. `setup` composes before publication and clears the child inbox
   (`session-rewind.js:98-101`); the pre-rewind session is never mutated —
   the discarded side stays resumable. The TUI recipe **stops after seeding**:
   it does not compact the child. This bundle's fork paths also stop at the
   scaffold: every surface ships a **scaffold-only five-field summary** and
   returns `hybrid: false`; child-side compaction is a post-v1 target
   (RWC-015 D3), because a forked child has no open turn and `compactRegion`
   requires one (§6).

Create metadata (`meta`, `inheritedEventCount`) and the best-effort
`session/title` event are covered in §9; no create-time `title` option is sent.

## 9. `CreateAgentOptions` (0.2.1)

`H/dsh-agent/lib/types/index.d.ts:48-104`; the factory consumes exactly
`sessionId`, `seed`, `meta`, `inheritedEventCount`, `agentOptions`, `setup`,
`signal`, `parentAgent` (`H/dsh-agent-loop/lib/index.js:1894-1897` for the
session creation fields, `:1909` for `agentOptions`/`setup`/`signal`/`parentAgent`):

- `sessionId` — caller-supplied live identity (`:50`);
- `meta` — validated session metadata: `cwd?`, `parentSession?`, `isSeeded?`,
  `origin? ('subagent')`, `delegationDepth?`, `agentPreset?` (`:60-71`);
- `inheritedEventCount?` — exact fork-inherited prefix length, required when
  `meta.isSeeded` is true (`:73`; session constructor
  `H/dsh-session/lib/index.js:1416-1423`);
- `seed?` — events contiguous from seq 0, lossless JSON, validated and frozen
  before publication (`:80`);
- `setup?` — runs after minting `agentCtx` but BEFORE publication, so observers
  never see a half-configured world (`:92-103`).

The old `inheritedCount` / top-level `parentSession` / top-level `cwd` aliases
are **not** in the 0.2.1 options and are ignored by the factory. The title is
not an option either: 0.2.1 folds it from log-only `session/title` events
(`H/dsh-session-title/lib/index.js:177,188-195`). This bundle appends
`{title: '<source title> (rewound)', messageSeqs: [], source: {kind: 'user'}}`
— the explicit-rename payload at
`H/dsh-session-title/lib/index.js:295-306` — inside `setup`, before
publication, best-effort: an untitled source appends nothing and a failed
append never aborts the fork (RWC-015 D7).

## 10. TUI decision events (the interactive picker seam)

- Plugins subscribe with plain `ctx.on('tui/rewind-prompt', listener)`; the
  return value is the decision: `{cancel: true, reason}` or
  `{modes: [{id, label, description}]}` (max 8), sanitized by
  `normalizeRewindPromptDecision`
  (`T/lib/types/dsh-adapter/channel/decisions.js:37-75`).
- The prompt fires **before** the fork with `{text, seq, sessionId, cwd}`;
  `seq` is the picked **message** event seq, not the fork boundary
  (`T/lib/types/dsh-adapter/channel/session-actions.js:9-17`;
  `T/lib/types/dsh-adapter/extension-events.d.ts:106-112`). This bundle
  answers with its after mode only (RWC-015 D5); it maps `seq` to the enclosing
  completed turn first, and a row in the still-open turn is ineligible.
- `tui/rewind-done` fires after the TUI's own fork with `{text, mode,
  boundarySeq, sourceSessionId, childSessionId, sessionId, cwd}`;
  `boundarySeq` is the **inclusive source cut** the child seed ends at
  (`turnStart.seq - 1`), and the first non-empty string return becomes the toast
  (`session-rewind.js:136-147`;
  `T/lib/types/dsh-adapter/extension-events.d.ts:130-144`;
  `normalizeRewindDoneSummary` at `decisions.js:81-91`).
- Subscriptions are D-7-gated on `session.rewind.intercept` (default deny), via
  `T/lib/types/adapter/spec/protocol-constants.js:83`. Grants live in
  `~/.dsh-tui/extension-grants.json` as
  `{"grants": {"<componentId>": [{"name": "session.rewind.intercept",
  "scope": "decision event subscription"}]}}`.

## 11. pnpm `file:` install quirks

- Offline install: `dsh plugin --profile <p> add --offline "file:$PWD"`.
  Registry writes fail EROFS on this machine.
- `pnpm add file:<path>` does NOT re-copy changed files ("Already up to date");
  refresh with `remove` + `add` (see `scripts/reload-profile.sh`).
- The probe imports `lib/` from this checkout, so a profile refresh is **not**
  needed for contract checks — only for booting the profile.

## 12. The dev loop that works

1. `npm run check` / `node scripts/check-contracts.mjs --profile <p>` — version
   gate + contract probe (imports worktree code, newest v4 fixture).
2. `bash scripts/reload-profile.sh <p>` — refresh the installed copy before a
   boot.
3. Boot via `scripts/test-web-profile.sh` (logs to a file; background-job stdout
   is buffered and hides runtime logs).
4. When the UI misleads: `bash scripts/session-tail.sh <session-id>` — the
   transcript is ground truth (`command/run` vs `command/done` shows hangs,
   `request/header` shows the exposed tool list).
