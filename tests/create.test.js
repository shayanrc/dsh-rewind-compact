/**
 * Create-time options for a fork (SPEC R4, R12; RWC-002).
 *
 * 0.2.1's CreateAgentOptions reads meta{ cwd, parentSession, isSeeded,
 * agentPreset } and inheritedEventCount; the old top-level aliases are
 * ignored. These tests pin the exact object and the title seam (a
 * `session/title` event, best-effort, never a create option).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateOptions, rewoundTitle, REWOUND_TITLE_SUFFIX } from '../lib/create.js';

function fakeChild() {
  const appended = [];
  let cleared = 0;
  return {
    appended,
    get cleared() { return cleared; },
    inbox: { clear: () => { cleared += 1; } },
    session: { append: (type, data) => { appended.push({ type, data }); } },
  };
}

const SEED = [
  { type: 'user/message', seq: 0, time: 1, data: { id: 'u1', role: 'user', content: [], source: { kind: 'user' } }, surfaceOp: 'append' },
  { type: 'user/message', seq: 1, time: 2, data: { id: 'sum', role: 'user', content: [], source: { kind: 'rewind-compact' } }, surfaceOp: 'append' },
];

test('exact 0.2.1 create options: meta + inheritedEventCount, no legacy aliases', () => {
  const options = buildCreateOptions({
    source: { id: 'source-session' },
    sessionId: 'child-session',
    seed: SEED,
    cwd: '/work/repo',
    title: 'Original title',
    agentPreset: 'standard',
  });
  assert.deepEqual(Object.keys(options).sort(), ['inheritedEventCount', 'meta', 'seed', 'sessionId', 'setup']);
  assert.equal(options.sessionId, 'child-session');
  assert.equal(options.seed, SEED, 'the composed seed travels by reference until the factory snapshots it');
  assert.equal(options.inheritedEventCount, SEED.length);
  assert.deepEqual(options.meta, {
    cwd: '/work/repo',
    parentSession: 'source-session',
    isSeeded: true,
    agentPreset: 'standard',
  });
  for (const legacy of ['inheritedCount', 'parentSession', 'cwd', 'title']) {
    assert.ok(!(legacy in options), `agents.create must not receive the ignored top-level "${legacy}" alias`);
  }
  assert.equal(typeof options.setup, 'function');
});

test('optional meta fields are omitted rather than sent as undefined', () => {
  const options = buildCreateOptions({ source: {}, sessionId: 'child', seed: SEED });
  assert.deepEqual(options.meta, { isSeeded: true });
  assert.deepEqual(Object.keys(options.meta).sort(), ['isSeeded']);
});

test('setup clears the child inbox and appends the rewound title event', async () => {
  const child = fakeChild();
  const options = buildCreateOptions({
    source: { id: 'source-session' }, sessionId: 'child', seed: SEED, title: 'Original title',
  });
  await options.setup({}, child);
  assert.equal(child.cleared, 1, 'the cut keeps pre-turn inbox insertions but drops their claims');
  assert.deepEqual(child.appended, [{
    type: 'session/title',
    data: { title: `Original title${REWOUND_TITLE_SUFFIX}`, messageSeqs: [], source: { kind: 'user' } },
  }]);
});

test('an untitled source appends no title event but still clears the inbox', async () => {
  for (const title of [undefined, '', '   ']) {
    const child = fakeChild();
    const options = buildCreateOptions({ source: { id: 's' }, sessionId: 'child', seed: SEED, title });
    await options.setup({}, child);
    assert.equal(child.cleared, 1);
    assert.deepEqual(child.appended, [], 'do not invent a title when the source has none');
  }
});

test('a failed title append never aborts an otherwise successful fork', async () => {
  let cleared = 0;
  const child = {
    inbox: { clear: () => { cleared += 1; } },
    session: { append() { throw new Error('title service unavailable'); } },
  };
  const options = buildCreateOptions({ source: { id: 's' }, sessionId: 'child', seed: SEED, title: 'Title' });
  await assert.doesNotReject(() => options.setup({}, child));
  assert.equal(cleared, 1);
});

test('a missing session/inbox degrades without throwing', async () => {
  const options = buildCreateOptions({ source: { id: 's' }, sessionId: 'child', seed: SEED, title: 'Title' });
  await assert.doesNotReject(() => options.setup({}, undefined));
  await assert.doesNotReject(() => options.setup({}, {}));
});

test('rewoundTitle adds the SPEC R12 suffix once and skips empty titles', () => {
  assert.equal(rewoundTitle('Original title'), 'Original title (rewound)');
  assert.equal(rewoundTitle('  padded  '), 'padded (rewound)');
  assert.equal(rewoundTitle(undefined), undefined);
  assert.equal(rewoundTitle('   '), undefined);
});

test('buildCreateOptions rejects a missing seed', () => {
  assert.throws(() => buildCreateOptions({ source: {}, sessionId: 'child' }), /seed array/);
});
