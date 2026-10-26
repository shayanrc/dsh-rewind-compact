# DSH plugin architecture — reading notes

Source: <https://deepseek-harness.github.io/deepseek-harness/develop/basic/> (English mirror),
crawled 2026-10-27. Scope crawled: `develop/basic/*` (4 pages), `develop/framework/*` (3),
`develop/practice/*` (3 + tutorial chapter 6), plus `reference/` (architecture overview,
Cordis primer, capability seams) and `reference/cookbook/adding-a-tool`.

These are notes on the **public docs**, not on our installed harness. Repo-specific
facts (line anchors, quirks) live in `docs/HARNESS-CONTRACTS.md`; where the two
disagree, the installed artifact wins.

---

## 0. The one-paragraph mental model

DSH is a Cordis plugin tree. There is **no privileged core to patch**: the model adapter,
tool registry, session log, and agent loop are all plugins, each replaceable from config.
A plugin contributes services, typed events, and reversible effects to a shared `ctx`.
Registrations are **effects** that unwind automatically on unload, so composition is
reversible and hot-swappable. What you run is a **profile**: an ordered stack of
**bundles** (config layers) applied to an empty row list, then the user's patches.

---

## 1. Plugin anatomy

A plugin is a module exporting `apply(ctx, config?)`:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['tools']          // required services; loader waits for them

export function apply(ctx: Context) {
  // register capabilities here
}
```

Three accepted forms (function is the default choice):

| Form | Shape | When |
|---|---|---|
| Function | `export function apply(ctx, config)` + `name`/`inject` | Almost everything |
| Object | `export default { name, inject, apply(ctx) {} }` | Grouping metadata |
| Class | `class X extends Service { static inject = [...]; constructor(ctx) { super(ctx, 'x') } }` | When the plugin **provides** a service |

- `inject` is the *only* load-ordering mechanism. No manual boot sequencing.
- A plugin that provides a service is mounted as a class extending `Service`; the service
  name passed to `super(ctx, 'name')` becomes `ctx.name` for consumers.
- Optional dependencies: omit `inject`, query at the use site with `ctx.get('name')`.
  (Local harness note: `ctx.<service>` *throws* if not declared in `inject`, so optional
  probing must go through `ctx.get`.)

### 1.1 Everything registered through `ctx` is an effect

Automatically disposed on unload:

- `ctx.on(event, handler)` — listener
- `ctx.tools.register(tool)` — tool
- `ctx.llm.registerAdapter(names, adapter)` — LLM adapter
- `ctx.effect(() => cleanup)` — arbitrary resource

No manual `removeListener` / `clearInterval`. `ctx.effect()` returns a disposer that runs
on unload. **Disposal order:** disposers start in reverse registration order, but multiple
async disposers run concurrently with no serial completion guarantee. If teardown order
matters, put the whole sequence in **one** `ctx.effect()` and await the steps serially there.

---

## 2. Lifecycle (Fiber state machine)

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED
ACTIVE → UNLOADING → DISPOSED
```

| State | Meaning |
|---|---|
| PENDING | Declared, but required (`inject`) services not ready |
| LOADING | Dependencies ready, `apply` running |
| ACTIVE | Running |
| FAILED | `apply` threw |
| UNLOADING | Disposing resources |
| DISPOSED | Fully unloaded |

Key consequences:

- **Dependency-driven loading.** If a required service disappears (provider replaced or
  unloaded), dependents auto-dispose (ACTIVE → DISPOSED) and **reload when it returns**.
  This prevents calls into a dead service.
- **PENDING is silent.** A typo'd/unsatisfiable `inject` waits forever with no error —
  legitimate, because the provider may mount later. To diagnose, enumerate
  `ctx.registry.values()` → `runtime.fibers` and look for `FiberState.PENDING`. This is
  the first thing to check when "my plugin does nothing".
- **Nested contexts.** `ctx.plugin(child)` creates a child Fiber with an independent
  lifecycle that unloads with its parent.
- **Manual dispose.** `const fiber = ctx.plugin(p); await fiber.dispose()` — disposes
  registrations, recursively unloads children, resolves after async cleanup finishes.
