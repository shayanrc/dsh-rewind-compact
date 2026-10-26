# RWC-003 — Surface-correct fork seed and inherited state

- **Status:** open
- **Priority:** P0
- **Type:** bug
- **Estimate:** L
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** RWC-001; coordinate with RWC-002
- **Blocks:** RWC-009, RWC-013, RWC-016
- **Spec:** R4, R5
- **Review:** 2026-10-27 review, P1-5

## Context

`lib/seed.js` builds the child seed by filtering raw events to five message
types, stripping `surfaceOp`/`sourceEventSeqs`, and renumbering. That is not
equivalent to the source’s current surface:

- A session with a prior compaction keeps the shadowed originals in the log.
  The seed resurrects them because it overwrites replacement `surfaceOp`s with
  `'append'`; the replacement summary may be excluded or duplicated.
  Demonstrated with a synthetic transcript.
- Only `system`/`user`/`assistant`/`tool-result` travel. Policy facts
  (`permission/preset`, `sandbox/mode`, `approval/policy`), `request/header`,
  agent preset, and `turn/start`/`turn/end` are dropped. The child can start
  with default permissions and no inherited turn history.
- `developer/message` is a surface type in 0.2.1 and is dropped by
  `SURFACE_TYPES` (`lib/events.js:14`).

The harness exposes `buildForkSeed`/`sliceLiveSessionSeed`-style raw-prefix
slicing, and the TUI preserves replacement surfaceOps. This ticket makes the
seed semantically faithful, not just validator-valid.

## Tasks

- [ ] Record the chosen strategy in the ticket/ADR:
      **A)** raw prefix slice like the TUI, seqs unchanged, keeping
      replacement `surfaceOp`s and their source references, then append the
      summary as a live child event; or
      **B)** fold the source surface (drop shadowed originals, keep replacement
      summaries) and build a renumbered message seed.
      Prefer A for after-mode; B only if before-mode needs a composed seed.
- [ ] Add `developer/message` to the surface type set; use the harness’s
      exported `isSurfaceEligibleType`/surface types rather than a local list
      where possible.
- [ ] If renumbering, remap any `surfaceOp.startSeq/endSeq` and
      `sourceEventSeqs`; do not strip valid references. If keeping seqs, stop
      renumbering.
- [ ] Preserve or replay inherited policy facts. For a cut that holds policy
      but no conversation, copy the latest facts into the child (as the TUI
      does with `latestPolicyFacts`/`replayPolicyFacts`) or keep them in the
      seed.
- [ ] Preserve turn markers so future `/rewind-compact` lists inherited turns;
      preserve `agentPreset` (also in RWC-002).
- [ ] Keep the after-mode summary last and the before-mode summary first; the
      summary remains one `user/message` built by `summaryMessage()`.
- [ ] Keep the source transcript unmutated and deep-copy every seed value.
- [ ] Add fixtures/tests:
      a prior-compaction transcript; a developer message; policy facts;
      multiple completed turns; a before/after pair.
- [ ] Update `AGENTS.md` seed invariant and `docs/HARNESS-CONTRACTS.md` §7–8.

## Acceptance criteria

- [ ] Seeding from a transcript with a prior replacement contains the
      replacement summary and **no** shadowed originals.
- [ ] A developer message in the kept side appears in the child.
- [ ] Policy facts from the kept prefix are present or replayed before the
      child’s first turn; the child does not silently reset permissions.
- [ ] Turn markers from the kept prefix are present; a `/rewind-compact` in the
      child can list at least the inherited completed turns as the harness
      allows.
- [ ] After-mode seed ends with the summary; before-mode seed starts with it.
- [ ] The source session’s events are byte-for-byte unchanged.
- [ ] All new fixtures pass the real seed validator on 0.2.1.

## Verification

```sh
npm test
npm run check
# inspect the child log after a fork from a pre-compacted session:
bash scripts/session-tail.sh <child-id> | grep -E 'compact|permission|sandbox|approval|turn/start'
```

Expected: replacement summary, no resurrected originals, policy facts/turn
markers present.

## Out of scope

- Child-side LLM compaction (RWC-004).
- Message source kind (RWC-009).
- Create-time metadata (RWC-002).

## Notes / evidence

- `lib/seed.js:28-33` forces `surfaceOp: 'append'` and drops
  `sourceEventSeqs`; `:62-73` filters `surfaceEvents` and renumbers.
- `lib/events.js:14` surface set excludes `developer/message`.
- 0.2.1 `SURFACE_EVENT_TYPES` includes `system`, `developer`, `user`,
  `assistant`, `tool/result`; tool calls are embedded in assistant messages.
- The TUI’s `sliceLiveSessionSeed` slices the raw prefix and preserves
  envelopes; the child’s `foldSurface` then applies replacements. That is the
  reference behavior.
