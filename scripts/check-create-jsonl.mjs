#!/usr/bin/env node
/**
 * RWC-002 evidence: write a prepared fork child through the shipped JSONL
 * persistence backend and read the artifact back.
 *
 * This is deliberately a separate process from check-contracts.mjs: the
 * contract probe installs a resolver hook for every `@deepseek-ai/*` import,
 * and the persistence backend's transitive message-projection import must
 * resolve from the installed profile instead. Run directly or via
 * `npm run check` (the probe spawns it).
 *
 * No profile/session under $DSH_HOME is touched: the persistence root is a
 * throwaway directory under the OS temp dir, removed in `finally`.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const hoist = join(DSH_HOME, 'profiles', 'node_modules');
const REPO = join(new URL('..', import.meta.url).pathname);
const importProfile = (specifier) => import(pathToFileURL(join(hoist, specifier)).href);

const { Context } = await importProfile('@deepseek-ai/cordis/lib/index.js');
const { default: SessionStore } = await importProfile('@deepseek-ai/dsh-session/lib/index.js');
const Jsonl = await importProfile('@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js');
const { buildCreateOptions } = await import(pathToFileURL(join(REPO, 'lib', 'create.js')).href);

const root = mkdtempSync(join(tmpdir(), 'rwc-create-jsonl-'));
const ctx = new Context();
try {
  ctx.plugin(SessionStore);
  ctx.plugin(Jsonl, { root, compression: 'none' });
  for (let attempt = 0; attempt < 100 && !ctx.sessionPersistence; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!ctx.sessionPersistence) throw new Error('JSONL persistence service did not mount');

  const seed = [{
    type: 'user/message', seq: 0, time: 1, surfaceOp: 'append',
    data: { id: 'probe-jsonl-seed', role: 'user', content: [{ type: 'text', text: 'seed' }], source: { kind: 'rewind-compact' } },
  }];
  const options = buildCreateOptions({
    source: { id: 'probe-source' },
    sessionId: 'probe-child-jsonl',
    seed,
    cwd: REPO,
    title: 'Probe source title',
    agentPreset: 'standard',
  });
  const prepared = ctx.sessions.prepare(options.sessionId, {
    seed: options.seed,
    meta: options.meta,
    inheritedEventCount: options.inheritedEventCount,
  });
  // Exercise the real setup seam (inbox clear + session/title append on the
  // prepared session), not a hand-built title event.
  await options.setup({}, { session: prepared, inbox: { clear() {} } });
  const preparedEvents = prepared.snapshotEvents();
  const titleEvent = preparedEvents.find((event) => event.type === 'session/title');
  if (titleEvent?.data?.title !== 'Probe source title (rewound)') {
    throw new Error(`setup did not append the rewound title: ${JSON.stringify(titleEvent)}`);
  }
  const handle = await ctx.sessionPersistence.create(prepared.header, {
    inheritedEventCount: prepared.inheritedEventCount,
  });
  await handle.append(preparedEvents);
  await handle.flush();
  await handle.close();

  const projectDir = readdirSync(root).find((entry) => entry.startsWith('--'));
  if (!projectDir) throw new Error('no workspace bucket was created');
  const logPath = join(root, projectDir, options.sessionId, 'session.v4.jsonl');
  if (!existsSync(logPath)) throw new Error(`child JSONL not written at ${logPath}`);
  const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const header = lines[0];
  const titleLine = lines.find((line) => line.type === 'session/title');
  const headerOk = header.type === 'session'
    && header.cwd === REPO
    && header.parentSession === 'probe-source'
    && header.isSeeded === true
    && header.agentPreset === 'standard';
  const titleOk = titleLine?.data?.title === 'Probe source title (rewound)';
  const grouped = !logPath.includes('_no-cwd');
  if (!headerOk || !titleOk || !grouped) {
    throw new Error(`child JSONL mismatch: ${JSON.stringify({ header, titleLine, grouped })}`);
  }
  const endSeed = lines.find((line) => line.type === 'session/end-seed');
  const inheritedOk = endSeed?.data?.inherited === true && endSeed.seq === seed.length;
  if (!inheritedOk) throw new Error(`session/end-seed ${JSON.stringify(endSeed)} does not mark inherited length ${seed.length}`);
  console.log(`CHILD_JSONL_OK rows=${lines.length} cwd=${header.cwd} parent=${header.parentSession} inherited=${endSeed.seq} title="${titleLine.data.title}"`);
} finally {
  ctx.stop?.();
  rmSync(root, { recursive: true, force: true });
}