- **HMR.** With `@deepseek-ai/dsh-hmr`, editing a source file (or the config) unloads the
  old instance, loads the new code, runs `apply` again. Existing registrations from the
  old instance do not linger because they are effects. `apply` runs on every reload, so
  keep it cheap and idempotent.
- Row `id` stability matters for HMR/config diffing: an entry **without** an `id` gets a
  generated id each read, so any config edit remounts it (remove+add) even if unchanged.
  Give every row an `id`.

---

## 3. Services

A service = a named capability mounted on `ctx` (`ctx.tools`, `ctx.llm`, `ctx.agents`, …).
Consumers find services **by key**, never by importing a concrete implementation.

### Consume

```ts
export const inject = ['tools']
export function apply(ctx: Context) { ctx.tools.register(/* ... */) }
```

### Provide

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context { metrics: MetricsService }
}

export default class MetricsService extends Service {
  static inject = ['llm']              // services may depend on services
  constructor(ctx: Context) { super(ctx, 'metrics') }
  record(event: string, value: number) { /* ... */ }
}
```

Declaration merging (`declare module '@deepseek-ai/cordis' { interface Context { ... } }`)
is how a service gets a typed `ctx.key`.

### Isolation

`cordis.yml` groups can `isolate` a service name, so two plugin groups each see their own
instance of the same service (e.g. two `shell` backends with different timeouts) without
cross-group effects:

```yaml
- id: group-a
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate: { shell: true }
  config: [ ... ]
