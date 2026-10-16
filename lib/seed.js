/**
 * Fork-seed composition (SPEC R4) — pure, no harness imports, unit-testable.
 *
 * A seed is the event list of a fresh session: the kept side travels verbatim,
 * the discarded side is replaced by ONE summary message. Two envelope rules
 * apply, and both have bitten this repo live (TESTING.md, "Live-boot findings"):
 *
 *  - seed events carry only the allowed keys, a contiguous safe-integer `seq`
 *    and defined `data` (dsh-session `assertSessionEventEnvelope`);
 *  - every surface event's payload carries an identified message
 *    (dsh-session `assertMessageEventShape`). For `user/message` the `data`
 *    object IS the message, so it needs a non-empty `id`, `role: "user"`, a
 *    `source.kind`, and `content` as an array of blocks; `assistant/message`,
 *    `system/message` and `tool/result` carry theirs under `data.message`.
 *
 * Getting the user/message shape wrong fails the whole fork with
 * "seed user/message at index 0 lacks an identified message".
 */

import { randomUUID } from 'node:crypto';
import { surfaceEvents, SURFACE_TYPES } from './events.js';
import { buildScaffold } from './scaffold.js';

/** Plain-JSON copy of one seed event: validator keys only. Surface-eligible
 *  types carry the `append` marker; the source's own `surfaceOp` and
 *  `sourceEventSeqs` reference SOURCE seqs and must not travel into the
 *  renumbered child seed. */
export function materializeEvent(event) {
  const copy = { type: event.type, time: event.time, data: event.data };
  if (SURFACE_TYPES.has(event.type)) copy.surfaceOp = 'append';
  if (event.ignorable !== undefined) copy.ignorable = event.ignorable;
  return JSON.parse(JSON.stringify(copy));
}

/** The summary message payload — `user/message` data in the shape both the
 *  seed validator and an `append()` call expect. `append()` neither assigns
 *  nor requires an `id`, so the plugin must supply one: an id-less summary
 *  message stays valid in the transcript but fails the next fork with
 *  "session event at seq N lacks an identified message". */
export function summaryMessage(scaffold, { id = randomUUID() } = {}) {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text: scaffold }],
    source: { kind: 'plugin', plugin: 'dsh-rewind-compact' },
  };
}

/** One summary seed record: a `user/message` whose `data` is the message
 *  itself, in the shape the seed validator accepts. */
export function summaryEvent(scaffold, { id = randomUUID(), time = Date.now() } = {}) {
  return materializeEvent({ type: 'user/message', time, data: summaryMessage(scaffold, { id }) });
}

/**
 * Build the child seed for a boundary and mode (SPEC R4):
 *   after  — prefix verbatim + one summary of the discarded tail
 *   before — one summary of the discarded prefix + tail verbatim
 * `boundarySeq` is the inclusive end of the kept prefix (turnStart.seq - 1).
 * Seqs are renumbered contiguously from 0, which the seed validator requires.
 */
export function buildSeed(events, boundarySeq, mode, summary = {}) {
  const list = Array.isArray(events) ? events : [];
  // Every seed event is a plain copy: the child must not share mutable objects
  // with the live transcript (the harness adopts seeded events and freezes
  // their messages), and source-seq references must not travel with them.
  const prefix = surfaceEvents(list.slice(0, boundarySeq + 1)).map(materializeEvent);
  const tail = surfaceEvents(list.slice(boundarySeq + 1)).map(materializeEvent);
  const seedEvents =
    mode === 'after'
      ? [...prefix, summaryEvent(buildScaffold(tail), summary)]
      : [summaryEvent(buildScaffold(prefix), summary), ...tail];
  return seedEvents.map((event, index) => ({ ...event, seq: index }));
}
