import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScaffold, SCAFFOLD_FIELDS, MAX_SCAFFOLD_FILES } from '../lib/scaffold.js';

const bashCall = (id, command) => ({ type: 'tool/call', seq: 1, data: { callId: id, name: 'bash', arguments: { command } } });
const bashResult = (id, result) => ({ type: 'tool/result', seq: 2, data: { callId: id, name: 'bash', result } });

const filesSection = (scaffold) => /## Files changed\n([\s\S]*?)(?:\n## |$)/.exec(scaffold)?.[1] ?? '';

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

test('derives commands with exit codes and errors from bash events, but no files', () => {
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
  assert.equal(filesSection(out), 'none');
});

test('read and web paths are not file changes', () => {
  const events = [
    { type: 'tool/call', seq: 1, data: { callId: 'r1', name: 'read', arguments: { file_path: '/repo/src/read.js' } } },
    { type: 'tool/result', seq: 2, data: { callId: 'r1', message: { content: 'file text' } } },
    { type: 'tool/call', seq: 3, data: { callId: 'w1', name: 'web_fetch', arguments: { url: 'https://example.com/v1.2.3' } } },
    { type: 'tool/result', seq: 4, data: { callId: 'w1', message: { content: 'fetched https://example.com/v1.2.3' } } },
    { type: 'tool/call', seq: 5, data: { callId: 'g1', name: 'grep', arguments: { pattern: 'x', path: '/repo' } } },
  ];
  assert.equal(filesSection(buildScaffold(events)), 'none');
});

test('bash output paths are not file changes', () => {
  const events = [
    bashCall('c1', 'ls src/main.ts package.json'),
    bashResult('c1', 'src/main.ts\npackage.json\n[exit code: 0]'),
  ];
  assert.equal(filesSection(buildScaffold(events)), 'none');
});

test('write/edit paths are deduplicated and prefer structured result metadata', () => {
  const events = [
    { type: 'tool/call', seq: 1, data: { callId: 'w1', name: 'write', arguments: { file_path: './src/a.ts' } } },
    { type: 'tool/result', seq: 2, data: { callId: 'w1', meta: { path: '/repo/src/a.ts' } } },
    { type: 'tool/call', seq: 3, data: { callId: 'e1', name: 'edit', arguments: { file_path: '/repo/src/a.ts' } } },
    { type: 'tool/result', seq: 4, data: { callId: 'e1', meta: { path: '/repo/src/a.ts' } } },
    { type: 'tool/call', seq: 5, data: { callId: 'w2', name: 'write', arguments: { file_path: './src/b.ts' } } },
  ];
  assert.equal(filesSection(buildScaffold(events)), '- /repo/src/a.ts\n- src/b.ts');
});

test('the scaffold caps the number of listed changed files', () => {
  const events = Array.from({ length: MAX_SCAFFOLD_FILES + 3 }, (_, index) => ({
    type: 'tool/call',
    seq: index + 1,
    data: { callId: `c${index}`, name: 'write', arguments: { file_path: `/repo/file-${index}.ts` } },
  }));
  const lines = filesSection(buildScaffold(events)).split('\n');
  assert.equal(lines.length, MAX_SCAFFOLD_FILES + 1);
  assert.equal(lines.at(-1), '- +3 more not listed');
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