```

### Built-in service names

Do **not** maintain a static list: the docs generate service names, public methods, and
source locations into the subsystem pages (`reference/subsystems/*`), and the generated
`cordis-surface` regions are authoritative. Core keys seen in the architecture page:

`ctx.sessions`, `ctx.systemPrompt`, `ctx.tools`, `ctx.agents`, `ctx.agentLoop`,
`ctx.llm`, `ctx.shell`, `ctx.fs`, `ctx.jobs`, `ctx.commands`, `ctx.goals`,
`ctx.userQuestions`, `ctx.sandbox`, `ctx.planMode`, `ctx.agentPresets`,
`ctx.sessionProjections`, `ctx.sessionTitle`, `ctx.sessionPersistence`,
`ctx.storage`, `ctx.credentials`, `ctx.settings`, `ctx.hmr`, `ctx.pluginManager`.

---

## 4. Events (the extension points)

Listen/emit:

```ts
ctx.on('event-name', handler)
ctx.emit('event-name', payload)
```

### 4.1 Dispatch modes (part of the public contract)

| Mode | Awaited? | Order | Return value? |
|---|---|---|---|
| `emit` | No | registration order, observe | No |
| `waterfall` | No* | registration order, each wraps downstream | Yes |
| `parallel` | Yes | all listeners concurrently | No |
| `serial` | Yes | registration order, stops at first real result | Yes |
| `bail` | No | registration order, stops at first real result | Yes |

\* Dispatch is still awaitable (`await ctx.waterfall(...)`); await the call when listeners
are async. Treat the table as the documented contract and the event's `@mode` tag as law.

- `bail`: first result that is **not** `null`/`false`/`undefined` wins; return one of those
  to pass.
- `serial`: async results awaited; first real result stops later listeners.
- `waterfall`: around-middleware. A listener receives `(...args, next)` and **must call
  `next()`** to delegate; omitting it deliberately short-circuits (gateway/interception).
  Cooperative listeners mutate a shared decision/request object then delegate; wrapping
  listeners must preserve fields they don't intend to change
  (`{ ...decision, messages }`).
- `prepend: true` only when a listener must run before ordinary registrations.

### 4.2 Typed events

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}
```

### 4.3 Two different "events" — do not conflate

- **Cordis events** use `namespace/action` names: `agent/pre-step`, `agent/request`,
  `agent/request-error`, `tools/result`, `session/event`, `llm/stream`, `tools/pre-execute`,
  `tools/execute`, `tools/post-execute`, `fs/*`, `telemetry/*`.
- **Durable session-event types** are *not* Cordis events: `turn/start|end`,
  `step/start|end`, `tool/call`, `tool/result`, `compaction/*`, `user/message`,
  `assistant/message`, `assistant/attempt`, `system/message`.
  To observe them, listen to **`session/event`** and inspect `event.type`.

- `ctx.on()` listeners are effects (auto-removed on unload).
- Architecture page names three event domains: **session events** (durable facts in the
  log, broadcast via `session/event`), **agent events** (`agent/*`, live `Agent`; inbox,
  step, status, request, validation, continuation), **capability events** (`fs/*`,
  `tools/*`, `telemetry/*`) that attach policy/adapters to a seam without importing the loop.

---

## 5. Configuration

Export an `interface Config` **and** a same-named Schemastery `Schema`; Cordis validates at
load and fills defaults; the validated object is `apply`'s second argument.

```ts
import Schema from '@deepseek-ai/schemastery'

export interface Config { greeting: string; maxRetries: number; verbose?: boolean }

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) { /* config is typed + validated */ }
```

Rules:

- **Do not export a plain object as `Config`** — it must implement the Standard Schema
  interface Cordis expects.
- **No hardcoded tunables.** The test: "can `cordis.yml` change this value without a code
  edit?" If two deployments might differ, it is a config field.
- **Fail loudly**: express self-contained constraints in the schema
  (`.required()`, `union`, …) so invalid config fails the load with an actionable error.
  Cross-service/resource constraints belong in dependency injection checks, not the schema.
- **HMR**: editing config hot-replaces the plugin (unload old → load new); effects prevent
  stale registrations.

---

## 6. Tools (model-facing capability)

`defineTool` from `@deepseek-ai/dsh-tools`; register through `ctx.tools`.

```ts
ctx.tools.register(defineTool({
  name: 'greet',
  description: 'Greet someone by name.',        // what the model sees
  parameters: {
    name: { type: 'string', required: true, description: 'The name to greet' },
    limit: { type: 'number' },                   // optional by default
  },
  output: {
    schema: { type: 'string' },                  // canonical value shape
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    return `Hello, ${args.name}!`
  },
}))
```

### 6.1 Contracts and rules

- **`parameters` is a per-property map**, not JSON Schema: `{name: {type, required?,
  description?, enum?}}`. `defineTool` infers `args` from it.
- **`output.schema` is a raw JSON-Schema value spec** (object/array/scalar/null root).
  Schemastery is not accepted here.
- **Return one canonical JSON value** from `execute`; return *only* the inferred value
  (never content blocks). The registry snapshots it as lossless JSON, validates it,
  freezes it, and passes it to `output.render(args, value)` for model-facing content.
- **Args are validated before `execute`** (types, required keys, literal constraints,
  exact-one unions, nested values). You still hand-check non-empty strings, positive
  numbers, cross-field rules.
- **Identity is protected.** The registry materializes `arguments` as detached lossless
  JSON in one recursive pass, freezes it before policy, and assigns an opaque `exec.token`.
  `callId`, `name`, `arguments`, `agent`, `token`, required `signal`, optional `parent`
  stay immutable through dispatch. Treat `args` as readonly. Only an around-dispatch
  wrapper may replace/restore `exec.signal` (to impose a deadline), never remove it.
- **Throwing or returning an invalid value ⇒ `isError`.** Throw for infrastructure
  failures; represent successful-but-unideal domain outcomes in the canonical value
  (e.g. non-zero exit code) and explain them in the renderer.
- **Honor `exec.signal`** (cancel in-flight work).
- Registration **borrows** your readonly definition: don't mutate schema/callbacks after
  registration. To hot-swap, dispose the owning effect and register a replacement.
- Schemas flow into **system-prompt assembly** automatically; a registered tool is
  model-visible through the prompt.
- **PTC mode** exposes every visible tool as `await tools.<name>(args)` for free, with
  derived exact arg/return types; calls re-enter the normal pipeline and resolve to the
  canonical value (not rendered content). Failed calls reject with the real
  `ToolCallError` (only `name`, `toolName`, `message` are inspectable).
- **`presentationMeta(args, value)`** (optional) derives replayable JSON card facts from
  the canonical value; the core persists it on `tool/result` for `presentResult`.
- **`exec.agent.inject({ content, source: { kind: 'my-plugin' } })`** appends durable
  context the **next** model request sees — it is **not** a wake-up (an idle agent stays
  idle). Declare the source `kind` in `MessageSourceMap`; session format V4 rejects the
  retired `{ kind: 'plugin', plugin: '<name>' }` wrapper.

### 6.2 Long-running work

Gate `run_in_background` with producer config, then `ctx.jobs.start({ kind, label,
owner: exec.agent, run })`. The runtime supplies the id, session fence, generic control
tools, notices, and owner cleanup. A successful background branch returns a typed
canonical handle (`{ kind: 'background', jobId }`); prose like "started job bash-1" may
appear in the Native renderer but PTC must never parse it. Once `ctx.jobs.start()`
publishes an id, use a **task-owned cancellation signal**, not `exec.signal`: later
outer-call cancellation stops waiting for the call but does not kill published work;
`job_kill`, owner disposal, and service teardown own that lifetime.

### 6.3 Policy / observation hooks (prefer these over building policy into the tool)

| Hook | Use |
|---|---|
| `tools/pre-execute` | extensible allow/deny/ask policy |
| `ctx.tools.guard()` | final monotonic deny that later listeners cannot undo |
| `tools/execute` | wrap dispatch (deadline, retry, metrics) |
| `tools/post-execute` | replace presentation content/value, block result, attach context |
| `tools/result` | observe the immutable normalized outcome |

Content replacement leaves programmatic access to `value` intact; confidentiality policy
blocks/replaces the value. A sandboxing implementation can also live inside the executor.

### 6.4 UI cards (separate from model rendering)

`output.render` → model-facing content. **UI card** is a separate pure projection:

- `presentCall(args)` → `{ card: 'generic' | 'terminal' | 'diff', ... }` (pending card)
- `presentResult(args, { content, isError, meta })` → completed card
  (`generic`, `terminal`, `diff`, `read`, `search`, `web`)

Hard rules:

- **Purity**: these run on live streaming *and* session replay — no I/O, no session state,
  no clock/random. Derive display from `args` (+ result). Want file contents or cwd? That
  belongs in durable `result.meta` or the UI adapter, not the presenter.
- **UI-only formatting stays out of the canonical value / model content.** A fenced
  console block, diff, or relativized path serves the UI, not the model.
- `defineTool` soft-validates the display path: malformed/old logged args → generic
  fallback, never a crash on replay.
- The built-in **Web Client does not consume `presentCall`/`presentResult`**; it reads raw
  `tool/call`/`tool/result` events and a Client plugin registers its wire tool name in the
  `tool.call.toolview` keyed slot. Defining Host presenters alone adds no Web card.

---

## 7. Bundles, profiles, and patch layering (distribution)

Two concepts, two manifests, both under the `dsh` key of a `package.json`:

| Concept | Manifest | Question it answers |
|---|---|---|
| **Bundle** | `dsh.bundle.patch` | "What does this package contribute?" — a patch file inserting/overriding rows |
| **Profile** | `dsh.profile.bundles` | "Which bundles compose this setup, in what order?" |

A bundle is what you author/distribute; a profile is what a user boots
(`dsh --profile <name>`). Nothing is both.

### 7.1 Bundle layout

```
hello-plugin/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # applied when a profile lists this bundle
└── index.js           # modules the patch rows reference
```

```json
{
  "name": "dsh-hello-plugin",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "engines": { "dsh": ">=0.2.0 <0.3.0" }
}
```

- Patch rows reference the **package name** (`dsh-hello-plugin`), not a relative source
  path, so Node resolution finds the installed code. (Local `--patch` overlays may use
  absolute/relative source paths.)
- `patch` may be an **ordered list** of files; each file's relative plugin paths resolve
  beside that file.
- A package **without** `dsh.bundle` still installs but only as a plain dependency —
  `dsh plugin` warns and activates no layer. Use that for libraries imported by plugins.
- `engines.dsh` (or `@deepseek-ai/dsh*` peer ranges) gates install and profile startup:
  an unsatisfied range refuses the bundle.

### 7.2 Profile layout

`$DSH_HOME/profiles/<name>/`:

- `package.json` — pnpm-managed out-of-tree deps + `dsh.profile.bundles` (ordered).
- `cordis.patch.yml` — the user's own layer, applied after every bundle layer.

Never hand-write a profile manifest: `dsh --profile <name> --from-default-profile
<template>` creates/resets one; `dsh plugin` creates a base-backed profile and maintains
the bundle list.

### 7.3 Install

```sh
dsh plugin --profile demo add ./hello-plugin   # forwards to pnpm in the profile dir
dsh --profile demo --dump-config               # shows "# == dsh-hello-plugin" layer
dsh --profile demo
dsh plugin --profile demo remove dsh-hello-plugin
```

`dsh plugin` auto-appends any added dependency that declares `dsh.bundle` to
`dsh.profile.bundles`. First use initializes the profile with `@deepseek-ai/dsh-base` as
its first bundle.

**Linked checkout resolution (important for local bundles):**
- A linked checkout keeps its own `node_modules`.
- Declare dsh packages whose *instances must be shared with the host* under **both**
  `peerDependencies` and `devDependencies` (peers serve runtime resolution, dev deps serve
  the type checker/tests). Keep independently-versioned third-party deps and stateless
  dsh utilities in `dependencies`.
- Ordinary linked imports follow Node's ancestor order and peer declarations; a nearer
  physical package wins. `require.resolve(..., {paths})` is always native.
- Links inside the profile (including its pnpm store) are profile-owned, not external.
- These rules don't invalidate loaded modules or validate peer version ranges.

**Git install catch:** a git install fetches **sources, not built artifacts**. No `build`
script runs. The author must ship a `prepare` script (self-contained; pnpm runs it after a
git install) and the user must allowlist the build (pnpm ≥10) in the profile's
`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-hello-plugin: true
```

That allowance is permission to execute package code at install time, outside any sandbox —
pin a commit (`github:you/plugin#<sha>`) and only allow trusted sources. Alternatives that
need no permission: publish to npm with built `lib/`, or ship a `pnpm pack` tarball.

