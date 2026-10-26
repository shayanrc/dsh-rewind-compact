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
