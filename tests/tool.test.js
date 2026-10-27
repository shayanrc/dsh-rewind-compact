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

// ── RWC-007/RWC-013: direct-human gate ──────────────────────────────────────

function gatedHarness({ kind = 'user', roots = undefined, projection = { openTurnStartSeq: 4 }, rootSelf = false } = {}) {
  const events = [
    msg('session', 0, {}),
    turnStart(1, 1), userMsg(2, 'first'), turnEnd(3, 1),
    turnStart(4, 2), userMsg(5, 'current input', kind), turnEnd(6, 2),
  ];
  const created = [];
  const agent = { session: { id: 'source-session', snapshotEvents: () => events } };
  const agents = {
    create: async (options) => { created.push(options); return { id: options.sessionId }; },
  };
  if (rootSelf) agents.roots = () => [agent];
  else if (roots !== undefined) agents.roots = () => roots;
  const ctx = {
    agents,
    get(name) {
      if (name === 'agents') return agents;
      if (name === 'sessionProjections') return projection === null ? undefined : { stateOf: () => projection };
      if (name === 'logger') return quietLogger();
      return undefined;
    },
  };
  return { tool: rewindCompactTool(ctx), agent, created };
}

test('rewind:true fails closed when the open turn has no human-sourced message', async () => {
  const { tool, agent, created } = gatedHarness({ kind: 'runtime-context' });
  await assert.rejects(
    () => tool.execute({ point: '2', rewind: true }, { agent }),
    (err) => err.code === 'REWIND_COMPACT_APPROVAL_REQUIRED',
  );
  assert.equal(created.length, 0, 'a denied rewind must not create a child');
});

test('rewind:true fails closed for a non-root agent', async () => {
  const { tool, agent, created } = gatedHarness({ roots: [] });
  await assert.rejects(
    () => tool.execute({ point: '2', rewind: true }, { agent }),
    (err) => err.code === 'REWIND_COMPACT_APPROVAL_REQUIRED',
  );
  assert.equal(created.length, 0);
});

test('rewind:true fails closed when the turn-boundary projection is unavailable', async () => {
  const { tool, agent, created } = gatedHarness({ projection: null });
  await assert.rejects(
    () => tool.execute({ point: '2', rewind: true }, { agent }),
    (err) => err.code === 'REWIND_COMPACT_APPROVAL_REQUIRED',
  );
  assert.equal(created.length, 0);
});

test('rewind:true forks for a root agent with human input in the open turn', async () => {
  const { tool, agent, created } = gatedHarness({ rootSelf: true });
  const result = await tool.execute({ point: '2', rewind: true }, { agent });
  assert.equal(result.forked, true);
  assert.equal(created.length, 1);
});

// ── RWC-020: the gate must map seq → index, never use seq as an index ────────
//
// `openTurnStartSeq` is an event seq. The scan below uses it as an ARRAY INDEX,
// which is only correct when the snapshot has no pre-seq rows and seqs start at
// 0. These fixtures vary both: k pre-seq header rows (the live v4 transcript
// carries one — index === seq + 1) and a log whose seqs start at 1 (a sliced or
// imported log — index === seq − 1).

function gateToolHarness(events, projection) {
  const created = [];
  const agent = { session: { id: 'source-session', snapshotEvents: () => events } };
  const agents = {
    create: async (options) => { created.push(options); return { id: options.sessionId }; },
    roots: () => [agent],
  };
  const ctx = {
    agents,
    get(name) {
      if (name === 'agents') return agents;
      if (name === 'sessionProjections') return { stateOf: () => projection };
      if (name === 'logger') return quietLogger();
      return undefined;
    },
  };
  return { tool: rewindCompactTool(ctx), agent, created };
}

// Pre-seq rows carry no seq — the physical header shape (RWC-020 evidence).
const PRE_SEQ_ROW = { type: 'session', version: 4 };
const LEGACY_ROW = { type: 'session/meta', legacy: true };

/** Three turns completed with human messages; turn 4 open with `openKind`. */
function manyPreSeqRowsLog(openKind) {
  return [
    PRE_SEQ_ROW, LEGACY_ROW, { ...LEGACY_ROW },
    turnStart(0, 1), userMsg(1, 'first ask'), turnEnd(2, 1),
    turnStart(3, 2), userMsg(4, 'second ask'), turnEnd(5, 2),
    turnStart(6, 3), userMsg(7, 'third ask'), turnEnd(8, 3),
    turnStart(9, 4), userMsg(10, openKind === 'user' ? 'human keeps typing' : 'goal-round nudge', openKind),
  ];
}

/** No pre-seq rows, seqs contiguous from 0; turn 3 open with a human message. */
function noPreSeqRowsLog() {
  return [
    turnStart(0, 1), userMsg(1, 'first ask'), turnEnd(2, 1),
    turnStart(3, 2), userMsg(4, 'second ask'), turnEnd(5, 2),
    turnStart(6, 3), userMsg(7, 'human keeps typing'),
  ];
}

test('RWC-020: with k>=2 pre-seq rows an agent-initiated open turn fails closed though the previous turn had a human message', async () => {
  const events = manyPreSeqRowsLog('runtime-context');
  const { tool, agent, created } = gateToolHarness(events, { openTurnStartSeq: 9 });
  await assert.rejects(
    () => tool.execute({ point: '3', rewind: true }, { agent }),
    (err) => err.code === 'REWIND_COMPACT_APPROVAL_REQUIRED',
  );
  assert.equal(created.length, 0, 'an agent-initiated turn must not fork (no fail-open)');
});

