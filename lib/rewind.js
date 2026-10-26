/**
 * Fork-at-boundary rewind (SPEC R4) — the TUI's own recipe, on harness seams.
 *
 * Recipe (verified against @deepseek-harness-tui/dsh-tui session-rewind.js):
 *   walk back from the selected row to its enclosing turn/start and cut just
 *   before it -> fork a new child session via agents.create with the composed
 *   seed. Never sessions.fork(); never mutate the pre-rewind session.
 *
 * - after mode:  child seed = current source prefix verbatim (seqs unchanged,
 *                surface markers and their references preserved) + one summary
 *                of the discarded tail.
 * - before mode: child seed = one summary of the discarded prefix + the
 *                folded, renumbered current tail.
 *
 * Create-time state follows 0.2.1's `CreateAgentOptions`: cwd / lineage /
 * seeded marker / agent preset live under `meta`, and the inherited prefix
 * length is `inheritedEventCount` (lib/create.js). The child title is a
 * best-effort `session/title` event, never a create option (SPEC R12).
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
import { isAbsolute } from 'node:path';
import { SessionId } from '@deepseek-ai/dsh-session';
import { buildSeed } from './seed.js';
import { buildCreateOptions } from './create.js';
import {
  forkBoundarySeq,
  probeService,
  probeLogger,
  sourceAgentPreset,
  sourceCwd,
  sourceSessionId,
  sourceTitle,
} from './events.js';
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
  // discarded side; the kept side follows the strategy in lib/seed.js.
  const seed = buildSeed(events, boundary, mode);

  // 0.2.1 create metadata: lineage/cwd/preset under `meta`, inherited length
  // in `inheritedEventCount`, title through a `session/title` event.
  const childId = SessionId(randomUUID());
  const sourceId = sourceSessionId(session, events);
  const rawCwd = sourceCwd(session, events) ?? agent?.cwd;
  const cwd = typeof rawCwd === 'string' && isAbsolute(rawCwd) ? rawCwd : undefined;
  const title = sourceTitle(events);
  const agentPreset = sourceAgentPreset(session, events);
  const logger = probeLogger(ctx);
  if (rawCwd !== undefined && cwd === undefined) {
    logger.warn(`[rewind-compact] source cwd "${rawCwd}" is not absolute; the child will not be workspace-grouped`);
  }

  const child = await ctx.agents.create(buildCreateOptions({
    source: { id: sourceId },
    sessionId: childId,
    seed,
    cwd,
    title,
    agentPreset,
  }));

  if (title === undefined) {
    logger.info('[rewind-compact] source has no folded title; skipping the session/title event');
  }
  logger.info(
    `[rewind-compact] forked ${childId} from ${sourceId} (${mode} mode, boundary ${boundary}, ` +
    `${seed.length} seeded events, scaffold-only summary)`,
  );
  return { childId, sourceId, hybrid: false };
}
