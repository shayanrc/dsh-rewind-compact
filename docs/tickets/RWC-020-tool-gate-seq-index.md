# RWC-020 — Tool human gate assumes event index equals seq

- **Status:** open
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

- [ ] Map seq → index explicitly: `const startIdx = events.findIndex((e) => e.seq === openTurnStartSeq)`; fail closed when not found; scan `startIdx + 1 … end`.
- [ ] Add a regression test with a transcript whose pre-seq row count is 0 and
      one with ≥2, covering: human in open turn forks; agent-initiated open
      turn fails closed even though the previous turn had a human message.
- [ ] Keep the existing fail-closed tests green (non-human source, non-root,
      missing projection).
- [ ] AGENTS gotcha: boundary helpers are seq-based; array scans must map
      seq → index first.
- [ ] After landing: rerun `npm run check` and the §6.3 live gate before
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
