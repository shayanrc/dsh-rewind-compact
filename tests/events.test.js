import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listTurnBoundaries, isNoOp, forkBoundarySeq, filesChangedSince, boundaryForPoint,
  parseRewindMode, recordCallId, toolArguments, toolResultText, changedFiles, extractPaths,
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

test('filesChangedSince counts write/edit calls after the boundary', () => {
  const events = [
    msg('tool/call', 4, { callId: 'c1', name: 'write', arguments: { file_path: '/repo/a.js' } }),
    msg('tool/result', 5, { callId: 'c1', name: 'write', result: 'ok' }),
    msg('tool/call', 6, { callId: 'c2', name: 'read', arguments: { file_path: '/repo/b.js' } }),
  ];
  assert.equal(filesChangedSince(events, 3), 1); // read is not a change
});

test('research-only tools report zero changed files', () => {
  const events = [
    msg('tool/call', 1, { callId: 'r', name: 'read', arguments: { file_path: '/repo/a.js' } }),
    msg('tool/call', 2, { callId: 'g', name: 'grep', arguments: { pattern: 'needle', path: '/repo' } }),
    msg('tool/call', 3, { callId: 'gl', name: 'glob', arguments: { pattern: '**/*.js', path: '/repo' } }),
    msg('tool/call', 4, { callId: 'wf', name: 'web_fetch', arguments: { url: 'https://example.com/a/v1.2.3' } }),
    msg('tool/call', 5, { callId: 'ws', name: 'web_search', arguments: { queries: ['src/main.ts v20.11.1'] } }),
  ];
  assert.deepEqual(changedFiles(events), []);
  assert.equal(filesChangedSince(events, 0), 0);
});

test('bash commands and their output never count as file changes', () => {
  const events = [
    msg('tool/call', 1, { callId: 'c', name: 'bash', arguments: { command: 'ls src/main.ts' } }),
    msg('tool/result', 2, { callId: 'c', meta: { cwd: '/repo' }, message: { content: 'src/main.ts\npackage.json' } }),
    msg('tool/call', 3, { callId: 's', name: 'bash', arguments: { command: 'git status --short' } }),
    msg('tool/result', 4, { callId: 's', message: { content: ' M src/main.ts\n?? new-file.ts' } }),
  ];
  assert.deepEqual(changedFiles(events), []);
});

test('write/edit report exactly their structured paths, deduplicated', () => {
  const events = [
    msg('tool/call', 1, { callId: 'w1', name: 'write', arguments: { file_path: './src/a.js' } }),
    msg('tool/result', 2, { callId: 'w1', meta: { path: '/repo/src/a.js' }, message: { content: 'Created file' } }),
    msg('tool/call', 3, { callId: 'e1', name: 'edit', arguments: { file_path: 'src/b.js' } }),
    msg('tool/result', 4, { callId: 'e1', meta: { path: '/repo/src/b.js', diffs: [{ path: '/repo/src/b.js' }] } }),
    msg('tool/call', 5, { callId: 'w2', name: 'write', arguments: { file_path: '/repo/src/a.js' } }),
    msg('tool/result', 6, { callId: 'w2', meta: { path: '/repo/src/a.js' } }),
    msg('tool/call', 7, { callId: 'r', name: 'read', arguments: { file_path: '/repo/src/c.js' } }),
  ];
  assert.deepEqual(changedFiles(events), ['/repo/src/a.js', '/repo/src/b.js']);
});

test('string arguments and nested result.meta are supported', () => {
  const events = [
    msg('tool/call', 1, { callId: 'w', name: 'write', arguments: '{"file_path": "./src/a.ts"}' }),
    msg('tool/result', 2, { callId: 'w', result: { meta: { path: '/repo/src/a.ts' } } }),
  ];
  assert.deepEqual(changedFiles(events), ['/repo/src/a.ts']);
});

test('a failed write/edit is not a file change', () => {
  const events = [
    msg('tool/call', 1, { callId: 'e1', name: 'edit', arguments: { file_path: '/repo/a.js' } }),
    msg('tool/result', 2, {
      callId: 'e1',
      error: { name: 'FsError', code: 'FS_NOT_OBSERVED' },
      message: { isError: true, content: 'Error: cannot modify file' },
    }),
  ];
  assert.deepEqual(changedFiles(events), []);
});

test('URLs and version strings are never file changes', () => {
  const events = [
    msg('tool/call', 1, { callId: 'a', name: 'write', arguments: { file_path: 'https://example.com/a/v1.2.3' } }),
    msg('tool/call', 2, { callId: 'b', name: 'edit', arguments: { file_path: 'v20.11.1' } }),
    msg('tool/call', 3, { callId: 'c', name: 'write', arguments: { file_path: './src/main.ts' } }),
  ];
  assert.deepEqual(changedFiles(events), ['src/main.ts']);
});

test('extractPaths rejects URLs and version strings', () => {
  assert.deepEqual(
    extractPaths('https://example.com/a/v1.2.3 v20.11.1 src/main.ts'),
    ['src/main.ts'],
  );
});

test('picker warning count and scaffold Files changed agree', () => {
  const events = [
    turnStart(1, 1), userMsg(2, 'hello'), turnEnd(3, 1),
    msg('tool/call', 4, { callId: 'w', name: 'write', arguments: { file_path: '/repo/a.js' } }),
    msg('tool/result', 5, { callId: 'w', meta: { path: '/repo/a.js' } }),
    msg('tool/call', 6, { callId: 'r', name: 'read', arguments: { file_path: '/repo/b.js' } }),
    msg('tool/call', 7, { callId: 'e', name: 'edit', arguments: { file_path: '/repo/c.js' } }),
    msg('tool/result', 8, { callId: 'e', meta: { path: '/repo/c.js' } }),
  ];
  const after = events.filter((event) => event.seq > 3);
  const expected = changedFiles(after);
  assert.deepEqual(expected, ['/repo/a.js', '/repo/c.js']);
  assert.equal(filesChangedSince(events, 3), expected.length);
  const scaffold = buildScaffold(after);
  const section = /## Files changed\n([\s\S]*?)\n## /.exec(scaffold)?.[1] ?? '';
  assert.deepEqual(section.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2)), expected);
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
