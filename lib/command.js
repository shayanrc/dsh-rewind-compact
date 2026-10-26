/**
 * TUI/web command `/rewind-compact` (SPEC R3.1) — interactive picker + fast path.
 *
 * Interactive picker: bare `/rewind-compact` asks the user through the
 * harness's own user-questions service (`ctx.userQuestions.ask` — the seam
 * behind `ask_user_question`), which every UI profile renders natively
 * (web and TUI):
 *   Q1 pick the completed turn (newest first, files-changed count per option)
 *   Q2 pick the side to compact (after recommended / before)
 * then forks and compacts the chosen side inside the child.
 *
 * Fast path: `/rewind-compact <turn> [after|before]` skips the prompts. Only
 * exactly `after`/`before` are accepted (omitted mode defaults to `after`);
 * any other token is a usage error, never a silent `after`. The point must be
 * an in-range 1-based turn number, `-1` (newest), or an exact turn id — an
 * invalid point errors before any fork.
 * In the TUI, the Esc-Esc rewind overlay additionally offers the two modes
 * via the `tui/rewind-prompt` decision seam (tui-rewind.js).
 */

import { forkAtBoundary } from './rewind.js';
import {
  listTurnBoundaries, isNoOp, filesChangedSince, messageText, probeService, probeLogger,
  boundaryForPoint, parseRewindMode,
} from './events.js';

const USAGE =
  'Usage: /rewind-compact <turn> [after|before] (mode defaults to after), ' +
  'or /rewind-compact with no arguments to pick interactively.';

function boundaryOptions(ctx, agent) {
  const events = agent?.session?.snapshotEvents?.() ?? [];
  const boundaries = listTurnBoundaries(events);
  const options = [];
  // Newest first, like the TUI's own rewind picker.
  for (let i = boundaries.length - 1; i >= 0; i -= 1) {
    const b = boundaries[i];
    const changed = filesChangedSince(events, b.seq);
    const preview = firstUserTextAfter(events, b.seq);
    const label = `turn ${b.turn}${preview ? ` — ${preview}` : ''}${changed ? ` · ${changed} file(s) changed since` : ''}`;
    options.push({
      label,
      description: `Rewind to the completed turn ${b.turn}.`,
    });
  }
  return { boundaries, options };
}

function firstUserTextAfter(events, seq) {
  for (const record of events ?? []) {
    if (!Number.isFinite(record.seq) || record.seq <= seq) continue;
    if (record.type === 'turn/end') break;
    if (record.type === 'user/message') {
      const text = messageText(record).replace(/\s+/g, ' ').trim();
      if (text) return text.length <= 60 ? text : `${text.slice(0, 60)}…`;
    }
  }
  return '';
}

function runFork(ctx, invocation, boundary, mode) {
  const agent = invocation.agent;
  const logger = probeLogger(ctx);
  const changed = filesChangedSince(agent.session.snapshotEvents?.() ?? [], boundary.seq);
  logger.info(`[rewind-compact] forking: turn ${boundary.turn}, mode ${mode}, boundary seq ${boundary.seq}, ${changed} file(s) changed`);
  return forkAtBoundary(ctx, { session: agent.session, agent, rowSeq: boundary.seq, mode }).then((forked) => {
    logger.info(`[rewind-compact] fork done: child ${forked.childId}, source ${forked.sourceId}, hybrid ${forked.hybrid}`);
    return {
      kind: 'success',
      text:
        `Rewound to turn ${boundary.turn} (${mode} mode). New session: ${forked.childId}.\n` +
        `Pre-rewind session ${forked.sourceId} keeps the discarded side and stays resumable.\n` +
        `${changed} file(s) changed since this point — files were NOT reverted (v1).`,
      sourceEventSeq: boundary.seq,
    };
  });
}

