/**
 * Fork-seed composition (SPEC R4/R5) — pure, no harness imports, unit-testable.
 *
 * A seed is the event list of a fresh session. Two strategies, recorded in
 * RWC-003:
 *
 *  - **after mode — raw prefix slice (strategy A).** Keep the source log
 *    verbatim through the cut, seqs unchanged, so every envelope travels with
 *    it: replacement `surfaceOp`s and their `sourceEventSeqs`, developer
 *    messages, policy facts, request headers, and turn markers. The child's
 *    own surface fold therefore reproduces the source prefix (shadowed
 *    originals stay shadowed) and the one summary record is appended last.
 *  - **before mode — folded, renumbered message seed (strategy B).** A
 *    prepended summary makes seqs move, so keep the CURRENT surface tail only
 *    (fold replacements: keep the replacement, drop what it shadowed) plus
 *    turn markers, policy facts, and preset selection, renumbered from 0. The
 *    summary comes first. Append-only provenance on folded tail records is
 *    dropped; their content is already the current surface node.
 *
 * Envelope rules both strategies obey, and both have bitten this repo live
 * (TESTING.md, "Live-boot findings"):
 *  - seed events carry only the allowed keys, a contiguous safe-integer `seq`
 *    and defined `data` (dsh-session `assertSessionEventEnvelope`);
 *  - every surface event's payload carries an identified message
 *    (dsh-session `assertMessageEventShape`). For `user/message` the `data`
 *    object IS the message; `assistant/message`, `developer/message`,
 *    `system/message` and `tool/result` carry theirs under `data.message`.
 *
 * The summary's `source.kind` is the declared `rewind-compact` kind
 * (lib/message-source.d.ts); the retired `{kind: 'plugin', plugin}` wrapper is
 * rejected at V4 admission in the documented contract.
 */

import { randomUUID } from 'node:crypto';
import {
  KEPT_LOG_TYPES,
  POLICY_FACT_TYPES,
  SURFACE_TYPES,
  foldSurfaceRecords,
  seedSourceEvents,
} from './events.js';
import { buildScaffold } from './scaffold.js';

/**
 * Declared message source for the five-field scaffold summary (SPEC R5,
 * RWC-009). 0.2.1 has no catch-all `plugin` kind; producers declare their own
 * kind by module augmentation (see lib/message-source.d.ts). The session
 * validator accepts any non-empty user-source kind; the Web conversation UI
 * renders an unknown kind as injected context labelled with the kind, and
 * session projections exclude it from the human conversation.
 */
export const SUMMARY_SOURCE_KIND = 'rewind-compact';
export const SUMMARY_SOURCE = Object.freeze({ kind: SUMMARY_SOURCE_KIND });

/**
 * The summary message payload — `user/message` data in the shape both the
 * seed validator and an `append()` call expect. `append()` neither assigns nor
 * requires an `id`, so the plugin must supply one: an id-less summary message
 * stays valid in the transcript but fails the next fork with
 * "session event at seq N lacks an identified message".
 */
export function summaryMessage(scaffold, { id = randomUUID() } = {}) {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text: scaffold }],
    source: { ...SUMMARY_SOURCE },
  };
}

/** One summary seed record without a seq (buildSeed assigns it): a
 *  `user/message` whose `data` is the message itself. */
export function summaryEvent(scaffold, { id = randomUUID(), time = Date.now() } = {}) {
  return {
    type: 'user/message',
    time,
    data: summaryMessage(scaffold, { id }),
    surfaceOp: 'append',
  };
}

/**
 * Plain-JSON copy of one seed event with validator keys only. `seq`, the
 * surface marker and `sourceEventSeqs` are preserved exactly — after mode keeps
 * the source's seqs, so its references remain valid. Non-surface events never
 * carry surface metadata; the copy keeps `ignorable` when the source had it.
 */
export function copySeedEvent(event) {
  const copy = { type: event.type, seq: event.seq, time: event.time, data: event.data };
  if (event.surfaceOp !== undefined) copy.surfaceOp = event.surfaceOp;
  if (event.sourceEventSeqs !== undefined) copy.sourceEventSeqs = event.sourceEventSeqs;
  if (event.ignorable !== undefined) copy.ignorable = event.ignorable;
  return JSON.parse(JSON.stringify(copy));
}

/** Reject a log whose seqs are not contiguous from 0 (a torn/imported log). */
function assertContiguous(list) {
  list.forEach((event, index) => {
    if (event.seq !== index) {
      throw new Error(`rewind source events are not contiguous from seq 0 (expected ${index}, got ${event.seq})`);
    }
  });
}

