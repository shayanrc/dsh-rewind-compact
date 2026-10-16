/**
 * Fork-seed envelope contract (SPEC R4).
 *
 * dsh-session's seed validator is not exported, so its rules are mirrored here
 * — the same approach scripts/check-contracts.mjs takes for the other
 * contracts. Two regressions are pinned:
 *
 *  - the summary record used the assistant-style `data.message.{role,content}`
 *    shape (bare string content, no id), so every fork died with
 *    "seed user/message at index 0 lacks an identified message";
 *  - `append()` neither assigns nor requires a message `id`, so an appended
 *    summary reached the transcript without one and poisoned the next fork
 *    ("session event at seq N lacks an identified message").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeed, materializeEvent, summaryEvent, summaryMessage } from '../lib/seed.js';

const ALLOWED_KEYS = new Set(['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable']);
const ROLE_BY_TYPE = {
  'system/message': 'system',
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'user',
};

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
    const role = ROLE_BY_TYPE[event.type];
    if (!role) return;
    // For user/message the data object IS the message; the other types nest it.
    const message = event.type === 'user/message' ? event.data : event.data?.message;
    assert.ok(message && typeof message === 'object', `seed[${index}] (${event.type}) lacks an identified message`);
    assert.ok(typeof message.id === 'string' && message.id !== '', `seed[${index}] (${event.type}) lacks an identified message`);
    assert.equal(message.role, role, `seed[${index}] (${event.type}) role must be "${role}"`);
    assert.ok(typeof message.source?.kind === 'string' && message.source.kind !== '', `seed[${index}] (${event.type}) has invalid source`);
    assert.ok(Array.isArray(message.content), `seed[${index}] (${event.type}) has invalid content`);
  });
}

/** Two completed turns, in the shapes a real transcript uses (assistant
 *  messages embed their stream and never carry sourceEventSeqs; tool/result
 *  records may cite earlier events). */
const EVENTS = [
  { type: 'session', seq: 0, time: 1, data: { id: 's1', cwd: '/w' } },
  { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
  { type: 'user/message', seq: 2, time: 3, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Reply with exactly: alpha' }], source: { kind: 'user' } } },
  { type: 'assistant/message', seq: 3, time: 4, data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'alpha' }], source: { kind: 'assistant' } } } },
  { type: 'tool/result', seq: 4, time: 5, data: { callId: 'c1', message: { id: 'r1', role: 'user', content: [{ type: 'text', text: 'ok' }], source: { kind: 'tool' } } }, sourceEventSeqs: [3] },
  { type: 'turn/end', seq: 5, time: 6, data: { turn: 1 } },
  { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
  { type: 'user/message', seq: 7, time: 8, data: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Reply with exactly: beta' }], source: { kind: 'user' } } },
  { type: 'assistant/message', seq: 8, time: 9, data: { turn: 2, step: 1, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'beta' }], source: { kind: 'assistant' } } } },
  { type: 'turn/end', seq: 9, time: 10, data: { turn: 2 } },
];
const BOUNDARY = 5; // turn 2 starts at seq 6, so the kept prefix ends at 5

test('summary event carries the user/message envelope the seed validator requires', () => {
  const seed = buildSeed(EVENTS, BOUNDARY, 'before', { id: 'summary-1', time: 11 });
  assertSeedShape(seed);
  const summary = seed[0];
  assert.equal(summary.type, 'user/message');
  assert.equal(summary.data.id, 'summary-1');
  assert.equal(summary.data.role, 'user');
  assert.deepEqual(summary.data.source, { kind: 'plugin', plugin: 'dsh-rewind-compact' });
  assert.match(summary.data.content[0].text, /## Files changed/);
  assert.equal(summary.surfaceOp, 'append');
});

test('the mirror rejects the shape that broke the fork', () => {
  const broken = [
    {
      ...materializeEvent({
        type: 'user/message',
        time: 1,
        data: { message: { role: 'user', content: 'prose' }, source: { kind: 'plugin' } },
      }),
      seq: 0,
    },
  ];
  assert.throws(() => assertSeedShape(broken), /lacks an identified message/);
});

test('before mode: one summary first, the kept tail verbatim after it', () => {
  const seed = buildSeed(EVENTS, BOUNDARY, 'before', { id: 'sum', time: 11 });
  assertSeedShape(seed);
  assert.deepEqual(seed.map((e) => e.data.id ?? e.data.message?.id), ['sum', 'u2', 'a2']);
  assert.deepEqual(seed.map((e) => e.seq), [0, 1, 2]);
});

test('after mode: the kept prefix verbatim first, one summary last', () => {
  const seed = buildSeed(EVENTS, BOUNDARY, 'after', { id: 'sum', time: 11 });
  assertSeedShape(seed);
  assert.deepEqual(seed.map((e) => e.data.id ?? e.data.message?.id), ['u1', 'a1', 'r1', 'sum']);
  assert.deepEqual(seed.map((e) => e.seq), [0, 1, 2, 3]);
});

test('verbatim events keep their ids, gain surfaceOp, and drop source seq references', () => {
  const seed = buildSeed(EVENTS, BOUNDARY, 'after');
  const assistant = seed.find((e) => e.type === 'assistant/message');
  assert.equal(assistant.data.message.id, 'a1', 'verbatim payloads travel as-is');
  assert.equal(assistant.surfaceOp, 'append');
  const toolResult = seed.find((e) => e.type === 'tool/result');
  assert.ok(!('sourceEventSeqs' in toolResult), 'source seq references must not travel into the renumbered seed');
  assert.deepEqual(EVENTS[4].sourceEventSeqs, [3], 'the source transcript is never mutated');
});

test('seeded events are plain copies — mutating a seed cannot touch the source transcript', () => {
  const seed = buildSeed(EVENTS, BOUNDARY, 'after');
  seed[0].data.content[0].text = 'mutated';
  assert.equal(EVENTS[2].data.content[0].text, 'Reply with exactly: alpha');
});

test('summary message carries the id an appended event needs', () => {
  const message = summaryMessage('scaffold text');
  assert.ok(typeof message.id === 'string' && message.id.length > 0, 'append() does not assign an id — the caller must');
  assert.equal(message.role, 'user');
  assert.equal(message.source.kind, 'plugin');
  assert.deepEqual(message.content, [{ type: 'text', text: 'scaffold text' }]);
  assert.notEqual(summaryMessage('x').id, summaryMessage('x').id, 'each summary needs its own id');
});

test('a summary without an id still gets a unique one', () => {
  const a = summaryEvent('x', { time: 1 });
  const b = summaryEvent('x', { time: 1 });
  assert.ok(a.data.id && b.data.id && a.data.id !== b.data.id);
});
