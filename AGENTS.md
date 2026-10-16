# dsh-rewind-compact

Navigation pointers — read the target only when the branch fires:

- Implementing or changing behavior → `SPEC.md` (requirements R1–R12 + acceptance criteria).
- Harness API facts (tool/skill/command dialects, fork recipe, transcript envelope, decision events, pnpm quirks) → `docs/HARNESS-CONTRACTS.md`.
- Verifying (web/TUI test runs, grants, live-boot findings) → `TESTING.md`.
- Before claiming done → run `npm run check` (contract probe + syntax + tests).

## Surface map — where a change goes

All four surfaces register in `lib/index.js` (`apply` → one `ctx.effect`); edit the owning file, never the entry.

| Surface / change | File | Flow |
|---|---|---|
| `rewind_compact` tool — gates, output schema | `lib/tool.js` | point → boundary → `rewind:true` forks (direct-human gate; fails closed headless) · `rewind:false` appends the scaffold, then shadows the range via `ctx.compaction.compactRegion` |
| `/rewind-compact` command | `lib/command.js` | `boundaryOptions` → fast path `<turn> [after\|before]`, else `ctx.userQuestions.ask` picker → `forkAtBoundary` |
| Esc-Esc picker modes | `lib/tui-rewind.js` | `tui/rewind-prompt` offers both modes (no-op side omitted); `tui/rewind-done` composes the child after the TUI's own fork — tail summary (after) or replay tail + trailing prefix summary (before) |
| Skill text | `skill/rewind-compact/SKILL.md` | instructions only, routing the model into the tool. Read at load; frontmatter stripped |
| Fork recipe | `lib/rewind.js` | settle → cut at `turnStart.seq - 1` → compose the seed per mode → `agents.create` |
| Five-field summary | `lib/scaffold.js` | pure; pairs `tool/call` ↔ `tool/result` by callId |
| Transcript access | `lib/events.js` | the only module that knows event shapes |

## Invariants a change must preserve

- The pre-rewind session is never mutated: forks use `agents.create` with a fresh `SessionId` and a sliced seed, never `sessions.fork()`. The discarded side stays resumable.
- `forkAtBoundary` never cancels its caller — the calling turn is the one rendering the completion message.
- Fork paths return `hybrid: false`; only the tool's in-place path sets `hybrid: true`.
- `inject` omits `compaction` and `logger` so profiles without the compaction bundle still load — reach both through `probeService`, and keep scaffold-only summaries working when compaction is absent.
- Files are reported, never reverted (v1).

## Gotchas

- `boundaryForPoint` (`lib/events.js`) falls back to the newest boundary for any out-of-range number: `0`, `99`, and `-1` all resolve to the last turn. Only a non-numeric miss errors as "Unknown turn".
- `compactRegion(range.start, range.end + 1, …)` spans the just-appended scaffold message on purpose — that is how the scaffold lands inside the compacted range.
- Transcripts carry two shapes (agent-session, surface/child-seed); go through the `events.js` accessors rather than reading `data` fields directly.

Delegation pattern for this environment: delegate **read-and-report research** or **content-dictated file writes** (micro-scoped); avoid open-ended implementer briefs — code-generating subagents stall on long generations here.
