# SPEC: rewind-compact plugin for DeepSeek Harness

Status: **approved for implementation** (user-confirmed design, 2026-10-14; revised 2026-10-27 per ADR RWC-015, decisions D1–D10).
Audience: the implementing agent, and the review agents that check the result against this file.

## 1. Purpose

A plugin bundle for the DeepSeek Harness (`dsh`) that combines the harness's existing primitives — the TUI's fork-at-boundary rewind recipe and, for any future LLM summary, `ctx.compaction` — into one user-controlled **rewind-compact** feature, exposed on three surfaces (TUI command, model-invoked tool, skill).

Rewind-compact rewinds the conversation to a chosen completed-turn boundary and summarizes one side of that boundary as the mechanical five-field scaffold (R5); the other side survives verbatim. LLM prose summaries (the hybrid form) are a v2 target (RWC-015 D3) — in v1 the scaffold alone is the summary — and `ctx.compaction` is named here only as the seam a future LLM summary must use. The discarded side always remains recoverable: the pre-rewind session keeps existing with its full transcript and stays resumable by session id.

## 2. Facts the implementation depends on (verified 2026-10-27 on dsh 0.2.1-rc.2)

Read these two research reports before writing code — they are authoritative environment documentation:

- `docs/research/claude-code-rewind-compact-research.md` — Claude Code's rewind/compact behavior (the UX this feature imitates).
- `docs/research/dsh-rewind-compact-plugin-research.md` — harness plugin anatomy, services, transcript format, mutation hooks, constraints.

Key facts (summarized; the report has file:line references):