### 7.4 Loading order (effective config)

Applied to an **empty** root, in order:

1. Each bundle patch in `dsh.profile.bundles` order (`@deepseek-ai/dsh-base` first, then
   installed bundles in the order added).
2. The profile's own `cordis.patch.yml`.
3. `$DSH_HOME/cordis.patch.yml` (machine-local, shared by every profile).
4. Each `--patch <path>` overlay, in argv order.

Later layers win **per row**, and **a patch replaces the row's entire `config` — no deep
merge**. So an override must restate every key the row needs. Consequence for bundle
authors: prefer defaults users keep; let the schema carry the rest; users can override
your rows in their profile patch without touching your package.

`preset` patches apply the same insert/override operations inside a declaration's
`config.plugins`, with the same precedence.

In-box bundle names resolve from the dsh installation itself; pnpm only manages
out-of-tree packages.

### 7.5 Surface bundles and command lines

A bundle defining a runnable app mounts an ordinary provider plugin:

```yaml
- id: hello-startup
  name: 'dsh-hello-plugin/startup'
```

The provider exports `inject = ['cmdlineArgs']`, calls `parseCmdline` from
`@deepseek-ai/dsh-cmdline` with its own commander program, and provides its app-owned
service from the program's action. The launcher hands every plugin the same immutable
argv snapshot after launcher flags, so app flags need no launcher change and multiple
plugins may parse it. Rows configured by those args inject the service and read it in
`!!js` config with the deployment value as fallback:

