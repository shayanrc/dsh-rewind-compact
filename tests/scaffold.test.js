import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScaffold, SCAFFOLD_FIELDS } from '../lib/scaffold.js';

const bashCall = (id, command) => ({ type: 'tool/call', seq: 1, data: { callId: id, name: 'bash', arguments: { command } } });
const bashResult = (id, result) => ({ type: 'tool/result', seq: 2, data: { callId: id, name: 'bash', result } });

test('SCAFFOLD_FIELDS names the five required sections in order', () => {
  assert.deepEqual(SCAFFOLD_FIELDS, [
    'Files changed',
    'Commands run',
    'Errors encountered',
    'Decisions made',
    'Outstanding TODOs',
  ]);
});

test('empty input renders all five sections as none', () => {
  const out = buildScaffold([]);
  for (const field of SCAFFOLD_FIELDS) assert.ok(out.includes(`## ${field}`));
  assert.equal((out.match(/none/g) ?? []).length, 5);
});

test('derives files, commands with exit codes, and errors from bash events', () => {
  const events = [
    bashCall('c1', 'git checkout src/main.ts'),
    bashResult('c1', 'M src/main.ts\n[exit code: 0]'),
    bashCall('c2', 'npm run build'),
    bashResult('c2', 'error: cannot find module "x"\n[exit code: 1]'),
  ];
  const out = buildScaffold(events);
  assert.ok(out.includes('git checkout src/main.ts (exit 0)'));
  assert.ok(out.includes('npm run build (exit 1)'));
  assert.ok(out.match(/Errors encountered[\s\S]*?error: cannot find module/));
});

test('derives decisions and TODOs from message text', () => {
  const events = [
    { type: 'assistant/message', seq: 3, data: { message: { role: 'assistant', content: 'We will use the fork recipe. TODO: wire the picker.' } } },
  ];
  const out = buildScaffold(events);
  assert.ok(out.match(/Decisions made[\s\S]*we will/i));
  assert.ok(out.match(/Outstanding TODOs[\s\S]*TODO: wire the picker/i));
});

test('flags nested summaries', () => {
  const events = [
    { type: 'assistant/message', seq: 4, data: { message: { role: 'assistant', content: 'This range already holds a prior compact summary.' } } },
  ];
  const out = buildScaffold(events);
  assert.ok(out.includes('includes a prior compact summary'));
});

test('write events contribute file paths', () => {
  const events = [
    { type: 'tool/call', seq: 5, data: { callId: 'c5', name: 'write', arguments: { file_path: '/repo/lib/scaffold.js' } } },
    { type: 'tool/result', seq: 6, data: { callId: 'c5', name: 'write', result: 'ok' } },
  ];
  const out = buildScaffold(events);
  assert.ok(out.match(/Files changed[\s\S]*scaffold\.js/));
});
