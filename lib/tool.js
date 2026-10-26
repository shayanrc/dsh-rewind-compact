/**
 * Model-invoked tool `rewind_compact` (SPEC R3, R7).
 *
 * - rewind=true (fork to a new session) requires direct human authority in the
 *   current turn — the harness's own authority pattern (see dsh-tool-goal's
 *   requireDirectHuman). Headless/goal-round turns fail closed.
 * - rewind=false (the historical in-place compaction path) is RETIRED in v1
 *   (RWC-004 / ADR RWC-015 D2). It never forks, never appends, and never calls
 *   `ctx.compaction.compactRegion`; it returns a documented unsupported result
 *   with `ok: false`, `applied: false`, and `reason: "in_place_retired"`.
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { forkAtBoundary } from './rewind.js';
import { listTurnBoundaries, filesChangedSince, boundaryForPoint, probeService, probeLogger } from './events.js';
import { rewindCompactError } from './errors.js';

/** Stable reason code for the retired in-place path. */
export const IN_PLACE_RETIRED_REASON = 'in_place_retired';

const RETIRED_NOTE =
  'in-place compaction is retired in v1; the transcript was not changed — ' +
  'call rewind_compact again with rewind: true to fork a new session with a five-field scaffold summary';

// Raw JSON Schema in the harness's enforced subset (required rides inside each
// property, additionalProperties is closed) — mirroring dsh-tool-goal's
// GOAL_VALUE_SCHEMA. Branch A = fork result, branch B = retired in-place result.
const FORK_RESULT_SCHEMA = {
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
};

const RETIRED_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    applied: { type: 'boolean', required: true },
    forked: { type: 'boolean', required: true },
    hybrid: { type: 'boolean', required: true },
    childSessionId: { type: 'null', required: true },
    sourceSessionId: { type: 'null', required: true },
    compactedRange: { type: 'null', required: true },
    filesChanged: { type: 'integer', required: true },
    reason: { type: 'string', required: true },
    note: { type: 'string', required: true },
  },
};

const TOOL_OUTPUT = {
  schema: { oneOf: [FORK_RESULT_SCHEMA, RETIRED_RESULT_SCHEMA] },
  render: (_args, value) => {
    const head = value?.reason === IN_PLACE_RETIRED_REASON
      ? `rewind-compact: in-place compaction retired — ${value?.note ?? RETIRED_NOTE}`
      : value?.applied === false
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
      'Rewind the conversation at a completed turn boundary by forking a new ' +
      'session seeded with the kept side and a five-field scaffold summary. ' +
      'Requires direct human authority (fails closed headless). The in-place ' +
      'compaction mode (rewind: false) is retired in v1: it returns an ' +
      'unsupported result and never mutates the transcript.',
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
        description: 'true = fork to a new session seeded at the boundary (gated; the only active mode in v1). false = retired in-place mode; returns a documented unsupported result and mutates nothing.',
      },
    },
    output: TOOL_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec?.agent;
      if (!agent) throw rewindCompactError('rewind_compact requires a calling agent', 'REWIND_COMPACT_AGENT_REQUIRED');
      const session = agent.session;
      const events = session?.snapshotEvents?.() ?? [];
      const rowSeq = resolveRowSeq(session, args.point);
      const changed = filesChangedSince(events, rowSeq);

      if (args.rewind === true) {
        // Gated: direct human authority only; headless fails closed (R7).
        if (!hasDirectHumanInput(ctx, agent)) {
          throw rewindCompactError('rewind requires direct human approval and none is present (fail closed)', 'REWIND_COMPACT_APPROVAL_REQUIRED');
        }
        const forked = await forkAtBoundary(ctx, { session, agent, rowSeq, mode: args.mode ?? 'after' });
        return { ok: true, applied: true, forked: true, hybrid: forked.hybrid, childSessionId: forked.childId, sourceSessionId: forked.sourceId, compactedRange: null, filesChanged: changed };
      }

      // Retired in-place path (RWC-004 / ADR D2): no fork, no scaffold append,
      // no compactRegion call. Returning a value (not throwing) lets the caller
      // render the documented unsupported result; `applied`/`hybrid` stay false.
      probeLogger(ctx).warn(`[rewind-compact] rewind:false is retired (point ${args.point}); no transcript change`);
      return {
        ok: false,
        applied: false,
        forked: false,
        hybrid: false,
        childSessionId: null,
        sourceSessionId: null,
        compactedRange: null,
        filesChanged: changed,
        reason: IN_PLACE_RETIRED_REASON,
        note: RETIRED_NOTE,
      };
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Rewind-compact',
      kind: 'other',
      rawInput: `turn ${args.point} (${args.mode ?? 'after'}${args.rewind === true ? ', rewind' : ', in-place retired'})`,
    }),
  });
}
