import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enclosingCompletedTurnStart } from '../lib/events.js';
import {
  MODE_AFTER, MODE_BEFORE, rewindPromptAnswer, rewindDoneAnswer,
} from '../lib/tui-rewind.js';

const msg = (type, seq, data = {}) => ({ type, seq, time: seq, data });
const turnStart = (seq, turn) => msg('turn/start', seq, { turn });
const turnEnd = (seq, turn) => msg('turn/end', seq, { turn });
// Real agent-session rows: a user/message's `data` IS the message.
const userMsg = (seq, text) => msg('user/message', seq, {
  id: `m-${seq}`,
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
});
const assistantMsg = (seq, text) => msg('assistant/message', seq, {
  message: { id: `a-${seq}`, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } },
});
const toolCall = (seq, callId, name, args) => msg('tool/call', seq, { callId, name, arguments: args });
const toolResult = (seq, callId) => msg('tool/result', seq, { callId, result: 'ok' });

/**
 * Realistic v4-shaped transcript. The seqs are deliberately larger than the
 * array index (a live session packs many non-surface records between turn
 * markers), so the picker must map by seq value: turn/start 10, the turn's
 * user message 15, turn/end 20. Two further completed turns follow, and turn 4
 * is open.
 */
function transcript({ openTurn = true } = {}) {
  const events = [
    msg('session', 0, { id: 'source' }),
    turnStart(10, 1),
    userMsg(15, 'first ask'),
    assistantMsg(16, 'first answer'),
    toolCall(18, 'c1', 'write', { file_path: '/repo/a.js' }),
    toolResult(19, 'c1'),
    turnEnd(20, 1),
    turnStart(30, 2),
    // A queued user message mid-turn (inbox splice): the TUI lists it, and a
    // tool call inside the same turn precedes it. The warning must count from
    // the turn cut (29), not from this message's seq (35).
    toolCall(32, 'c2', 'edit', { file_path: '/repo/b.js' }),
    toolResult(33, 'c2'),
    userMsg(35, 'second ask'),
    turnEnd(40, 2),
    turnStart(50, 3),
    userMsg(55, 'third ask TODO: finish up'),
    turnEnd(60, 3),
  ];
  if (openTurn) {
    events.push(turnStart(70, 4), userMsg(75, 'still working'));
  }
  return events;
}

const quietLogger = { info() {}, warn() {}, debug() {} };

function ctxFor({ source, child } = {}) {
  const byId = new Map();
  if (source) byId.set(source.id, source);
  if (child) byId.set(child.id, child);
  const sessions = { get: (id) => byId.get(id) };
  return {
    get(name) {
      if (name === 'sessions') return sessions;
      if (name === 'logger') return quietLogger;
      return undefined;
    },
  };
}

function sourceSession(id = 'source') {
  const calls = [];
  return {
    id,
    calls,
    snapshotEvents: () => transcript(),
    append: async (...args) => { calls.push(args); },
  };
}

function childSession(id = 'child', calls = []) {
  return { id, append: async (...args) => { calls.push(args); } };
}

// ── RWC-005: picked message seq → enclosing completed turn ──────────────────

test('enclosingCompletedTurnStart maps a message seq to its turn, not to a turn/start seq', () => {
  const events = transcript();
  assert.equal(enclosingCompletedTurnStart(events, 15).seq, 10);
  assert.equal(enclosingCompletedTurnStart(events, 35).seq, 30);
  assert.equal(enclosingCompletedTurnStart(events, 55).seq, 50);
});

test('enclosingCompletedTurnStart rejects an open turn, a post-turn row, and unknown seqs', () => {
  const events = transcript();
  // turn 4 has started but not ended
  assert.equal(enclosingCompletedTurnStart(events, 75), undefined);
  // the turn/end row itself and a surface row after it sit outside a turn
  assert.equal(enclosingCompletedTurnStart(events, 60), undefined);
  const afterTurn = [...events, userMsg(65, 'orphan row after turn 3')];
  assert.equal(enclosingCompletedTurnStart(afterTurn, 65), undefined);
  // not in the transcript / not a finite seq
  assert.equal(enclosingCompletedTurnStart(events, 999), undefined);
  assert.equal(enclosingCompletedTurnStart(events, undefined), undefined);
  assert.equal(enclosingCompletedTurnStart(events, '15'), undefined);
});

