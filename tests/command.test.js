/**
 * `/rewind-compact` command (SPEC R3.1, R6; RWC-005/008/013).
 *
 * The command's fast path and picker mapping were previously untested. These
 * tests drive the real handler with a fake userQuestions/agents seam, so a
 * regression in point/mode validation or label mapping fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-session') {
      return { url: dataModule('export function SessionId(value) { return value; }'), shortCircuit: true };
    }
    if (specifier === '@deepseek-ai/dsh-llm') {
      return {
        url: dataModule('export class HarnessError extends Error { constructor(message, code) { super(message); this.code = code; } }'),
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});

const { rewindCompactCommand } = await import('../lib/command.js');

const msg = (type, seq, data = {}) => ({ type, seq, time: seq, data });
const turnStart = (seq, turn) => msg('turn/start', seq, { turn });
const turnEnd = (seq, turn) => msg('turn/end', seq, { turn });
const userMsg = (seq, text) => msg('user/message', seq, {
  id: `u-${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' },
});

function transcript() {
  return [
    msg('session', 0, { id: 'source-session' }),
    turnStart(1, 1), userMsg(2, 'first ask'), turnEnd(3, 1),
    turnStart(4, 2), userMsg(5, 'second ask'), turnEnd(6, 2),
  ];
}

const quietLogger = { info() {}, warn() {} };

function harness({ answers = [], events = transcript() } = {}) {
  const created = [];
  const asked = [];
  const session = {
    id: 'source-session',
    header: { id: 'source-session' },
    snapshotEvents: () => events,
  };
  const ctx = {
    agents: {
      create: async (options) => {
        created.push(options);
        return { id: options.sessionId, session: { id: options.sessionId } };
      },
    },
    get(name) {
      if (name === 'logger') return quietLogger;
      if (name === 'agents') return ctx.agents;
      if (name === 'userQuestions') {
        return {
          ask: async (request) => {
            asked.push(request);
            return { answers };
          },
        };
      }
      return undefined;
    },
  };
  return { ctx, command: rewindCompactCommand(ctx), created, asked, session };
}

test('fast path forks at the selected turn and reports the source/child ids', async () => {
  const { command, created, session } = harness();
  const result = await command.handler({ agent: { session }, rawInput: '1 after', signal: undefined });

  assert.equal(result.kind, 'success');
  assert.match(result.text, /turn 1 \(after mode\)/);
  assert.match(result.text, /stays resumable/);
  assert.equal(created.length, 1);
  assert.equal(created[0].meta.parentSession, 'source-session');
  assert.equal(created[0].inheritedEventCount, created[0].seed.length);
  assert.equal(created[0].seed.at(-1).data.source.kind, 'rewind-compact');
});

test('omitted mode defaults to after; only after/before are accepted', async () => {
  const { command, session } = harness();
  const result = await command.handler({ agent: { session }, rawInput: '1' });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /after mode/);

  const bad = await command.handler({ agent: { session }, rawInput: '1 sideways' });
  assert.equal(bad.kind, 'error');
  assert.match(bad.text, /Mode must be exactly "after" or "before"/);

  for (const raw of ['0 after', '99 after', '2.5 after', '-2 after', 'nope after']) {
    const invalid = await command.handler({ agent: { session }, rawInput: raw });
    assert.equal(invalid.kind, 'error', raw);
    assert.match(invalid.text, /Unknown turn/);
  }
});

test('the last completed turn after mode is a no-op; before is allowed', async () => {
  const { command, session } = harness();
  const noAfter = await command.handler({ agent: { session }, rawInput: '2 after' });
  assert.equal(noAfter.kind, 'error');
  assert.match(noAfter.text, /Nothing to compact after turn 2/);

  const before = await command.handler({ agent: { session }, rawInput: '2 before' });
  assert.equal(before.kind, 'success');
  assert.match(before.text, /before mode/);
});

test('picker maps the selected newest-first label back to the chronological boundary', async () => {
  const answers = [
    { id: 'rc-point', selected: ['turn 1 — first ask'] },
    { id: 'rc-mode', selected: ['Compact after (Recommended)'] },
  ];
  const { command, asked, created, session } = harness({ answers });
  const result = await command.handler({ agent: { session }, rawInput: '' });

  assert.equal(result.kind, 'success');
  assert.match(result.text, /turn 1 \(after mode\)/);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].questions.length, 2);
  assert.deepEqual(asked[0].questions[0].options.map((option) => option.label.split(' — ')[0]), ['turn 2', 'turn 1']);
  assert.equal(created.length, 1);
  // turn 1 has a tail (turn 2), so the after seed ends with the summary.
  assert.equal(created[0].seed.at(-1).type, 'user/message');
});

test('picker cancellation selects no boundary and returns an error', async () => {
  const { command, session } = harness({ answers: [] });
  const result = await command.handler({ agent: { session }, rawInput: '' });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /No turn selected/);
});

test('a missing agent returns a usage error', async () => {
  const { command } = harness();
  const result = await command.handler({ rawInput: '1 after' });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /requires an agent session/);
});

// ── RWC-019: the picker offers only in-context turns ────────────────────────
//
// A completed turn is offered iff at least one of its messages survives in the
// session's CURRENT derived surface (foldSurfaceRecords); preview and
// files-changed are derived over the same in-context view. Explicit fast-path
// points keep resolving over ALL completed turns (recovery path).

/** A user/message that is not human input (system notices, injected context). */
const noticeMsg = (seq, text, kind = 'runtime-context') => msg('user/message', seq, {
  id: `n-${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind },
});

/** A compaction checkpoint: a user/message replacing a seq range (RWC-019). */
const checkpointMsg = (seq, startSeq, endSeq, text = 'compaction summary') => ({
  type: 'user/message', seq, time: seq,
  surfaceOp: { op: 'replace', startSeq, endSeq },
  data: {
    id: `ckpt-${seq}`, role: 'user', content: [{ type: 'text', text }],
    source: { kind: 'compact-checkpoint', compactionId: 'c1' },
  },
});

/** Five completed turns; a checkpoint in turn 5 shadows the messages of
 *  turns 2 and 3 (seqs 5..8) — they are no longer in the visible context. */
function compactedTranscript() {
  return [
    msg('session', 0, { id: 'source-session' }),
    turnStart(1, 1), userMsg(2, 'first ask'), turnEnd(3, 1),
    turnStart(4, 2), userMsg(5, 'second ask'), turnEnd(6, 2),
    turnStart(7, 3), userMsg(8, 'third ask'), turnEnd(9, 3),
    turnStart(10, 4), userMsg(11, 'fourth ask'), turnEnd(12, 4),
    turnStart(13, 5), checkpointMsg(14, 5, 8, 'summary of turns 2-3'), turnEnd(15, 5),
  ];
}

const optionLabels = (asked) => asked[0].questions[0].options.map((option) => option.label.split(' — ')[0]);
const optionByTurn = (asked) => Object.fromEntries(
  asked[0].questions[0].options.map((option) => [option.label.split(' — ')[0], option.label]),
);

test('RWC-019: the picker offers only turns still present in the current context', async () => {
  const { command, asked, session } = harness({ events: compactedTranscript() });
  await command.handler({ agent: { session }, rawInput: '' });

  // Turns 2 and 3 are fully shadowed by the checkpoint: never advertised.
  assert.deepEqual(optionLabels(asked), ['turn 5', 'turn 4', 'turn 1']);
  const byTurn = optionByTurn(asked);
  assert.match(byTurn['turn 1'], /first ask/);
  assert.match(byTurn['turn 4'], /fourth ask/);
  // Turn 5's only message is the checkpoint itself: offered, but its preview
  // is never the plugin/compact summary row.
  assert.equal(byTurn['turn 5'], 'turn 5');
});

test('RWC-019: previews never show system-notice text', async () => {
  const events = [
    msg('session', 0, { id: 'source-session' }),
    turnStart(1, 1), noticeMsg(2, 'The approval policy changed from ask to never'), userMsg(3, 'actual human ask'), turnEnd(4, 1),
    turnStart(5, 2), noticeMsg(6, 'time context notice'), turnEnd(7, 2),
    turnStart(8, 3), userMsg(9, 'third ask'), turnEnd(10, 3),
  ];
  const { command, asked, session } = harness({ events });
  await command.handler({ agent: { session }, rawInput: '' });

  const byTurn = optionByTurn(asked);
  assert.match(byTurn['turn 1'], /actual human ask/);
  assert.doesNotMatch(byTurn['turn 1'], /approval policy/i);
  // A turn whose only user row is a system notice gets no preview at all.
  assert.equal(byTurn['turn 2'], 'turn 2');
});

test('RWC-019: the files-changed count skips writes the surface no longer shows', async () => {
  const events = [
    msg('session', 0, { id: 'source-session' }),
    turnStart(1, 1), userMsg(2, 'first ask'),
    msg('tool/call', 3, { callId: 'w1', name: 'write', arguments: { file_path: '/repo/a.js' } }),
    msg('tool/result', 4, { callId: 'w1', meta: { path: '/repo/a.js' }, message: { content: 'Created file' } }),
    turnEnd(5, 1),
    turnStart(6, 2), userMsg(7, 'second ask'),
    msg('tool/call', 8, { callId: 'w2', name: 'write', arguments: { file_path: '/repo/b.js' } }),
    msg('tool/result', 9, { callId: 'w2', meta: { path: '/repo/b.js' }, message: { content: 'Created file' } }),
    checkpointMsg(10, 7, 9, 'summary of turn 2'),
    turnEnd(11, 2),
    turnStart(12, 3), userMsg(13, 'third ask'), turnEnd(14, 3),
  ];
  const { command, asked, session } = harness({ events });
  await command.handler({ agent: { session }, rawInput: '' });

  const byTurn = optionByTurn(asked);
  assert.deepEqual(optionLabels(asked), ['turn 3', 'turn 2', 'turn 1']);
  // Only the visible write (a.js) counts; the shadowed write (b.js) is already
  // represented by the checkpoint summary and must not double-count.
  assert.match(byTurn['turn 1'], /1 file\(s\) changed since/);
  assert.doesNotMatch(byTurn['turn 1'], /2 file/);
  assert.equal(byTurn['turn 2'], 'turn 2');
});

test('RWC-019: a forked child lists its inherited turns plus new turns; the source picker is unchanged', async () => {
  const source = [
    msg('session', 0, { id: 'source-session' }),
    turnStart(1, 1), userMsg(2, 'first ask'), turnEnd(3, 1),
    turnStart(4, 2), userMsg(5, 'second ask'), turnEnd(6, 2),
    turnStart(7, 3), userMsg(8, 'third ask'), turnEnd(9, 3),
  ];
  // Fork through the real command: '/rewind-compact 2 after' keeps turn 1
  // verbatim (cut at ts2.seq - 1) and summarizes the rest.
  const fork = harness({ events: source });
  const result = await fork.command.handler({ agent: { session: fork.session }, rawInput: '2 after' });
  assert.equal(result.kind, 'success');
  assert.equal(fork.created.length, 1);

  // The child session continues from the real seed: inherited turn 1 plus one
  // new completed turn. The scaffold summary sits between turns — it must
  // never surface as a summary-only rewind range.
  const seed = fork.created[0].seed;
  const childEvents = [
    ...seed,
    turnStart(seed.length, 2), userMsg(seed.length + 1, 'new ask in the child'), turnEnd(seed.length + 2, 2),
  ];
  const child = harness({ events: childEvents });
  await child.command.handler({ agent: { session: child.session }, rawInput: '' });
  assert.deepEqual(optionLabels(child.asked), ['turn 2', 'turn 1']);
  assert.match(optionByTurn(child.asked)['turn 1'], /first ask/);
  assert.match(optionByTurn(child.asked)['turn 2'], /new ask in the child/);

  // The source session was never mutated: its picker still lists everything.
  const sourceAgain = harness({ events: source });
  await sourceAgain.command.handler({ agent: { session: sourceAgain.session }, rawInput: '' });
  assert.deepEqual(optionLabels(sourceAgain.asked), ['turn 3', 'turn 2', 'turn 1']);
});

test('RWC-019: when every completed turn is out of context the picker says so', async () => {
  const events = [
    msg('session', 0, { id: 'source-session' }),
    turnStart(1, 1), userMsg(2, 'only ask'), turnEnd(3, 1),
    turnStart(4, 5), checkpointMsg(5, 2, 2, 'summary of turn 1'),
  ];
  const { command, session } = harness({ events });
  const result = await command.handler({ agent: { session }, rawInput: '' });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /current context/);
});

test('RWC-019: the fast path still resolves out-of-context turns (recovery path)', async () => {
  const { command, created, session } = harness({ events: compactedTranscript() });
  // Turn 2 is shadowed, but an explicit point still resolves it.
  const result = await command.handler({ agent: { session }, rawInput: '2 after' });
  assert.equal(result.kind, 'success');
  assert.equal(created.length, 1);
});
