# RWC-004 — Retire the in-place compaction path (ADR D2)

- **Status:** open
- **Priority:** P0
- **Type:** bug
- **Estimate:** S (retire)
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001 (RWC-015 signed 2026-10-27)
- **Blocks:** RWC-007, RWC-011, RWC-016
- **Spec:** R2, R5, R7
- **Review:** 2026-10-27 review, P0-1

## Post-ADR scope (authoritative, 2026-10-27)

ADR D2 retires the in-place path for v1. Implement **only the retire branch**:
remove the `compactRegion` call and the append-before-compaction sequence;
return a documented retired result (no fork, no transcript mutation) with a
`note`/`reason`; update the tool output schema/description, the SKILL/README
claims, and add a regression test. Do not implement the repair branch below;
it is historical. RWC-007 then covers error surfacing for the remaining paths.

## Context

The tool’s `rewind: false` branch (`lib/tool.js:145-179`) appends a scaffold
`user/message`, then calls `compaction.compactRegion(range.start, range.end + 1,
agent, undefined)`. On 0.2.1 this cannot succeed:

- `compactRegion` requires `start` and `end` to be nodes of the current
  `session.surface` (message events). `modeRange()` returns raw seqs:
  `turn/start + 1` is typically `agent/inbox/spliced` or `step/start` (verified:
  turn/start 10 → seq 11 non-surface; first surface seq 14). It throws
  `start seq 11 not found in surface`.
- The end is unbalanced while the tool’s own call is open: the assistant
  message embeds the `tool-call` block, and `toolPairingBalancedAfter` rejects a
  cut after the scaffold. Verified: assistant seq 28 has a `tool-call` block;
  its result arrives only after `execute` returns.
- The start would land on a per-step `system/message`, so a “working” range
  would summarize the system prompt.
- The scaffold is appended before validation; a rejection leaves a stray fake
  user message in the live session.
- `AGENTS.md` describes the end as exclusive; 0.2.1 treats it as inclusive.
- `rewind.js` probes `compaction.settle()`, which does not exist in 0.2.1.

The web E2E never caught this because the web template has no compaction
service; the only exercised path was the fork.

## Tasks

- [x] **Decision input:** RWC-015 chooses repair vs retire. Record the choice in
      this ticket before coding. (D2: retire.)
- [ ] If **repair**:
      - build the range from `session.surface.nodes`, not raw seqs;
      - start at the first non-system user/assistant surface node after the
        cut (exclude the system head and runtime-context messages as the
        engine’s own range selection does);
      - end at the last balanced surface node **before** the open step, or
        defer tail compaction to `agent/turn-stopping` / the next step when the
        full tail must be included;
      - validate membership + balance (`toolPairingBalancedBefore/After`) before
        appending anything;
      - keep the scaffold inside the range only when the engine can accept it;
        otherwise append the scaffold after a successful compaction and
        document the “summary then scaffold” order;
      - pass an `AbortSignal` and handle cancellation.
- [ ] If **retire**: remove the `compactRegion` call and the `applied/hybrid`
      in-place contract; return a documented unsupported result (or make the
      tool fork-only); update output schema, SKILL, README, SPEC.
- [ ] Fix `compactedRange` to report the actual inclusive range; do not report
      a range when nothing was shadowed.
- [ ] Remove the dead `settle` probe (or gate it on a verified capability).
- [ ] Add a unit test with a fake surface (non-surface seqs, open tool call,
      system head) and a live test on a compaction-enabled profile.
- [ ] Update `AGENTS.md` gotchas: 0.2.1 end is inclusive; surface-node and
      balance preconditions.

## Acceptance criteria

- [ ] `compactRegion` never receives a non-surface or unbalanced seq in any
      code path.
- [ ] On a profile with compaction (e.g. a scratch `dsh-base`/sdk-minimal
      profile), the ungated path either succeeds with a real summary containing
      the scaffold, or returns the documented retired result — no unhandled
      throw.
- [ ] A forced rejection leaves the session transcript unchanged (no stray
      scaffold).
- [ ] `applied` is true only when a range was actually shadowed;
      `compactedRange` matches the shadowed range.
- [ ] The tool result/renderer do not claim a summary when the profile has no
      compaction service.
- [ ] Tests fail on the pre-fix code.

## Verification

```sh
# scratch profile with compaction; then ask the model for rewind_compact rewind:false
bash scripts/session-tail.sh <session-id> | grep -E 'compaction/|rewind-compact'
npm test
```

Expected: valid `compaction/start` + summary + `compaction/end`; no error; no
stray scaffold on failure.

## Out of scope

- Fork-path summarization (RWC-002/RWC-003/RWC-006).
- Changing the compaction engine.

## Notes / evidence

- `compactSurfaceRegion` docs: `start`/`end` inclusive, must exist in
  `session.surface.nodes`, balanced before/after.
- `validateSurfaceRegion` throws `start seq … not found in surface` and
  `… is not a balanced boundary`.
- `toolPairingBalancedAfter` counts `assistant/message` tool-call blocks minus
  `tool/result`; an in-flight call makes the tail cut unbalanced.
- `modeRange` for before-mode returns `end = turnStart`, so the `+1` includes
  the selected turn’s first message; that is also semantically off by one turn.