- **Bundle anatomy**: an npm package whose `package.json` declares `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`. The patch file is a YAML array of loader patch entries (`{id, name?, disabled?, config?}` row overrides, or `insert:` lists). A patch **replaces the targeted row's whole config** — never merges. Layer order: bundle patches → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays; last-write-per-id wins. Profiles declare ordered `dsh.profile.bundles`.
- **Runtime**: Cordis/Koishi with schemastery. Core services include `ctx.sessions`, `ctx.agents`, `ctx.llm`, `ctx.compaction` (contract: `compactIfNeeded` / `compactNow` / `compactRegion`), `ctx.tokenMeter`, `ctx.sessionQuery`, `ctx.sessionPersistence`, `ctx.commands`.
- **Sessions**: event-sourced, append-only. `session.append(type, data, {surfaceOp})`; `session.deriveMessages()` produces model-visible messages. Committed events are never rewritten; compaction only *shadows* ranges via `surfaceOp: {op: "replace", startSeq, endSeq}`. Surface-eligible events are `system/message`, `developer/message`, `user/message`, `assistant/message`, and `tool/result`.
- **Rewind recipe** (the TUI's existing implementation, to be reused, not reinvented): `@deepseek-harness-tui/dsh-tui/lib/types/dsh-adapter/channel/session-rewind.js` — cancel agent → wait `turn/end` → walk back to the enclosing `turn/start` → `sliceLiveSessionSeed(turnStart.seq - 1)` → `agents.create({sessionId, seed, meta: {cwd, parentSession, isSeeded: true, agentPreset?}, inheritedEventCount: seed.length, setup})`. 0.2.1 has no `settleCompaction`; the fork path never runs compaction. Deliberately **not** `sessions.fork()`.
- **Permissions**: TUI permission registry has `session.rewind.intercept` and `session.compact.intercept`, with decision events `tui/rewind-prompt` and `tui/compact`.
- **Transcript**: `$DSH_HOME/sessions/<normalized-cwd>/<session-id>/session.v4.jsonl.zstd` (raw profiles: `session.v4.jsonl`); records `{type, seq, time, data}`; types include `user/message`, `assistant/message`, `tool/call`, `tool/result`, `turn/start`, `turn/end`, `step/start`, `step/end`, `agent/inbox/spliced`, `request/context`. `session.lock` is a kernel flock lease.
- **Mutation hooks**: `agent/pre-step` (waterfall; can replace the messages entering a step), `agent/request` (call config only, messages immutable). No `beforePrompt` hook exists.

## 3. Requirements

Each requirement carries acceptance criteria. An acceptance criterion is a check the reviewer can run or observe in the code; all of them must hold.

### R1 — Bundle package

This repository is an npm package named `dsh-rewind-compact` declaring `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`.

**Acceptance**: `package.json` contains the `dsh.bundle.patch` field; the referenced patch file exists and parses as YAML.

### R2 — Composition, not reinvention

The plugin reuses the harness's existing machinery everywhere it exists: the fork-at-boundary rewind recipe (section 2) and the `ctx.compaction` contract for **any LLM-generated summary**. It must not reimplement session storage, locking, context assembly, or the LLM summarization call; the five-field scaffold (R5) is built by the plugin and is not an LLM summary.

**Acceptance**: the implementation contains no second implementation of session persistence, locking, context assembly, or LLM-call plumbing; rewind goes through `agents.create` with a sliced seed (or a thin equivalent layered on the same services), and **any LLM-generated summary** goes through the `ctx.compaction` contract. A profile without the service, or a path with no closed range, delivers the R5 five-field scaffold alone as the documented scaffold-only fallback; the plugin never implements its own summarizer, persistence, locking, or context assembly.

### R3 — Surfaces

The feature is exposed on exactly three surfaces:

1. **TUI picker surface** — the interactive picker is the TUI's native Double-Esc rewind overlay, extended through the plugin decision-event seam: the bundle answers `tui/rewind-prompt` with the after mode only (`rewind-compact-after`; the before mode is dropped from the TUI — ADR D5 — and remains on the command and tool), which the confirm pane renders as a choice list; on pick the TUI forks and dispatches `tui/rewind-done`, which the bundle answers by appending the five-field scaffold to the child session it forked (scaffold-only in v1; child-side compaction is a post-v1 target, ADR D3). The slash command `/rewind-compact [turn] [after|before]` remains as the fast path and keeps both modes; its bare form is itself an interactive picker on every profile that provides the `commands` service — it asks through the harness's user-questions service (`ctx.userQuestions.ask`, the seam behind `ask_user_question`), which web and TUI both render natively: pick the completed turn (newest first, files-changed count), then the side (after recommended / before).
2. **Model-invoked tool** `rewind_compact(point, mode, rewind = false)` registered as a runtime tool using the harness's tool-registration seam (the mechanism built-in runtime tools use; find it in the installed harness packages and use it — do not invent a new registration protocol). `rewind = true` is the gated fork path (R7). The `rewind = false` branch keeps its default parameter value for signature compatibility only; in v1 it is retired and returns the documented unsupported result — `ok: false`, `applied: false`, a `reason` recording the retirement, and a note pointing at the fork path — never calling `compactRegion` and never writing to the transcript.
3. **Skill** `rewind-compact` — a `SKILL.md` in the repo (see R11), wired into the harness skill catalog by whatever mechanism bundles use for skill registration; if the harness has no such mechanism, document the drop-in install path in the repo README and ship the skill directory.

**Acceptance**: all three surfaces exist in the repo; the command and tool names are exactly `/rewind-compact` and `rewind_compact`; the README states how each surface is installed/registered.

### R4 — Fork semantics (the core)

A **rewind run** — any TUI/command fork, or the tool with `rewind: true` — always **forks** to a new session seeded at the chosen boundary. Given boundary point P:

- **after mode**: seed = messages up to and including P, verbatim; then the discarded tail (everything after P) is summarized and the summary appended as one message. On the TUI surface the TUI performs the fork; the plugin appends the scaffold to the child it forked (R3).
- **before mode**: seed = summary of the discarded prefix (everything before P) as one leading message, then messages from P onward, verbatim. This mode is offered by the command and tool forks only; the TUI does not offer it (R3/R6, ADR D5).

The pre-rewind session is left unmodified and resumable by its id — that session is the recoverable copy of the discarded side. No hidden regions, no transcript rewriting, no sidecar files.

The tool's in-place path (`rewind: false`) is a compaction under R5/R7, **not a rewind**, and in v1 is retired (RWC-015 D2).

**Acceptance**: code paths exist for both modes on the command and tool surfaces (the TUI offers after only); the after-mode fork result ends with a summary message; the before-mode seed begins with one; the pre-rewind session is never mutated by the plugin (no `append`, no truncation); the old session id is discoverable after the fork (logged, or recorded on the new session, or both); the retired in-place call sites contain no `agents.create` and no `compactRegion` call.

### R5 — Summary shape (five-field scaffold)

Every compacted side is summarized as the mechanical five-field scaffold. Where a **closed, balanced range and a compaction service** exist, the scaffold is delivered **inside that range** as its final message, so the summarizer condenses the range and preserves the scaffold's facts into prose. **v1 ships scaffold-only summaries**: the in-place path is retired (RWC-015 D2) and child-side fork compaction is deferred until a child-side closed-range seam is proven (RWC-015 D3) — so in v1 the scaffold-only message is the summary on every surface, forks included, and the pre-rewind session is never touched. Fork-side LLM compaction is a post-v1 target; when it lands it must use the closed-range seam above. No v1 code path calls `ctx.compaction`; the service is named for a future LLM summary only.

Scaffold fields, always present as labeled sections:

1. `Files changed` — created/modified/deleted, derived from `write`/`edit` arguments (and structured result metadata where present); `bash` counts only paths the result exposes as structured applied changes (v1 counts none from `bash`); reads, searches, and fetches never count; paths are normalized and deduplicated. R10 defines the same set for the warning.
2. `Commands run` — with exit codes where recorded.
3. `Errors encountered`.
4. `Decisions made`.
5. `Outstanding TODOs`.

If a field has no data, the section is present and says so. If the compacted range already contains a summary from an earlier rewind-compact, the scaffold notes "includes a prior compact summary".

**Acceptance**: the scaffold string built by the plugin contains all five labeled sections; the code derives each section from the range's tool events rather than hardcoding; the nested-summary note exists; the `Files changed` section uses the conservative derivation in field 1 (a read-only transcript reports zero files); the scaffold is delivered inside the compacted range **whenever a closed, balanced range exists** — the open-step tool context must defer compaction to a step-closed hook rather than append outside the range — and never via an unsupported `compactRegion` instructions argument; the before-mode fork is scaffold-first by R4 and is not a range-compaction case.

### R6 — Picker rules

**Implementation status (2026-10-27):** blocked by RWC-018 on dsh-tui 0.17.0. A profile bundle is a backend activation and cannot register in the TUI host `DecisionEvents` registry; the TUI command/tool ship, the picker waits for a native TUI plugin or a harness bridge. The rules below are the target.

The interactive picker is the TUI's native rewind overlay (Esc Esc), which lists **user-message rows**. The bundle's `tui/rewind-prompt` answer realizes the designed rules:

- the picked user-message row is mapped to its enclosing `turn/start`, and that turn must have ended. A row in the still-open turn is ineligible (no plugin modes; the built-in rewind remains) until that turn ends. There is no mid-turn point;
- the fork cut is `turnStart.seq - 1` (the `boundarySeq` `tui/rewind-done` receives), never the picked row's seq, and the files-changed warning is counted from that same cut;
- the confirm pane offers the **after** mode only, labeled "Rewind + compact after" (before mode is dropped from this surface — ADR D5 — and remains on the command and tool);
- no-ops are omitted: after-mode is not offered when the boundary is the last completed turn (no tail);
- ranges that already contain a prior summary stay selectable (nested compaction);
- the mode description carries the warning "N file(s) changed since this point — not reverted" when file-editing tools ran after the cut, using the conservative `Files changed` set of R5 field 1 (v1 warns, does not revert — see R10).

**Acceptance**: the `tui/rewind-prompt` answer maps the picked message seq to its enclosing completed turn and returns the after mode with the id `rewind-compact-after` and the label "Rewind + compact after"; the code computes per-boundary validity for that boundary and omits the no-op mode; before mode is never returned by this surface; the files-changed warning is counted from the turn cut (`turnStart.seq - 1`, via the same conservative helper as R5 field 1), not the picked row's seq, and appended to the mode description; a row in the open turn yields no modes; there is no code path that selects a mid-turn point.

### R7 — Gating

- The **tool**'s in-place path (`mode` with `rewind = false`) is a compaction, not a rewind, and is **ungated** — it never creates a session. In v1 it is **retired**: it returns the documented unsupported result (R3) without calling `compactRegion` and without writing to the transcript. If in-place returns after v1, it stays ungated, still never creates a session, and must satisfy the closed-range rule in R5 (RWC-015 D2b).
- Any operation that rewinds (forks) is **gated**: the TUI picker path is the human's own action inside the TUI's rewind flow, and the decision-event subscriptions that enable it are themselves D-7-gated on the `session.rewind.intercept` grant (default deny — the user must grant it in the TUI's permission store); through the tool it requires **direct human authority in the current turn** — the harness's own authority pattern (a user-sourced `user/message` in the open turn, as in `dsh-tool-goal`'s `requireDirectHuman`). In profiles with no human (headless/sdk, goal-round turns) the check fails closed.
- The plugin authors **no decision prompt**: the tool's gate is the direct-human authority check itself, and the skill (R11) defers to this clause. A conversational ask by the model is guidance, not a gate.

**Acceptance**: the tool's ungated path contains no fork call and, in v1, no `compactRegion` call and no transcript append (it returns the retired result); the tool's fork path performs the direct-human authority check (a user-sourced `user/message` in the open turn, via the session turn-boundary projection); headless behavior is fail-closed (no silent fork); no plugin-authored decision prompt exists on the tool path.

### R8 — Coexistence

The built-in `/rewind`, `/compact`, and auto-compaction are untouched. The plugin adds alongside them; it must not disable, rename, or re-implement them.

**Acceptance**: the patch layer does not override or disable any `dsh-*` compaction/rewind entries.

### R9 — Profiles

The bundle loads in all profiles. `tools` and `agents` are hard requirements; the command and skill surfaces are optional and are probed and registered only where the profile provides the `commands`/`skills` services, with one log line per skipped surface. `sdk-minimal` deliberately provides neither and must still load the tool. The TUI picker surface exists in the TUI profile. No profile-specific hacks.

**Acceptance**: the patch does not gate itself to one profile; a profile without `commands`/`skills` (sdk-minimal) still activates the entry and registers the tool, while a base-backed profile registers tool, command, and skill. README documents per-profile install (`dsh plugin --profile <name> ...`) and which surface works where.

### R10 — Files: warn, don't revert (v1)

v1 never reverts files. The plugin reports which files changed after the boundary (picker warning, R6; scaffold field, R5) and does nothing else to the filesystem. Both reports use the same conservative `Files changed` set as R5 field 1: `write`/`edit` arguments plus structured result metadata, structured `bash`-applied changes only (none in v1), never reads/searches/fetches, normalized and deduplicated.

**Acceptance**: no code performs file restoration, snapshotting, or git rollback; a comment or README line marks revert as explicitly deferred v2; the warning and the scaffold derive from the same helper, so their counts agree for the same range.

### R11 — Skill content

The shipped `SKILL.md` (skill `rewind-compact`) teaches the model, in this order:

1. When to propose a rewind-compact: context pressure climbing, work derailed, user signals "start over from X".
2. How to use the `rewind_compact` tool: rewind requires **direct human authority** in the current turn and fails closed when there is no human (headless/sdk/goal-round turns). The plugin does not show a decision prompt; ask the user in conversation first if unsure. In v1 the tool's in-place path is retired and returns a documented unsupported result pointing at `rewind: true`.
3. The five-field scaffold format (R5) that compacted summaries must follow: in v1 the scaffold **is** the summary (scaffold-only; no LLM prose), and its `Files changed` derivation follows R5 field 1.
4. Post-fork etiquette: the pre-rewind session keeps existing and is resumable; files are NOT reverted in v1 — never claim they were; the child's `<source title> (rewound)` title is best-effort metadata, not a guarantee.

**Acceptance**: the SKILL.md contains all four parts in order; its frontmatter sets `name: rewind-compact` and a description naming the trigger branches (rewind, compact, context pressure); the text claims no approval prompt, no LLM prose, no successful in-place compaction, and no create-time title.

### R12 — Naming

- Bundle/package: `dsh-rewind-compact`.
- TUI command: `/rewind-compact`.
- Tool: `rewind_compact`.
- Skill directory: `rewind-compact`.
- Forked session title: `<original title> (rewound)`, delivered as a `session/title` event appended in the child's `setup`, before publication (best-effort metadata; skipped when the source has no title). No create-time `title` option is passed to `agents.create`.

**Acceptance**: all five names appear exactly as written; the fork appends a `session/title` event carrying the source session's title with the ` (rewound)` suffix in the child's `setup`, before publication; the title is best-effort — an unknown source title or a failed append never fails the fork — and no create-time `title` option is used.

## 4. Non-goals (v1)

Explicitly out of scope; do not build:

- File revert / rollback / snapshotting (R10).
- In-place compaction (`rewind: false`) and LLM-generated (hybrid) summaries — retired/deferred in v1 (R3/R5/R7).
- Mid-turn rewind points (R6).
- Hidden transcript regions or sidecar stash files (R4 covers recovery).
- Modifying the launcher, session lock, or transcript files directly (R2).
- Changing built-in `/rewind`, `/compact`, or auto-compaction (R8).

## 5. Standards for the code

- TypeScript (or the JS dialect the harness packages use — match `@deepseek-ai/dsh-*` package conventions exactly; read two of them before writing code).
- Use the harness's own config-schema style (schemastery/zod) for any plugin config.
- Errors: fail loudly with actionable messages; never swallow the LLM or compaction errors.
- Naming: match the harness's existing vocabulary (session, seed, surface, compaction); no invented synonyms.
- No speculative generality: implement only what the requirements need; no plugin-in-plugin frameworks, no unused config knobs.
- Harness-boundary backstop: every object crossing a harness boundary (tool output schema and parameters, skill definition, fork seed events, inject list, patch rows) must pass the harness's own validators as exercised by `scripts/check-contracts.mjs` — run `npm run check` and have it green before claiming done.
- Tests where the harness makes it cheap: pure functions (scaffold derivation, boundary computation, no-op validity) must have unit tests; service plumbing is acceptable without if the harness lacks a test harness for it (state that in the README).
- Keep the repo small: one patch entry per concern, no dead code.

## 6. Verification the implementer must perform before finishing

1. The patch file parses (YAML) and every referenced id exists or is inserted.
2. The package typechecks/builds with the harness's toolchain conventions.
3. Two verification gates, both required:
   - **Compose gate**: copy `$DSH_HOME/profiles/dsh-tui` to a **new throwaway profile directory**, install the bundle into it (`dsh plugin --profile <scratch> add --offline file:$PWD`), then run `dsh --profile <scratch> --dump-config` and confirm the rewind-compact entry composes. Never against the user's live profile; never boot the live TUI.
   - **Live gate**: at least one live run of a scratch profile per shipped surface — the web E2E (`scripts/test-web-profile.sh` + `scripts/e2e-web-test.py`) for the command/tool, and the manual TUI picker run in `TESTING.md` (with the `session.rewind.intercept` grant and recorded logs/screenshots) for the decision-event surface. The TUI run exercises after mode only (R3/R6); before mode is verified through the command/tool fork.
   Both gates create their scratch profile per §7, then remove it and record the cleanup in the run's evidence.
4. `README.md` exists and covers: what the plugin does, install per profile, the three surfaces, the v1 limitations (scaffold-only summaries; no file revert; no in-place path; headless rewind fails closed).
5. The repo layout is: `package.json`, `cordis.patch.yml`, `lib/` (or `src/` + build), `skill/rewind-compact/SKILL.md`, `README.md`, `SPEC.md` (this file, copied), `tests/` if applicable.

## 7. Hard constraints

- Never modify an existing profile, session, or storage under `~/.dsh/`. In v1 the only permitted write under that tree is creating a **new, throwaway profile directory** at `$DSH_HOME/profiles/<scratch-name>/` (with `$DSH_HOME` defaulting to `~/.dsh` and the name not already existing) by copying a template or `dsh-tui`, and installing the bundle into that copy. Never edit, install into, rename, or delete an existing profile; never boot the live TUI. At the end of the run — and on failure — remove the scratch directory with `rm -rf "$DSH_HOME/profiles/<scratch-name>"` and record the cleanup in the run's evidence.
- The exception is scoped to that new scratch directory only: if a harness or package-manager step would write outside it (for example the shared `$DSH_HOME/profiles/node_modules`), stop the run and record a blocker in the verification evidence rather than widening the exception.
- Never touch a live session transcript or its lock file.
- If a required seam (tool registration, skill registration) does not exist in the installed harness, do not invent a parallel runtime: implement the closest documented seam, and record the gap and the chosen fallback in `README.md` under "Harness seams used".