test('rewindPromptAnswer maps a picked message to the boundary and offers after only (ADR D5)', () => {
  const ctx = ctxFor({ source: sourceSession() });
  // Non-edge completed turn (turn 1): after is valid; before is never offered.
  const first = rewindPromptAnswer(ctx, { sessionId: 'source', seq: 15 });
  assert.deepEqual(first.modes.map((m) => m.id), [MODE_AFTER]);
  assert.deepEqual(first.modes.map((m) => m.label), ['Rewind + compact after']);

  // Middle turn (turn 2) — mapped via message seq 35, exactly the old bug case.
  const middle = rewindPromptAnswer(ctx, { sessionId: 'source', seq: 35 });
  assert.deepEqual(middle.modes.map((m) => m.id), [MODE_AFTER]);
});

test('rewindPromptAnswer omits the no-op after mode on the last completed turn', () => {
  const ctx = ctxFor({ source: sourceSession() });
  assert.equal(rewindPromptAnswer(ctx, { sessionId: 'source', seq: 55 }), undefined);
});

test('rewindPromptAnswer is ineligible for a row in the still-open turn', () => {
  const ctx = ctxFor({ source: sourceSession() });
  assert.equal(rewindPromptAnswer(ctx, { sessionId: 'source', seq: 75 }), undefined);
});

test('rewindPromptAnswer counts files changed from the turn cut, not the picked message seq', () => {
  const ctx = ctxFor({ source: sourceSession() });
  // cut 29 includes the edit at seq 32 inside turn 2; counting from the picked
  // message seq 35 would report 0.
  const answer = rewindPromptAnswer(ctx, { sessionId: 'source', seq: 35 });
  assert.match(answer.modes[0].description, /\(1 file\(s\) changed since this point — not reverted\)/);
});

test('rewindPromptAnswer rejects a non-finite or missing seq and a missing session', () => {
  const ctx = ctxFor({ source: sourceSession() });
  assert.equal(rewindPromptAnswer(ctx, { sessionId: 'source' }), undefined);
  assert.equal(rewindPromptAnswer(ctx, { sessionId: 'source', seq: '15' }), undefined);
  assert.equal(rewindPromptAnswer(ctxFor({}), { sessionId: 'gone', seq: 15 }), undefined);
});

// ── RWC-006: after-only done path; before mode fails loudly ─────────────────

test('rewindDoneAnswer (after) appends one scaffold summary of the discarded tail', async () => {
  const calls = [];
  const ctx = ctxFor({ source: sourceSession(), child: childSession('child', calls) });
  const answer = await rewindDoneAnswer(ctx, {
    mode: MODE_AFTER, boundarySeq: 29, sourceSessionId: 'source', childSessionId: 'child',
  });

  assert.equal(calls.length, 1);
  const [type, data, options] = calls[0];
  assert.equal(type, 'user/message');
  assert.equal(data.role, 'user');
  assert.equal(typeof data.id, 'string');
  assert.deepEqual(options, { surfaceOp: 'append' });
  const scaffold = data.content.map((part) => part.text).join('\n');
  assert.match(scaffold, /## Files changed/);
  assert.match(scaffold, /TODO: finish up/);
  assert.ok(!scaffold.includes('first ask'), 'the kept prefix must not be summarized by after mode');
  assert.match(answer, /compacted after this point/);
});

test('rewindDoneAnswer (after) reports an empty tail without appending', async () => {
  const calls = [];
  const events = transcript({ openTurn: false });
  const source = { id: 'source', snapshotEvents: () => events, append: async () => { throw new Error('source must never be appended to'); } };
  const ctx = ctxFor({ source, child: childSession('child', calls) });
  const answer = await rewindDoneAnswer(ctx, {
    mode: MODE_AFTER, boundarySeq: 60, sourceSessionId: 'source', childSessionId: 'child',
  });
  assert.equal(calls.length, 0);
  assert.match(answer, /nothing after it to compact/);
});

test('rewindDoneAnswer (before) returns an error toast and never composes the old prefix child', async () => {
  const calls = [];
  const source = sourceSession();
  const ctx = ctxFor({ source, child: childSession('child', calls) });
  const answer = await rewindDoneAnswer(ctx, {
    mode: MODE_BEFORE, boundarySeq: 29, sourceSessionId: 'source', childSessionId: 'child',
  });

  assert.equal(calls.length, 0);
  assert.equal(typeof answer, 'string');
  assert.match(answer, /before mode is not available on the TUI/);
  assert.equal(source.calls.length, 0, 'the source session must stay untouched');
});

test('rewindDoneAnswer leaves unknown modes (e.g. the built-in rewind) to the TUI', async () => {
  const calls = [];
  const ctx = ctxFor({ source: sourceSession(), child: childSession('child', calls) });
  const answer = await rewindDoneAnswer(ctx, {
    mode: 'conversation-rewind', boundarySeq: 29, sourceSessionId: 'source', childSessionId: 'child',
  });
  assert.equal(answer, undefined);
  assert.equal(calls.length, 0);
});
