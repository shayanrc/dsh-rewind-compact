/**
 * Fork-seed contract (SPEC R4/R5, RWC-002/003/009).
 *
 * dsh-session's seed validator is not exported, so its rules are mirrored here
 * — the same approach scripts/check-contracts.mjs takes for the other
 * contracts (the probe additionally runs the REAL `Session.create`). The
 * regressions pinned:
 *
 *  - a kept replacement `surfaceOp` used to be flattened to `append`, which
 *    resurrected the shadowed originals in the child surface;
 *  - `developer/message` was missing from the surface set and never travelled;
 *  - policy facts and turn markers were dropped from the seed;
 *  - the summary used the retired `{kind: 'plugin', plugin}` source shape;
 *  - the summary record used the assistant-style `data.message` nesting or
 *    arrived without an `id`, poisoning the next fork.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeed,
  copySeedEvent,
  summaryEvent,
  summaryMessage,
  SUMMARY_SOURCE,
  SUMMARY_SOURCE_KIND,
} from '../lib/seed.js';
import { foldSurfaceRecords, seedSourceEvents, SURFACE_TYPES } from '../lib/events.js';

const ALLOWED_KEYS = new Set(['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable']);
const ROLE_BY_TYPE = {
  'system/message': 'system',
  'developer/message': 'developer',
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'tool',
};
const isReplace = (event) =>
  event.surfaceOp !== null
  && typeof event.surfaceOp === 'object'
  && !Array.isArray(event.surfaceOp)
  && event.surfaceOp.op === 'replace';

/** Mirror of dsh-session's assertSessionEventEnvelope + assertMessageEventShape. */
function assertSeedShape(seed) {
  seed.forEach((event, index) => {
    assert.ok(event && typeof event === 'object' && !Array.isArray(event), `seed[${index}] is not an object`);
    for (const key of Object.keys(event)) {
      assert.ok(ALLOWED_KEYS.has(key), `seed[${index}] has unexpected key "${key}"`);
    }
    assert.ok(Number.isSafeInteger(event.seq) && event.seq === index, `seed[${index}] seq must be contiguous from 0`);
    assert.ok(Number.isSafeInteger(event.time), `seed[${index}] time must be a safe integer`);
    assert.notEqual(event.data, undefined, `seed[${index}] data is undefined`);

    const eligible = SURFACE_TYPES.has(event.type);
    if (eligible) {
      assert.ok(event.surfaceOp !== undefined, `seed[${index}] (${event.type}) is missing its surfaceOp`);
    } else {
      assert.ok(!('surfaceOp' in event), `seed[${index}] (${event.type}) is not surface-eligible`);
      assert.ok(!('sourceEventSeqs' in event), `seed[${index}] (${event.type}) cannot carry sourceEventSeqs`);
    }
    if (isReplace(event)) {
      assert.ok(event.surfaceOp.startSeq < event.seq, `seed[${index}] replace startSeq must be earlier`);
      assert.ok(event.surfaceOp.endSeq < event.seq, `seed[${index}] replace endSeq must be earlier`);
      assert.ok(Array.isArray(event.sourceEventSeqs), `seed[${index}] replace needs sourceEventSeqs`);
    }

    const role = ROLE_BY_TYPE[event.type];
    if (!role) return;
    // For user/message the data object IS the message; the other types nest it.
    const message = event.type === 'user/message' ? event.data : event.data?.message;
    assert.ok(message && typeof message === 'object', `seed[${index}] (${event.type}) lacks an identified message`);
    assert.ok(typeof message.id === 'string' && message.id !== '', `seed[${index}] (${event.type}) lacks an identified message`);
    assert.equal(message.role, role, `seed[${index}] (${event.type}) role must be "${role}"`);
    assert.ok(typeof message.source?.kind === 'string' && message.source.kind !== '', `seed[${index}] (${event.type}) has invalid source`);
    assert.ok(Array.isArray(message.content), `seed[${index}] (${event.type}) has invalid content`);
    if (event.type === 'system/message') {
      assert.equal(message.source.kind, 'system-prompt');
    }
    if (event.type === 'assistant/message') {
      assert.equal(message.source.kind, 'model');
      assert.equal(typeof message.source.provider, 'string');
      assert.equal(typeof message.source.model, 'string');
      assert.equal(typeof event.data.turn, 'number');
      assert.equal(typeof event.data.step, 'number');
      assert.ok(Array.isArray(event.data.stream));
    }
    if (event.type === 'tool/result') {
      assert.equal(message.source.kind, 'tool');
      assert.equal(typeof message.source.callId, 'string');
      assert.equal(message.toolCallId, message.source.callId);
    }
  });
}

