import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listTurnBoundaries, isNoOp, forkBoundarySeq, modeRange, filesChangedSince, boundaryForPoint,
  recordCallId, toolArguments, toolResultText,
} from '../lib/events.js';
import { buildScaffold } from '../lib/scaffold.js';

const msg = (type, seq, data) => ({ type, seq, time: seq, data });
const turnStart = (seq, turn) => msg('turn/start', seq, { turn });
const turnEnd = (seq, turn) => msg('turn/end', seq, { turn });
const userMsg = (seq, text) => msg('user/message', seq, { message: { role: 'user', content: text }, source: { kind: 'user' } });

function transcript() {
  return [
    { type: 'session', seq: 0, time: 0, data: {} },
    turnStart(1, 1),
    userMsg(2, 'hello'),
    turnEnd(3, 1),
    turnStart(4, 2),
    userMsg(5, 'world'),
    turnEnd(6, 2),
    turnStart(7, 3),
    userMsg(8, 'again'),
    turnEnd(9, 3),
  ];
}

test('listTurnBoundaries returns completed turns only', () => {
  const events = [...transcript(), turnStart(10, 4)]; // open turn 4
  const boundaries = listTurnBoundaries(events);
  assert.deepEqual(boundaries.map((b) => b.turn), [1, 2, 3]);
});

test('isNoOp: after at last turn, before at first turn', () => {
  const boundaries = [{ seq: 1, turn: 1 }, { seq: 4, turn: 2 }, { seq: 7, turn: 3 }];
  assert.equal(isNoOp(boundaries, 0, 'before'), true);
  assert.equal(isNoOp(boundaries, 0, 'after'), false);
  assert.equal(isNoOp(boundaries, 2, 'after'), true);
  assert.equal(isNoOp(boundaries, 2, 'before'), false);
  assert.equal(isNoOp(boundaries, 1, 'after'), false);
  assert.equal(isNoOp(boundaries, 1, 'before'), false);
});

test('forkBoundarySeq cuts just before the enclosing turn/start', () => {
  const events = transcript();
  // row seq 5 is inside turn 2 -> cut at turn2.start (4) - 1 = 3
  assert.equal(forkBoundarySeq(events, 5), 3);
  // a row on turn/end itself stops the walk (open turn): no cut
  const withOpenTurn = [...transcript(), turnStart(10, 4), userMsg(11, 'x'), turnEnd(12, 4), turnStart(13, 5)];
  assert.equal(forkBoundarySeq(withOpenTurn, 13), 12);
  // first turn -> cut at 0? turn1 start seq 1 -> 0
  assert.equal(forkBoundarySeq(events, 2), 0);
});

test('modeRange splits around the boundary', () => {
  const events = transcript();
  assert.deepEqual(modeRange(events, 3, 'after'), { start: 4, end: 9 });
  assert.deepEqual(modeRange(events, 3, 'before'), { start: 0, end: 3 });
});

test('boundaryForPoint resolves index, negative index, and id', () => {
  const boundaries = [{ seq: 1, turn: 1 }, { seq: 4, turn: 2 }, { seq: 7, turn: 3 }];
  assert.equal(boundaryForPoint(boundaries, '2').seq, 4);
  assert.equal(boundaryForPoint(boundaries, '-1').seq, 7);
  assert.equal(boundaryForPoint(boundaries, '3').seq, 7);
  assert.equal(boundaryForPoint(boundaries, 'nope'), undefined);
});

test('filesChangedSince counts file-touching tools after the boundary', () => {
  const events = [
    msg('tool/call', 4, { callId: 'c1', name: 'write', arguments: { file_path: '/repo/a.js' } }),
    msg('tool/result', 5, { callId: 'c1', name: 'write', result: 'ok' }),
    msg('tool/call', 6, { callId: 'c2', name: 'read', arguments: { file_path: '/repo/b.js' } }),
  ];
  assert.equal(filesChangedSince(events, 3), 1); // read is not a modifying tool
});

test('dual transcript shapes: string arguments and nested callId/result', () => {
  const events = [
    { type: 'tool/call', seq: 1, data: { callId: 'c1', name: 'bash', arguments: '{"command": "npm run build"}' } },
    { type: 'tool/result', seq: 2, data: { message: { content: 'error: boom\n[exit code: 1]', source: { callId: 'c1' } } } },
  ];
  assert.equal(recordCallId(events[0]), 'c1');
  assert.equal(recordCallId(events[1]), 'c1');
  assert.deepEqual(toolArguments(events[0].data), { command: 'npm run build' });
  const out = buildScaffold(events);
  assert.ok(out.includes('npm run build (exit 1)'));
  assert.ok(out.match(/Errors encountered[\s\S]*error: boom/));
});

test('nested-summary note and decisions/TODOs from message text', () => {
  const events = [
    userMsg(1, 'We will use the fork recipe. TODO: wire the picker. This range already holds a prior compact summary.'),
  ];
  const out = buildScaffold(events);
  assert.ok(out.match(/Decisions made[\s\S]*we will/i));
  assert.ok(out.match(/Outstanding TODOs[\s\S]*TODO: wire the picker/i));
  assert.ok(out.includes('includes a prior compact summary'));
});
