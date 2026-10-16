/**
 * TUI-native interactive picker integration (SPEC R3.1, R6) — the sanctioned
 * plugin seam for the Double-Esc rewind picker:
 *
 * - `tui/rewind-prompt` (permission `session.rewind.intercept`, D-7 default
 *   deny): answered with the plugin's rewind modes (no-op sides omitted).
 *   The confirm pane renders them as a choice list under the built-in
 *   conversation rewind.
 * - `tui/rewind-done`: dispatched AFTER the TUI forks at the chosen boundary;
 *   the payload carries the chosen mode and both session ids. The TUI's child
 *   holds only the prefix; this bundle composes the discarded side per mode
 *   (source stays untouched) and returns the toast summary string.
 *
 * The fork itself stays the TUI's (it owns the picker, cancellation, and
 * adoption) — this bundle never re-forks in the TUI flow (SPEC R2). Forked
 * children have no open turn, so child-side compactRegion is structurally
 * unavailable; the summaries here are scaffold-only (SPEC R5 fallback), and
 * the hybrid is reported honestly.
 */

import { buildScaffold } from './scaffold.js';
import { surfaceEvents, SURFACE_TYPES, listTurnBoundaries, isNoOp, filesChangedSince, probeService, probeLogger } from './events.js';

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
 * `tui/rewind-prompt` answer: offer the rewind-compact modes with a
 * files-changed warning in the description (R10: warn, never revert),
 * omitting the no-op side (R6: no after-mode at the last turn, no
 * before-mode at the first). Returns undefined when nothing is usable.
 */
export function rewindPromptAnswer(ctx, payload) {
  const seq = payload?.seq;
  if (!Number.isFinite(seq)) return undefined;
  const session = sessionFor(ctx, payload.sessionId);
  const events = session?.snapshotEvents?.() ?? [];
  const boundaries = listTurnBoundaries(events);
  const index = boundaries.findIndex((b) => b.seq === seq);
  if (index < 0) return undefined;

  const changed = filesChangedSince(events, seq);
  const warning = changed > 0 ? ` (${changed} file(s) changed since this point — not reverted)` : '';
  const modes = [];
  if (!isNoOp(boundaries, index, 'after')) {
    modes.push({
      id: MODE_AFTER,
      label: 'Rewind + compact after',
      description: `Rewind here, then condense everything after this point into a summary${warning}.`,
    });
  }
  if (!isNoOp(boundaries, index, 'before')) {
    modes.push({
      id: MODE_BEFORE,
      label: 'Rewind + compact before',
      description: `Rewind here, then condense everything before this point into a summary${warning}.`,
    });
  }
  return modes.length > 0 ? { modes } : undefined;
}

/** Append a scaffold summary message to a session (append-only seam). */
async function appendSummary(session, scaffold) {
  const append = session?.append?.bind(session);
  if (typeof append !== 'function') throw new Error('child session append unavailable');
  await append('user/message', {
    role: 'user',
    content: [{ type: 'text', text: scaffold }],
    source: { kind: 'plugin', plugin: 'dsh-rewind-compact' },
  }, { surfaceOp: 'append' });
}

/** Append source surface events verbatim (replay the kept side). */
async function replayEvents(session, events) {
  for (const record of events) {
    const data = record?.data ?? {};
    if (data.message && session?.append) {
      await session.append(record.type, data, { surfaceOp: 'append' });
    }
  }
}

/**
 * `tui/rewind-done` answer: the TUI has forked (child = prefix only). Compose
 * the child per mode:
 * - after:  the discarded tail lives only in the source; append a scaffold
 *           summary of it to the child (the child ends with the summary, R4).
 * - before: replay the discarded tail verbatim into the child, then append
 *           the prefix scaffold summary (append-only transcripts cannot
 *           prepend, so the summary trails — documented in TESTING.md).
 * Returns a one-line toast summary (the done-event normalization takes the
 * first non-empty string).
 */
export async function rewindDoneAnswer(ctx, payload) {
  const mode = payload?.mode;
  if (mode !== MODE_AFTER && mode !== MODE_BEFORE) return undefined;
  const source = sessionFor(ctx, payload.sourceSessionId ?? payload.sessionId);
  const childSession = sessionFor(ctx, payload.childSessionId ?? payload.sessionId);
  const sourceEvents = source?.snapshotEvents?.() ?? [];
  const boundary = payload.boundarySeq;
  const tail = surfaceEvents(sourceEvents.filter((e) => Number.isFinite(e.seq) && e.seq > boundary));

  try {
    if (mode === MODE_AFTER) {
      if (!tail.length) return `Rewound to this point — nothing after it to compact. Source session ${payload.sourceSessionId} keeps the discarded side.`;
      await appendSummary(childSession, buildScaffold(tail));
    } else {
      await replayEvents(childSession, tail);
      const prefix = surfaceEvents(sourceEvents.filter((e) => Number.isFinite(e.seq) && e.seq <= boundary));
      if (prefix.length) await appendSummary(childSession, buildScaffold(prefix));
    }
  } catch (err) {
    probeLogger(ctx).warn(`[rewind-compact] tui/rewind-done composition failed: ${err?.message ?? err}`);
    return undefined;
  }

  const verb = mode === MODE_AFTER ? 'after' : 'before';
  return `Rewound and compacted ${verb} this point (scaffold summary — the hybrid LLM path needs an open turn, which forked children don't have). Source session ${payload.sourceSessionId} keeps the discarded side and stays resumable. Files were NOT reverted (v1).`;
}

/** Wire both decision-event subscriptions through plain cordis ctx.on. */
export function subscribeRewindDecisions(ctx) {
  ctx.on('tui/rewind-prompt', (payload) => rewindPromptAnswer(ctx, payload));
  ctx.on('tui/rewind-done', (payload) => rewindDoneAnswer(ctx, payload));
  probeLogger(ctx).info('[rewind-compact] subscribed to tui/rewind-prompt and tui/rewind-done decision events');
}
