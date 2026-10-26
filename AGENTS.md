# dsh-rewind-compact

Navigation pointers — read the target only when the branch fires:

- Implementing or changing behavior → `SPEC.md` (requirements R1–R12 + acceptance criteria).
- Harness API facts (tool/skill/command dialects, fork recipe, transcript envelope, decision events, pnpm quirks) → `docs/HARNESS-CONTRACTS.md`.
- Verifying (web/TUI test runs, grants, live-boot findings) → `TESTING.md`.
- Running a test end to end (refresh a profile, boot the web rig, drive the TUI picker, read a pass) → `.agent/skills/testing-rewind-compact/SKILL.md` (+ its `scripts/` for transcript forensics).
- Before claiming done → run `npm run check` (contract probe + syntax + tests).

## Surface map — where a change goes

All four surfaces register in `lib/index.js` (`apply` → one `ctx.effect`); edit the owning file, never the entry.

| Surface / change | File | Flow |
|---|---|---|
| `rewind_compact` tool — gates, output schema | `lib/tool.js` | point → boundary → `rewind:true` forks (direct-human gate; fails closed headless) · `rewind:false` appends the scaffold, then shadows the range via `ctx.compaction.compactRegion` |
| `/rewind-compact` command | `lib/command.js` | `boundaryOptions` → fast path `<turn> [after\|before]`, else `ctx.userQuestions.ask` picker → `forkAtBoundary` |
| Esc-Esc picker modes | `lib/tui-rewind.js` | `tui/rewind-prompt` offers both modes (no-op side omitted); `tui/rewind-done` composes the child after the TUI's own fork — tail summary (after) or replay tail + trailing prefix summary (before) |
| Skill text | `skill/rewind-compact/SKILL.md` | instructions only, routing the model into the tool. Read at load; frontmatter stripped |
| Fork recipe | `lib/rewind.js` | settle → cut at `turnStart.seq - 1` → `buildSeed` → `agents.create` |
| Seed composition (kept side verbatim + one summary) | `lib/seed.js` | pure; owns the message envelopes the seed validator enforces |
| Five-field summary | `lib/scaffold.js` | pure; pairs `tool/call` ↔ `tool/result` by callId |
| Transcript access | `lib/events.js` | the only module that knows event shapes |

## Invariants a change must preserve

- The pre-rewind session is never mutated: forks use `agents.create` with a fresh `SessionId` and a sliced seed, never `sessions.fork()`. The discarded side stays resumable.
- `forkAtBoundary` never cancels its caller — the calling turn is the one rendering the completion message.
- Fork paths return `hybrid: false`; only the tool's in-place path sets `hybrid: true`. The tool's `applied` field is the honest signal — a no-op reports `applied: false` + a `note`.
- A summary record's `data` IS the message (`id`, `role`, `source.kind`, `content` blocks); the assistant-style `data.message` nesting fails the fork at index 0. Both append sites and the seed build that payload through `summaryMessage()` in `lib/seed.js`, because `session.append()` assigns no `id`.
- `inject` omits `compaction` and `logger` so profiles without the compaction bundle still load — reach both through `probeService`, and keep scaffold-only summaries working when compaction is absent.
- Files are reported, never reverted (v1).

## Gotchas

- `boundaryForPoint` (`lib/events.js`) fails closed: only an in-range 1-based turn number, the documented `-1` (newest) alias, or an exact turn-id match resolves. `0`, `99`, `-2`, `2.5`, `''`, and non-matches return `undefined` — there is no fallback to the last boundary. The command fast path likewise accepts only `after`/`before` (omitted mode = `after`) and returns a usage error for any other token.
- `compactRegion(range.start, range.end + 1, …)` takes an exclusive end. In `after` mode that end is the scaffold message appended just before, so the scaffold lands inside the compacted range as its final message (the hybrid path). In `before` mode the appended scaffold sits at the transcript end, outside the compacted prefix — the summarizer never sees it (v1 gap, not yet exercised against a live compaction service).
- Transcripts carry two shapes (agent-session, surface/child-seed); go through the `events.js` accessors rather than reading `data` fields directly.

Delegation pattern for this environment: delegate **read-and-report research** or **content-dictated file writes** (micro-scoped); avoid open-ended implementer briefs — code-generating subagents stall on long generations here.