test('RWC-020: with k>=2 pre-seq rows a human message in the open turn still forks', async () => {
  const events = manyPreSeqRowsLog('user');
  const { tool, agent, created } = gateToolHarness(events, { openTurnStartSeq: 9 });
  const result = await tool.execute({ point: '3', rewind: true }, { agent });
  assert.equal(result.forked, true);
  assert.equal(created.length, 1);
});

test('RWC-020: with no pre-seq rows (k=0) a human message in the open turn still forks', async () => {
  const events = noPreSeqRowsLog();
  const { tool, agent, created } = gateToolHarness(events, { openTurnStartSeq: 6 });
  const result = await tool.execute({ point: '2', rewind: true }, { agent });
  assert.equal(result.forked, true);
  assert.equal(created.length, 1);
});

test('RWC-020: one pre-seq row (k=1, the JSONL header shape) — gate scoped to the open turn', async () => {
  // The JSONL file's physical header shape: one seq-less row before seq 0
  // (index === seq + 1). snapshotEvents() never contains that row, but a scan
  // must not depend on any pre-seq row count. The gate must pass with a human
  // message in the open turn and fail closed without one; the fork itself then
  // rejects this snapshot downstream (REWIND_COMPACT_FIRST) — only the gate's
  // verdict is under test here.
  const withHuman = gateToolHarness(
    [
      PRE_SEQ_ROW,
      turnStart(0, 1), userMsg(1, 'first ask'), turnEnd(2, 1),
      turnStart(3, 2), userMsg(4, 'human keeps typing'),
    ],
    { openTurnStartSeq: 3 },
  );
  await assert.rejects(
    () => withHuman.tool.execute({ point: '1', rewind: true }, { agent: withHuman.agent }),
    (err) => err.code === 'REWIND_COMPACT_FIRST',
  );
  assert.equal(withHuman.created.length, 0);

  const agentInitiated = gateToolHarness(
    [
      PRE_SEQ_ROW,
      turnStart(0, 1), userMsg(1, 'first ask'), turnEnd(2, 1),
      turnStart(3, 2), userMsg(4, 'goal-round nudge', 'runtime-context'),
    ],
    { openTurnStartSeq: 3 },
  );
  await assert.rejects(
    () => agentInitiated.tool.execute({ point: '1', rewind: true }, { agent: agentInitiated.agent }),
    (err) => err.code === 'REWIND_COMPACT_APPROVAL_REQUIRED',
  );
  assert.equal(agentInitiated.created.length, 0);
});

test('RWC-020: seqs not starting at 0 — the row right after turn/start is not skipped', async () => {
  // A sliced/imported log whose first row is seq 1 (index === seq − 1): the
  // human message immediately after the open turn/start must still count.
  // The gate PASSES here; the fork then rejects the torn (non-contiguous-from-0)
  // log in buildSeed, which is the proof the gate let the human input through.
  const events = [
    turnStart(1, 1), userMsg(2, 'first ask'), turnEnd(3, 1),
    turnStart(4, 2), userMsg(5, 'human keeps typing'),
  ];
  const { tool, agent, created } = gateToolHarness(events, { openTurnStartSeq: 4 });
  await assert.rejects(
    () => tool.execute({ point: '1', rewind: true }, { agent }),
    (err) => err.code !== 'REWIND_COMPACT_APPROVAL_REQUIRED' && /contiguous/.test(err.message),
  );
  assert.equal(created.length, 0);
});

test('RWC-020: an openTurnStartSeq matching no transcript row fails closed', async () => {
  const events = noPreSeqRowsLog();
  const { tool, agent, created } = gateToolHarness(events, { openTurnStartSeq: -5 });
  await assert.rejects(
    () => tool.execute({ point: '2', rewind: true }, { agent }),
    (err) => err.code === 'REWIND_COMPACT_APPROVAL_REQUIRED',
  );
  assert.equal(created.length, 0);
});

// ── RWC-019: the tool's point resolution is the recovery path ────────────────
//
// The picker never advertises a turn that a compaction checkpoint shadowed,
// but an explicit `point` still resolves it (recorded decision in the ticket).

test('RWC-019: the tool still resolves explicit points for out-of-context turns', async () => {
  const events = [
    msg('session', 0, {}),
    turnStart(1, 1), userMsg(2, 'first ask'), turnEnd(3, 1),
    turnStart(4, 2), userMsg(5, 'second ask'), turnEnd(6, 2),
    turnStart(7, 5),
    {
      type: 'user/message', seq: 8, time: 8,
      surfaceOp: { op: 'replace', startSeq: 5, endSeq: 5 },
      data: { message: { role: 'user', content: 'compaction summary of turn 2' }, source: { kind: 'compact-checkpoint', compactionId: 'c1' } },
    },
  ];
  const session = { id: 'source-session', snapshotEvents: () => events };
  const ctx = { get: (name) => (name === 'logger' ? quietLogger() : undefined) };
  const tool = rewindCompactTool(ctx);

  // Turn 2's only message is shadowed by the checkpoint — the retired
  // (ungated) path still resolves point "2"; a picker-filtered resolution
  // would throw REWIND_COMPACT_NO_TURN here.
  const result = await tool.execute({ point: '2', rewind: false }, { agent: { session } });
  assert.equal(result.reason, IN_PLACE_RETIRED_REASON);
  assert.equal(result.ok, false);
});
