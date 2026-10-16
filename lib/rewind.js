/**
 * Fork-at-boundary rewind (SPEC R4) — the TUI's own recipe, on harness seams.
 *
 * Recipe (verified against @deepseek-harness-tui/dsh-tui session-rewind.js):
 *   walk back from the selected row to its enclosing turn/start and cut just
 *   before it -> fork a new child session via agents.create with the composed
 *   seed. Never sessions.fork(); never mutate the pre-rewind session.
 *
 * - after mode:  child seed = prefix verbatim + one summary message of the
 *                discarded tail.
 * - before mode: child seed = one summary message of the discarded prefix +
 *                tail verbatim.
 *
 * Forked children have NO open turn, so ctx.compaction.compactRegion (which
 * requires an open turn on the target) cannot run there — the summary message
 * is the five-field scaffold (SPEC R5's scaffold-only fallback); the hybrid
 * LLM path is the tool's in-place compaction on the LIVE session (tool.js).
 * hybrid is reported false here, honestly.
 *
 * Seed composition — the envelopes the harness validates — lives in lib/seed.js.
 */

import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { buildSeed } from './seed.js';
import { forkBoundarySeq, probeService, probeLogger } from './events.js';
import { rewindCompactError } from './errors.js';

/**
 * Fork a new session seeded at a completed-turn boundary with the discarded
 * side replaced by a scaffold summary inside the child.
 *
 * Callers are the command and the tool, which execute inside the invoking
 * agent's own turn: this fork NEVER cancels its caller (the TUI's interactive
 * flow performs its own cancel + adoption before tui/rewind-done — see
 * tui-rewind.js). Cancelling here would abort the turn that renders the
 * completion message.
 *
 * @param {object} ctx Cordis context
 * @param {object} opts
 * @param {object} opts.session source live session
 * @param {object} opts.agent source agent handle (for context only)
 * @param {number} opts.rowSeq selected transcript row (the rewind point)
 * @param {'after'|'before'} opts.mode
 * @returns {Promise<{childId: string, sourceId: string, hybrid: boolean}>}
 */
export async function forkAtBoundary(ctx, { session, agent, rowSeq, mode }) {
  const events = session?.snapshotEvents?.() ?? session?.events ?? [];
  if (!events.length) throw rewindCompactError('no session events to rewind', 'REWIND_COMPACT_EMPTY');

  // Settle any in-flight compaction when the seam exposes it (best-effort).
  const compaction = probeService(ctx, 'compaction');
  if (typeof compaction?.settle === 'function') {
    try {
      await compaction.settle();
    } catch {
      // Compaction is log-bracketed; a missing settle hook is not an error.
    }
  }

  // Walk back to the enclosing turn/start; cut just before it.
  const boundary = forkBoundarySeq(events, rowSeq);
  if (boundary === undefined || boundary < 0) {
    throw rewindCompactError('cannot rewind to the very first message', 'REWIND_COMPACT_FIRST');
  }

  // Compose the child seed (SPEC R4): one scaffold summary replaces the
  // discarded side, the kept side travels verbatim, seqs renumbered from 0.
  // lib/seed.js owns the envelope rules the harness validates.
  const seed = buildSeed(events, boundary, mode);

  // Fork: agents.create owns the new session id. Never sessions.fork().
  const childId = SessionId(randomUUID());
  const title = session?.title ?? session?.identity?.title;
  // Carry the workspace cwd so the child lands in the same session bucket as
  // its source (the live session object may not expose it; the session header
  // event does).
  const header = events.find((e) => e.type === 'session');
  const cwd = session?.header?.cwd ?? session?.cwd ?? session?.identity?.cwd ?? agent?.cwd ?? header?.cwd ?? header?.data?.cwd;
  const child = await ctx.agents.create({
    sessionId: childId,
    seed,
    inheritedCount: seed.length,
    parentSession: session.id ?? session.sessionId,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(title ? { title: `${title} (rewound)` } : {}),
    setup: async (_agentCtx, childAgent) => {
      // The cut keeps pre-turn inbox insertions but drops their claims.
      childAgent?.inbox?.clear?.();
    },
  });

  probeLogger(ctx).info(`[rewind-compact] forked ${childId} from ${session.id} (${mode} mode, boundary ${boundary}, scaffold-only summary)`);
  return { childId, sourceId: session.id ?? session.sessionId, hybrid: false };
}
