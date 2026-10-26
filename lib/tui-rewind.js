/**
 * TUI-native interactive picker integration (SPEC R3.1, R6) — the sanctioned
 * plugin seam for the Double-Esc rewind picker:
 *
 * - `tui/rewind-prompt` (permission `session.rewind.intercept`, D-7 default
 *   deny): answered with the plugin's after mode only (ADR D5). The confirm
 *   pane renders it as a choice under the built-in conversation rewind.
 *   `payload.seq` is the picked MESSAGE's seq: it is mapped to the enclosing
 *   completed turn (ADR D4), never compared to turn/start seqs.
 * - `tui/rewind-done`: dispatched AFTER the TUI forks at the chosen boundary;
 *   the payload carries the chosen mode and both session ids. The TUI's child
 *   holds only the prefix; this bundle appends a scaffold summary of the
 *   discarded tail (source stays untouched) and returns the toast string.
 *   A before-mode done event (not offered here) returns an error toast.
 *
 * The fork itself stays the TUI's (it owns the picker, cancellation, and
 * adoption) — this bundle never re-forks in the TUI flow (SPEC R2). Forked
 * children have no open turn, so child-side compactRegion is structurally
 * unavailable; the summaries here are scaffold-only (SPEC R5 fallback), and
 * the hybrid is reported honestly.
 */

import { buildScaffold } from './scaffold.js';
import { summaryMessage } from './seed.js';
import {
  surfaceEvents, enclosingCompletedTurnStart, listTurnBoundaries, isNoOp,
  filesChangedSince, probeService, probeLogger,
} from './events.js';

export const MODE_AFTER = 'rewind-compact-after';
export const MODE_BEFORE = 'rewind-compact-before';

function sessionFor(ctx, sessionId) {
  const sessions = probeService(ctx, 'sessions');
  const byId = sessions?.get?.(sessionId);
  if (byId) return byId;
  const agents = probeService(ctx, 'agents');
  const agent = agents?.get?.(sessionId);
  return agent?.session;
}

/**
 * `tui/rewind-prompt` answer: offer the after mode only (ADR D5 — before mode
 * stays on the command and tool), with a files-changed warning derived from
 * the turn cut (R10: warn, never revert). Returns undefined when nothing is
 * usable: the picked row is not inside a completed turn, the cut precedes the
 * first event, or the after side is a no-op (R6).
 *
 * `payload.seq` is the picked message's seq. Map it to the enclosing
 * completed turn, then find that boundary's chronological index; the fork cut
 * is `turnStart.seq - 1`, matching what `tui/rewind-done` receives as
 * `boundarySeq`.
 */
export function rewindPromptAnswer(ctx, payload) {
  const seq = payload?.seq;
  if (!Number.isFinite(seq)) return undefined;
  const session = sessionFor(ctx, payload.sessionId);
  const events = session?.snapshotEvents?.() ?? [];

  const turnStart = enclosingCompletedTurnStart(events, seq);
  if (!turnStart) {
    // Row in the still-open turn or outside any turn: no boundary to fork at.
    // Ineligible until that turn ends; the pane falls back to the TUI's
    // built-in rewind, and the same row becomes selectable afterwards (D4).
    probeLogger(ctx).debug?.(`[rewind-compact] picked row seq ${seq} is not inside a completed turn; no TUI modes`);
    return undefined;
  }

  const cut = turnStart.seq - 1;
  // The TUI's own fork rejects a cut before the first event (the first turn's
  // start is normally above 0 because a session header precedes it).
  if (cut < 0) return undefined;

  const boundaries = listTurnBoundaries(events);
  const index = boundaries.findIndex((boundary) => boundary.seq === turnStart.seq);
  if (index < 0) return undefined;
  // No-op omission stays keyed to the chronological index: the last completed
  // turn has no tail to compact. (Before mode is not offered on this surface.)
  if (isNoOp(boundaries, index, 'after')) return undefined;

  const changed = filesChangedSince(events, cut);
  const warning = changed > 0 ? ` (${changed} file(s) changed since this point — not reverted)` : '';
  return {
    modes: [{
      id: MODE_AFTER,
      label: 'Rewind + compact after',
      description: `Rewind here, then condense everything after this point into a summary${warning}.`,
    }],
  };
}

/** Append a scaffold summary message to a session (append-only seam). */
async function appendSummary(session, scaffold) {
  const append = session?.append?.bind(session);
  if (typeof append !== 'function') throw new Error('child session append unavailable');
  await append('user/message', summaryMessage(scaffold), { surfaceOp: 'append' });
}

const BEFORE_UNAVAILABLE =
  'Rewind-compact: before mode is not available on the TUI — the rewind ran without a compact summary. ' +
  'Use /rewind-compact <turn> before or the rewind_compact tool for before mode.';

/**
 * `tui/rewind-done` answer: the TUI has forked (child = prefix only) and
 * dispatches the chosen mode.
 * - after: the discarded tail lives only in the source; append a scaffold
 *   summary of it to the child (the child ends with the summary, R4).
 * - before: not offered by this surface (ADR D5). The TUI's append-only child
 *   holds the prefix; composing the old `[prefix][tail][summary]` order would
 *   duplicate the prefix, so return an explicit error toast instead.
 * Unknown modes return undefined ("no opinion") so the TUI's own toast stands.
 * Returns a one-line toast string (the done-event normalization takes the
 * first non-empty string).
 */
export async function rewindDoneAnswer(ctx, payload) {
  const mode = payload?.mode;
  if (mode === MODE_BEFORE) {
    probeLogger(ctx).warn('[rewind-compact] tui/rewind-done requested before mode, which the TUI does not offer (ADR D5)');
    return BEFORE_UNAVAILABLE;
  }
  if (mode !== MODE_AFTER) return undefined;

  const boundary = payload?.boundarySeq;
  if (!Number.isFinite(boundary)) return undefined;
  const source = sessionFor(ctx, payload.sourceSessionId ?? payload.sessionId);
  const childSession = sessionFor(ctx, payload.childSessionId ?? payload.sessionId);
  const sourceEvents = source?.snapshotEvents?.() ?? [];
  const tail = surfaceEvents(sourceEvents.filter((event) => Number.isFinite(event.seq) && event.seq > boundary));

  try {
    if (!tail.length) {
      return `Rewound to this point — nothing after it to compact. Source session ${payload.sourceSessionId} keeps the discarded side.`;
    }
    await appendSummary(childSession, buildScaffold(tail));
  } catch (err) {
    probeLogger(ctx).warn(`[rewind-compact] tui/rewind-done composition failed: ${err?.message ?? err}`);
    // RWC-007 owns the visible-failure toast for this path.
    return undefined;
  }

  return `Rewound and compacted after this point (scaffold summary — the hybrid LLM path needs an open turn, which forked children don't have). Source session ${payload.sourceSessionId} keeps the discarded side and stays resumable. Files were NOT reverted (v1).`;
}

/** Wire both decision-event subscriptions through plain cordis ctx.on. */
export function subscribeRewindDecisions(ctx) {
  ctx.on('tui/rewind-prompt', (payload) => rewindPromptAnswer(ctx, payload));
  ctx.on('tui/rewind-done', (payload) => rewindDoneAnswer(ctx, payload));
  probeLogger(ctx).info('[rewind-compact] subscribed to tui/rewind-prompt and tui/rewind-done decision events');
}
