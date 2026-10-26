# SPEC: rewind-compact plugin for DeepSeek Harness

Status: **approved for implementation** (user-confirmed design, 2026-10-14).
Audience: the implementing agent, and the review agents that check the result against this file.

## 1. Purpose

A plugin bundle for the DeepSeek Harness (`dsh`) that combines the harness's existing primitives — the TUI's fork-at-boundary rewind recipe and `ctx.compaction.compactRegion` — into one user-controlled **rewind-compact** feature, exposed on three surfaces (TUI command, model-invoked tool, skill).

Rewind-compact rewinds the conversation to a chosen completed-turn boundary and compacts one side of that boundary into a hybrid summary; the other side survives verbatim. The discarded side always remains recoverable: the pre-rewind session keeps existing with its full transcript and stays resumable by session id.

## 2. Facts the implementation depends on (verified 2026-10-14)

Read these two research reports before writing code — they are authoritative environment documentation:

- `docs/research/claude-code-rewind-compact-research.md` — Claude Code's rewind/compact behavior (the UX this feature imitates).
- `docs/research/dsh-rewind-compact-plugin-research.md` — harness plugin anatomy, services, transcript format, mutation hooks, constraints.

Key facts (summarized; the report has file:line references):

- **Bundle anatomy**: an npm package whose `package.json` declares `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`. The patch file is a YAML array of loader patch entries (`{id, name?, disabled?, config?}` row overrides, or `insert:` lists). A patch **replaces the targeted row's whole config** — never merges. Layer order: bundle patches → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays; last-write-per-id wins. Profiles declare ordered `dsh.profile.bundles`.
- **Runtime**: Cordis/Koishi with schemastery. Core services include `ctx.sessions`, `ctx.agents`, `ctx.llm`, `ctx.compaction` (contract: `compactIfNeeded` / `compactNow` / `compactRegion`), `ctx.tokenMeter`, `ctx.sessionQuery`, `ctx.sessionPersistence`, `ctx.commands`.
- **Sessions**: event-sourced, append-only. `session.append(type, data, {surfaceOp})`; `session.deriveMessages()` produces model-visible messages. Committed events are never rewritten; compaction only *shadows* ranges via `surfaceOp: {op: "replace", startSeq, endSeq}`. Only `system` / `user` / `assistant` / `tool-result` events may carry a `surfaceOp`.
- **Rewind recipe** (the TUI's existing implementation, to be reused, not reinvented): `@deepseek-harness-tui/dsh-tui/lib/types/dsh-adapter/channel/session-rewind.js` — cancel agent → wait `turn/end` → settleCompaction → walk back to the enclosing `turn/start` → `sliceLiveSessionSeed(boundary)` → `agents.create({sessionId, seed, inheritedCount, parentSession, setup: agent.inbox.clear()})`. Deliberately **not** `sessions.fork()`.
- **Permissions**: TUI permission registry has `session.rewind.intercept` and `session.compact.intercept`, with decision events `tui/rewind-prompt` and `tui/compact`.
- **Transcript**: `$DSH_HOME/sessions/<cwd>/<session-id>/session.v3.jsonl.zstd`; records `{type, seq, time, data}`; types include `user/message`, `assistant/message`, `tool/call`, `tool/result`, `turn/start`, `turn/end`, `step/start`, `step/end`, `agent/inbox/spliced`, `request/context`. `session.lock` is a kernel flock lease.
- **Mutation hooks**: `agent/pre-step` (waterfall; can replace the messages entering a step), `agent/request` (call config only, messages immutable). No `beforePrompt` hook exists.

## 3. Requirements

Each requirement carries acceptance criteria. An acceptance criterion is a check the reviewer can run or observe in the code; all of them must hold.

### R1 — Bundle package

This repository is an npm package named `dsh-rewind-compact` declaring `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`.

**Acceptance**: `package.json` contains the `dsh.bundle.patch` field; the referenced patch file exists and parses as YAML.

### R2 — Composition, not reinvention

The plugin reuses the harness's existing machinery everywhere it exists: the fork-at-boundary rewind recipe (section 2) and `ctx.compaction.compactRegion` for summaries. It must not reimplement session storage, locking, context assembly, or the LLM summarization call.

**Acceptance**: the implementation contains no second implementation of session persistence or LLM-call plumbing; rewind goes through `agents.create` with a sliced seed (or a thin equivalent layered on the same services), and summaries go through the `ctx.compaction` contract.

### R3 — Surfaces

The feature is exposed on exactly three surfaces:

1. **TUI picker surface** — the interactive picker is the TUI's native Double-Esc rewind overlay, extended through the plugin decision-event seam: the bundle answers `tui/rewind-prompt` with the after mode only (`rewind-compact-after`; before mode is dropped from the TUI — ADR D5 — and remains on the command and tool), which the confirm pane renders as a choice list; on pick the TUI forks and dispatches `tui/rewind-done`, which the bundle answers by compacting the chosen side inside the child session. The slash command `/rewind-compact [turn] [after|before]` remains as the fast path; its bare form is itself an interactive picker on every profile — it asks through the harness's user-questions service (`ctx.userQuestions.ask`, the seam behind `ask_user_question`), which web and TUI both render natively: pick the completed turn (newest first, files-changed count), then the side (after recommended / before).
2. **Model-invoked tool** `rewind_compact(point, mode, rewind = false)` registered as a runtime tool using the harness's tool-registration seam (the mechanism built-in runtime tools use; find it in the installed harness packages and use it — do not invent a new registration protocol). `rewind = false` (default) is the ungated in-place compaction path; `rewind = true` is the gated fork path (R7).
3. **Skill** `rewind-compact` — a `SKILL.md` in the repo (see R11), wired into the harness skill catalog by whatever mechanism bundles use for skill registration; if the harness has no such mechanism, document the drop-in install path in the repo README and ship the skill directory.

**Acceptance**: all three surfaces exist in the repo; the command and tool names are exactly `/rewind-compact` and `rewind_compact`; the README states how each surface is installed/registered.

### R4 — Fork semantics (the core)

A rewind-compact run always **forks to a new session** seeded at the chosen boundary. Given boundary point P:

- **after mode**: seed = messages up to and including P, verbatim; then the discarded tail (everything after P) is summarized and the summary appended to the seed as one message.
- **before mode**: seed = summary of the discarded prefix (everything before P) as one leading message, then messages from P onward, verbatim.

The pre-rewind session is left unmodified and resumable by its id — that session is the recoverable copy of the discarded side. No hidden regions, no transcript rewriting, no sidecar files.

**Acceptance**: code paths exist for both modes; the after-mode seed ends with a summary message; the before-mode seed begins with one; the pre-rewind session is never mutated by the plugin (no `append`, no truncation); the old session id is discoverable after the fork (logged, or recorded on the new session, or both).

### R5 — Summary shape (hybrid)

Every compacted side is summarized as: a mechanical five-field scaffold followed by LLM prose, produced through `ctx.compaction.compactRegion` with the scaffold delivered **inside the compacted range** as its final message (the summarizer condenses the range and preserves the scaffold's facts into the prose). For forks, the range compaction runs on the **child** session after seeding, so the pre-rewind session is never touched; when child-side compaction is unavailable, the scaffold-only message remains as the summary (mechanical half still delivered).

Scaffold fields, always present as labeled sections:

1. `Files changed` — created/modified/deleted, derived from tool events in the compacted range.
2. `Commands run` — with exit codes where recorded.
3. `Errors encountered`.
4. `Decisions made`.
5. `Outstanding TODOs`.

If a field has no data, the section is present and says so. If the compacted range already contains a summary from an earlier rewind-compact, the scaffold notes "includes a prior compact summary".

**Acceptance**: the scaffold string built by the plugin contains all five labeled sections; the code derives each section from the range's tool events rather than hardcoding; the nested-summary note exists; the scaffold is delivered inside the compacted range (child-side for forks), never via an unsupported `compactRegion` instructions argument.

### R6 — Picker rules

The interactive picker is the TUI's native rewind overlay (Esc Esc), which lists **user-message rows**. The bundle's `tui/rewind-prompt` answer realizes the designed rules:

- the picked row is mapped to its enclosing `turn/start`, and that turn must have ended: a row in the still-open turn is ineligible (no plugin modes; the built-in rewind remains) until that turn ends. There is no mid-turn point;
- the fork cut is `turnStart.seq - 1` (the `boundarySeq` `tui/rewind-done` receives), never the picked row's seq;
- the confirm pane offers the **after** mode only, labeled "Rewind + compact after" (before mode is dropped from this surface — ADR D5 — and remains on the command and tool);
- no-ops are omitted: after-mode is not offered when the boundary is the last completed turn (no tail);
- ranges that already contain a prior summary stay selectable (nested compaction);
- the mode description carries the warning "N file(s) changed since this point — not reverted" when file-editing tools ran after the cut (v1 warns, does not revert — see R10).

**Acceptance**: the `tui/rewind-prompt` answer maps the picked message seq to its enclosing completed turn and returns the after mode with the id `rewind-compact-after` and the label "Rewind + compact after"; the code computes per-boundary validity for that boundary and omits the no-op mode; the files-changed warning is counted from the turn cut and appended to the mode description; a row in the open turn yields no modes; there is no code path that selects a mid-turn point.

### R7 — Gating

- The **tool** runs compact (mode `after`/`before` without rewind, i.e. shadow-in-place via the compaction contract — no fork) **ungated**.
- Any operation that rewinds (forks) is **gated**: the TUI picker path is the human's own action inside the TUI's rewind flow, and the decision-event subscriptions that enable it are themselves D-7-gated on the `session.rewind.intercept` grant (default deny — the user must grant it in the TUI's permission store); through the tool it requires **direct human authority in the current turn** — the harness's own authority pattern (a user-sourced `user/message` in the open turn, as in `dsh-tool-goal`'s `requireDirectHuman`). In profiles with no human (headless/sdk, goal-round turns) the check fails closed.

**Acceptance**: the tool's ungated path contains no fork call; the tool's fork path performs the direct-human authority check (a user-sourced `user/message` in the open turn, via the session turn-boundary projection); headless behavior is fail-closed (no silent fork).

### R8 — Coexistence

The built-in `/rewind`, `/compact`, and auto-compaction are untouched. The plugin adds alongside them; it must not disable, rename, or re-implement them.

**Acceptance**: the patch layer does not override or disable any `dsh-*` compaction/rewind entries.

### R9 — Profiles

The bundle loads in all profiles (that is automatic for a bundle); the TUI picker surface exists in the TUI profile. No profile-specific hacks.

**Acceptance**: the patch does not gate itself to one profile; README documents per-profile install (`dsh plugin --profile <name> ...`) and which surface works where.

### R10 — Files: warn, don't revert (v1)

v1 never reverts files. The plugin reports which files changed after the boundary (picker warning, R6; scaffold field, R5) and does nothing else to the filesystem.

**Acceptance**: no code performs file restoration, snapshotting, or git rollback; a comment or README line marks revert as explicitly deferred v2.

### R11 — Skill content

The shipped `SKILL.md` (skill `rewind-compact`) teaches the model, in this order:

1. When to propose a rewind-compact: context pressure climbing, work derailed, user signals "start over from X".
2. How to use the `rewind_compact` tool: compaction is ungated and safe (recoverable by design); rewind requires user approval and will surface a decision prompt.
3. The five-field scaffold format (R5) that compacted summaries must follow.
4. Post-fork etiquette: the pre-rewind session keeps existing and is resumable; files are NOT reverted in v1 — never claim they were.

**Acceptance**: the SKILL.md contains all four parts in order; its frontmatter sets `name: rewind-compact` and a description naming the trigger branches (rewind, compact, context pressure).

### R12 — Naming

- Bundle/package: `dsh-rewind-compact`.
- TUI command: `/rewind-compact`.
- Tool: `rewind_compact`.
- Skill directory: `rewind-compact`.
- Forked session title: `<original title> (rewound)`.

**Acceptance**: all five names appear exactly as written; the forked session's title is set from the pre-rewind session's title with the ` (rewound)` suffix.

## 4. Non-goals (v1)

Explicitly out of scope; do not build:

- File revert / rollback / snapshotting (R10).
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
3. A composed-config validation: run the harness's config dump (`dsh --dump-config`) against a **temporary copy** of the `dsh-tui` profile with the bundle added (never against the user's live profile; never boot the live TUI).
4. `README.md` exists and covers: what the plugin does, install per profile, the three surfaces, the v1 limitations (no revert; headless approval fails closed).
5. The repo layout is: `package.json`, `cordis.patch.yml`, `lib/` (or `src/` + build), `skill/rewind-compact/SKILL.md`, `README.md`, `SPEC.md` (this file, copied), `tests/` if applicable.

## 7. Hard constraints

- Never modify anything under `~/.dsh/` (profiles, sessions, storages) — the plugin is built and validated in the repo and a throwaway profile copy only.
- Never touch a live session transcript or its lock file.
- If a required seam (tool registration, skill registration) does not exist in the installed harness, do not invent a parallel runtime: implement the closest documented seam, and record the gap and the chosen fallback in `README.md` under "Harness seams used".
