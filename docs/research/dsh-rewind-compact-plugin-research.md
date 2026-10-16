# Building a "rewind + compact" plugin for DeepSeek Harness (dsh)

Sources: installed CLI `$(npm root -g)/@deepseek-ai/dsh` (v0.1.5-rc.1; ships only `lib/` + READMEs — the `reference/` and `config/examples/` dirs its README links are repo-relative and **not** in the installed package), its 240 bundled `@deepseek-ai/dsh-*` packages under `…/dsh/node_modules/@deepseek-ai/`, and the user profiles at `~/.dsh/profiles/{dsh-tui,web}`.

## 1. Plugin bundle anatomy

A bundle is an npm package whose `package.json` declares `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` (e.g. `dsh-base/package.json`, `@deepseek-harness-tui/dsh-tui/package.json`). The profile manifest lives in `package.json`:

```json
// ~/.dsh/profiles/dsh-tui/package.json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui"], "patchReload": "live" } }
```

`cordis.patch.yml` is a top-level YAML **array of loader patch entries**: `- insert: [{id, name, disabled, config}]` adds rows; `{id, name?, disabled?, config?}` overrides one row by id (`dsh-base/cordis.patch.yml`). Semantics (comment header + `dsh-app-boot/lib/index.js:59` `applyEntryPatches`): a patch **replaces the targeted row's whole `config`** (no merge), unknown ids warn-and-skip, `name` mismatch skips, row order carries no load semantics, `!!js` expressions allowed. Composition order (`dsh/lib/profile-boot-Dk-7KqJc.js:232-256`, `README.md` "Profiles"): bundle patches in `bundles` order → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays → telemetry switch; last write per row id wins. `cordis.yml` is an empty root rewritten every boot. `dsh plugin --profile X <pnpm args>` = pnpm forwarder in the profile dir + reconciliation of `dsh.profile.bundles` against installed deps declaring `dsh.bundle` (`lib/plugin-Ddi42qoW.js:25-128`); in-box bundles resolve from the dsh installation first (README).

## 2. Runtime extension point

Yes — it is **Cordis** (Koishi lineage; `@deepseek-ai/cordis`, `cosmokit`, `schemastery` bundled), with services (`class X extends Service` + `ctx.inject`/`static inject`) and waterfall/broadcast events. Plugins export `{ name, inject, apply }` (e.g. `dsh-command-compact/lib/index.js:8` → `inject = ["commands", "compaction"]`). Config schemas are per-plugin `static Config` (zod in `dsh-compaction-basic/lib/index.js:766-775`).

Core injected services:

- `ctx.sessions` — `dsh-session/lib/index.js:1315` (`super(ctx, "sessions")`): event-sourced session log; `create/get/list/fork/flush`, `session.append(type, data, {surfaceOp})`, `session.deriveMessages()` → `Message[]` (incrementally cached), `session.snapshotEvents/eventAt/seq`.
- `ctx.agents` — `dsh-agent/lib/index.js:299`: registry + `Agent` handle (`followup/steer/inject/cancel/whenIdle`), `Agent.ctx` scoped world.
- `ctx.llm` — `dsh-llm`: `ctx.llm.stream({provider, model, messages})`, adapter registry, `prepareCall()`.
- `ctx.compaction` — `dsh-compaction/lib/index.js:170`: abstract `CompactionEngine` (`compactIfNeeded`, `compactNow`, `compactRegion`).
- `ctx.tokenMeter` (`dsh-token-meter/lib/index.js:613`), `ctx.sessionQuery` (`dsh-session-query/lib/index.js:1040`), `ctx.sessionPersistence`, `ctx.commands`.

History-relevant events: `session/event` firehose (`dsh-session/lib/index.js:1197`), `agent/pre-step`, `agent/request`, `agent/request-error`, `agent/assistant-stream`, `agent/inbox/*` (dsh-agent README; type decls in `dsh-agent/lib/types/runtime-types.d.ts:313+`).

## 3. Existing compact / rewind / checkpoint / truncation

**Compaction — fully implemented.** `dsh-compaction` contract: log-bracketed lock `compaction/start` → `compaction/summary` → `compaction/end` (log-only), surface mutated exactly once by a `user/message` replacement. `dsh-compaction-basic` auto-backend (config `thresholdRatio: 0.8`, `retainRatio: 0.16`, `modelPolicies`), splice at `dsh-compaction-basic/lib/index.js:622`:

```js
session.append("user/message", checkpointMessage, { surfaceOp: { op: "replace", startSeq: start, endSeq: end }, sourceEventSeqs: [...] })
```

`dsh-compaction-tool-result-pruner` (PRUNE_MARKER `lib/index.js:8`), `dsh-command-compact` (`/compact`). **Checkpoint** = crash-durability only: `dsh-session-checkpoint-policy` (flushes before model request / top-level tool / `agent/pre-step`); not user-visible rewind.

**Rewind — no first-party impl.** grep "rewind" in `@deepseek-ai/*` hits only unrelated dist/language files. But the out-of-tree TUI **does implement /rewind**: `@deepseek-harness-tui/dsh-tui@0.14.0`, `lib/types/dsh-adapter/channel/session-rewind.js` — cancel agent → wait `turn/end` → `settleCompaction()` → walk back to enclosing `turn/start` → `sliceLiveSessionSeed(session, boundary)` → `agents.create({sessionId, seed, inheritedCount, parentSession, setup: agent.inbox.clear()})`. Its comment: "Never `sessions.fork()`" (fork registers a real child). Rewind is **fork-and-adopt**, never log mutation. TUI also defines decision events `tui/rewind-prompt`, `tui/compact`, permissions `session.rewind.intercept` / `session.compact.intercept` (`tui-profile/registry/permissions-0.1.json:9,11`, `registry/contracts/decision-events-v1alpha1.json`). `dsh-working-activity/src/compat/session-events.ts:60-62` recognizes compaction checkpoint messages. No "history truncation" beyond compaction shadowing exists.

