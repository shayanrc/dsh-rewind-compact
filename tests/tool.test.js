import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// lib/tool.js imports the harness's defineTool and the fork helper's SessionId
// (plus HarnessError through lib/errors.js). The worktree has no node_modules,
// so resolve those three specifiers to tiny stubs; everything else imports from
// this checkout. This keeps the tool path unit-testable under `npm test`.
const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: dataModule('export function defineTool(definition) { return definition; }'), shortCircuit: true };
    }
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

const { IN_PLACE_RETIRED_REASON, rewindCompactTool } = await import('../lib/tool.js');

const msg = (type, seq, data) => ({ type, seq, time: seq, data });
const turnStart = (seq, turn) => msg('turn/start', seq, { turn });
const turnEnd = (seq, turn) => msg('turn/end', seq, { turn });
const userMsg = (seq, text, kind = 'user') => msg('user/message', seq, {
  message: { role: 'user', content: text },
  source: { kind },
});

function quietLogger() {
  return { info() {}, warn() {} };
}

function completedTurnWithWrite() {
  return [
    turnStart(1, 1),
    userMsg(2, 'change the file'),
    msg('tool/call', 3, { callId: 'w1', name: 'write', arguments: { file_path: '/repo/a.js' } }),
    msg('tool/result', 4, { callId: 'w1', meta: { path: '/repo/a.js' }, message: { content: 'Created file' } }),
    turnEnd(5, 1),
  ];
}

test('rewind:false returns the documented retired result and mutates nothing', async () => {
  const events = completedTurnWithWrite();
  const snapshot = structuredClone(events);
  const appendCalls = [];
  const compactCalls = [];
  const session = {
    id: 'source-session',
    snapshotEvents: () => events,
    append: (...args) => { appendCalls.push(args); },
  };
  const ctx = {
    get(name) {
      if (name === 'compaction') return { compactRegion: (...args) => { compactCalls.push(args); } };
      if (name === 'logger') return quietLogger();
      return undefined;
    },
  };
  const tool = rewindCompactTool(ctx);

  const result = await tool.execute({ point: '1', rewind: false }, { agent: { session } });

  assert.equal(result.ok, false);
  assert.equal(result.applied, false);
  assert.equal(result.forked, false);
  assert.equal(result.hybrid, false);
  assert.equal(result.childSessionId, null);
  assert.equal(result.sourceSessionId, null);
  assert.equal(result.compactedRange, null);
  assert.equal(result.filesChanged, 1);
  assert.equal(result.reason, IN_PLACE_RETIRED_REASON);
  assert.match(result.note, /retired/i);
  assert.match(result.note, /rewind: true/);
  assert.equal(appendCalls.length, 0, 'the retired path must not append a scaffold');
  assert.equal(compactCalls.length, 0, 'the retired path must not call compactRegion');
  assert.deepEqual(events, snapshot, 'the source transcript must be unchanged');
});

test('an omitted rewind flag also takes the retired path', async () => {
  const events = completedTurnWithWrite();
  const session = { id: 'source-session', snapshotEvents: () => events, append: () => { throw new Error('append must not run'); } };
  const ctx = { get: (name) => (name === 'logger' ? quietLogger() : undefined) };
  const tool = rewindCompactTool(ctx);

  const result = await tool.execute({ point: '1' }, { agent: { session } });
  assert.equal(result.reason, IN_PLACE_RETIRED_REASON);
  assert.equal(result.applied, false);
  assert.equal(result.forked, false);
});

test('rewind:true still forks and reports hybrid:false', async () => {
  const events = [
    msg('session', 0, {}),
    turnStart(1, 1), userMsg(2, 'first'), turnEnd(3, 1),
    turnStart(4, 2), userMsg(5, 'human keeps typing'), turnEnd(6, 2),
  ];
  const created = [];
  const session = { id: 'source-session', snapshotEvents: () => events };
  const agents = {
    create: async (options) => {
      created.push(options);
      return { id: options.sessionId };
    },
  };
  const ctx = {
    agents,
    get(name) {
      if (name === 'agents') return agents;
      if (name === 'sessionProjections') return { stateOf: () => ({ openTurnStartSeq: 4 }) };
      if (name === 'logger') return quietLogger();
      return undefined;
    },
  };
  const tool = rewindCompactTool(ctx);

  const result = await tool.execute({ point: '2', rewind: true }, { agent: { session } });

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.forked, true);
  assert.equal(result.hybrid, false);
  assert.equal(result.sourceSessionId, 'source-session');
  assert.equal(typeof result.childSessionId, 'string');
  assert.equal(result.compactedRange, null);
  assert.equal(created.length, 1);
  assert.ok(Array.isArray(created[0].seed));
});

test('output schema has a fork branch and a retired branch, with no in-place range', () => {
  const tool = rewindCompactTool({ get: () => undefined });
  const branches = tool.output.schema.oneOf;
  assert.equal(branches.length, 2);

  const retired = branches.find((branch) => branch.properties?.reason !== undefined);
  assert.ok(retired, 'retired branch must require a reason');
  assert.deepEqual(retired.properties.reason, { type: 'string', required: true });
  assert.deepEqual(retired.properties.note, { type: 'string', required: true });
  assert.deepEqual(retired.properties.compactedRange, { type: 'null', required: true });
  assert.deepEqual(retired.properties.applied, { type: 'boolean', required: true });
  assert.deepEqual(retired.properties.hybrid, { type: 'boolean', required: true });

  const fork = branches.find((branch) => branch.properties?.reason === undefined);
  assert.ok(fork);
  assert.deepEqual(fork.properties.childSessionId, { type: 'string', required: true });

  assert.equal(JSON.stringify(tool.output.schema).includes('"start"'), false);
  assert.equal(JSON.stringify(tool.output.schema).includes('"end"'), false);
  assert.match(tool.description, /retired/i);
});