/**
 * Input for the scaffold: log-only records (tool/call pairing, policy facts)
 * plus the CURRENT surface of the compacted side, so shadowed originals never
 * leak into the summary and tool results still pair with their calls.
 *
 * Exported because the TUI after-mode path builds the same summary from a
 * source transcript it did not seed. Passing only `surfaceEvents()` there
 * dropped every `tool/call`, so `Files changed`, `Commands run`, and `Errors
 * encountered` came out empty even though the picker warning counted the same
 * calls (RWC-006/010).
 */
export function summaryInput(events, boundarySeq, side) {
  const list = seedSourceEvents(events);
  const inSide = (event) => (side === 'prefix' ? event.seq <= boundarySeq : event.seq > boundarySeq);
  const surface = foldSurfaceRecords(list).filter(inSide);
  const logOnly = list.filter((event) => !SURFACE_TYPES.has(event.type) && inSide(event));
  return [...logOnly, ...surface].sort((a, b) => a.seq - b.seq);
}

/**
 * Latest policy fact of each kind in the discarded prefix (before mode).
 * A before-mode child keeps the tail but still inherits the permission /
 * sandbox / approval baseline the prefix established; without this replay the
 * child silently resets to harness defaults (RWC-003, ADR D4). Later tail facts
 * stay in the tail and override these because they come after them.
 */
function latestPrefixPolicyFacts(list, boundarySeq) {
  const latest = new Map();
  for (const event of list) {
    if (event.seq > boundarySeq) break;
    if (POLICY_FACT_TYPES.has(event.type)) latest.set(event.type, event);
  }
  return [...latest.values()].sort((a, b) => a.seq - b.seq);
}

/** The kept tail of a before-mode seed: the source's current surface after the
 *  cut, plus the log-only facts a child needs to keep its policy and turn
 *  history. Shadowed originals and event-local source references stay behind. */
function keptTail(list, boundarySeq) {
  const surface = foldSurfaceRecords(list).filter((event) => event.seq > boundarySeq);
  const logOnly = list.filter((event) => (
    event.seq > boundarySeq && !SURFACE_TYPES.has(event.type) && KEPT_LOG_TYPES.has(event.type)
  ));
  return [...surface, ...logOnly].sort((a, b) => a.seq - b.seq);
}

function hasToolChangeBlocks(message) {
  return Array.isArray(message?.content)
    && message.content.some((block) => block?.type === 'tool-addition' || block?.type === 'tool-removal');
}

/** Renumber one kept tail record into the composed seed. A surface record is a
 *  current surface node, so it enters as a plain append; a developer message
 *  whose request header is not in the seed loses the dangling `headerSeq`
 *  (tool-addition messages are dropped, because they cannot validate without
 *  it — the child recomposes tools from `meta.agentPreset`). */
function renumberTailEvent(event, newSeq) {
  const copy = copySeedEvent(event);
  copy.seq = newSeq;
  if (!SURFACE_TYPES.has(event.type)) return copy;
  copy.surfaceOp = 'append';
  delete copy.sourceEventSeqs;
  if (event.type === 'developer/message' && copy.data?.headerSeq !== undefined) {
    if (hasToolChangeBlocks(copy.data.message)) return undefined;
    delete copy.data.headerSeq;
  }
  return copy;
}

/**
 * Build the child seed for a boundary and mode (SPEC R4):
 *   after  — current source prefix verbatim (seqs unchanged) + one summary last
 *   before — one summary first + folded current tail, renumbered from 0
 * `boundarySeq` is the inclusive end of the kept prefix (turnStart.seq - 1).
 * Every value is a deep copy: the source transcript is never mutated.
 */
export function buildSeed(events, boundarySeq, mode, summary = {}) {
  const list = seedSourceEvents(events);
  if (!Number.isSafeInteger(boundarySeq)) throw new TypeError('rewind boundary must be an integer event seq');
  assertContiguous(list);

  if (mode === 'before') {
    const summaryRecord = {
      ...summaryEvent(buildScaffold(summaryInput(list, boundarySeq, 'prefix')), summary),
      seq: 0,
    };
    // Summary first (R4), then the inherited policy baseline from the
    // discarded prefix, then the kept tail. The baseline is renumbered like
    // the tail; tail facts later in the log still win at replay time.
    const tail = [
      ...latestPrefixPolicyFacts(list, boundarySeq),
      ...keptTail(list, boundarySeq),
    ]
      .map((event, index) => renumberTailEvent(event, index + 1))
      .filter((event) => event !== undefined);
    return [summaryRecord, ...tail];
  }

  const prefix = list.filter((event) => event.seq <= boundarySeq);
  if (prefix.length !== boundarySeq + 1) {
    throw new Error(`rewind boundary ${boundarySeq} is outside this transcript`);
  }
  const summaryRecord = {
    ...summaryEvent(buildScaffold(summaryInput(list, boundarySeq, 'tail')), summary),
    seq: boundarySeq + 1,
  };
  return [...prefix.map(copySeedEvent), summaryRecord];
}