const text = (value) => [{ type: 'text', text: value }];
const headerLine = { type: 'session', version: 4, id: 'fixture-session', cwd: '/work/repo', isSeeded: false };

/** A v4 transcript with a prior replacement in the KEPT prefix, a developer
 *  message, policy facts, two completed turns, and one replacement in the
 *  discarded tail (so before mode has to fold it). */
function transcript() {
  return [
    headerLine,
    {
      type: 'system/message', seq: 0, time: 1, surfaceOp: 'append',
      data: { turn: 1, step: 0, message: { id: 'sys', role: 'system', content: text('system prompt'), source: { kind: 'system-prompt' } } },
    },
    { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
    {
      type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
      data: { id: 'u1', role: 'user', content: text('reply with exactly alpha'), source: { kind: 'user' } },
    },
    {
      type: 'assistant/message', seq: 3, time: 4, surfaceOp: 'append',
      data: {
        turn: 1, step: 1, stream: [],
        message: { id: 'a1', role: 'assistant', content: text('alpha'), source: { kind: 'model', provider: 'test', model: 'test-model' } },
      },
    },
    {
      type: 'user/message', seq: 4, time: 5, surfaceOp: 'append',
      data: { id: 'shadowed-context', role: 'user', content: text('old context that a replacement hid'), source: { kind: 'user' } },
    },
    {
      type: 'user/message', seq: 5, time: 6, surfaceOp: { op: 'replace', startSeq: 4, endSeq: 4 }, sourceEventSeqs: [4],
      data: { id: 'prior-summary', role: 'user', content: text('prior compact summary — kept'), source: { kind: 'compact-checkpoint', compactionId: 'cmp-1' } },
    },
    {
      type: 'developer/message', seq: 6, time: 7, surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: { id: 'dev', role: 'developer', content: text('follow the style guide'), source: { kind: 'agent-instructions' } },
      },
    },
    { type: 'permission/preset', seq: 7, time: 8, data: { preset: 'workspace-write' } },
    { type: 'sandbox/mode', seq: 8, time: 9, data: { mode: 'workspace-write' } },
    { type: 'turn/end', seq: 9, time: 10, data: { turn: 1 } },
    { type: 'turn/start', seq: 10, time: 11, data: { turn: 2 } },
    { type: 'sandbox/mode', seq: 11, time: 12, data: { mode: 'read-only' } },
    {
      type: 'user/message', seq: 12, time: 13, surfaceOp: 'append',
      data: { id: 'tail-shadowed', role: 'user', content: text('tail original the replacement hid'), source: { kind: 'user' } },
    },
    {
      type: 'user/message', seq: 13, time: 14, surfaceOp: { op: 'replace', startSeq: 12, endSeq: 12 }, sourceEventSeqs: [12],
      data: { id: 'u2', role: 'user', content: text('reply with exactly beta'), source: { kind: 'user' } },
    },
    {
      type: 'assistant/message', seq: 14, time: 15, surfaceOp: 'append',
      data: {
        turn: 2, step: 1, stream: [],
        message: { id: 'a2', role: 'assistant', content: text('beta'), source: { kind: 'model', provider: 'test', model: 'test-model' } },
      },
    },
    { type: 'tool/call', seq: 15, time: 16, data: { callId: 'c1', name: 'bash', arguments: { command: 'npm test' } } },
    {
      type: 'tool/result', seq: 16, time: 17, surfaceOp: 'append',
      data: {
        message: {
          id: 'r1', role: 'tool', content: text('ok\n[exit code: 0]'),
          source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1',
        },
      },
    },
    { type: 'turn/end', seq: 17, time: 18, data: { turn: 2 } },
    { type: 'session/title', seq: 18, time: 19, data: { title: 'Fixture session', messageSeqs: [2], source: { kind: 'user' } } },
  ];
}

