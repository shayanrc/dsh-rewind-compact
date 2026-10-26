# dsh-rewind-compact

Navigation pointers — read the target only when the branch fires:

- Implementing or changing behavior → `SPEC.md` (requirements R1–R12 + acceptance criteria).
- Harness API facts (tool/skill/command dialects, fork recipe, transcript envelope, decision events, pnpm quirks) → `docs/HARNESS-CONTRACTS.md`.
- Verifying (web/TUI test runs, grants, live-boot findings) → `TESTING.md`.
- Running a test end to end (refresh a profile, boot the web rig, drive the TUI picker, read a pass) → `.agent/skills/testing-rewind-compact/SKILL.md` (+ its `scripts/` for transcript forensics).
- Ticket board (statuses, owners, next up) → `docs/tickets/README.md`; waves, dependency edges, and parallel-safe lanes → `docs/tickets/dependency-graph.md`. (`docs/task_dependencies.mmd` is historical — not a status source.)
- Before claiming done → run `npm run check` (contract probe + syntax + tests).

## Surface map — where a change goes

All four surfaces register in `lib/index.js` (`apply` → one `ctx.effect`); edit the owning file, never the entry.

| Surface / change | File | Flow |
|---|---|---|
| `rewind_compact` tool — gates, output schema | `lib/tool.js` | point → boundary → `rewind:true` forks (direct-human gate; fails closed headless) · `rewind:false` is retired in v1: no fork, no scaffold append, no `compactRegion` call; returns the documented unsupported result (`ok:false`, `applied:false`, `reason:"in_place_retired"`, note → fork path) |
| `/rewind-compact` command | `lib/command.js` | `boundaryOptions` → fast path `<turn> [after\|before]` (both modes kept; omitted = after), else `ctx.userQuestions.ask` picker → `forkAtBoundary` |
| Esc-Esc picker modes | `lib/tui-rewind.js` | `tui/rewind-prompt` offers **after only** (no-op side omitted); `tui/rewind-done` runs after the TUI's own fork and appends a five-field scaffold of the discarded tail to the TUI-forked child (child = prefix); a before-mode done gets an error toast |
| Skill text | `skill/rewind-compact/SKILL.md` | instructions only, routing the model into the tool. Read at load; frontmatter stripped |
| Fork recipe | `lib/rewind.js` | cut at `turnStart.seq - 1` → `buildSeed` → `agents.create` (no compaction settle); every fork path returns `hybrid:false` — v1 summaries are scaffold-only |
| Seed composition | `lib/seed.js` | pure; after = kept prefix verbatim + summary last; before = summary first + latest prefix policy facts + folded/renumbered tail; owns the message envelopes the seed validator enforces |
| Five-field summary | `lib/scaffold.js` | pure; pairs `tool/call` ↔ `tool/result` by callId |
| Transcript access | `lib/events.js` | the only module that knows event shapes |

## Invariants a change must preserve

- The pre-rewind session is never mutated: forks use `agents.create` with a fresh `SessionId` and a sliced seed, never `sessions.fork()`. The discarded side stays resumable.
- `forkAtBoundary` never cancels its caller — the calling turn is the one rendering the completion message.
- Fork paths return `hybrid: false` — every shipped path, on every surface; v1 summaries are scaffold-only. The tool's `applied` field is the honest signal: the retired `rewind:false` call reports `ok:false`, `applied:false`, `reason:"in_place_retired"`, and a note pointing at the fork path — never success and never a silent no-op.
- A summary record's `data` IS the message (`id`, `role`, `source.kind`, `content` blocks); the assistant-style `data.message` nesting fails the fork at index 0. The TUI append site and the seed builder both construct that payload through `summaryMessage()` in `lib/seed.js`, because `session.append()` assigns no `id`.
- `inject` omits `compaction` and `logger` so profiles without the compaction bundle still load — reach both through `probeService`, and keep scaffold-only summaries working when compaction is absent.
- Files are reported, never reverted (v1). `Files changed` is conservative: only `write`/`edit` path arguments (plus structured result metadata where present) count; reads, searches, web fetches, and bash prose never do; the scaffold and `filesChangedSince()` share `changedFiles()` so the summary and warning agree.

## Gotchas

- `boundaryForPoint` (`lib/events.js`) fails closed: only an in-range 1-based turn number, the documented `-1` (newest) alias, or an exact turn-id match resolves. `0`, `99`, `-2`, `2.5`, `''`, and non-matches return `undefined` — there is no fallback to the last boundary. The command fast path likewise accepts only `after`/`before` (omitted mode = `after`) and returns a usage error for any other token.
- `ctx.compaction` is never called in v1: no path invokes `compactRegion` or `compactNow`. The hybrid seam is a v2 target only; `compactRegion(start, end, agent, signal)` takes **inclusive** surface-node seqs on an open turn with balanced edges (see `docs/HARNESS-CONTRACTS.md` §6). Do not reintroduce the retired in-place after/before range design as current behavior.
- The TUI after-mode scaffold must be built with `summaryInput(sourceEvents, boundary, 'tail')` — log-only records (`tool/call`, policy facts) plus the folded current surface. Using `surfaceEvents()` alone drops every `tool/call`, so `Files changed`, `Commands run`, and `Errors encountered` come out empty even though the picker warning counted them.
- A failed `tui/rewind-done` scaffold append must return a non-empty error toast naming the prefix-only child and the intact source. Returning `undefined` lets the TUI's own success toast stand over a child that lacks its summary.
- Transcripts carry two shapes (agent-session, surface/child-seed); go through the `events.js` accessors rather than reading `data` fields directly.

Delegation pattern for this environment: delegate **read-and-report research** or **content-dictated file writes** (micro-scoped); avoid open-ended implementer briefs — code-generating subagents stall on long generations here.