## 4. Session transcript format

`$DSH_HOME/sessions/<normalized-cwd>/<session-id>/session.v3.jsonl.zstd` (current gen; `session.jsonl`, `.v1.`, `.v2.` historical). `zstd`/`unzstd` (whatever is on `PATH`) work. Layout/durability: `dsh-session-persistence-jsonl/README.md` (one JSON row per event; checksummed zstd frames; "Committed events are never rewritten"; torn-tail recovery). Record shape from `…/<normalized-cwd>/50f2122d-…/session.v3.jsonl.zstd`:

```json
{"type":"session","version":3,"id":"50f2122d-…","createdAt":…,"cwd":"<workspace>","isSeeded":false,"delegationDepth":0,"agentPreset":"standard"}
{"type":"user/message","seq":8,"time":…,"data":{"role":"user","content":[{"type":"text","text":"…"}],"source":{"kind":"user"},"id":"db893e1b-…"},"surfaceOp":"append"}
{"type":"assistant/message","seq":16,"time":…,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"reasoning","text":"…"},…]},"sourceEventSeqs":[…]},"surfaceOp":"append"}
{"type":"tool/call","seq":17,"time":…,"data":{"turn":1,"step":1,"callId":"call_00_…","name":"skill","arguments":"{\"name\":\"grilling\"}"}}
```

Event types seen: `session`, `permission/preset`, `sandbox/mode`, `approval/policy`, `agent/inbox/spliced {target:"next-turn", start, removedCount, inserted:[{id,role,content,source}]}`, `turn/start|end`, `step/start|end`, `system/user/assistant/message`, `tool/call|result`, `request/header`, `request/context`, `subagent/catalog`, `session/title`. `session.lock` (0 bytes) = kernel `flock(2)` lease (`dsh-session-persistence-jsonl/lib/index.js:557-660`); never delete.

`$DSH_HOME/storages/session_projcache/sessions/<id>.json` (from `dsh-session-projection-cache`, flush `writeEveryEvents:200` / `writeIntervalMs:5000`): `{version:7, record:{identity, rows:{…}}}` — per-projection `{ver, seq, val}` for `title`, `titleInput`, `llmRetry`, `sandboxMode`, `goal`, `tokenUsage {totals:{uncachedInputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}, last}`, `contextPressure {surfaceTokens, contextWindow:1000000, pressureTokens, sampledSurfaceTokens}`, `contextBreakdown {nodes:[{seq,heuristicTokens,system}], breakdown:{systemTokens,toolsTokens,messageTokens}}`, `turnBoundary`, `agentPreset`, `subagentCatalog`, `subagentTiming`, `permissions`, `workingActivity`, `inbox {"next-turn":[],"next-step":[]}`, `todos`, `plan`.

## 5. Context assembly and mutation hooks

`dsh-agent-loop/README.md`: each step sends `session.deriveMessages()` (with latest non-empty `system/message` node as effective prompt) + tool schemas; request = `{header.config, deriveMessages(), header.tools}`. A rewind/compact plugin mutates history **before** the request via:

- **`agent/pre-step`** (waterfall): "Reject a proposed step or replace the messages that enter it" — `{agent, messages, turn, step, signal} → PreStepDecision` (`{kind:'reject'}` | `{kind:'enter', messages, startsRequestSeries?}`); example listener `dsh-agent/lib/index.js:160`.
- **Surface replacement**: `session.append(surfaceType, msg, {surfaceOp:{op:'replace', startSeq, endSeq}})` — the exact splice compaction uses.
- **Inbox splice**: `agent.inbox.splice/append/remove/clear` (durable `agent/inbox/spliced`).
- **`ctx.sessions.fork(source, boundary)`** for rewind (prefix must end outside an open turn).

Not available: **no `beforePrompt` hook** (grep: zero hits). `agent/request` waterfall can replace only call config ("this waterfall cannot mutate messages" — `runtime-types.d.ts`); `ctx.llm` freezes requests ("extensions and adapters can read them but cannot rewrite them" — `dsh-llm/README.md`); `llm/stream` can be wrapped (checkpoint policy does) but not rewrite.

## 6. Constraints

- **Bundles are config layers, not libraries** ("this package is not a library you import" — `dsh-base/README.md`); launcher owns argv/flags (`dsh/lib/bin.js:7-16`); plugins get `ctx.cmdlineArgs` only.
- **Transcript is append-only**: "Committed events are never rewritten" (`dsh-session-persistence-jsonl/README.md`); rewind must fork (TUI comment, `session-rewind.js`), compaction only shadows (events stay in raw log; `deriveMessages` renders the surface).
- **Surface is a closed union**: only `system/user/assistant/message` + `tool/result` carry `surfaceOp`; other events "forbid both metadata fields" (`dsh-session/README.md`); replacements need inclusive `SessionSeq` endpoints and tool-pairing-balanced edges (`toolPairingBalancedBefore/After`).
- **`session.lock`** is a kernel lease; deleting it forfeits exclusion (never do).
- **Patch rows**: whole-`config` replacement; wrong id/name silently skipped.
- Rewinding into the first message and crossing open turns are rejected by design.

*Unknowable from installed artifacts: the exact wire payloads of `tui/rewind-prompt` decision envelopes beyond what `tui-profile/registry/contracts/decision-events-v1alpha1.json` declares, and repo-only docs (`reference/`, `docs/`, `.agents/notes/`) cited by READMEs.*