export function rewindCompactCommand(ctx) {
  return {
    name: 'rewind-compact',
    description:
      'Rewind to a completed turn boundary and summarize one side as a five-field scaffold; the pre-rewind session stays resumable.',
    handler: async (invocation) => {
      const agent = invocation?.agent;
      if (!agent) return { kind: 'error', text: 'rewind-compact requires an agent session' };
      const tokens = invocation?.rawInput?.trim().split(/\s+/) ?? [];

      if (tokens.length > 0 && tokens[0] !== '') {
        // Fast path: /rewind-compact <turn> [after|before]
        const point = tokens[0];
        const mode = parseRewindMode(tokens[1]);
        if (!mode) {
          return {
            kind: 'error',
            text: `Unknown mode "${tokens[1]}". Mode must be exactly "after" or "before". ${USAGE}`,
          };
        }
        const { boundaries } = boundaryOptions(ctx, agent);
        if (boundaries.length === 0) {
          return { kind: 'error', text: `No completed turns to rewind to yet. ${USAGE}` };
        }
        const boundary = boundaryForPoint(boundaries, point);
        if (!boundary) {
          return {
            kind: 'error',
            text:
              `Unknown turn "${point}". Point must be a completed turn number from 1 to ${boundaries.length}, ` +
              `or -1 for the newest. ${USAGE}`,
          };
        }
        const index = boundaries.findIndex((b) => b.seq === boundary.seq);
        if (isNoOp(boundaries, index, mode)) {
          return { kind: 'error', text: `Nothing to compact ${mode} turn ${boundary.turn} — pick the other mode.` };
        }
        try {
          return await runFork(ctx, invocation, boundary, mode);
        } catch (err) {
          return { kind: 'error', text: `rewind-compact failed: ${err?.message ?? err}` };
        }
      }

      // Interactive picker via the harness's user-questions seam.
      const { boundaries, options } = boundaryOptions(ctx, agent);
      if (boundaries.length === 0) return { kind: 'success', text: 'No completed turns to rewind to yet.' };
      const userQuestions = probeService(ctx, 'userQuestions');
      if (typeof userQuestions?.ask !== 'function') {
        return { kind: 'success', text: 'No interactive prompt surface in this profile. Fast path: /rewind-compact <turn> [after|before]' };
      }

      const result = await userQuestions.ask({
        questions: [
          {
            id: 'rc-point',
            question: 'Rewind to which completed turn?',
            header: 'Rewind-compact — pick a turn',
            options,
          },
          {
            id: 'rc-mode',
            question: 'Which side gets summarized as a five-field scaffold?',
            header: 'Rewind-compact — pick a side',
            options: [
              { label: 'Compact after (Recommended)', description: 'Summarize everything after the chosen turn; the tail is condensed, the prefix stays verbatim.' },
              { label: 'Compact before', description: 'Summarize everything before the chosen turn; the tail stays verbatim.' },
            ],
          },
        ],
        agent,
        signal: invocation.signal,
      });

      const answers = result?.answers ?? [];
      const pointAnswer = answers.find((a) => a.id === 'rc-point');
      const modeAnswer = answers.find((a) => a.id === 'rc-mode');
      probeLogger(ctx).info(`[rewind-compact] picker answers: point=${JSON.stringify(pointAnswer?.selected)} mode=${JSON.stringify(modeAnswer?.selected)}`);
      const pointLabel = pointAnswer?.selected?.[0];
      const pickedIdx = Number.isInteger(Number(pointLabel)) ? Number(pointLabel) : options.findIndex((o) => o.label === pointLabel);
      // Options are newest-first: map back to the chronological boundary list.
      const boundary = boundaries[boundaries.length - 1 - pickedIdx];
      if (!boundary) return { kind: 'error', text: 'No turn selected — cancelled.' };
      const mode = String(modeAnswer?.selected?.[0] ?? '').includes('before') ? 'before' : 'after';
      const chronologicalIndex = boundaries.findIndex((b) => b.seq === boundary.seq);
      if (isNoOp(boundaries, chronologicalIndex, mode)) {
        return { kind: 'error', text: `Nothing to compact ${mode} turn ${boundary.turn} — pick the other side.` };
      }
      try {
        return await runFork(ctx, invocation, boundary, mode);
      } catch (err) {
        return { kind: 'error', text: `rewind-compact failed: ${err?.message ?? err}` };
      }
    },
  };
}