const BOUNDARY = 9; // turn 2 starts at seq 10
const surfaceIds = (events) => foldSurfaceRecords(events)
  .map((event) => event.data.id ?? event.data.message?.id)
  .filter(Boolean);

test('after mode: raw prefix with preserved envelopes, one summary last', () => {
  const source = transcript();
  const seed = buildSeed(source, BOUNDARY, 'after', { id: 'sum', time: 100 });
  assertSeedShape(seed);

  // Verbatim prefix: seqs, replacements and their source references unchanged.
  const replacement = seed.find((event) => event.seq === 5);
  assert.deepEqual(replacement.surfaceOp, { op: 'replace', startSeq: 4, endSeq: 4 });
  assert.deepEqual(replacement.sourceEventSeqs, [4]);
  assert.equal(seed.find((event) => event.seq === 2).data.id, 'u1');
  assert.equal(seed.at(-1).seq, BOUNDARY + 1);
  assert.equal(seed.at(-1).type, 'user/message');
  assert.equal(seed.at(-1).data.id, 'sum');

  // The prior replacement summary is kept; its shadowed original stays a
  // shadowed log record, never a surface node.
  assert.ok(seed.some((event) => event.data.id === 'prior-summary'));
  assert.deepEqual(
    surfaceIds(seed),
    ['sys', 'u1', 'a1', 'prior-summary', 'dev', 'sum'],
    'the child surface must fold the preserved replacement, not resurrect the original',
  );
  assert.ok(!surfaceIds(seed).includes('shadowed-context'));

  // developer/message, policy facts and turn markers travel with the prefix.
  assert.ok(seed.some((event) => event.type === 'developer/message' && event.data.message.id === 'dev'));
  assert.ok(seed.some((event) => event.type === 'permission/preset' && event.data.preset === 'workspace-write'));
  assert.ok(seed.some((event) => event.type === 'sandbox/mode' && event.data.mode === 'workspace-write'));
  assert.ok(seed.some((event) => event.type === 'turn/start' && event.data.turn === 1));
  assert.ok(seed.some((event) => event.type === 'turn/end' && event.data.turn === 1));

  // The summary describes the discarded tail's CURRENT surface and pairs the
  // tool call with its result.
  const summaryText = seed.at(-1).data.content[0].text;
  assert.match(summaryText, /npm test \(exit 0\)/);
  assert.doesNotMatch(summaryText, /tail original the replacement hid/);
});

