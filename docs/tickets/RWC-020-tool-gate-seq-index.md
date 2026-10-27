# RWC-020 — Tool human gate assumes event index equals seq

- **Status:** in-progress (implementation + tests green; awaiting independent code review + acceptance check)
- **Priority:** P1
- **Type:** bug (robustness)
- **Estimate:** S
- **Owner:** unassigned
- **Created:** 2026-10-27
- **Depends on:** —
- **Blocks:** —
- **Spec:** R7
- **Review:** 2026-10-27 live attempt to run `rewind_compact`

## Context

`hasDirectHumanInput` (`lib/tool.js`) scans the open turn with:

```js
for (let seq = openTurnStartSeq + 1; seq < events.length; seq += 1) {
  const event = events[seq];
```

It uses the loop variable as an **array index** while it is actually an event
**seq**. The two coincide only because a v4 transcript has exactly one row
before seq 0 (the session header), so `index == seq + 1` and the scan window
starts one row early — at the `turn/start` itself — which happens to be safe
for human detection.

That coupling breaks the gate in both directions when the pre-seq row count
differs (legacy rows, extra header metadata, a projection that reports the
boundary differently):

- **k = 0** rows before seq 0 → the scan starts one row *late* and can miss a
  human message that immediately follows `turn/start` (fail closed).
- **k ≥ 2** rows → the scan starts early enough to reach the *previous* turn's
  human message, so an agent-initiated turn (heartbeat/goal) could pass the
  gate (fail **open** — an unauthorized fork).

A earlier P0 alarm ("the gate always fails closed") was a test-harness
artifact: the probe passed `{ agent: { session } }` — a fresh wrapper — while
`agents.roots()` contained a different object, so `roots().includes(agent)`
failed first. With matching agent identity the gate passes on a realistic
seq≠index fixture and on the live session. The structural fragility above is
the real (smaller) issue.

## Tasks

- [x] Map seq → index explicitly: `const startIdx = events.findIndex((e) => e.seq === openTurnStartSeq)`; fail closed when not found; scan `startIdx + 1 … end`.
- [x] Add a regression test with a transcript whose pre-seq row count is 0 and
      one with ≥2, covering: human in open turn forks; agent-initiated open
      turn fails closed even though the previous turn had a human message.
- [x] Keep the existing fail-closed tests green (non-human source, non-root,
      missing projection).
- [x] AGENTS gotcha: boundary helpers are seq-based; array scans must map
      seq → index first.
- [x] After landing: rerun `npm run check` and the §6.3 live gate before
      reinstalling into live profiles.

## Acceptance criteria

- [ ] The gate passes only when a human-sourced message exists strictly inside
      the open turn, regardless of the pre-seq row count (0, 1, ≥2 fixtures).
- [ ] No fail-open path exists when the open turn has no human message.
- [ ] Regression tests fail before the fix.
- [ ] `npm test` and `npm run check` green on the declared harness line.

## Verification

```sh
npm test
node scripts/check-contracts.mjs
```

Expected: gate correct under all pre-seq row counts; no fail-open.

## Out of scope

- Changing the direct-human authority model (R7 / ADR D6).
- The command surface (no gate there by design — user-invoked).

## Notes / evidence

- Corrected repro (`agent` identity matched): human in open turn → passes the
  gate (fork then fails only in the mock harness, expected); no human in open
  turn → `REWIND_COMPACT_APPROVAL_REQUIRED`.
- Live session `da55c85a-…` has exactly one pre-seq row, so `index == seq + 1`
  — the gate works today by that coincidence.
- **Arithmetic correction (implementation, 2026-10-27):** with k = 0 pre-seq
  rows and 0-based contiguous seqs, `index == seq`, so the old scan starts
  exactly at the open turn's first row — the fail-closed direction needs a log
  whose seqs start past 0 (sliced/imported: `index < seq`), which the new
  regression test uses (seqs start at 1; the gate must pass, and the fork then
  rejects the torn log in `buildSeed` — proof the gate let the human input
  through). The k ≥ 2 fail-open direction is as diagnosed: with k = 3 the old
  scan starts two rows before the turn/start and reads the previous turn's
  trailing human message; the regression test shows a full unauthorized fork
  (`agents.create` reached) before the fix.
- Regression tests fail before the fix exactly as required: 3 of 5 new tests
  failed on the pre-fix code (fail-open ×2, fail-closed ×1); 2 are k-coverage
  (human in open turn forks under both old and new code). `npm test` 86/86 and
  `npm run check` green after the fix.
- **Review reconciliation (independent code review, 2026-10-27):** the original
  claim that a live v4 snapshot carries one pre-seq row (`index == seq + 1`)
  conflicts with the harness core's contiguity contract (`seq = log.length`,
  `eventAt(seq) = log[seq]`) and `lib/events.js`'s own note that
  `snapshotEvents()` never contains the physical header — the observation
  almost certainly read the JSONL *file*, which does begin with a header line.
  Live snapshots are `index === seq` (k = 0), so the gate worked by design
  there, not by coincidence. The fix is correct under every shape regardless
  (k = 0, 1, ≥2 pre-seq rows; seqs starting past 0 — all pinned by tests,
  including a k=1 gate test added after review). Review findings addressed:
  AGENTS gotcha reworded; `isDirectHumanMessage` extracted into `events.js`
  (the module that owns event shapes).
