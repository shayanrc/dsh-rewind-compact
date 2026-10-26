import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listTurnBoundaries, isNoOp, forkBoundarySeq, modeRange, filesChangedSince, boundaryForPoint,
  parseRewindMode, recordCallId, toolArguments, toolResultText,
  SURFACE_TYPES, POLICY_FACT_TYPES, KEPT_LOG_TYPES, seedSourceEvents, foldSurfaceRecords,
  sourceTitle, sourceAgentPreset, sourceCwd, sourceSessionId,
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

test('boundaryForPoint resolves an in-range 1-based turn, -1, and an exact id', () => {
  const boundaries = [{ seq: 1, turn: 1 }, { seq: 4, turn: 2 }, { seq: 7, turn: 3 }];
  assert.equal(boundaryForPoint(boundaries, '1').seq, 1);
  assert.equal(boundaryForPoint(boundaries, 1).seq, 1);
  assert.equal(boundaryForPoint(boundaries, '2').seq, 4);
  assert.equal(boundaryForPoint(boundaries, '3').seq, 7);
  assert.equal(boundaryForPoint(boundaries, '-1').seq, 7);
  assert.equal(boundaryForPoint([{ seq: 2, turn: 'alpha' }], 'alpha').seq, 2);
});

test('boundaryForPoint fails closed instead of falling back to the newest turn', () => {
  const boundaries = [{ seq: 1, turn: 1 }, { seq: 4, turn: 2 }, { seq: 7, turn: 3 }];
  for (const point of ['0', 0, '99', 99, '-2', '2.5', 2.5, '', '   ', 'n', 'nope', null, undefined]) {
    assert.equal(boundaryForPoint(boundaries, point), undefined, `point ${JSON.stringify(point)} must not resolve`);
  }
  assert.equal(boundaryForPoint([], '1'), undefined);
});

test('parseRewindMode accepts only after/before and defaults when omitted', () => {
  assert.equal(parseRewindMode('after'), 'after');
  assert.equal(parseRewindMode('before'), 'before');
  assert.equal(parseRewindMode(undefined), 'after');
  assert.equal(parseRewindMode('sideways'), undefined);
  assert.equal(parseRewindMode('AFTER'), undefined);
  assert.equal(parseRewindMode(''), undefined);
  assert.equal(parseRewindMode(null), undefined);
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

test('the surface vocabulary includes developer/message and the policy/kept-log facts', () => {
  assert.deepEqual([...SURFACE_TYPES].sort(), [
    'assistant/message', 'developer/message', 'system/message', 'tool/result', 'user/message',
  ]);
  assert.deepEqual([...POLICY_FACT_TYPES].sort(), [
    'approval/policy', 'permission/preset', 'plan/mode', 'sandbox/mode',
  ]);
  assert.ok(KEPT_LOG_TYPES.has('turn/start'));
  assert.ok(KEPT_LOG_TYPES.has('turn/end'));
  assert.ok(KEPT_LOG_TYPES.has('agent-preset/selected'));
});

test('seedSourceEvents drops the transcript header line and sorts by seq', () => {
  const events = [
    { type: 'session', version: 4, id: 's1', cwd: '/w' },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1 } },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'torn', seq: undefined },
  ];
  assert.deepEqual(seedSourceEvents(events).map((event) => event.seq), [0, 1]);
});

test('foldSurfaceRecords applies replacements and drops the shadowed originals', () => {
  const events = [
    { type: 'user/message', seq: 0, time: 1, surfaceOp: 'append', data: { id: 'original', role: 'user', content: [], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 1, time: 2, surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: { id: 'a1', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } } } },
    { type: 'user/message', seq: 2, time: 3, surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 }, sourceEventSeqs: [0], data: { id: 'replacement', role: 'user', content: [], source: { kind: 'compact-checkpoint', compactionId: 'c' } } },
  ];
  assert.deepEqual(foldSurfaceRecords(events).map((event) => event.data.id ?? event.data.message?.id), ['replacement', 'a1']);
});

test('source accessors fold title, preset, cwd and session id from their real homes', () => {
  const events = [
    { type: 'session', version: 4, id: 'header-session', cwd: '/header/cwd' },
    { type: 'session/title', seq: 0, time: 1, data: { title: 'Older title', messageSeqs: [], source: { kind: 'fallback' } } },
    { type: 'session/title', seq: 1, time: 2, data: { title: 'Latest title', messageSeqs: [], source: { kind: 'user' } } },
    { type: 'agent-preset/selected', seq: 2, time: 3, data: { agentPreset: 'reviewer' } },
  ];
  assert.equal(sourceTitle(events), 'Latest title');
  assert.equal(sourceTitle([]), undefined);
  assert.equal(sourceCwd({}, events), '/header/cwd');
  assert.equal(sourceCwd({ header: { cwd: '/live' } }, events), '/live');
  assert.equal(sourceCwd({}, []), undefined);
  assert.equal(sourceSessionId({}, events), 'header-session');
  assert.equal(sourceSessionId({ id: 'live-session' }, events), 'live-session');
  assert.equal(sourceAgentPreset({ header: { agentPreset: 'standard' } }, events), 'reviewer');
  assert.equal(sourceAgentPreset({}, []), undefined);
  assert.equal(sourceAgentPreset({ header: { agentPreset: 'standard' } }, []), 'standard');
});