```yaml
- id: my-app
  name: '@example/my-app'
  inject: [myAppStartup]
  config:
    port: !!js ctx.myAppStartup.port ?? 8080
```

On `--help` the provider publishes no service, so those rows never activate. Loader
mounts once, waits for ordinary injections, then evaluates each row's `!!js` against its
injected context.

Argument parsing is not a patch layer.

---

## 8. Capability layering (three roles / seams)

When a capability must have replaceable providers, split three roles — a **seam**:

1. **Service Definition** — abstract `Service` subclass + `Request`/`Result` types
   (e.g. `dsh-shell`).
2. **Service Provider** — implements it (`dsh-bash-local`).
3. **Consumer** — usually a model-facing tool, `inject`s the service
   (`dsh-tool-bash`, `inject: ['shell']`).

```
dsh-shell (definition) ◀── dsh-bash-local (provider)
        ▲
        └── dsh-tool-bash (consumer, inject: ['shell'])
```

- Provider and Consumer **do not depend on each other**; both depend on the definition.
- Swap the provider row in `cordis.yml` and the tool/definition are unchanged.
- A package may own more than one role. **Do not split preemptively** — only when roles
  must evolve/be replaced independently. A simple tool plugin does not.
- The **Service Definition owns the Request/Result types**.
- **Explicit > implicit**: resolve defaults in an explicit `resolve(request): Spec` step
  rather than hiding `?? default` inside `run()`.