test('before mode: one summary first, folded current tail after it', () => {
  const source = transcript();
  const seed = buildSeed(source, BOUNDARY, 'before', { id: 'sum', time: 100 });
  assertSeedShape(seed);

  assert.equal(seed[0].type, 'user/message');
  assert.equal(seed[0].data.id, 'sum');
  assert.match(seed[0].data.content[0].text, /## Files changed/);
  assert.deepEqual(seed.map((event) => event.seq), seed.map((_, index) => index));
  assert.deepEqual(surfaceIds(seed), ['sum', 'u2', 'a2', 'r1']);

  // The tail replacement is folded: its content is kept as the current node,
  // the shadowed original never travels, and no dangling source references
  // are carried into the renumbered seed.
  assert.ok(!seed.some((event) => event.data?.id === 'tail-shadowed'));
  assert.ok(seed.every((event) => !('sourceEventSeqs' in event)));
  assert.ok(seed.filter((event) => SURFACE_TYPES.has(event.type)).every((event) => event.surfaceOp === 'append'));

  // Policy facts and turn markers after the cut survive.
  assert.ok(seed.some((event) => event.type === 'sandbox/mode' && event.data.mode === 'read-only'));
  assert.ok(seed.some((event) => event.type === 'turn/start' && event.data.turn === 2));
  assert.ok(seed.some((event) => event.type === 'turn/end' && event.data.turn === 2));
});

test('the header line and non-session rows are filtered out of the seed', () => {
  const source = [{ ...headerLine }, ...transcript().slice(1), { type: 'torn', seq: undefined }];
  const seed = buildSeed(source, BOUNDARY, 'after', { id: 'sum', time: 100 });
  assertSeedShape(seed);
  assert.equal(seed[0].type, 'system/message');
  assert.equal(seedSourceEvents(source).length, 19);
});

test('every seed record is a deep copy — the source transcript is not mutated', () => {
  const source = transcript();
  const frozen = JSON.parse(JSON.stringify(source));
  const seed = buildSeed(source, BOUNDARY, 'after');
  seed[2].data.content[0].text = 'mutated';
  seed[0].surfaceOp = 'replace';
  assert.deepEqual(source, frozen, 'the source transcript is byte-for-byte unchanged');
  assert.equal(source.find((event) => event.seq === 2).data.content[0].text, 'reply with exactly alpha');
});

test('copySeedEvent preserves seq/surfaceOp/sourceEventSeqs and copies data', () => {
  const source = transcript()[5];
  const copy = copySeedEvent(source);
  assert.deepEqual(copy, source);
  assert.notEqual(copy, source);
  assert.notEqual(copy.data, source.data);
});

test('summary source is the declared rewind-compact kind, never the retired plugin wrapper', () => {
  assert.equal(SUMMARY_SOURCE_KIND, 'rewind-compact');
  assert.deepEqual(SUMMARY_SOURCE, { kind: 'rewind-compact' });
  const message = summaryMessage('scaffold text');
  assert.ok(typeof message.id === 'string' && message.id.length > 0, 'append() does not assign an id — the caller must');
  assert.equal(message.role, 'user');
  assert.deepEqual(message.source, { kind: 'rewind-compact' });
  assert.ok(!('plugin' in message.source), 'the retired {kind:"plugin", plugin} wrapper must not return');
  assert.deepEqual(message.content, [{ type: 'text', text: 'scaffold text' }]);
  assert.notEqual(summaryMessage('x').id, summaryMessage('x').id, 'each summary needs its own id');
});

test('summaryEvent is the seeded user/message shape with no seq until buildSeed assigns one', () => {
  const a = summaryEvent('x', { time: 1 });
  const b = summaryEvent('x', { time: 1 });
  assert.equal(a.type, 'user/message');
  assert.equal(a.surfaceOp, 'append');
  assert.equal(a.time, 1);
  assert.ok(!('seq' in a));
  assert.ok(a.data.id && b.data.id && a.data.id !== b.data.id);
  assert.deepEqual(a.data.source, { kind: 'rewind-compact' });
});

test('the mirror rejects the shape that broke the fork', () => {
  assert.throws(() => assertSeedShape([
    {
      type: 'user/message', seq: 0, time: 1, surfaceOp: 'append',
      data: { message: { role: 'user', content: 'prose' }, source: { kind: 'plugin' } },
    },
  ]), /lacks an identified message/);
});

test('a non-contiguous source log is rejected instead of silently resequenced', () => {
  assert.throws(
    () => buildSeed([
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 2, data: { turn: 1 } },
    ], 1, 'after'),
    /not contiguous/,
  );
});
