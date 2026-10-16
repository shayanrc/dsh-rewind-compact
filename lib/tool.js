/**
 * Model-invoked tool `rewind_compact` (SPEC R3, R7).
 *
 * - mode `after`/`before` with rewind=false (shadow-in-place compaction via
 *   the ctx.compaction contract, scaffold delivered inside the compacted
 *   range — the hybrid path) runs ungated.
 * - rewind=true (fork to a new session) requires direct human authority in the
 *   current turn — the harness's own authority pattern (see dsh-tool-goal's
 *   requireDirectHuman). Headless/goal-round turns fail closed.
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { forkAtBoundary } from './rewind.js';
import { buildScaffold } from './scaffold.js';
import { summaryMessage } from './seed.js';
import { listTurnBoundaries, modeRange, filesChangedSince, boundaryForPoint, probeService, probeLogger } from './events.js';
import { rewindCompactError } from './errors.js';

const TOOL_OUTPUT = {
  // Raw JSON Schema in the harness's enforced subset (required rides inside
  // each property, additionalProperties is closed) — mirroring dsh-tool-goal's
  // GOAL_VALUE_SCHEMA. Branch A = fork result, branch B = in-place compact.
  schema: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          applied: { type: 'boolean', required: true },
          note: { type: 'string' },
          forked: { type: 'boolean', required: true },
          hybrid: { type: 'boolean', required: true },
          childSessionId: { type: 'string', required: true },
          sourceSessionId: { type: 'string', required: true },
          compactedRange: { type: 'null', required: true },
          filesChanged: { type: 'integer', required: true },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          applied: { type: 'boolean', required: true },
          note: { type: 'string' },
          forked: { type: 'boolean', required: true },
          hybrid: { type: 'boolean', required: true },
          childSessionId: { type: 'null', required: true },
          sourceSessionId: { type: 'null', required: true },
          compactedRange: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              start: { type: 'integer', required: true },
              end: { type: 'integer', required: true },
            },
          },
          filesChanged: { type: 'integer', required: true },
        },
      },
    ],
  },
  render: (_args, value) => {
    const head = value?.applied === false
      ? `rewind-compact: no-op — ${value?.note ?? 'nothing was compacted'}`
      : 'rewind-compact';
    return [{ type: 'text', text: `${head}\n${JSON.stringify(value)}` }];
  },
};

/** Resolve the rewind point (turn index or id) to a transcript row seq. */
function resolveRowSeq(session, point) {
  const events = session?.snapshotEvents?.() ?? [];
  const boundaries = listTurnBoundaries(events);
  if (boundaries.length === 0) throw rewindCompactError('no completed turns to rewind to', 'REWIND_COMPACT_NO_TURNS');
  const b = boundaryForPoint(boundaries, point);
  if (!b) throw rewindCompactError(`unknown turn "${point}"`, 'REWIND_COMPACT_NO_TURN');
  return b.seq;
}

/**
 * Direct-human authority, mirroring dsh-tool-goal's requireDirectHuman: the
 * current open turn of a ROOT agent must contain a user message whose source
 * is the human.
 */
function hasDirectHumanInput(ctx, agent) {
  const agents = probeService(ctx, 'agents');
  if (typeof agents?.roots === 'function' && !agents.roots().includes(agent)) return false;
  const events = agent?.session?.snapshotEvents?.() ?? [];
  const projections = probeService(ctx, 'sessionProjections');
  const boundary = projections?.stateOf?.(agent.session, 'turnBoundary');
  const openTurnStartSeq = boundary?.openTurnStartSeq;
  if (openTurnStartSeq === null || openTurnStartSeq === undefined) return false;
  for (let seq = openTurnStartSeq + 1; seq < events.length; seq += 1) {
    const event = events[seq];
    if (event?.type === 'user/message' && event?.data?.source?.kind === 'user') return true;
  }
  return false;
}

export function rewindCompactTool(ctx) {
  return defineTool({
    name: 'rewind_compact',
    description:
      'Rewind or compact the conversation at a completed turn boundary. ' +
      'Compaction is recoverable and runs without approval; rewinding forks ' +
      'to a new session and requires direct human authority (fails closed headless).',
    parameters: {
      point: {
        type: 'string',
        required: true,
        description: 'Completed turn boundary: turn index (e.g. "3") or turn id.',
      },
      mode: {
        type: 'string',
        enum: ['after', 'before'],
        description: 'after = summarize the tail after the point (default); before = summarize the prefix before the point.',
      },
      rewind: {
        type: 'boolean',
        description: 'true = fork to a new session seeded at the boundary (gated); false = compact in place (ungated, default).',
      },
    },
    output: TOOL_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec?.agent;
      if (!agent) throw rewindCompactError('rewind_compact requires a calling agent', 'REWIND_COMPACT_AGENT_REQUIRED');
      const session = agent.session;
      const events = session?.snapshotEvents?.() ?? [];
      const rowSeq = resolveRowSeq(session, args.point);
      const mode = args.mode ?? 'after';
      const changed = filesChangedSince(events, rowSeq);

      if (args.rewind === true) {
        // Gated: direct human authority only; headless fails closed (R7).
        if (!hasDirectHumanInput(ctx, agent)) {
          throw rewindCompactError('rewind requires direct human approval and none is present (fail closed)', 'REWIND_COMPACT_APPROVAL_REQUIRED');
        }
        const forked = await forkAtBoundary(ctx, { session, agent, rowSeq, mode });
        return { ok: true, applied: true, forked: true, hybrid: forked.hybrid, childSessionId: forked.childId, sourceSessionId: forked.sourceId, compactedRange: null, filesChanged: changed };
      }

      // Ungated compaction path: scaffold-in-range on the LIVE session (an
      // open turn exists here, which is what compactRegion requires), then
      // shadow-in-place compaction over the extended range (R5 hybrid).
      const range = modeRange(events, rowSeq, mode);
      const scaffold = buildScaffold(events.slice(range.start, range.end + 1));
      let hybrid = false;
      let note;
      const append = session?.append?.bind(session);
      const compaction = probeService(ctx, 'compaction');
      if (append && compaction?.compactRegion) {
        try {
          await append('user/message', summaryMessage(scaffold), { surfaceOp: 'append' });
          await compaction.compactRegion(range.start, range.end + 1, agent, undefined);
          hybrid = true;
        } catch (err) {
          throw rewindCompactError(`compaction failed: ${err?.message ?? err}`, 'REWIND_COMPACT_COMPACT_FAILED');
        }
      } else {
        note = 'compaction service unavailable in this profile — nothing was compacted';
        probeLogger(ctx).warn(`[rewind-compact] ${note}`);
      }
      // `applied` is the honest signal: `ok` means the call completed,
      // `applied` means the compaction actually ran and the transcript now
      // shadows the range. Without it a no-op reads as a success.
      return {
        ok: true,
        applied: hybrid,
        forked: false,
        hybrid,
        childSessionId: null,
        sourceSessionId: null,
        compactedRange: { start: range.start, end: range.end },
        filesChanged: changed,
        ...(note ? { note } : {}),
      };
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Rewind-compact',
      kind: 'other',
      rawInput: `turn ${args.point} (${args.mode ?? 'after'}${args.rewind ? ', rewind' : ''})`,
    }),
  });
}