- "The complete capability is its seam. No individual role is a seam."

The seam model is why one provider swap changes the whole product: filesystem and
subprocess providers share one execution world, so pointing them at a remote sandbox moves
Bash, PTY, and LSP with them.

---

## 9. LLM adapters

```ts
class MyAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { /* ... */ }
}

export const inject = ['llm']
export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(config.providers, new MyAdapter(config.apiKey))
}
```

`GenerateOptions` (authoritative type from `@deepseek-ai/dsh-llm`) includes model,
adapter-owned reasoning-effort id, history, system prompt, tool schemas, generation
parameters, stop sequences, abort signal. Map what the provider supports; if it cannot
honor a field, throw `LlmError` with a stable code — never silently drop.

`StreamChunk` protocol:

1. `block-start` (`index`, `blockType`) for every block.
2. `text-delta` (per `index`) for text.
3. `block-end` with the complete block.
4. Tool calls: `block-start` → `tool-call-delta` (`id`, `name`, `argumentsDelta` = raw JSON
   text, possibly split) → `block-end` with the complete `tool-call` block.
5. `usage` (input/output tokens) **before** `finish`.
6. `finish` last; `reason.kind: 'stop'` or `'tool-calls'`.

Rules: every `block-start` has a matching `block-end`; `index` starts at 0 and defines
order; `usage` before `finish`; `finish` is final.

- `registerAdapter(providerNames, adapter)` — routes by `GenerateOptions.provider`;
  `model` is adapter-owned and passes through.
- Override `resolveModel(provider, model, signal?)` for exact provider/model identity plus
  optional `context`/`reasoning` metadata; honor the signal. The service validates the
  aggregate and rejects unsupported explicit efforts before `stream()`.
- Override `listModels()` when the adapter can advertise choices.
- Every provider HTTP request must merge `attributionHeaders()` and forward `options.signal`.
- Reference implementations: `packages/llm/llm-deepseek`, `packages/llm/llm-pi-ai`.

---

## 10. Persistent plugins from a prompt (Creator mode)

- Creator mode = **Plugin Manager** (`ctx.pluginManager`) + read-only runtime inspection
  (`tool-cordis`, `ctx.pluginRegistryProbe`).
- Plugin configuration belongs to the **current profile**, affects its sessions, survives
  restarts.
- Flow for e.g. MCP: agent writes a configuration-only bundle whose patch inserts
  `@deepseek-ai/dsh-mcp-client`, installs via `plugin_manager install_bundle`; with HMR the
  tools appear in the same running session. Verify `application: applied` (a saved
  `restart-required` entry has not activated) **and** a real tool call.
- Disable entries or remove the bundle through Plugin Manager; read the bundle patch before
  editing its config.

---

## 11. Harness architecture map (what sits where)

### 11.1 Core packages

| Package | Owns | `ctx` key |
|---|---|---|
| `core/session` | append-only `SessionEvent` log + in-memory store | `ctx.sessions` |
| `core/system-prompt` | prompt-section and tool-schema assembly | `ctx.systemPrompt` |
| `core/tools` | scoped tool registry + guarded execution pipeline | `ctx.tools` |
| `core/agent` | `Agent` interface, live registry, `agent/*` events | `ctx.agents` |
| `core/agent-loop` | default driver implementing that interface | `ctx.agentLoop` |
| `core/scope` | per-agent scoped-registration primitive | library |
| `llm/llm` | message/stream vocabulary + adapter seam | `ctx.llm` |

### 11.2 Turn vs step

- **Step** = one model request + the tools it calls.
- **Turn** = zero or more steps; opens before its first input is claimed, closes once
  nothing is owed.

```
turn/start
  claim input + one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step (waterfall; may rewrite/reject)
     step/start
     agent/request (waterfall) -> prepareCall
     reconcile system/message; append users; freeze history from log
     stream -> llm/stream -> chunks -> assistant/message | assistant/attempt
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> next step
  -> agent/turn-stopping (serial, no next())
turn/end
```

Waterfalls here: `agent/pre-step`, `agent/request`, `llm/stream`, `tools/pre-execute`,
`tools/execute`, `tools/post-execute` — all must call `next()`. `agent/turn-stopping` is
serial and has no `next()`.

### 11.3 Session log

- The log is the source of the context the model sees; `deriveMessages()` projects model
  history from it.
- **Model-visible means logged.** Every model request must be reconstructable from the log;
  new model-visible inputs require session events.
- Each `assistant/message` embeds the exact compact timed stream that produced its content;
  `assistant/attempt` retains settled failures/retries/cancellations without adding model
  history.
- Fork/resume/transcripts/telemetry/persistence derive from durable settlements; live UI
  incrementality comes from `agent/assistant-stream` (process-local).
- Plugins changing existing message content register **pure message projections**; detached
  readers supply the same definitions explicitly.
- `dsh-session-projection` owns `ctx.sessionProjections`: units fold committed events
  incrementally, consumers read one typed state with `stateOf()`.

### 11.4 "Where new behavior goes" (docs table, condensed)

| Goal | Mechanism |
|---|---|
| Add a model provider | register adapter on `ctx.llm` |
| Add a model-facing capability | register on `ctx.tools` (schema joins prompt) |
| Different capability set per session | agent preset; a service row there needs an `isolate` realm |
| Add shell execution | register `ctx.shell` backend (local one spawns via `ctx.subprocess`) |
| Persistent terminal | `ctx.terminals` backend + `dsh-tool-terminal` |
| Human command (no model turn) | register on `ctx.commands` |
| Background jobs | register on `ctx.jobs`; `job_*` tools read/stop |
| External webhook → Session | trusted rule on `ctx.webhookRuntime` + provider adapter |
| Filesystem access/policy | `ctx.fs` provider or `fs/*` listeners |
| Confine processes | `ctx.sandbox` backend (consumers wrap argv before spawn) |
| Intercept request/tool/turn | its `agent/*` or `tools/*` event; `agent/turn-stopping` stops a turn |
| Add model-facing context | `agent.inject()` — lands in next admitted request |
| UI/editor integration | drive `ctx.agents`, render from `session/event` |
| Web Client Chat node | `ConversationNodeDefinition` + keyed renderer |
| Durable session state | extend `SessionEventMap`; render/replay from the log |
| Session titles | sole `ctx.sessionTitle` provider |
| Same-session objective | `ctx.goals` |
| Fork at a turn boundary | `ctx.agents.create({ sessionId, seed, meta: { parentSession, seedLength } })` — only agent-loop-published sessions persist |
| New persistence backend | implement `SessionPersistence` (`create`/`open`/`stat`/`list`/`export`) |
| Scope a registration to one agent | that agent's `agent.ctx` |

---

## 12. Gotchas worth remembering

1. **Silent PENDING** — a missing `inject` provider is not an error. Inspect fibers.
2. **Patch = replace config, not merge.** Restate every key when overriding a row.
3. **Waterfall listeners must call `next()`** or they short-circuit the chain (sometimes
   intentionally; usually a bug).
4. **`turn/*`, `step/*`, `tool/*`, `compaction/*` are not Cordis events** — listen to
   `session/event` for those.
5. **`typeof ctx.x` may throw without `inject`** — use `ctx.get('x')` for optional services.
6. **`defineTool` parameters ≠ JSON Schema**; `output.schema` *is* JSON Schema (value spec).
7. **Registration borrows the definition** — no post-registration mutation; dispose +
   re-register to swap.
8. **PRESENTERS MUST BE PURE** — they replay; no I/O, no session state, no clock.
9. **`agent.inject` is context, not a wake-up.**
10. **A background job outlives the call** — switch to a task-owned signal once its id is
    published.
11. **Linked checkouts:** shared dsh instances need peer **and** dev deps; git installs need
    `prepare` + `allowBuilds` + a pinned SHA.
12. **Entry `id`s:** without one, every config edit remounts the plugin.

---

## 13. Crawl log (pages read)

Basics (requested scope):
- <https://deepseek-harness.github.io/deepseek-harness/develop/basic/> — first plugin,
  `cordis.yml` local overlay, auto-cleanup, inject, three plugin forms.
- <https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool> — `defineTool`.
- <https://deepseek-harness.github.io/deepseek-harness/develop/basic/config> — Schema,
  defaults, validation, HMR.
- <https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish> — bundle vs
  profile, layer order, install, git caveat, surface command lines.

Framework / practice / reference (for "complete architecture"):
- <https://deepseek-harness.github.io/deepseek-harness/develop/framework/> — fiber states,
  effects, dispose, HMR.
- <https://deepseek-harness.github.io/deepseek-harness/develop/framework/service> —
  services, isolation.
- <https://deepseek-harness.github.io/deepseek-harness/develop/framework/events> — modes,
  typed events, session vs Cordis events.
- <https://deepseek-harness.github.io/deepseek-harness/develop/practice/> — three roles.
- <https://deepseek-harness.github.io/deepseek-harness/develop/practice/llm-adapter> —
  StreamChunk protocol.
- <https://deepseek-harness.github.io/deepseek-harness/develop/practice/dynamic-cordis> —
  plugin manager / creator mode.
- <https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/06-composition-and-hmr> —
  ids, HMR, PENDING diagnosis.
- <https://deepseek-harness.github.io/deepseek-harness/reference/> — architecture map.
- <https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer> — five ideas,
  dispatch table, loader `!!js`.
- <https://deepseek-harness.github.io/deepseek-harness/reference/capability-seams> — service
  graph (very large; skimmed for roles/notes).
- <https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/adding-a-tool> —
  full tool contract, PTC, presentation, background jobs.

Not crawled (out of scope, useful next): `develop/cordis-tutorial/01–05,07`,
`reference/config-catalog`, `reference/tool-catalog`, `reference/subsystems/*` (session,
tools, compaction — relevant to this repo), `reference/cookbook/extension-cookbook`.

---

## 14. Local cross-check (this repo, not the website)

Our plugin (`dsh-rewind-compact`) is a textbook consumer-side plugin:
`lib/index.js` exports `apply` and registers every surface inside one `ctx.effect`;
`inject` deliberately omits `compaction`/`logger` so profiles without the compaction
bundle still load, reaching them through `probeService`. That matches the docs'
"optional = `ctx.get`, not `inject`" rule. See `AGENTS.md` surface map and
`docs/HARNESS-CONTRACTS.md` for the verified line anchors.

Two docs claims worth re-verifying against the installed harness when relevant:
- `patchReload: live` semantics vs. this repo's note that lib code changes need a process
  restart (docs say HMR unloads/reloads source; local note says patch reload does not
  re-import changed bundle module code — different mechanisms, same warning).
- `ctx.agents.create` seed shape for forks (docs only state the call shape; the exact
  message envelope is in `docs/HARNESS-CONTRACTS.md` and `lib/seed.js`).
